import type { SupabaseClient } from "@supabase/supabase-js";

import {
  objeto,
  sanitizarConsultaGeranet,
  texto,
} from "@/lib/fiscal/geranet/classificar-consulta";
import {
  anoFiscalDaEmissao,
  aplicarConsultaInutilizacao,
  EmissaoParaInutilizacao,
  mensagemInutilizacao,
} from "@/lib/fiscal/geranet/classificar-inutilizacao";
import { consultarInutilizacaoGeranet } from "@/lib/fiscal/geranet/consultar-inutilizacao";

export async function reconciliarInutilizacaoFiscal({
  admin,
  empresaId,
  emissaoId,
  origem,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  origem: "manual" | "cron";
}) {
  const { data: emissao, error } = await admin
    .from("fiscal_emissoes")
    .select(
      `
      id,
      modelo,
      serie,
      numero,
      ambiente,
      status,
      reservada_at,
      created_at,
      resposta_resumo
    `
    )
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !emissao) {
    throw new Error(error?.message ?? "Emissão fiscal não encontrada.");
  }

  if (texto(emissao.status) === "inutilizada") {
    return {
      ok: true,
      emissao_id: emissaoId,
      modelo: texto(emissao.modelo),
      situacao: "inutilizada",
      status_anterior: "inutilizada",
      status: "inutilizada",
      mensagem: "Esta numeração já está inutilizada.",
      cstat: null,
      chave: null,
      protocolo: null,
      reenviou: false as const,
      podeConsultarNovamente: false,
      podeRetransmitir: false,
    };
  }

  if (texto(emissao.status) !== "aguardando_inutilizacao") {
    throw new Error(
      `Reconciliação de inutilização disponível somente para aguardando_inutilizacao. Status atual: ${emissao.status}.`
    );
  }

  const [{ data: empresa }, { data: fiscal }, segredosResult] =
    await Promise.all([
      admin.from("empresas").select("cnpj").eq("id", empresaId).maybeSingle(),
      admin
        .from("empresas_fiscal")
        .select("fuso_horario")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
    ]);

  if (!empresa) {
    throw new Error("Empresa da emissão não encontrada.");
  }

  const apiKey = texto(objeto(segredosResult.data).geranet_api_key);
  if (!apiKey) {
    throw new Error("API Key Geranet não configurada.");
  }

  const ano = anoFiscalDaEmissao({
    reservadaAt: emissao.reservada_at,
    createdAt: emissao.created_at,
    fusoHorario: fiscal?.fuso_horario,
  });

  const consulta = await consultarInutilizacaoGeranet({
    apiKey,
    cnpj: texto(empresa.cnpj),
    emissao: emissao as EmissaoParaInutilizacao,
    ano,
  });

  const statusFinal = aplicarConsultaInutilizacao({
    emissaoStatus: texto(emissao.status),
    situacao: consulta.situacao,
  });

  const cstat = texto(consulta.log?.cstat) || null;
  const protocolo = texto(consulta.log?.protocolo) || null;
  const mensagem = mensagemInutilizacao(
    consulta.situacao,
    cstat,
    consulta.log?.mensagem ?? consulta.erro ?? null
  );
  const agora = new Date().toISOString();

  await admin
    .from("fiscal_emissoes")
    .update({
      status: statusFinal,
      cstat,
      protocolo: protocolo || undefined,
      motivo: mensagem,
      resposta_resumo: {
        ...objeto(emissao.resposta_resumo),
        consulta_inutilizacao: {
          em: agora,
          origem,
          situacao: consulta.situacao,
          endpoint: consulta.endpoint_consultado,
          log_id: consulta.log?.id ?? null,
        },
      },
      respondida_at: agora,
    })
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .eq("status", "aguardando_inutilizacao");

  const { data: evento } = await admin
    .from("fiscal_emissao_eventos")
    .select("id, tentativas")
    .eq("empresa_id", empresaId)
    .eq("emissao_id", emissaoId)
    .eq("tipo", "inutilizacao")
    .maybeSingle();

  if (evento) {
    await admin
      .from("fiscal_emissao_eventos")
      .update({
        status:
          consulta.situacao === "inutilizada"
            ? "sucesso"
            : consulta.situacao === "rejeitada"
              ? "rejeitado"
              : "aguardando_reconciliacao",
        cstat,
        protocolo,
        motivo: mensagem,
        xml_hex: consulta.xml,
        resposta_resumo: sanitizarConsultaGeranet(consulta.resumo_seguro),
        respondido_at: agora,
        concluido_at:
          consulta.situacao === "inutilizada" ? agora : null,
      })
      .eq("id", evento.id)
      .eq("empresa_id", empresaId);
  }

  return {
    ok: consulta.situacao !== "falha_consulta",
    emissao_id: emissaoId,
    modelo: texto(emissao.modelo),
    situacao: consulta.situacao,
    status_anterior: "aguardando_inutilizacao",
    status: statusFinal,
    mensagem,
    cstat,
    chave: null,
    protocolo,
    reenviou: false as const,
    podeConsultarNovamente: statusFinal !== "inutilizada",
    podeRetransmitir: false,
  };
}
