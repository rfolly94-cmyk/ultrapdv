import type { SupabaseClient } from "@supabase/supabase-js";

import { consultarEmissaoGeranet } from "@/lib/fiscal/geranet/consultar-emissao";
import { reconciliarInutilizacaoFiscal } from "@/lib/fiscal/reconciliar-inutilizacao";
import { extrairChaveAcessoXml } from "@/lib/fiscal/documento-fiscal";
import {
  acoesEmissaoFiscal,
  acoesEmissaoFiscalNfce65,
} from "@/lib/fiscal/geranet/classificar-emissao";
import { classificacaoResumoDaEmissao } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  EmissaoParaConsulta,
  mensagemConsulta,
  montarAtualizacaoEmissao,
  objeto,
  sanitizarConsultaGeranet,
  texto,
} from "@/lib/fiscal/geranet/classificar-consulta";

export type OrigemReconciliacao = "manual" | "cron";

export type ResultadoReconciliacao = {
  ok: boolean;
  emissao_id: string;
  modelo: string;
  situacao: string;
  status_anterior: string;
  status: string;
  mensagem: string;
  cstat: string | null;
  chave: string | null;
  protocolo: string | null;
  reenviou: false;
  podeConsultarNovamente: boolean;
  podeRetransmitir: boolean;
};

const STATUS_CONSULTAVEIS = new Set([
  "aguardando_reconciliacao",
  "erro_comunicacao",
  "enviando",
  "autorizada",
  "rejeitada",
  "cancelada",
  "aguardando_transmissao_contingencia",
  "transmitindo_contingencia",
  "aguardando_inutilizacao",
  "inutilizada",
]);

export async function reconciliarEmissaoFiscal({
  admin,
  empresaId,
  emissaoId,
  origem,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  origem: OrigemReconciliacao;
}): Promise<ResultadoReconciliacao> {
  const { data: emissao, error: emissaoError } = await admin
    .from("fiscal_emissoes")
    .select(
      `
      id,
      modelo,
      serie,
      numero,
      ambiente,
      status,
      tipo_emissao,
      chave_acesso,
      protocolo,
      codigo_numerico,
      origem_id,
      origem_tipo,
      xml_hex,
      pdf_hex,
      xml_contingencia_hex,
      pdf_contingencia_hex,
      enviada_at,
      autorizada_at,
      cancelada_at,
      resposta_resumo,
      cstat,
      motivo,
      geranet_http_status,
      erro_comunicacao,
      geranet_log_id
    `
    )
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (emissaoError || !emissao) {
    throw new Error(
      emissaoError?.message ?? "Emissão fiscal não encontrada."
    );
  }

  if (!["55", "65"].includes(texto(emissao.modelo))) {
    throw new Error("Reconciliação disponível somente para NF-e 55 e NFC-e 65.");
  }

  if (!STATUS_CONSULTAVEIS.has(texto(emissao.status))) {
    throw new Error(
      `Esta emissão não pode ser consultada no status ${emissao.status}.`
    );
  }

  if (
    texto(emissao.status) === "aguardando_inutilizacao" ||
    texto(emissao.status) === "inutilizada"
  ) {
    return reconciliarInutilizacaoFiscal({
      admin,
      empresaId,
      emissaoId,
      origem,
    });
  }

  const [{ data: empresa, error: empresaError }, segredosResult] =
    await Promise.all([
      admin
        .from("empresas")
        .select("cnpj")
        .eq("id", empresaId)
        .maybeSingle(),
      admin.rpc("obter_segredos_fiscais", {
        p_empresa_id: empresaId,
      }),
    ]);

  if (empresaError || !empresa) {
    throw new Error("Empresa da emissão não encontrada.");
  }

  if (segredosResult.error) {
    throw new Error("Não foi possível ler a API Key da Geranet.");
  }

  const apiKey = texto(
    objeto(segredosResult.data).geranet_api_key
  );

  if (!apiKey) {
    throw new Error("API Key Geranet não configurada.");
  }

  let numeroVenda: string | null = null;
  if (
    texto(emissao.origem_tipo) === "venda" &&
    texto(emissao.origem_id)
  ) {
    const { data: venda } = await admin
      .from("vendas")
      .select("numero")
      .eq("id", emissao.origem_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (venda?.numero != null) {
      numeroVenda = String(venda.numero);
    }
  }

  const chaveXml = extrairChaveAcessoXml(
    texto(emissao.xml_hex) || texto(emissao.xml_contingencia_hex)
  );

  const emissaoConsulta: EmissaoParaConsulta = {
    ...(emissao as EmissaoParaConsulta),
    numero_venda: numeroVenda,
    chave_acesso:
      texto(emissao.chave_acesso) || chaveXml,
  };
  const statusAnterior = texto(emissao.status);

  const consulta = await consultarEmissaoGeranet({
    apiKey,
    cnpj: texto(empresa.cnpj),
    emissao: emissaoConsulta,
  });

  const atualizacao = montarAtualizacaoEmissao({
    emissao: emissaoConsulta,
    situacao: consulta.situacao,
    log: consulta.log,
    xml: consulta.xml,
    pdf: consulta.pdf,
    origem,
  });

  if (
    !texto(emissao.chave_acesso) &&
    !texto(atualizacao.patch.chave_acesso) &&
    chaveXml
  ) {
    atualizacao.patch.chave_acesso = chaveXml;
  }

  const { error: updateError } = await admin
    .from("fiscal_emissoes")
    .update(atualizacao.patch)
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId);

  if (updateError) {
    throw new Error(
      `A consulta ocorreu, mas falhou ao persistir a emissão: ${updateError.message}`
    );
  }

  const { data: eventosAnteriores } = await admin
    .from("fiscal_emissao_eventos")
    .select("sequencia")
    .eq("empresa_id", empresaId)
    .eq("emissao_id", emissaoId)
    .eq("tipo", "consulta_status")
    .order("sequencia", { ascending: false })
    .limit(1);

  const { data: tentativaVigente } = await admin
    .from("fiscal_emissao_tentativas")
    .select("id, tentativa, classificacao_inicial")
    .eq("empresa_id", empresaId)
    .eq("emissao_id", emissaoId)
    .order("tentativa", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proximaSequencia =
    Number(eventosAnteriores?.[0]?.sequencia ?? 0) + 1;

  const agora = new Date().toISOString();

  const { error: eventoError } = await admin
    .from("fiscal_emissao_eventos")
    .insert({
      empresa_id: empresaId,
      emissao_id: emissaoId,
      tipo: "consulta_status",
      status:
        consulta.situacao === "falha_consulta" ? "rejeitado" : "sucesso",
      sequencia: proximaSequencia,
      tentativas: 1,
      cstat: atualizacao.cstat,
      protocolo: atualizacao.protocolo,
      motivo: atualizacao.mensagem,
      payload_resumo: {
        origem,
        estado_anterior: statusAnterior,
        estado_encontrado: consulta.situacao,
        modelo: emissao.modelo,
        serie: emissao.serie,
        numero: String(emissao.numero),
        geranet_log_id: consulta.log?.id ?? null,
        tentativa_id: tentativaVigente?.id ?? null,
        tentativa: tentativaVigente?.tentativa ?? null,
        classificacao_inicial_tentativa:
          tentativaVigente?.classificacao_inicial ?? null,
      },
      resposta_resumo: sanitizarConsultaGeranet({
        ...consulta.resumo_seguro,
        snapshot: atualizacao.snapshot,
      }),
      enviado_at: agora,
      respondido_at: agora,
      concluido_at: agora,
    });

  if (eventoError) {
    atualizacao.patch.resposta_resumo = {
      ...objeto(atualizacao.patch.resposta_resumo),
      historico_evento_erro: eventoError.message,
    };
  }

  return {
    ok: consulta.situacao !== "falha_consulta",
    emissao_id: emissaoId,
    modelo: texto(emissao.modelo),
    situacao: consulta.situacao,
    status_anterior: statusAnterior,
    status: atualizacao.status_local,
    mensagem:
      consulta.erro && consulta.situacao === "falha_consulta"
        ? consulta.erro
        : atualizacao.mensagem ||
          mensagemConsulta(
            texto(emissao.modelo),
            consulta.situacao,
            atualizacao.cstat,
            atualizacao.motivo
          ),
    cstat: atualizacao.cstat,
    chave: atualizacao.chave,
    protocolo: atualizacao.protocolo,
    reenviou: false,
    ...(texto(emissao.modelo) === "65"
      ? acoesEmissaoFiscalNfce65({
          status: atualizacao.status_local,
          classificacao: classificacaoResumoDaEmissao(
            atualizacao.patch.resposta_resumo
          ),
          resposta_resumo: atualizacao.patch.resposta_resumo,
          cstat: atualizacao.cstat,
          motivo: atualizacao.patch.motivo
            ? String(atualizacao.patch.motivo)
            : atualizacao.motivo || emissao.motivo,
          protocolo: atualizacao.protocolo || emissao.protocolo,
          chave_acesso: atualizacao.chave || emissao.chave_acesso,
          geranet_http_status:
            consulta.log?.http_status ?? emissao.geranet_http_status,
          geranet_situacao: consulta.log?.situacao ?? null,
          erro_comunicacao:
            atualizacao.patch.erro_comunicacao === undefined
              ? emissao.erro_comunicacao
              : (atualizacao.patch.erro_comunicacao as string | null),
        })
      : acoesEmissaoFiscal({
          status: atualizacao.status_local,
          classificacao: classificacaoResumoDaEmissao(
            atualizacao.patch.resposta_resumo
          ),
          resposta_resumo: atualizacao.patch.resposta_resumo,
          cstat: atualizacao.cstat,
          motivo: atualizacao.patch.motivo
            ? String(atualizacao.patch.motivo)
            : atualizacao.motivo || emissao.motivo,
          protocolo: atualizacao.protocolo || emissao.protocolo,
          chave_acesso: atualizacao.chave || emissao.chave_acesso,
          geranet_http_status:
            consulta.log?.http_status ?? emissao.geranet_http_status,
          geranet_situacao: consulta.log?.situacao ?? null,
          erro_comunicacao:
            atualizacao.patch.erro_comunicacao === undefined
              ? emissao.erro_comunicacao
              : (atualizacao.patch.erro_comunicacao as string | null),
        })),
  };
}
