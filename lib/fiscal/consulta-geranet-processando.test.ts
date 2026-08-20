import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolverApresentacaoEmissaoFiscal } from "./apresentacao-emissao";
import { avaliarBloqueioRascunhoFiscal } from "./emissao-tentativas";
import { resolverEstadoOperacionalFiscal } from "./estado-operacional-fiscal";
import {
  classificarLogEmitir,
  decidirStatusLocal,
  EmissaoParaConsulta,
  LogGeranetResumo,
  montarAtualizacaoEmissao,
} from "./geranet/classificar-consulta";
import { MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO } from "./geranet/classificar-emissao";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function emissao107(
  parcial: Partial<EmissaoParaConsulta> = {}
): EmissaoParaConsulta {
  return {
    id: "emissao-107",
    modelo: "55",
    serie: 1,
    numero: 107,
    ambiente: 1,
    status: "erro_comunicacao",
    codigo_numerico: "44556677",
    origem_id: "venda-107",
    geranet_http_status: 422,
    motivo:
      "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
    resposta_resumo: {
      classificacao: "erro_envio",
    },
    ...parcial,
  };
}

function logProcessando(
  parcial: Partial<LogGeranetResumo> = {}
): LogGeranetResumo {
  return {
    id: 1071,
    endpoint: "nfe/emitir",
    criado_em: "2026-08-19T04:00:00.000Z",
    http_status: 202,
    sucesso: null,
    chave: null,
    protocolo: null,
    cstat: null,
    numero: "107",
    situacao: "",
    mensagem: "Documento ainda está sendo processado.",
    xml: null,
    pdf: null,
    modelo: "55",
    serie: "1",
    ambiente: "1",
    codigo_numerico: "44556677",
    numero_venda: "venda-107",
    contingencia: "nao",
    ...parcial,
  };
}

function consultar(atual: EmissaoParaConsulta, encontrado: LogGeranetResumo | null, situacao?: ReturnType<typeof classificarLogEmitir>) {
  const situacaoFinal =
    situacao ??
    (encontrado ? classificarLogEmitir(encontrado, atual) : "falha_consulta");
  return montarAtualizacaoEmissao({
    emissao: atual,
    situacao: situacaoFinal,
    log: encontrado,
    origem: "manual",
  });
}

function estadoDoPatch(
  atual: EmissaoParaConsulta,
  patch: Record<string, unknown>
) {
  return resolverEstadoOperacionalFiscal({
    modelo: atual.modelo,
    status: String(patch.status),
    classificacao: (patch.resposta_resumo as { classificacao?: string })
      ?.classificacao,
    resposta_resumo: patch.resposta_resumo,
    cstat: (patch.cstat as string | null | undefined) ?? atual.cstat,
    motivo: (patch.motivo as string | null | undefined) ?? atual.motivo,
    protocolo:
      (patch.protocolo as string | null | undefined) ?? atual.protocolo,
    chaveAcesso:
      (patch.chave_acesso as string | null | undefined) ?? atual.chave_acesso,
    geranetHttpStatus:
      (patch.geranet_http_status as number | null | undefined) ??
      atual.geranet_http_status,
    geranetSituacao: patch.geranet_situacao as string | null | undefined,
    erroComunicacao:
      patch.erro_comunicacao === undefined
        ? atual.erro_comunicacao
        : (patch.erro_comunicacao as string | null),
  });
}

test("A) erro_envio + consulta processando vira aguardando_reconciliacao e bloqueia retry", () => {
  const atual = emissao107();
  const encontrado = logProcessando();
  const resultado = consultar(atual, encontrado);
  const resumo = resultado.patch.resposta_resumo as {
    classificacao?: string;
    origem_classificacao?: string;
    situacao_remota?: string;
    mensagem?: string;
  };
  const estado = estadoDoPatch(atual, resultado.patch);
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: String(resultado.patch.status),
    classificacao: resumo.classificacao,
    resposta_resumo: resumo,
    motivo: String(resultado.patch.motivo),
  });

  assert.equal(resultado.situacao, "processando");
  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(resultado.patch.status, "aguardando_reconciliacao");
  assert.equal(resumo.classificacao, "ambigua");
  assert.equal(resumo.origem_classificacao, "consulta_geranet");
  assert.equal(resumo.situacao_remota, "processando");
  assert.match(String(resumo.mensagem), /ainda está sendo processado/i);
  assert.equal(estado.estado, "ambigua");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, true);
  assert.equal(estado.podeEditarFiscal, false);
  assert.equal(estado.documentoFiscalAmbiguo, true);
  assert.equal(ui.caso, "aguardando_reconciliacao");
  assert.equal(ui.titulo, "Emissão pendente de reconciliação");
  assert.match(ui.texto, /ainda está sendo processado pela Geranet/i);
  assert.match(ui.texto, /Não retransmita este documento/i);
  assert.equal(ui.acaoPrincipal, "reconciliar");
  assert.equal(ui.podeRetransmitir, false);
  assert.equal(resultado.patch.serie, undefined);
  assert.equal(resultado.patch.numero, undefined);
  assert.equal(resultado.patch.codigo_numerico, undefined);
  assert.equal(resultado.patch.modelo, undefined);
  assert.equal(resultado.patch.ambiente, undefined);
  assert.equal(
    JSON.stringify(resultado.patch).includes("/nfe/emitir"),
    false
  );
});

test("B) após processando, retry é bloqueado server-side e não há POST /nfe/emitir", () => {
  const atual = emissao107();
  const resultado = consultar(atual, logProcessando());
  const estado = estadoDoPatch(atual, resultado.patch);
  const bloqueio = avaliarBloqueioRascunhoFiscal({
    id: atual.id,
    status: String(resultado.patch.status),
    resposta_resumo: resultado.patch.resposta_resumo,
    motivo: String(resultado.patch.motivo),
  });
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const claim = fonte("lib/fiscal/emissao-tentativas.ts");
  const rpc = fonte(
    "supabase/migrations/20260818210000_claim_tentativa_erro_comunicacao.sql"
  );
  const reconciliar = fonte("lib/fiscal/reconciliar-emissao.ts");
  const posClaim = emitirVenda.lastIndexOf("await claimTentativaEmissaoFiscal");
  const posPost = emitirVenda.indexOf("await chamarGeranet");

  assert.equal(estado.podeRetry, false);
  assert.equal(bloqueio.tipo, "bloquear");
  assert.equal(bloqueio.tipo === "bloquear" ? bloqueio.mensagem : "", MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO);
  assert.match(claim, /MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO/);
  assert.match(claim, /estado\.estado === "ambigua"/);
  assert.match(rpc, /v_classificacao = 'erro_envio'/);
  assert.doesNotMatch(rpc, /v_status = 'aguardando_reconciliacao'/);
  assert.ok(posClaim >= 0);
  assert.ok(posPost > posClaim);
  assert.match(emitirVenda, /claim\.motivo === "erro" \? 500 : 409/);
  assert.doesNotMatch(reconciliar, /nfe\/emitir/);
  assert.match(
    reconciliar,
    /from\("fiscal_emissoes"\)[\s\S]*\.update\(atualizacao\.patch\)/
  );
  assert.doesNotMatch(reconciliar, /from\("fiscal_emissoes"\)\s*\.insert/);
  assert.match(
    reconciliar,
    /from\("fiscal_emissao_tentativas"\)[\s\S]*\.select\("id, tentativa, classificacao_inicial"\)/
  );
  assert.doesNotMatch(
    reconciliar,
    /from\("fiscal_emissao_tentativas"\)\s*\.insert/
  );
  assert.match(reconciliar, /consulta_status/);
});

test("C) após processando, consulta autorizada persiste chave/protocolo/cStat e fecha retry", () => {
  const aposProcessando = consultar(emissao107(), logProcessando());
  const atual: EmissaoParaConsulta = {
    ...emissao107({
      status: String(aposProcessando.patch.status),
      motivo: String(aposProcessando.patch.motivo),
      resposta_resumo: aposProcessando.patch.resposta_resumo as Record<
        string,
        unknown
      >,
    }),
  };
  const autorizado = logProcessando({
    http_status: 200,
    sucesso: true,
    situacao: "sucesso",
    chave: "51260812345678000155550010000001074455667701",
    protocolo: "151260000000107",
    cstat: "100",
    mensagem: "Autorizado o uso da NF-e",
    xml: "3c786d6c",
    pdf: "25504446",
  });
  const resultado = consultar(atual, autorizado);
  const estado = estadoDoPatch(atual, resultado.patch);

  assert.equal(resultado.status_local, "autorizada");
  assert.equal(resultado.patch.chave_acesso, autorizado.chave);
  assert.equal(resultado.patch.protocolo, autorizado.protocolo);
  assert.equal(resultado.patch.cstat, "100");
  assert.equal(resultado.patch.xml_hex, "3c786d6c");
  assert.equal(resultado.patch.pdf_hex, "25504446");
  assert.equal(
    (resultado.patch.resposta_resumo as { classificacao?: string }).classificacao,
    "autorizada"
  );
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(estado.estado, "autorizada");
});

test("D) após processando, rejeição SEFAZ conclusiva libera retry da mesma emissão", () => {
  const aposProcessando = consultar(emissao107(), logProcessando());
  const atual: EmissaoParaConsulta = {
    ...emissao107({
      status: String(aposProcessando.patch.status),
      motivo: String(aposProcessando.patch.motivo),
      resposta_resumo: aposProcessando.patch.resposta_resumo as Record<
        string,
        unknown
      >,
    }),
  };
  const rejeitado = logProcessando({
    http_status: 200,
    sucesso: false,
    situacao: "erro",
    cstat: "230",
    mensagem: "Rejeição: IE do emitente não cadastrada",
    xml: "3c72656a",
    pdf: null,
  });
  const resultado = consultar(atual, rejeitado);
  const estado = estadoDoPatch(atual, resultado.patch);

  assert.equal(resultado.status_local, "rejeitada");
  assert.equal(resultado.patch.cstat, "230");
  assert.equal(
    (resultado.patch.resposta_resumo as { classificacao?: string }).classificacao,
    "rejeitada"
  );
  assert.equal(estado.estado, "rejeitada_sefaz");
  assert.equal(estado.podeRetry, true);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(resultado.patch.serie, undefined);
  assert.equal(resultado.patch.numero, undefined);
});

test("E) após processando, timeout/500 permanece aguardando e não volta para erro_envio", () => {
  const aposProcessando = consultar(emissao107(), logProcessando());
  const atual: EmissaoParaConsulta = {
    ...emissao107({
      status: String(aposProcessando.patch.status),
      motivo: String(aposProcessando.patch.motivo),
      resposta_resumo: aposProcessando.patch.resposta_resumo as Record<
        string,
        unknown
      >,
    }),
  };
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: "falha_consulta",
    log: null,
    origem: "manual",
  });
  const resumo = resultado.patch.resposta_resumo as {
    classificacao?: string;
    situacao_remota?: string;
  };
  const estado = estadoDoPatch(atual, resultado.patch);

  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.notEqual(resumo.classificacao, "erro_envio");
  assert.equal(resumo.situacao_remota, "processando");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, true);
  assert.equal(
    decidirStatusLocal("aguardando_reconciliacao", "falha_consulta", {
      modelo: "55",
    }),
    "aguardando_reconciliacao"
  );
});

test("F) Empresa A processando e Empresa B erro_envio permanecem independentes; consulta cruzada bloqueia", () => {
  const empresaA = consultar(emissao107(), logProcessando());
  const estadoA = estadoDoPatch(emissao107(), empresaA.patch);
  const estadoB = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    geranetHttpStatus: 422,
  });
  const reconciliarRota = fonte(
    "app/api/fiscal/emissoes/[id]/reconciliar/route.ts"
  );
  const reconciliar = fonte("lib/fiscal/reconciliar-emissao.ts");
  const transporte = fonte("app/api/vendas/[id]/transporte/route.ts");

  assert.equal(estadoA.podeRetry, false);
  assert.equal(estadoA.podeReconciliar, true);
  assert.equal(estadoB.podeRetry, true);
  assert.equal(estadoB.podeReconciliar, false);
  assert.match(reconciliarRota, /usuarios_empresas/);
  assert.match(reconciliarRota, /principal/);
  assert.match(reconciliarRota, /vinculo\.empresa_id/);
  assert.doesNotMatch(reconciliarRota, /_request\.(json|formData)/);
  assert.match(reconciliar, /\.eq\("id", emissaoId\)/);
  assert.match(reconciliar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(reconciliar, /obter_segredos_fiscais/);
  assert.match(reconciliar, /p_empresa_id: empresaId/);
  assert.match(transporte, /podeEditarFiscal/);
  assert.match(transporte, /empresa_id/);
});
