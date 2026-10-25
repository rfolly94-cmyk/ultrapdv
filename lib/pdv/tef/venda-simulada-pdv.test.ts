import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  avaliarCartaoAntesDaCobranca,
  cartaoVinculadoSemHabilitacao,
  MENSAGEM_HABILITAR_TEF,
  motivoBloqueioTef,
  selecionarParcelasTef,
} from "./cartao-checkout";
import { executarCobrancasTef, executarVendaPinpad } from "./fluxo-cliente";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, MENSAGEM_COBRANCA_BLOQUEADA } from "./motor";
import { classificarFormaTef } from "./regras";
import {
  conduzirVendaSimuladaPdv,
  dllSimulada,
  encaminharCliqueSimulado,
  pedidoSimulado,
} from "./venda-simulada-pdv";

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function autorizado(empresaId: string, terminalCodigo = "caixa-1") {
  return { empresaId, terminalCodigo, dispositivoId: "disp-1" };
}

function pedido(idempotencyKey: string, vendaId = "venda-1") {
  return pedidoSimulado({
    vendaId,
    idempotencyKey,
    valorCentavos: 2590,
    modalidade: "debito",
  });
}

test("clique em homologação percorre os estados sem receber o pagamento", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  try {
    const transporte = dllSimulada("aprovada");
    const resultado = await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-1"),
      raiz,
      biblioteca: transporte.biblioteca,
    });
    assert.deepEqual(resultado.estados, [
      "Processando.",
      "Aguardando cartão.",
      "Processando.",
      "Autorizado, aguardando confirmação.",
      "Confirmado.",
    ]);
    assert.equal(resultado.ok, false);
    assert.equal(resultado.pagamentoRecebido, false);
    assert.equal(resultado.podeFinalizar, false);
    assert.deepEqual(resultado.operacoes, []);
    assert.equal(resultado.status, "confirmada");
    assert.equal(transporte.funcoes.estado.novas, 1);
    assert.equal(transporte.funcoes.estado.confirmacoes, 1);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("duplo clique não inicia outra transação", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  try {
    const transporte = dllSimulada("aprovada");
    const entrada = {
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-duplo"),
      raiz,
      biblioteca: transporte.biblioteca,
    };
    const primeiro = encaminharCliqueSimulado(entrada);
    const segundo = encaminharCliqueSimulado(entrada);
    const [a, b] = await Promise.all([primeiro, segundo]);
    assert.equal(a, b);
    assert.equal(a.pagamentoRecebido, false);
    assert.equal(a.podeFinalizar, false);
    const repetido = await encaminharCliqueSimulado(entrada);
    assert.equal(repetido.status, "confirmada");
    assert.equal(repetido.pagamentoRecebido, false);
    assert.equal(transporte.funcoes.estado.novas, 1);
    assert.deepEqual(repetido.operacoes, []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("falha de comunicação não confirma nem finaliza", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  try {
    const transporte = dllSimulada("rede");
    const resultado = await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-rede"),
      raiz,
      roteiro: "rede",
      biblioteca: transporte.biblioteca,
    });
    assert.equal(resultado.estados.includes("Recuperação necessária."), true);
    assert.equal(resultado.pagamentoRecebido, false);
    assert.equal(resultado.podeFinalizar, false);
    assert.equal(transporte.funcoes.estado.confirmacoes, 0);
    assert.deepEqual(resultado.operacoes, []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("queda após autorização exige recuperação e não recebe o pagamento", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  try {
    const transporte = dllSimulada("aprovada");
    const comum = {
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-queda"),
      raiz,
      biblioteca: transporte.biblioteca,
    };
    const autorizada = await conduzirVendaSimuladaPdv({ ...comum, pararEm: "autorizada" });
    assert.equal(autorizada.estados.includes("Autorizado, aguardando confirmação."), true);
    assert.equal(autorizada.pagamentoRecebido, false);
    const retomada = await conduzirVendaSimuladaPdv({ ...comum, acao: "retomar" });
    assert.equal(retomada.estados.includes("Recuperação necessária."), true);
    assert.equal(retomada.estados.includes("Autorizado, aguardando confirmação."), true);
    assert.equal(retomada.pagamentoRecebido, false);
    assert.equal(retomada.podeFinalizar, false);
    assert.equal(transporte.funcoes.estado.confirmacoes, 0);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("confirmação de outra empresa não é reutilizada", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  const arquivoLivro = path.join(raiz, "livro.json");
  const arquivoJournal = path.join(raiz, "journal.json");
  try {
    const transporte = dllSimulada("aprovada");
    await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-isolada"),
      raiz,
      arquivoLivro,
      arquivoJournal,
      biblioteca: transporte.biblioteca,
      pararEm: "autorizada",
    });
    const outra = dllSimulada("aprovada");
    const resultado = await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-b"),
      pedido: pedido("idem-isolada"),
      raiz,
      arquivoLivro,
      arquivoJournal,
      biblioteca: outra.biblioteca,
      acao: "confirmar",
    });
    assert.equal(resultado.situacao, "isolada");
    assert.equal(resultado.estados.includes("Recuperação necessária."), true);
    assert.equal(resultado.pagamentoRecebido, false);
    assert.equal(resultado.podeFinalizar, false);
    assert.equal(outra.funcoes.estado.confirmacoes, 0);
    assert.deepEqual(resultado.operacoes, []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("recusa e desfazimento pendente aparecem sem baixa", async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-"));
  try {
    const recusada = await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-a"),
      pedido: pedido("idem-recusa"),
      raiz,
      roteiro: "recusada",
    });
    assert.equal(recusada.estados.includes("Recusado."), true);
    assert.equal(recusada.pagamentoRecebido, false);
    const falha = await conduzirVendaSimuladaPdv({
      autorizado: autorizado("empresa-a", "caixa-2"),
      pedido: pedido("idem-falha", "venda-2"),
      raiz,
      arquivoJournal: path.join(raiz, "falha-journal.json"),
      arquivoLivro: path.join(raiz, "falha-livro.json"),
      roteiro: "falha",
    });
    assert.equal(falha.estados.includes("Desfazimento pendente."), true);
    assert.equal(falha.pagamentoRecebido, false);
    assert.equal(falha.podeFinalizar, false);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

const formasDaEmpresa = {
  debito: {
    codigo: "CARTAO_DEBITO",
    nome: "Cartão de Débito",
    tipo: "CARTAO_DEBITO",
    codigo_fiscal: "04",
    permite_fiado: false,
  },
  credito: {
    codigo: "CARTAO_CREDITO",
    nome: "Cartão de Crédito",
    tipo: "CARTAO_CREDITO",
    codigo_fiscal: "03",
    permite_fiado: false,
  },
  dinheiro: {
    codigo: "DINHEIRO",
    nome: "Dinheiro",
    tipo: "DINHEIRO",
    codigo_fiscal: "01",
    permite_fiado: false,
  },
  pix: {
    codigo: "PIX",
    nome: "PIX",
    tipo: "PIX",
    codigo_fiscal: "20",
    permite_fiado: false,
  },
  duplicata: {
    codigo: "DUPLICATA_MERCANTIL",
    nome: "Duplicata Mercantil",
    tipo: "OUTROS",
    codigo_fiscal: "14",
    permite_fiado: false,
  },
  fiado: {
    codigo: "FIADO",
    nome: "Fiado / Crédito Loja",
    tipo: "FIADO",
    codigo_fiscal: "05",
    permite_fiado: true,
  },
};

test("simulação só ocorre com TEF habilitado em homologação", async () => {
  assert.equal(classificarFormaTef(formasDaEmpresa.debito), "debito");
  assert.equal(classificarFormaTef(formasDaEmpresa.credito), "credito");
  for (const modalidade of ["debito", "credito"] as const) {
    const desligado = selecionarParcelasTef({
      parcelas: [{ modalidade, formaPagamentoId: modalidade, valorCentavos: 5500 }],
      cobrarNoPinpad: false,
      tefHabilitado: false,
      ambiente: "homologacao",
      cobrancaRealBloqueada: true,
    });
    assert.equal(desligado.simular, false);
    assert.deepEqual(desligado.parcelas, []);
    const bloqueio = avaliarCartaoAntesDaCobranca(
      {
        plataformaHabilitada: true,
        empresaHabilitada: false,
        permitirOperacaoManual: true,
        ambiente: "homologacao",
      },
      [{ modalidade, operacaoManual: false }]
    );
    assert.equal(bloqueio.ok, false);
    if (!bloqueio.ok) {
      assert.equal(bloqueio.erro, MENSAGEM_HABILITAR_TEF);
    }
    const chamadas: string[] = [];
    const selecao = selecionarParcelasTef({
      parcelas: [{ modalidade, formaPagamentoId: modalidade, valorCentavos: 5500 }],
      cobrarNoPinpad: true,
      tefHabilitado: true,
      ambiente: "homologacao",
      cobrancaRealBloqueada: true,
    });
    assert.equal(selecao.simular, false);
    assert.equal(selecao.prepararNativo, true);
    assert.equal(selecao.parcelas.length, 1);
    const resultado = await executarCobrancasTef(
      {
        parcelas: selecao.parcelas.map((parcela) => ({
          formaPagamentoId: parcela.formaPagamentoId,
          modalidade: parcela.modalidade as "debito" | "credito",
          valorCentavos: parcela.valorCentavos,
        })),
        origem: "http://127.0.0.1:18181",
        dispositivoId: "disp-1",
        idempotencyKey: () => `idem-${modalidade}`,
        grupoVenda: "venda-pdv",
        ambiente: "homologacao",
      },
      {
        fetchImpl: async (url, init) => {
          chamadas.push(`${init?.method ?? "GET"} ${url}`);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              estados: ["Processando.", "Aguardando cartão.", "Confirmado."],
              operacoes: [{ operacaoId: "nao-usar" }],
              pagamentoRecebido: true,
            }),
          };
        },
      }
    );
    assert.equal(resultado.ok, false);
    assert.equal("simulado" in resultado && resultado.simulado, false);
    assert.equal("comandoEnviado" in resultado && resultado.comandoEnviado, false);
    assert.deepEqual(resultado.operacoes, []);
    assert.equal(resultado.pagamentoRecebido, false);
    assert.deepEqual(resultado.estados, []);
    assert.equal(chamadas.length, 0);
    const repetido = await executarCobrancasTef(
      {
        parcelas: [
          {
            formaPagamentoId: modalidade,
            modalidade,
            valorCentavos: 5500,
          },
        ],
        origem: "http://127.0.0.1:18181",
        dispositivoId: "disp-1",
        idempotencyKey: () => `idem-${modalidade}`,
        grupoVenda: "venda-pdv",
        ambiente: "homologacao",
      },
      {
        fetchImpl: async (url, init) => {
          chamadas.push(`${init?.method ?? "GET"} ${url}`);
          return { ok: true, status: 200, json: async () => ({ estados: ["Confirmado."], operacoes: [] }) };
        },
      }
    );
    assert.deepEqual(repetido.operacoes, []);
    assert.equal(repetido.pagamentoRecebido, false);
  }
  assert.equal(
    cartaoVinculadoSemHabilitacao({
      ambiente: "homologacao",
      empresaHabilitada: false,
      formas: [formasDaEmpresa.debito],
    }),
    true
  );
  assert.equal(
    cartaoVinculadoSemHabilitacao({
      ambiente: "homologacao",
      empresaHabilitada: true,
      formas: [formasDaEmpresa.credito],
    }),
    false
  );
});

test("dinheiro, PIX, duplicata e fiado não chamam a simulação", () => {
  for (const forma of [
    formasDaEmpresa.dinheiro,
    formasDaEmpresa.pix,
    formasDaEmpresa.duplicata,
    formasDaEmpresa.fiado,
  ]) {
    assert.equal(classificarFormaTef(forma), null);
  }
  const selecao = selecionarParcelasTef({
    parcelas: [{ modalidade: null, formaPagamentoId: "dinheiro", valorCentavos: 5500 }],
    cobrarNoPinpad: false,
    tefHabilitado: false,
    ambiente: "homologacao",
    cobrancaRealBloqueada: true,
  });
  assert.equal(selecao.simular, false);
  assert.deepEqual(selecao.parcelas, []);
  assert.equal(
    cartaoVinculadoSemHabilitacao({
      ambiente: "homologacao",
      empresaHabilitada: false,
      formas: [formasDaEmpresa.dinheiro, formasDaEmpresa.pix, formasDaEmpresa.duplicata, formasDaEmpresa.fiado],
    }),
    false
  );
  const producao = selecionarParcelasTef({
    parcelas: [{ modalidade: "debito" as const, formaPagamentoId: "debito", valorCentavos: 5500 }],
    cobrarNoPinpad: true,
    tefHabilitado: true,
    ambiente: "producao",
    cobrancaRealBloqueada: true,
  });
  assert.equal(producao.simular, false);
  assert.equal(producao.parcelas.length, 1);
  const finalizacao = readFileSync(path.join(raizRepo, "lib/pdv/tef/finalizacao.ts"), "utf8");
  const shell = readFileSync(path.join(raizRepo, "components/pdv/pdv-shell.tsx"), "utf8");
  const fluxoCliente = readFileSync(path.join(raizRepo, "lib/pdv/tef/fluxo-cliente.ts"), "utf8");
  assert.ok(
    finalizacao.indexOf("cartaoVinculadoSemHabilitacao") <
      finalizacao.indexOf("!habilitacao.empresaHabilitada && !informouTef")
  );
  assert.equal(shell.includes("Cobrança indisponível"), true);
  assert.equal(shell.includes("MENSAGEM_HABILITAR_TEF"), true);
  assert.equal(fluxoCliente.includes("A cobrança TEF foi desativada"), true);
  assert.equal(fluxoCliente.includes("/api/pdv/tef/executor-homologacao"), false);
  assert.match(motivoBloqueioTef({ habilitado: false, ambiente: "homologacao", cobrancaRealBloqueada: true }), /desligado/);
  assert.match(
    motivoBloqueioTef({ habilitado: true, ambiente: "homologacao", cobrancaRealBloqueada: true }),
    /PWOPER_SALE/
  );
  assert.equal(
    motivoBloqueioTef({ habilitado: true, ambiente: "", cobrancaRealBloqueada: false }),
    ""
  );
});

test("o caixa só encaminha a simulação em homologação e não finaliza a venda", async () => {
  const chamadas: string[] = [];
  const resultado = await executarCobrancasTef(
    {
      parcelas: [{ formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 2590 }],
      origem: "http://127.0.0.1:18181",
      dispositivoId: "disp-1",
      idempotencyKey: () => "idem-pdv",
      grupoVenda: "venda-pdv",
      ambiente: "homologacao",
    },
    {
      fetchImpl: async (url, init) => {
        chamadas.push(`${init?.method ?? "GET"} ${url}`);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mensagem: "O pagamento não foi recebido e a venda não foi finalizada.",
            estados: ["Processando.", "Aguardando cartão.", "Confirmado."],
            operacoes: [{ operacaoId: "nao-usar" }],
            pagamentoRecebido: true,
          }),
        };
      },
    }
  );
  assert.equal(resultado.ok, false);
  assert.equal("simulado" in resultado && resultado.simulado, false);
  assert.equal("comandoEnviado" in resultado && resultado.comandoEnviado, false);
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.podeFinalizar, false);
  assert.deepEqual(resultado.operacoes, []);
  assert.deepEqual(resultado.estados, []);
  assert.equal(chamadas.length, 0);

  const producao = await executarCobrancasTef(
    {
      parcelas: [{ formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 2590 }],
      origem: "http://127.0.0.1:18181",
      dispositivoId: "disp-1",
      idempotencyKey: () => "idem-pdv",
      ambiente: "producao",
    },
    {
      fetchImpl: async (url) => {
        chamadas.push(`GET ${url}`);
        return { ok: true, status: 200, json: async () => ({}) };
      },
    }
  );
  assert.equal(producao.ok, false);
  assert.match(producao.erro ?? "", /desativada/);
  assert.deepEqual(chamadas, []);

  const fluxo = readFileSync(path.join(raizRepo, "lib/pdv/tef/fluxo-cliente.ts"), "utf8");
  const shell = readFileSync(path.join(raizRepo, "components/pdv/pdv-shell.tsx"), "utf8");
  const versao = JSON.parse(readFileSync(path.join(raizRepo, "print-agent/version.json"), "utf8")) as { version: string };
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(fluxo.includes("A cobrança TEF foi desativada"), true);
  assert.equal(fluxo.includes("/tef/inicializar"), false);
  assert.equal(fluxo.includes("venda-pgweb"), false);
  assert.equal(fluxo.includes("rpc_finalizar_venda"), false);
  assert.equal(versao.version, "1.3.41");
  const inicio = shell.indexOf("executarVendaPinpad");
  const fim = shell.indexOf("finalizarVendaPdv", inicio);
  assert.ok(shell.slice(inicio, fim).includes("return"));
  assert.equal(shell.includes("onClick={concluirVenda}"), true);
  assert.match(shell.slice(shell.indexOf('event.key === "F2"')), /concluirVenda\(\)/);
});

test("débito e crédito enviam o valor ao Connector e erro financeiro não conclui", async () => {
  const chamadas: Array<{ valorCentavos: number; modalidade: string }> = [];
  const buscar = async (_url: string, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as { valorCentavos: number; modalidade: string };
    chamadas.push({ valorCentavos: corpo.valorCentavos, modalidade: corpo.modalidade });
    return {
      ok: corpo.modalidade !== "credito",
      status: corpo.modalidade === "credito" ? 409 : 200,
      json: async () =>
        corpo.modalidade === "credito"
          ? { ok: false, pagamentoRecebido: false, mensagem: "Transação recusada pelo host." }
          : { ok: true, pagamentoRecebido: true, comandoDll: true },
    };
  };
  const debito = await executarVendaPinpad({
    parcelas: [
      { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 2590 },
      { formaPagamentoId: "credito", modalidade: "credito", valorCentavos: 4800 },
    ],
    dispositivoId: "disp-1",
    origem: "http://127.0.0.1:18182",
    idempotencyKey: (indice) => `venda-${indice}`,
    buscar,
  });
  assert.deepEqual(chamadas, []);
  assert.equal(debito.ok, false);
  assert.equal(debito.pagamentoRecebido, false);
  assert.match(debito.erro, /desativada/);
});
