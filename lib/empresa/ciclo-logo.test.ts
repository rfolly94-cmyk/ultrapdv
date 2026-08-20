import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  executarCicloLogoEmpresa,
  MENSAGEM_FALHA_LOGO,
  MENSAGEM_LOGO_ATUALIZADA,
} from "./ciclo-logo";
import {
  caminhoLogoEmpresa,
  planejarAtualizacaoLogo,
  validarUploadLogoEmpresa,
} from "./logo";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const empresaA = "11111111-1111-4111-8111-111111111111";
const empresaB = "22222222-2222-4222-8222-222222222222";
const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);
const jpegMinimo = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);

function arquivoPng() {
  return {
    bytes: png1x1,
    nomeArquivo: "logo.png",
    mimeInformado: "image/png",
    tamanho: png1x1.length,
  };
}

function arquivoJpeg() {
  return {
    bytes: jpegMinimo,
    nomeArquivo: "logo.jpg",
    mimeInformado: "image/jpeg",
    tamanho: jpegMinimo.length,
  };
}

function bancoLogo() {
  const storage = new Map<string, Buffer>();
  let logoPath: string | null = null;
  let falharUpload = false;
  let falharPersistir = false;

  return {
    get logoPath() {
      return logoPath;
    },
    get arquivos() {
      return [...storage.keys()];
    },
    tem(path: string) {
      return storage.has(path);
    },
    falharProximoUpload() {
      falharUpload = true;
    },
    falharProximoPersistir() {
      falharPersistir = true;
    },
    deps: {
      upload: async ({
        path,
        bytes,
      }: {
        path: string;
        bytes: Buffer;
        contentType: string;
      }) => {
        if (falharUpload) {
          falharUpload = false;
          return { error: { message: "storage" } };
        }
        if (storage.has(path)) {
          return { error: { message: "duplicate" } };
        }
        storage.set(path, bytes);
        return { error: null };
      },
      persistir: async (path: string | null) => {
        if (falharPersistir) {
          falharPersistir = false;
          return { error: { message: "db" } };
        }
        logoPath = path;
        return { error: null };
      },
      confirmar: async () => logoPath,
      removerArquivo: async (path: string) => {
        storage.delete(path);
      },
    },
  };
}

test("1. empresa sem logo cadastra a primeira logo", async () => {
  const banco = bancoLogo();
  const resultado = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "primeira",
    ...banco.deps,
  });

  assert.equal(resultado.ok, true);
  if (!resultado.ok) {
    return;
  }
  assert.equal(resultado.logoPath, `${empresaA}/logo-primeira.png`);
  assert.equal(banco.logoPath, `${empresaA}/logo-primeira.png`);
  assert.equal(banco.tem(`${empresaA}/logo-primeira.png`), true);
});

test("2. primeira logo aparece na URL oficial e no sidebar", () => {
  const path = caminhoLogoEmpresa(empresaA, "image/png", "v1");
  const urlEsperada = `/storage/v1/object/public/logos-empresas/${path}`;
  assert.equal(path, `${empresaA}/logo-v1.png`);
  assert.match(fonte("lib/empresa/identidade-sessao.ts"), /pathLogoDaEmpresa/);
  assert.match(fonte("components/layout/app-sidebar.tsx"), /logoUrlUtilizavel/);
  assert.match(fonte("components/empresa/logo-empresa.tsx"), /object-contain/);
  assert.match(fonte("lib/empresa/logo.ts"), /BUCKET_LOGOS_EMPRESAS/);
  assert.equal(urlEsperada.includes(path), true);
});

test("3. trocar logo A por logo B gera path novo", async () => {
  const banco = bancoLogo();
  const primeira = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "logo-a",
    ...banco.deps,
  });
  assert.equal(primeira.ok, true);

  const segunda = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: banco.logoPath,
    arquivo: arquivoJpeg(),
    versao: "logo-b",
    ...banco.deps,
  });

  assert.equal(segunda.ok, true);
  if (!segunda.ok) {
    return;
  }
  assert.equal(segunda.logoPath, `${empresaA}/logo-logo-b.jpg`);
  assert.notEqual(segunda.logoPath, `${empresaA}/logo-logo-a.png`);
  assert.notEqual(segunda.logoPath, `${empresaA}/logo.png`);
});

test("4. banco passa a armazenar logo B", async () => {
  const banco = bancoLogo();
  await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "a",
    ...banco.deps,
  });
  await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: banco.logoPath,
    arquivo: arquivoJpeg(),
    versao: "b",
    ...banco.deps,
  });

  assert.equal(banco.logoPath, `${empresaA}/logo-b.jpg`);
  assert.equal(banco.tem(`${empresaA}/logo-a.png`), false);
  assert.equal(banco.tem(`${empresaA}/logo-b.jpg`), true);
});

test("5. sidebar e PDV consomem a logo B da empresa ativa", () => {
  const acao = fonte("app/configuracoes/empresa/actions.ts");
  const sidebar = fonte("components/layout/app-sidebar.tsx");
  const pdv = fonte("app/pdv/page.tsx");
  const form = fonte("app/configuracoes/empresa/identidade-visual-form.tsx");

  assert.match(acao, /revalidatePath\("\/", "layout"\)/);
  assert.match(acao, /revalidatePath\("\/pdv"\)/);
  assert.match(acao, /router\.refresh|revalidatePath/);
  assert.match(form, /router\.refresh\(\)/);
  assert.match(sidebar, /LogoEmpresa/);
  assert.match(pdv, /pathLogoDaEmpresa/);
  assert.match(pdv, /urlPublicaLogoEmpresa/);
  assert.doesNotMatch(sidebar, /\?random=/);
  assert.doesNotMatch(form, /Math\.random\(\)/);
});

test("6. logo A não continua na mesma URL por cache", () => {
  const pathA = caminhoLogoEmpresa(empresaA, "image/png", "111");
  const pathB = caminhoLogoEmpresa(empresaA, "image/png", "222");
  assert.notEqual(pathA, pathB);
  assert.notEqual(pathA, `${empresaA}/logo.png`);
  assert.notEqual(pathB, `${empresaA}/logo.png`);

  const plano = planejarAtualizacaoLogo({
    empresaId: empresaA,
    pathAtual: pathA,
    novoPath: pathB,
  });
  assert.equal(plano.pathFinal, pathB);
  assert.equal(plano.pathNovo, pathB);
  assert.equal(plano.pathAntigoParaRemover, pathA);

  const acao = fonte("app/configuracoes/empresa/actions.ts");
  assert.match(acao, /upsert: false/);
  assert.doesNotMatch(acao, /upsert: true/);
});

test("7. PDV usa logo B quando mostrar_logo_centro = true, sem copiar a imagem", () => {
  const prefs = fonte("lib/pdv/preferencias.ts");
  const servidor = fonte("lib/pdv/preferencias-servidor.ts");
  assert.match(prefs, /mostrarLogoCentro: boolean/);
  assert.match(prefs, /type PreferenciasPdv = \{[\s\S]*mostrarLogoCentro/);
  assert.doesNotMatch(servidor, /logo_path/);
  assert.match(fonte("app/pdv/page.tsx"), /logoUrl=\{logoUrl\}/);
  assert.match(
    fonte("lib/pdv/preferencias-servidor.ts"),
    /mostrar_logo_centro: preferencias.mostrarLogoCentro/
  );
});

test("8. empresa A não altera logo da empresa B", async () => {
  const bancoB = bancoLogo();
  const bancoA = bancoLogo();

  await executarCicloLogoEmpresa({
    empresaId: empresaB,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "b",
    ...bancoB.deps,
  });
  const pathB = bancoB.logoPath;

  const planoIgnoraB = planejarAtualizacaoLogo({
    empresaId: empresaA,
    pathAtual: pathB,
    novoPath: caminhoLogoEmpresa(empresaA, "image/jpeg", "a"),
  });
  assert.equal(planoIgnoraB.pathAntigoParaRemover, null);

  const tentativa = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: pathB,
    arquivo: arquivoJpeg(),
    versao: "a",
    ...bancoA.deps,
  });

  assert.equal(tentativa.ok, true);
  if (!tentativa.ok) {
    return;
  }
  assert.equal(tentativa.logoPath?.startsWith(`${empresaA}/`), true);
  assert.equal(tentativa.logoPath?.startsWith(`${empresaB}/`), false);
  assert.equal(pathB, `${empresaB}/logo-b.png`);
  assert.equal(bancoB.logoPath, pathB);
  assert.equal(bancoB.tem(`${empresaB}/logo-b.png`), true);
  assert.equal(bancoA.tem(`${empresaB}/logo-b.png`), false);
  assert.match(fonte("app/configuracoes/empresa/actions.ts"), /buscarVinculoEmpresaAtiva/);
  assert.match(
    fonte("app/configuracoes/empresa/actions.ts"),
    /empresaId: String\(vinculo.empresa_id\)/
  );
});

test("9. falha no novo upload preserva logo antiga", async () => {
  const banco = bancoLogo();
  await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "antiga",
    ...banco.deps,
  });
  const antiga = banco.logoPath;
  banco.falharProximoUpload();

  const falha = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: antiga,
    arquivo: arquivoJpeg(),
    versao: "nova",
    ...banco.deps,
  });

  assert.equal(falha.ok, false);
  if (falha.ok) {
    return;
  }
  assert.equal(falha.erro, MENSAGEM_FALHA_LOGO);
  assert.equal(falha.logoPathPreservado, antiga);
  assert.equal(banco.logoPath, antiga);
  assert.equal(banco.tem(`${empresaA}/logo-antiga.png`), true);
  assert.equal(banco.tem(`${empresaA}/logo-nova.jpg`), false);

  banco.falharProximoPersistir();
  const falhaDb = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: antiga,
    arquivo: arquivoJpeg(),
    versao: "nova-db",
    ...banco.deps,
  });
  assert.equal(falhaDb.ok, false);
  assert.equal(banco.logoPath, antiga);
  assert.equal(banco.tem(`${empresaA}/logo-nova-db.jpg`), false);
});

test("10. remover logo limpa o banco e o sidebar volta ao nome", async () => {
  const banco = bancoLogo();
  await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: null,
    arquivo: arquivoPng(),
    versao: "tmp",
    ...banco.deps,
  });

  const removida = await executarCicloLogoEmpresa({
    empresaId: empresaA,
    pathAtual: banco.logoPath,
    remover: true,
    ...banco.deps,
  });

  assert.equal(removida.ok, true);
  if (!removida.ok) {
    return;
  }
  assert.equal(removida.logoPath, null);
  assert.equal(banco.logoPath, null);
  assert.equal(banco.arquivos.length, 0);

  const logoUi = fonte("components/empresa/logo-empresa.tsx");
  assert.match(logoUi, /NomeEmpresa/);
  assert.match(fonte("app/configuracoes/empresa/actions.ts"), /revalidatePath\("\/", "layout"\)/);
  assert.match(fonte("app/configuracoes/empresa/actions.ts"), /MENSAGEM_LOGO_ATUALIZADA/);
});

test("validação recusa arquivo de outra empresa no plano", () => {
  assert.throws(
    () =>
      planejarAtualizacaoLogo({
        empresaId: empresaA,
        pathAtual: `${empresaA}/logo-a.png`,
        novoPath: `${empresaB}/logo-b.png`,
      }),
    /não pertence à empresa ativa/
  );
});

test("cada upload válido recebe versão estável e única", () => {
  const a = validarUploadLogoEmpresa({
    empresaId: empresaA,
    mimeInformado: "image/png",
    tamanho: png1x1.length,
    bytes: png1x1,
  });
  const b = validarUploadLogoEmpresa({
    empresaId: empresaA,
    mimeInformado: "image/png",
    tamanho: png1x1.length,
    bytes: png1x1,
  });
  assert.notEqual(a.path, b.path);
  assert.equal(a.path.startsWith(`${empresaA}/logo-`), true);
  assert.match(fonte("lib/empresa/ciclo-logo.ts"), /Logo da empresa atualizada/);
  assert.match(fonte("app/configuracoes/empresa/actions.ts"), /MENSAGEM_LOGO_ATUALIZADA/);
});
