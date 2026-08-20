import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "path";

import {
  anexarAuditoriaCabecalhoFiscal,
  argsNumeroManualReservaNfe,
  camposCabecalhoParaSnapshot,
  escolherNumeracaoNfe55,
  lerCabecalhoFiscalDoSnapshot,
  MENSAGEM_NUMERO_NFE_DUPLICADO,
  MENSAGEM_SERIE_NFE_INVALIDA,
  montarDataHoraSaidaGeranet,
  numeroNfeEmConflito,
  resolverPayloadCabecalhoNfe,
} from "./cabecalho-fiscal";
import {
  MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO,
  MENSAGEM_NUMERACAO_IMUTAVEL,
  podeEditarDocumentoFiscal,
  podeEditarNumeracaoFiscal,
  statusAposEdicaoDocumentoFiscal,
} from "@/lib/fiscal/operacoes/status-operacao";

const numeracoesEmpresaA = [
  { modelo: "55", ambiente: 2, serie: 1, proximo_numero: 10, ativo: true },
  { modelo: "55", ambiente: 2, serie: 2, proximo_numero: 1, ativo: true },
  { modelo: "55", ambiente: 1, serie: 1, proximo_numero: 99, ativo: true },
];

test("TESTE A: snapshot do cabeçalho persiste série/número/datas/intermediador", () => {
  const snapshot = camposCabecalhoParaSnapshot({
    tpNf: "1",
    serie: 2,
    numero: 113,
    numeracaoAutomatica: false,
    indicadorPresenca: "2",
    indicativoIntermediador: "1",
    finNfe: "1",
    dataEmissao: "2026-08-18",
    horaEmissao: "09:00",
    dataSaida: "2026-08-19",
    horaSaida: "14:30",
  });
  const lido = lerCabecalhoFiscalDoSnapshot({
    pagamentos_rascunho: [{ formaPagamentoId: "x", valorCentavos: 100 }],
    ...snapshot,
  });
  assert.equal(lido.tpNf, "1");
  assert.equal(lido.serie, 2);
  assert.equal(lido.numero, 113);
  assert.equal(lido.numeracaoAutomatica, false);
  assert.equal(lido.indicadorPresenca, "2");
  assert.equal(lido.indicativoIntermediador, "1");
  assert.equal(lido.finNfe, "1");
  assert.equal(lido.dataEmissao, "2026-08-18");
  assert.equal(lido.horaEmissao, "09:00");
  assert.equal(lido.dataSaida, "2026-08-19");
  assert.equal(lido.horaSaida, "14:30");
});

test("TESTE B: número duplicado na mesma empresa/ambiente/modelo/série é bloqueado", () => {
  const conflito = numeroNfeEmConflito({
    empresaId: "emp-a",
    ambiente: 2,
    serie: 1,
    numero: 112,
    emissoes: [
      {
        empresa_id: "emp-a",
        modelo: "55",
        ambiente: 2,
        serie: 1,
        numero: 112,
        status: "aguardando_reconciliacao",
      },
    ],
  });
  assert.equal(conflito, MENSAGEM_NUMERO_NFE_DUPLICADO);
  assert.equal(
    numeroNfeEmConflito({
      empresaId: "emp-a",
      ambiente: 2,
      serie: 1,
      numero: 112,
      emissoes: [
        {
          empresa_id: "emp-b",
          modelo: "55",
          ambiente: 2,
          serie: 1,
          numero: 112,
        },
      ],
    }),
    null
  );
});

test("TESTE C: série de outra empresa ou outro ambiente é recusada", () => {
  const outraEmpresa = escolherNumeracaoNfe55({
    numeracoes: [],
    ambiente: 2,
    serieEscolhida: 1,
  });
  assert.equal(outraEmpresa.ok, false);
  if (!outraEmpresa.ok) {
    assert.equal(outraEmpresa.mensagem, MENSAGEM_SERIE_NFE_INVALIDA);
  }

  const outroAmbiente = escolherNumeracaoNfe55({
    numeracoes: numeracoesEmpresaA,
    ambiente: 2,
    serieEscolhida: 99,
  });
  assert.equal(outroAmbiente.ok, false);

  const ok = escolherNumeracaoNfe55({
    numeracoes: numeracoesEmpresaA,
    ambiente: 2,
    serieEscolhida: 2,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(Number(ok.numeracao.serie), 2);
    assert.equal(Number(ok.numeracao.ambiente), 2);
  }
});

test("TESTE D: REQUEST_INICIADA / reservada trava série e número, não o restante do rascunho", () => {
  const documento = podeEditarDocumentoFiscal({
    statusOperacao: "pronta_para_emissao",
    emissao: { modelo: "55", status: "reservada" },
  });
  const numeracao = podeEditarNumeracaoFiscal({
    statusOperacao: "pronta_para_emissao",
    emissao: { modelo: "55", status: "reservada" },
  });
  assert.equal(documento.permitido, true);
  assert.equal(numeracao.permitido, false);
  assert.equal(numeracao.motivo, MENSAGEM_NUMERACAO_IMUTAVEL);
  assert.equal(
    podeEditarDocumentoFiscal({
      statusOperacao: "enviando",
      emissao: { modelo: "55", status: "enviando" },
    }).permitido,
    false
  );
});

test("TESTE E: aguardando_reconciliacao congela o documento, inclusive a NF-e 112", () => {
  const gateOperacao = podeEditarDocumentoFiscal({
    statusOperacao: "aguardando_reconciliacao",
  });
  assert.equal(gateOperacao.permitido, false);
  assert.equal(gateOperacao.motivo, MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO);

  const gateEmissao = podeEditarDocumentoFiscal({
    statusOperacao: "rascunho",
    emissao: {
      modelo: "55",
      status: "aguardando_reconciliacao",
      classificacao: "erro_tecnico",
    },
  });
  assert.equal(gateEmissao.permitido, false);
  assert.equal(
    podeEditarNumeracaoFiscal({
      statusOperacao: "aguardando_reconciliacao",
    }).permitido,
    false
  );
});

test("TESTE F: persistir cabeçalho não toca venda, estoque, pagamento nem financeiro", () => {
  const actions = readFileSync(
    path.join(process.cwd(), "app/fiscal/nfe/operacoes-actions.ts"),
    "utf8"
  );
  const cabecalhoFn = actions.slice(
    actions.indexOf("export async function salvarCabecalhoFiscalOperacao"),
    actions.indexOf("export async function adicionarItemOperacaoFiscal")
  );
  assert.doesNotMatch(cabecalhoFn, /from\("vendas"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("vendas_itens"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("estoque_atual"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("pagamentos_venda"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("contas_receber"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("caixa/);
  assert.doesNotMatch(cabecalhoFn, /pix/i);
});

test("alteração invalida validação pronta_para_emissao", () => {
  assert.equal(
    statusAposEdicaoDocumentoFiscal("pronta_para_emissao"),
    "pronta_para_verificacao"
  );
  assert.equal(statusAposEdicaoDocumentoFiscal("rascunho"), "rascunho");
});

test("rascunho, preparado e pronta permitem edição enquanto não há transmissão", () => {
  for (const status of [
    "rascunho",
    "pronta_para_verificacao",
    "pronta_para_emissao",
    "rejeitada",
  ]) {
    assert.equal(
      podeEditarDocumentoFiscal({ statusOperacao: status }).permitido,
      true,
      status
    );
    assert.equal(
      podeEditarNumeracaoFiscal({ statusOperacao: status }).permitido,
      true,
      status
    );
  }
  assert.equal(
    podeEditarDocumentoFiscal({
      statusOperacao: "autorizada",
      emissao: { modelo: "55", status: "autorizada" },
    }).permitido,
    false
  );
});

test("payload Geranet usa data/hora manuais, intermediador do snapshot e não sobrescreve com now()", () => {
  const payload = resolverPayloadCabecalhoNfe({
    snapshot: {
      indicador_presenca: "5",
      indicativo_intermediador: "1",
      fin_nfe: "4",
      tp_nf: "1",
      serie: 2,
      numero: 80,
      numeracao_automatica: false,
      data_emissao: "2026-08-18",
      hora_emissao: "08:10",
      data_saida: "2026-08-19",
      hora_saida: "09:15",
    },
    finNfeOperacao: "1",
    finNfeNatureza: "1",
    indicadorPresencaPadraoEmpresa: "1",
    indicativoIntermediadorPadraoEmpresa: "0",
    dataHoraEmissao: "2026-08-19 12:00:00",
  });
  assert.equal(payload.indicadorPresenca, "5");
  assert.equal(payload.indicativoIntermediador, "1");
  assert.equal(payload.finNfe, "4");
  assert.equal(payload.dataEmissao, "2026-08-18 08:10:00");
  assert.equal(payload.dataSaida, "2026-08-19 09:15:00");
  assert.equal(payload.serie, 2);
  assert.equal(payload.numero, 80);
  assert.equal(payload.numeracaoAutomatica, false);
  assert.deepEqual(argsNumeroManualReservaNfe(lerCabecalhoFiscalDoSnapshot({
    numeracao_automatica: false,
    numero: 80,
  })), { p_numero: 80 });
  assert.deepEqual(
    argsNumeroManualReservaNfe(lerCabecalhoFiscalDoSnapshot({ numeracao_automatica: true })),
    {}
  );
  assert.equal(montarDataHoraSaidaGeranet("2026-08-19", "14:30"), "2026-08-19 14:30:00");
});

test("sem data de emissão manual, usa o default do sistema na transmissão", () => {
  const payload = resolverPayloadCabecalhoNfe({
    snapshot: { indicador_presenca: "2", fin_nfe: "1" },
    indicadorPresencaPadraoEmpresa: "1",
    finNfeNatureza: "4",
    indicativoIntermediadorPadraoEmpresa: "0",
    dataHoraEmissao: "2026-08-19 12:00:00",
  });
  assert.equal(payload.indicadorPresenca, "2");
  assert.equal(payload.finNfe, "1");
  assert.equal(payload.indicativoIntermediador, "0");
  assert.equal(payload.dataEmissao, "2026-08-19 12:00:00");
  assert.equal(payload.dataSaida, "2026-08-19 12:00:00");
  assert.equal(payload.numero, null);
  assert.equal(payload.numeracaoAutomatica, true);
});

test("auditoria do cabeçalho registra alteração manual de número", () => {
  const auditoria = anexarAuditoriaCabecalhoFiscal(
    { numero: null, numeracao_automatica: true },
    {
      usuario_id: "user-1",
      empresa_id: "emp-a",
      em: "2026-08-19T13:00:00.000Z",
      antes: { numero: null, numeracao_automatica: true },
      depois: { numero: 80, numeracao_automatica: false },
    }
  );
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0]?.empresa_id, "emp-a");
  assert.equal(auditoria[0]?.depois.numero, 80);
});

test("código desta tarefa não reabre nem renumera a NF-e 112", () => {
  const actions = readFileSync(
    path.join(process.cwd(), "app/fiscal/nfe/operacoes-actions.ts"),
    "utf8"
  );
  const cabecalhoFn = actions.slice(
    actions.indexOf("export async function salvarCabecalhoFiscalOperacao"),
    actions.indexOf("export async function adicionarItemOperacaoFiscal")
  );
  assert.doesNotMatch(cabecalhoFn, /\b112\b/);
  assert.match(cabecalhoFn, /recusarEdicaoDocumentoFiscal/);
  assert.match(cabecalhoFn, /recusarNumeracaoFiscal/);
});
