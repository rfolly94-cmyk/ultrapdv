import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import tls from "node:tls";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  chaveSeparadaDoCofre,
  fingerprintChavePem,
  MENSAGEM_ENVIAR_CHAVE_CORRESPONDENTE_C6,
  MENSAGEM_PAR_MTLS_C6,
  MENSAGEM_SANDBOX_EM_PRODUCAO_C6,
  MENSAGEM_SOMENTE_CERTIFICADO_PUBLICO_C6,
  planejarSubstituicaoMtlsC6,
  resolverMaterialMtlsC6,
  usarMtlsC6,
} from "./material-mtls";

type Par = { cert: string; key: string };

function binarioOpenssl() {
  const git = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  if (process.platform === "win32" && existsSync(git)) {
    return git;
  }
  return "openssl";
}

function openssl(args: string[], cwd: string) {
  execFileSync(binarioOpenssl(), args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
}

function spki(pem: string) {
  return createHash("sha256")
    .update(new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function hex(valor: string | Buffer) {
  return Buffer.from(valor).toString("hex");
}

function zipArmazenado(arquivos: { nome: string; conteudo: Buffer }[]) {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(arquivo.conteudo.length, 18);
    local.writeUInt32LE(arquivo.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    const localCompleto = Buffer.concat([local, nome, arquivo.conteudo]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(arquivo.conteudo.length, 20);
    central.writeUInt32LE(arquivo.conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(Buffer.concat([central, nome]));
    locais.push(localCompleto);
    offset += localCompleto.length;
  }

  const centralDir = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8);
  eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, centralDir, eocd]);
}

function laboratorio() {
  const dir = mkdtempSync(join(tmpdir(), "c6-mtls-"));
  const gerar = (nome: string): Par => {
    openssl(
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        `${nome}.key`,
        "-out",
        `${nome}.crt`,
        "-days",
        "2",
        "-nodes",
        "-subj",
        `/CN=${nome}`,
      ],
      dir
    );
    return {
      cert: readFileSync(join(dir, `${nome}.crt`), "utf8"),
      key: readFileSync(join(dir, `${nome}.key`), "utf8"),
    };
  };

  openssl(
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "2",
      "-nodes",
      "-subj",
      "/CN=ca-c6",
    ],
    dir
  );
  openssl(
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
      "-nodes",
      "-subj",
      "/CN=leaf-c6",
    ],
    dir
  );
  openssl(
    [
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "leaf.crt",
      "-days",
      "2",
    ],
    dir
  );

  const producao = gerar("producao");
  const outro = gerar("outro");
  openssl(
    [
      "pkcs12",
      "-export",
      "-inkey",
      "producao.key",
      "-in",
      "producao.crt",
      "-out",
      "producao.pfx",
      "-passout",
      "pass:",
    ],
    dir
  );

  const dados = {
    dir,
    producao,
    outro,
    ca: readFileSync(join(dir, "ca.crt"), "utf8"),
    leafCert: readFileSync(join(dir, "leaf.crt"), "utf8"),
    leafKey: readFileSync(join(dir, "leaf.key"), "utf8"),
    pfx: readFileSync(join(dir, "producao.pfx")),
  };

  return {
    ...dados,
    fechar() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const lab = laboratorio();

test("certificado e chave do mesmo par passam e o contexto TLS abre", () => {
  const material = resolverMaterialMtlsC6({
    certificado: hex(lab.producao.cert),
    chavePrivada: hex(lab.producao.key),
    ambiente: "2",
  });
  assert.equal(material.pfx, undefined);
  assert.equal(
    fingerprintChavePem(String(material.key)),
    fingerprintChavePem(lab.producao.key)
  );
  assert.doesNotThrow(() =>
    tls.createSecureContext({ cert: material.cert, key: material.key })
  );
});

test("certificado e chave diferentes falham antes de qualquer HTTP", async () => {
  let chamado = false;
  await assert.rejects(
    () =>
      usarMtlsC6(
        {
          certificado: lab.producao.cert,
          chavePrivada: lab.outro.key,
          ambiente: "2",
        },
        async () => {
          chamado = true;
          return true;
        }
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", MENSAGEM_PAR_MTLS_C6);
      assert.equal(String(error instanceof Error ? error.message : "").includes("PRIVATE"), false);
      return true;
    }
  );
  assert.equal(chamado, false);
});

test("produção não reutiliza a chave privada de sandbox", () => {
  assert.throws(
    () =>
      resolverMaterialMtlsC6({
        certificado: lab.producao.cert,
        chavePrivada: lab.producao.key,
        ambiente: "1",
        chaveSandbox: lab.producao.key,
        certificadoSandbox: lab.producao.cert,
      }),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : "",
        MENSAGEM_SANDBOX_EM_PRODUCAO_C6
      );
      return true;
    }
  );

  const material = resolverMaterialMtlsC6({
    certificado: lab.producao.cert,
    chavePrivada: lab.producao.key,
    ambiente: "1",
    chaveSandbox: lab.outro.key,
    certificadoSandbox: lab.outro.cert,
  });
  assert.equal(
    fingerprintChavePem(String(material.key)),
    fingerprintChavePem(lab.producao.key)
  );
  assert.notEqual(
    fingerprintChavePem(String(material.key)),
    fingerprintChavePem(lab.outro.key)
  );
});

test("certificado público sozinho não combina com a chave de sandbox", async () => {
  let chamado = false;
  await assert.rejects(
    () =>
      usarMtlsC6(
        {
          certificado: lab.producao.cert,
          chavePrivada: "",
          ambiente: "1",
          chaveSandbox: lab.producao.key,
          certificadoSandbox: lab.outro.cert,
        },
        async () => {
          chamado = true;
          return true;
        }
      ),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : "",
        MENSAGEM_SOMENTE_CERTIFICADO_PUBLICO_C6
      );
      return true;
    }
  );
  assert.equal(chamado, false);
});

test("PEM combinado usa o par do mesmo arquivo e ignora outra chave", () => {
  const material = resolverMaterialMtlsC6({
    certificado: `${lab.producao.cert}\n${lab.producao.key}`,
    chavePrivada: lab.outro.key,
    ambiente: "1",
    chaveSandbox: lab.outro.key,
  });
  assert.equal(
    fingerprintChavePem(String(material.key)),
    fingerprintChavePem(lab.producao.key)
  );
  assert.equal(spki(String(material.cert)), spki(lab.producao.cert));
});

test("cadeia com a CA na frente escolhe o certificado que casa com a chave", () => {
  const material = resolverMaterialMtlsC6({
    certificado: `${lab.ca}\n${lab.leafCert}`,
    chavePrivada: lab.leafKey,
    ambiente: "2",
  });
  const primeiro = String(material.cert).match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
  )?.[0];
  assert.ok(primeiro);
  assert.equal(spki(primeiro ?? ""), spki(lab.leafCert));
  assert.doesNotThrow(() =>
    tls.createSecureContext({ cert: material.cert, key: material.key })
  );
});

test("ZIP do C6 com crt e key forma o par e não mistura outra chave", () => {
  const zip = zipArmazenado([
    { nome: "certificado.crt", conteudo: Buffer.from(lab.producao.cert, "utf8") },
    { nome: "chave.key", conteudo: Buffer.from(lab.producao.key, "utf8") },
  ]);
  const material = resolverMaterialMtlsC6({
    certificado: hex(zip),
    chavePrivada: hex(lab.outro.key),
    ambiente: "1",
    chaveSandbox: lab.outro.key,
  });
  assert.equal(
    fingerprintChavePem(String(material.key)),
    fingerprintChavePem(lab.producao.key)
  );
});

test("PFX válido abre o contexto sem usar a chave antiga", () => {
  const material = resolverMaterialMtlsC6({
    certificado: hex(lab.pfx),
    chavePrivada: hex(lab.outro.key),
    ambiente: "2",
  });
  assert.ok(material.pfx && material.pfx.byteLength > 0);
  assert.equal(material.key, undefined);
  assert.doesNotThrow(() => tls.createSecureContext({ pfx: material.pfx }));
});

test("o agente de produção não aponta a chave de sandbox", () => {
  const adapter = fonte("lib/pagamentos/pix/c6/adapter.ts");
  assert.match(adapter, /resolverMaterialMtlsC6/);
  assert.match(adapter, /chaveSeparadaDoCofre/);
  assert.match(adapter, /chaveSandbox/);
  assert.doesNotMatch(adapter, /pemDeHexadecimal/);
  assert.match(fonte("lib/pagamentos/pix/c6/http.ts"), /validarMaterialTlsC6/);
  const actions = fonte("app/configuracoes/financeiro/pix/actions.ts");
  const plano = actions.indexOf("planejarSubstituicaoMtlsC6");
  const gravacao = actions.indexOf("salvar_segredo_bancario_provedor");
  assert.ok(plano >= 0 && gravacao > plano);
  assert.doesNotMatch(
    actions,
    /chavePrivadaPemHexadecimal \?\?\s*\n?\s*existentes\.chavePrivadaPemHexadecimal/
  );
});

function pemDoPlano(valor: string) {
  return Buffer.from(valor, "hex").toString("utf8");
}

function cofreDepoisDaTentativa(params: {
  certificado: string;
  chave: string;
  certificadoNovo?: string;
  chaveNova?: string;
}) {
  const antes = {
    certificado: params.certificado,
    chave: params.chave,
    erro: null as string | null,
  };
  try {
    const plano = planejarSubstituicaoMtlsC6({
      certificadoNovo: params.certificadoNovo,
      chaveNova: params.chaveNova,
      certificadoAtual: antes.certificado,
      chaveAtual: antes.chave,
      ambiente: "1",
    });
    if (!plano.substituir) {
      return antes;
    }
    return {
      certificado: plano.certificadoPemHexadecimal,
      chave: plano.chavePrivadaPemHexadecimal,
      erro: null,
    };
  } catch (error) {
    assert.ok(error instanceof Error);
    return { ...antes, erro: error.message };
  }
}

test("certificado novo com chave antiga do cofre é rejeitado", () => {
  const resultado = cofreDepoisDaTentativa({
    certificado: hex(lab.producao.cert),
    chave: hex(lab.producao.key),
    certificadoNovo: hex(lab.outro.cert),
    chaveNova: hex(lab.producao.key),
  });
  assert.equal(resultado.erro, MENSAGEM_PAR_MTLS_C6);
  assert.equal(resultado.certificado, hex(lab.producao.cert));
  assert.equal(resultado.chave, hex(lab.producao.key));
});

test("certificado público novo não reaproveita a chave antiga", () => {
  const resultado = cofreDepoisDaTentativa({
    certificado: hex(lab.producao.cert),
    chave: hex(lab.producao.key),
    certificadoNovo: hex(lab.outro.cert),
  });
  assert.equal(resultado.erro, MENSAGEM_ENVIAR_CHAVE_CORRESPONDENTE_C6);
  assert.equal(resultado.certificado, hex(lab.producao.cert));
  assert.equal(resultado.chave, hex(lab.producao.key));
  assert.equal(
    chaveSeparadaDoCofre(hex(lab.outro.cert), hex(lab.producao.key)),
    hex(lab.producao.key)
  );
});

test("ZIP novo substitui certificado e chave antigos", () => {
  const zip = zipArmazenado([
    { nome: "certificado.crt", conteudo: Buffer.from(lab.outro.cert, "utf8") },
    { nome: "chave.key", conteudo: Buffer.from(lab.outro.key, "utf8") },
  ]);
  const plano = planejarSubstituicaoMtlsC6({
    certificadoNovo: hex(zip),
    certificadoAtual: hex(lab.producao.cert),
    chaveAtual: hex(lab.producao.key),
    ambiente: "1",
  });
  assert.equal(plano.substituir, true);
  if (!plano.substituir) {
    return;
  }
  assert.equal(
    fingerprintChavePem(pemDoPlano(plano.chavePrivadaPemHexadecimal)),
    fingerprintChavePem(lab.outro.key)
  );
  assert.notEqual(
    fingerprintChavePem(pemDoPlano(plano.chavePrivadaPemHexadecimal)),
    fingerprintChavePem(lab.producao.key)
  );
  assert.equal(spki(pemDoPlano(plano.certificadoPemHexadecimal)), spki(lab.outro.cert));
  assert.equal(
    chaveSeparadaDoCofre(hex(zip), hex(lab.producao.key)),
    ""
  );
});

test("PEM combinado novo substitui o par antigo", () => {
  const plano = planejarSubstituicaoMtlsC6({
    certificadoNovo: hex(`${lab.outro.cert}\n${lab.outro.key}`),
    chaveAtual: hex(lab.producao.key),
    certificadoAtual: hex(lab.producao.cert),
    ambiente: "1",
  });
  assert.equal(plano.substituir, true);
  if (!plano.substituir) {
    return;
  }
  assert.equal(
    fingerprintChavePem(pemDoPlano(plano.chavePrivadaPemHexadecimal)),
    fingerprintChavePem(lab.outro.key)
  );
  assert.equal(spki(pemDoPlano(plano.certificadoPemHexadecimal)), spki(lab.outro.cert));
});

test("PFX novo ignora o PEM antigo", () => {
  const plano = planejarSubstituicaoMtlsC6({
    certificadoNovo: hex(lab.pfx),
    chaveAtual: hex(lab.outro.key),
    certificadoAtual: hex(lab.outro.cert),
    ambiente: "2",
  });
  assert.equal(plano.substituir, true);
  if (!plano.substituir) {
    return;
  }
  assert.equal(plano.chavePrivadaPemHexadecimal, hex(lab.pfx));
  assert.notEqual(plano.chavePrivadaPemHexadecimal, hex(lab.outro.key));
  const material = resolverMaterialMtlsC6({
    certificado: plano.certificadoPemHexadecimal,
    chavePrivada: chaveSeparadaDoCofre(
      plano.certificadoPemHexadecimal,
      hex(lab.outro.key)
    ),
    ambiente: "2",
  });
  assert.ok(material.pfx && material.pfx.byteLength > 0);
  assert.equal(material.key, undefined);
});

test("par novo válido substitui os dois segredos", () => {
  const plano = planejarSubstituicaoMtlsC6({
    certificadoNovo: hex(lab.outro.cert),
    chaveNova: hex(lab.outro.key),
    certificadoAtual: hex(lab.producao.cert),
    chaveAtual: hex(lab.producao.key),
    ambiente: "1",
  });
  assert.equal(plano.substituir, true);
  if (!plano.substituir) {
    return;
  }
  assert.equal(
    fingerprintChavePem(pemDoPlano(plano.chavePrivadaPemHexadecimal)),
    fingerprintChavePem(lab.outro.key)
  );
  assert.equal(spki(pemDoPlano(plano.certificadoPemHexadecimal)), spki(lab.outro.cert));
  assert.doesNotThrow(() =>
    tls.createSecureContext({
      cert: pemDoPlano(plano.certificadoPemHexadecimal),
      key: pemDoPlano(plano.chavePrivadaPemHexadecimal),
    })
  );
});

test("erro no upload novo preserva o par antigo inteiro", () => {
  const resultado = cofreDepoisDaTentativa({
    certificado: hex(lab.producao.cert),
    chave: hex(lab.producao.key),
    certificadoNovo: hex(lab.outro.cert),
    chaveNova: hex(lab.producao.key),
  });
  assert.equal(resultado.certificado, hex(lab.producao.cert));
  assert.equal(resultado.chave, hex(lab.producao.key));
  assert.equal(
    planejarSubstituicaoMtlsC6({
      certificadoAtual: hex(lab.producao.cert),
      chaveAtual: hex(lab.producao.key),
      ambiente: "1",
    }).substituir,
    false
  );
});

after(() => {
  lab.fechar();
});
