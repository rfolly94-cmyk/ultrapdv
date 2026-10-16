import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bloqueioTefHomologacaoNfceProducao } from "@/lib/fiscal/tef/ambiente-tef-nfce";
import { origemProducaoComprovada } from "@/lib/pdv/tef/ambiente-transacao";
import { codigoBandeiraFiscal } from "@/lib/fiscal/tef/dados-fiscais-cartao";
import {
  saldoDinheiroAutomaticoPdv,
  textoParaCentavosPdv,
} from "@/lib/pdv/distribuicao-pagamento-pdv";
import { validarItensEstoquePdv } from "@/lib/pdv/venda-sem-estoque";
import { cargaPodeAtingir } from "@/lib/pdv/auditoria-isolamento";
import {
  decidirRecuperacao,
  interpretarResultadoConector,
  sanitizarParaLog,
  validarPagamentoMisto,
  type ProvaTef,
} from "@/lib/pdv/tef/regras";
import {
  iniciarOperacao,
  memoriaTefVazia,
  registrarResultado,
  salvarConfigEmpresa,
  type MemoriaTef,
} from "@/lib/pdv/tef/orquestracao";
import { assinarProvaTef, verificarProvaTef } from "@/lib/pdv/tef/prova";
import { decidirSituacaoTerminalComputador } from "@/lib/pdv/tef/estado-terminal";

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function percentil(amostras: number[], p: number) {
  const ordenadas = [...amostras].sort((a, b) => a - b);
  const indice = Math.min(
    ordenadas.length - 1,
    Math.max(0, Math.ceil((p / 100) * ordenadas.length) - 1)
  );
  return ordenadas[indice] ?? 0;
}

function memoria(empresaId = EMPRESA_A): MemoriaTef {
  const atual = memoriaTefVazia();
  atual.plataformaHabilitada = true;
  salvarConfigEmpresa(atual, empresaId, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA",
    pontoCaptura: "900001",
  });
  return atual;
}

function iniciar(
  atual: MemoriaTef,
  parcial: Partial<Parameters<typeof iniciarOperacao>[1]> = {}
) {
  return iniciarOperacao(atual, {
    empresaId: EMPRESA_A,
    dispositivoId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    terminalCodigo: "900001",
    modalidade: "debito",
    valorCentavos: 100,
    identificador: "op-1",
    idempotencyKey: "idem-1",
    ...parcial,
  });
}

function provaPix(id = "op-pix"): ProvaTef {
  return {
    id,
    empresaId: EMPRESA_A,
    modalidade: "debito",
    valorCentavos: 100,
    status: "autorizada",
    vendaId: null,
    teste: false,
    nsu: "E1928374620261011120364LDuT35VP5",
    autorizacao: null,
    rede: "PIX C6 BANK",
    ambienteEfetivo: "producao",
  };
}

test("carga recusa Supabase, SEFAZ, C6, PayGo e qualquer host externo", () => {
  assert.equal(cargaPodeAtingir("http://127.0.0.1:54321"), true);
  assert.equal(cargaPodeAtingir("http://localhost:3000"), true);
  assert.equal(
    cargaPodeAtingir("https://xdcmoqvfrdqfinylyjqt.supabase.co"),
    false
  );
  assert.equal(cargaPodeAtingir("https://nfe.sefaz.mt.gov.br"), false);
  assert.equal(cargaPodeAtingir("https://baas-api.c6bank.info"), false);
  assert.equal(cargaPodeAtingir("https://pos-transac-sb.tpgweb.io:31735"), false);
  assert.equal(cargaPodeAtingir("https://paygo.example"), false);
  assert.equal(cargaPodeAtingir(""), false);
  assert.equal(cargaPodeAtingir("not-a-url"), false);
});

test("PIX PayGo sem autorização fecha a venda e cartão sem autorização não fecha", () => {
  const pix = validarPagamentoMisto(
    [
      {
        modalidade: "debito",
        valorCentavos: 100,
        tefOperacaoId: "op-pix",
      },
    ],
    [provaPix()],
    EMPRESA_A
  );
  assert.equal(pix.ok, true);

  const cartao = validarPagamentoMisto(
    [
      {
        modalidade: "debito",
        valorCentavos: 100,
        tefOperacaoId: "op-cartao",
      },
    ],
    [{ ...provaPix("op-cartao"), rede: "MASTERCARD DEBITO", nsu: "766596" }],
    EMPRESA_A
  );
  assert.equal(cartao.ok, false);

  const semNsu = validarPagamentoMisto(
    [
      {
        modalidade: "debito",
        valorCentavos: 100,
        tefOperacaoId: "op-pix",
      },
    ],
    [{ ...provaPix(), nsu: null }],
    EMPRESA_A
  );
  assert.equal(semNsu.ok, false);

  const outraEmpresa = validarPagamentoMisto(
    [
      {
        modalidade: "debito",
        valorCentavos: 100,
        tefOperacaoId: "op-pix",
      },
    ],
    [provaPix()],
    EMPRESA_B
  );
  assert.equal(outraEmpresa.ok, false);
});

test("finalização lê a rede gravada para reconhecer PIX", () => {
  const fonte = readFileSync(new URL("./tef/finalizacao.ts", import.meta.url), "utf8");
  assert.match(fonte, /rede, instituicao, bandeira_nome/);
  assert.match(fonte, /nomeBandeiraPadrao: linha\.bandeira_nome/);
});

test("PIX não vira bandeira de cartão e homologação não financia NFC-e de produção", () => {
  assert.equal(codigoBandeiraFiscal("PIX C6 BANK"), null);
  assert.equal(codigoBandeiraFiscal("MASTERCARD DEBITO"), "02");
  assert.ok(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "homologacao",
      possuiTransacaoTef: true,
    })
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "homologacao",
      possuiTransacaoTef: false,
    }),
    null
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 2,
      ambienteTef: "homologacao",
      possuiTransacaoTef: true,
    }),
    null
  );
});

test("prova de pagamento não desfaz, prova adulterada falha e chave de outra empresa falha", () => {
  const parA = generateKeyPairSync("ed25519");
  const parB = generateKeyPairSync("ed25519");
  const publicaA = parA.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privadaA = parA.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicaB = parB.publicKey.export({ type: "spki", format: "pem" }).toString();
  const campos = {
    acao: "pagamento" as const,
    desafio: "a".repeat(64),
    identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
    valorCentavos: 100,
    nsu: "E1928374620261011120364LDuT35VP5",
    autorizacao: "",
    rede: "PIX C6 BANK",
    finalizacao: "1",
    sucesso: true,
    codigo: "",
    bandeira: "",
    cnpjCredenciadora: "",
    cnpjRecebedor: "",
    instituicao: "",
  };
  const assinatura = assinarProvaTef(privadaA, campos);
  assert.equal(verificarProvaTef(publicaA, campos, assinatura), true);
  assert.equal(
    verificarProvaTef(publicaA, { ...campos, acao: "desfazer" }, assinatura),
    false
  );
  assert.equal(
    verificarProvaTef(publicaA, { ...campos, nsu: "OUTRO" }, assinatura),
    false
  );
  assert.equal(verificarProvaTef(publicaB, campos, assinatura), false);
  assert.equal(verificarProvaTef(publicaA, campos, ""), false);
  const adulterada = Buffer.from(assinatura, "base64");
  adulterada[0] ^= 0xff;
  assert.equal(
    verificarProvaTef(publicaA, campos, adulterada.toString("base64")),
    false
  );
});

test("terminal ocupado, outra empresa e retorno duplicado não cobram de novo", () => {
  const atual = memoria();
  const primeira = iniciar(atual);
  assert.equal(primeira.ok, true);
  const concorrente = iniciar(atual, {
    identificador: "op-2",
    idempotencyKey: "idem-2",
  });
  assert.equal(concorrente.ok, false);
  if (!concorrente.ok) {
    assert.equal(concorrente.codigo, "TERMINAL_OCUPADO");
  }

  salvarConfigEmpresa(atual, EMPRESA_B, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA",
    pontoCaptura: "900001",
  });
  const outraEmpresa = iniciar(atual, {
    empresaId: EMPRESA_B,
    dispositivoId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    identificador: "op-b",
    idempotencyKey: "idem-b",
  });
  assert.equal(outraEmpresa.ok, false);
  if (!outraEmpresa.ok) {
    assert.equal(outraEmpresa.codigo, "TERMINAL_OUTRA_EMPRESA");
  }

  if (!primeira.ok) {
    return;
  }
  const resultado = {
    sucessoTransacao: true,
    nsu: "E2EPIX",
    autorizacao: "",
    rede: "PIX C6 BANK",
    finalizacao: "1",
    valor: 1,
    confirmar: true,
  };
  const gravado = registrarResultado(atual, {
    empresaId: EMPRESA_A,
    operacaoId: primeira.operacaoId,
    resultado,
    provaValida: true,
    origem: origemProducaoComprovada(),
  });
  const repetido = registrarResultado(atual, {
    empresaId: EMPRESA_A,
    operacaoId: primeira.operacaoId,
    resultado,
    provaValida: true,
    origem: origemProducaoComprovada(),
  });
  assert.equal(gravado.ok && gravado.status, "autorizada");
  assert.equal(repetido.ok && repetido.repetida, true);
  assert.equal(atual.operacoes.length, 1);
  assert.equal(
    decidirRecuperacao({
      empresaId: EMPRESA_A,
      operacao: atual.operacoes[0] ?? null,
      existeVenda: false,
    }).acao,
    "desfazer"
  );
  assert.equal(
    decidirRecuperacao({
      empresaId: EMPRESA_A,
      operacao: atual.operacoes[0] ?? null,
      existeVenda: false,
    }).confirmar,
    false
  );
});

test("timeout, negação e identificadores ausentes não confirmam", () => {
  const esperado = { valorCentavos: 100, identificador: "op-1" };
  assert.equal(
    interpretarResultadoConector(
      { codigo: "TEF_TIMEOUT", sucessoTransacao: true },
      esperado,
      true
    ).status,
    "timeout"
  );
  assert.equal(
    interpretarResultadoConector(
      { sucessoTransacao: false, nsu: "1", autorizacao: "A", rede: "X", finalizacao: "1" },
      esperado,
      true
    ).status,
    "recusada"
  );
  assert.equal(
    interpretarResultadoConector(
      { sucessoTransacao: true, nsu: "1", rede: "PIX C6 BANK", finalizacao: "1", valor: 1, confirmar: true },
      esperado,
      false
    ).status,
    "desconhecida"
  );
  assert.equal(
    decidirRecuperacao({
      empresaId: EMPRESA_A,
      operacao: {
        empresaId: EMPRESA_A,
        status: "desconhecida",
        vendaId: null,
        teste: false,
      },
      existeVenda: false,
    }).acao,
    "reconciliar"
  );
});

test("computador pareado em outra empresa não entra no caixa atual", () => {
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: "dev",
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: EMPRESA_B,
      terminalDestaEmpresa: null,
      dispositivoDeOutraEmpresa: false,
    }),
    "outra_empresa"
  );
});

test("último item, estoque agregado e venda sem estoque", () => {
  const estoque = new Map([
    ["p1", 1],
    ["p2", 0],
  ]);
  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: false,
      itens: [
        { produtoId: "p1", quantidade: 1 },
        { produtoId: "p1", quantidade: 1 },
      ],
      estoquePorProduto: estoque,
    }).ok,
    false
  );
  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: false,
      itens: [{ produtoId: "p1", quantidade: 1 }],
      estoquePorProduto: estoque,
    }).ok,
    true
  );
  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: true,
      itens: [{ produtoId: "p2", quantidade: 5 }],
      estoquePorProduto: estoque,
    }).ok,
    true
  );
});

test("centavos de pagamento misto não perdem o residual do dinheiro", () => {
  assert.equal(textoParaCentavosPdv("0,10"), 10);
  assert.equal(textoParaCentavosPdv("0,20"), 20);
  assert.equal(textoParaCentavosPdv("1.234,56"), 123456);
  assert.equal(saldoDinheiroAutomaticoPdv(1000, 333 + 667), 0);
  assert.equal(saldoDinheiroAutomaticoPdv(1000, 999), 1);
  assert.equal(textoParaCentavosPdv("-1"), 0);
});

test("log de TEF não conserva segredo, certificado nem chave privada", () => {
  const limpo = sanitizarParaLog({
    nsu: "123",
    chavePrivada: "SEGREDO",
    certificado: "CERT",
    csc: "CSC",
    segredoVinculo: "VINCULO",
    authorization: "Bearer abc",
  }) as Record<string, unknown>;
  assert.equal(limpo.nsu, "123");
  assert.equal("chavePrivada" in limpo, false);
  assert.equal("certificado" in limpo, false);
  assert.equal("csc" in limpo, false);
  assert.equal("segredoVinculo" in limpo, false);
  assert.equal("authorization" in limpo, false);
});

test("simulação local de 50 caixas e 1000 vendas não duplica operação nem confirma antes da venda", () => {
  const antes = process.memoryUsage().heapUsed;
  const duracoes: number[] = [];
  let erros = 0;
  let duplicadas = 0;
  let confirmadasCedo = 0;
  const caixas = 50;
  const vendasPorCaixa = 20;

  for (let caixa = 0; caixa < caixas; caixa += 1) {
    for (let venda = 0; venda < vendasPorCaixa; venda += 1) {
      const inicioMs = performance.now();
      const atual = memoria();
      const dispositivo = `dev-${caixa}`;
      const criado = iniciar(atual, {
        dispositivoId: dispositivo,
        terminalCodigo: String(800000 + caixa),
        identificador: `id-${caixa}-${venda}`,
        idempotencyKey: `idem-${caixa}-${venda}`,
        desafio: randomBytes(8).toString("hex"),
      });
      if (!criado.ok) {
        erros += 1;
        duracoes.push(performance.now() - inicioMs);
        continue;
      }
      const repetida = iniciar(atual, {
        dispositivoId: dispositivo,
        terminalCodigo: String(800000 + caixa),
        identificador: `id-${caixa}-${venda}`,
        idempotencyKey: `idem-${caixa}-${venda}`,
      });
      if (!repetida.ok || !repetida.repetida || atual.operacoes.length !== 1) {
        duplicadas += 1;
      }
      registrarResultado(atual, {
        empresaId: EMPRESA_A,
        operacaoId: criado.operacaoId,
        resultado: {
          sucessoTransacao: true,
          nsu: `E2E-${caixa}-${venda}`,
          autorizacao: "",
          rede: "PIX C6 BANK",
          finalizacao: "1",
          valor: 1,
          confirmar: true,
        },
        provaValida: true,
        origem: origemProducaoComprovada(),
      });
      const recuperacao = decidirRecuperacao({
        empresaId: EMPRESA_A,
        operacao: atual.operacoes[0] ?? null,
        existeVenda: false,
      });
      if (recuperacao.confirmar || recuperacao.acao === "confirmar") {
        confirmadasCedo += 1;
      }
      duracoes.push(performance.now() - inicioMs);
    }
  }

  const total = caixas * vendasPorCaixa;
  assert.equal(erros, 0);
  assert.equal(duplicadas, 0);
  assert.equal(confirmadasCedo, 0);
  assert.equal(duracoes.length, total);
  const heap = process.memoryUsage().heapUsed - antes;
  console.log(
    JSON.stringify({
      simulado: true,
      total,
      erros,
      duplicadas,
      confirmadasCedo,
      p50ms: Number(percentil(duracoes, 50).toFixed(3)),
      p95ms: Number(percentil(duracoes, 95).toFixed(3)),
      p99ms: Number(percentil(duracoes, 99).toFixed(3)),
      heapDeltaBytes: heap,
    })
  );
});
