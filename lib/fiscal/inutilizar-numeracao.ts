import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chamarGeranet,
  ErroComunicacaoGeranet,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  objeto,
  sanitizarConsultaGeranet,
  texto,
} from "@/lib/fiscal/geranet/classificar-consulta";
import {
  anoFiscalDaEmissao,
  classificarRespostaInutilizacao,
  EmissaoParaInutilizacao,
  EventoInutilizacao,
  mensagemInutilizacao,
  montarPayloadInutilizacaoGeranet,
  podeIniciarInutilizacao,
  resumoPayloadInutilizacao,
  validarJustificativaInutilizacao,
} from "@/lib/fiscal/geranet/classificar-inutilizacao";
import type { SegredosFiscaisGeranet } from "@/lib/fiscal/geranet/montar-payload-nfce";

export type ResultadoInutilizacao = {
  ok: boolean;
  emissao_id: string;
  status: string;
  situacao: string;
  mensagem: string;
  cstat: string | null;
  protocolo: string | null;
  reenviou: false;
  reutilizada?: boolean;
};

function erroInutilizacao(mensagem: string): never {
  throw new Error(mensagem);
}

export async function inutilizarNumeracaoFiscal({
  admin,
  empresaId,
  emissaoId,
  justificativa,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  justificativa: string;
}): Promise<ResultadoInutilizacao> {
  const erroJustificativa = validarJustificativaInutilizacao(justificativa);
  if (erroJustificativa) {
    erroInutilizacao(erroJustificativa);
  }

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
      chave_acesso,
      protocolo,
      reservada_at,
      created_at,
      enviada_at,
      autorizada_at,
      cancelada_at,
      resposta_resumo
    `
    )
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (emissaoError || !emissao) {
    erroInutilizacao(emissaoError?.message ?? "Emissão fiscal não encontrada.");
  }

  if (!["55", "65"].includes(texto(emissao.modelo))) {
    erroInutilizacao("Inutilização disponível somente para NF-e 55 e NFC-e 65.");
  }

  const [
    { data: empresa },
    { data: fiscal },
    segredosResult,
    { data: eventoExistente },
  ] = await Promise.all([
    admin.from("empresas").select("cnpj").eq("id", empresaId).maybeSingle(),
    admin
      .from("empresas_fiscal")
      .select("uf, ambiente, fuso_horario, ativo")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
    admin
      .from("fiscal_emissao_eventos")
      .select(
        "id, status, tentativas, justificativa, cstat, protocolo, motivo"
      )
      .eq("empresa_id", empresaId)
      .eq("emissao_id", emissaoId)
      .eq("tipo", "inutilizacao")
      .maybeSingle(),
  ]);

  if (!empresa) {
    erroInutilizacao("Empresa da emissão não encontrada.");
  }

  if (!fiscal?.ativo) {
    erroInutilizacao("Configuração fiscal da empresa não encontrada ou inativa.");
  }

  if (Number(fiscal.ambiente) !== Number(emissao.ambiente)) {
    erroInutilizacao(
      "O ambiente fiscal atual é diferente do ambiente da numeração."
    );
  }

  const uf = texto(fiscal.uf).toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) {
    erroInutilizacao("UF fiscal do emitente inválida.");
  }

  const inicio = podeIniciarInutilizacao(
    emissao as EmissaoParaInutilizacao,
    (eventoExistente as EventoInutilizacao | null) ?? null
  );

  if (!inicio.ok) {
    erroInutilizacao(inicio.motivo ?? "Inutilização bloqueada.");
  }

  if (
    eventoExistente?.status === "sucesso" &&
    texto(emissao.status) !== "inutilizada"
  ) {
    await admin
      .from("fiscal_emissoes")
      .update({
        status: "inutilizada",
        cstat: eventoExistente.cstat,
        protocolo: eventoExistente.protocolo,
        motivo:
          eventoExistente.motivo ??
          "Inutilização homologada pela SEFAZ.",
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);
  }

  if (inicio.reutilizar || texto(emissao.status) === "inutilizada") {
    return {
      ok: true,
      emissao_id: emissaoId,
      status: "inutilizada",
      situacao: "inutilizada",
      mensagem: "Esta numeração já está inutilizada.",
      cstat: eventoExistente?.cstat ?? emissao.protocolo ?? null,
      protocolo: eventoExistente?.protocolo ?? null,
      reenviou: false,
      reutilizada: true,
    };
  }

  if (segredosResult.error) {
    erroInutilizacao("Não foi possível ler os segredos fiscais.");
  }

  const segredos = (segredosResult.data ?? {}) as SegredosFiscaisGeranet;
  const apiKey = texto(segredos.geranet_api_key);
  const certificado = texto(segredos.certificado_a1);
  const senha = texto(segredos.senha_certificado);

  if (!apiKey || !certificado || !senha) {
    erroInutilizacao("API Key/certificado/senha fiscal incompletos.");
  }

  const ano = anoFiscalDaEmissao({
    reservadaAt: emissao.reservada_at,
    createdAt: emissao.created_at,
    fusoHorario: fiscal.fuso_horario,
  });

  const payload = montarPayloadInutilizacaoGeranet({
    cnpj: texto(empresa.cnpj),
    serie: emissao.serie,
    ano,
    numero: emissao.numero,
    justificativa,
    certificadoDigital: certificado,
    senhaCertificadoDigital: senha,
    ambiente: emissao.ambiente,
    modelo: emissao.modelo,
    ufEmitente: uf,
  });

  const payloadResumo = resumoPayloadInutilizacao(payload);
  const agora = new Date().toISOString();
  let eventoId = texto(eventoExistente?.id);

  if (eventoExistente) {
    const { data: atualizado, error } = await admin
      .from("fiscal_emissao_eventos")
      .update({
        status: "processando",
        justificativa,
        tentativas: Number(eventoExistente.tentativas ?? 0) + 1,
        payload_resumo: payloadResumo,
        resposta_resumo: {},
        cstat: null,
        protocolo: null,
        motivo: null,
        xml_hex: null,
        enviado_at: agora,
        respondido_at: null,
        concluido_at: null,
      })
      .eq("id", eventoExistente.id)
      .eq("empresa_id", empresaId)
      .in("status", ["rejeitado"])
      .select("id")
      .maybeSingle();

    if (error || !atualizado) {
      erroInutilizacao(
        "Já existe uma inutilização em andamento ou homologada. Não reenvie automaticamente."
      );
    }

    eventoId = atualizado.id;
  } else {
    const { data: novo, error } = await admin
      .from("fiscal_emissao_eventos")
      .insert({
        empresa_id: empresaId,
        emissao_id: emissaoId,
        tipo: "inutilizacao",
        status: "processando",
        sequencia: 1,
        tentativas: 1,
        justificativa,
        payload_resumo: payloadResumo,
        enviado_at: agora,
      })
      .select("id")
      .single();

    if (error || !novo) {
      if (error?.code === "23505") {
        erroInutilizacao(
          "Já existe uma inutilização registrada para esta emissão. Consulte a situação antes de tentar novamente."
        );
      }

      erroInutilizacao(
        error?.message ?? "Não foi possível registrar o evento de inutilização."
      );
    }

    eventoId = novo.id;
  }

  let resultado;
  try {
    resultado = await chamarGeranet({
      apiKey,
      endpoint: "/api/v1/nfe/inutilizar-numeracao",
      payload,
      timeoutMs: 45_000,
    });
  } catch (error) {
    const motivo =
      error instanceof ErroComunicacaoGeranet
        ? error.message
        : "Falha inesperada depois de iniciar a inutilização.";

    await admin
      .from("fiscal_emissao_eventos")
      .update({
        status: "aguardando_reconciliacao",
        erro_comunicacao: motivo,
        motivo,
        respondido_at: new Date().toISOString(),
      })
      .eq("id", eventoId)
      .eq("empresa_id", empresaId);

    return {
      ok: false,
      emissao_id: emissaoId,
      status: "aguardando_inutilizacao",
      situacao: "processando",
      mensagem: `${motivo} Não reenvie automaticamente; consulte a situação da inutilização.`,
      cstat: null,
      protocolo: null,
      reenviou: false,
    };
  }

  const situacao = classificarRespostaInutilizacao({
    httpOk: resultado.httpOk,
    httpStatus: resultado.httpStatus,
    situacao: resultado.dados.situacao,
    cstat: resultado.dados.cstat,
    protocolo: resultado.dados.protocolo,
    mensagem: resultado.dados.mensagem,
  });

  const cstat = texto(resultado.dados.cstat) || null;
  const protocolo = texto(resultado.dados.protocolo) || null;
  const motivo = texto(resultado.dados.mensagem) || null;
  const xml = texto(resultado.dados.xml) || null;
  const mensagem = mensagemInutilizacao(situacao, cstat, motivo);
  const respondido = new Date().toISOString();

  if (situacao === "inutilizada") {
    await admin
      .from("fiscal_emissao_eventos")
      .update({
        status: "sucesso",
        cstat,
        protocolo,
        motivo: mensagem,
        xml_hex: xml,
        resposta_resumo: sanitizarConsultaGeranet(resultado.resumo),
        erro_comunicacao: null,
        respondido_at: respondido,
        concluido_at: respondido,
      })
      .eq("id", eventoId)
      .eq("empresa_id", empresaId);

    const { error: updateError } = await admin
      .from("fiscal_emissoes")
      .update({
        status: "inutilizada",
        cstat,
        protocolo,
        motivo: mensagem,
        geranet_http_status: resultado.httpStatus,
        geranet_situacao: texto(resultado.dados.situacao) || null,
        resposta_resumo: {
          ...objeto(emissao.resposta_resumo),
          inutilizacao: sanitizarConsultaGeranet({
            ...resultado.resumo,
            ano,
            numeroInicial: String(emissao.numero),
            numeroFinal: String(emissao.numero),
          }),
        },
        erro_comunicacao: null,
        respondida_at: respondido,
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId)
      .eq("status", "aguardando_inutilizacao");

    if (updateError) {
      erroInutilizacao(
        "A Geranet homologou a inutilização, mas falhou ao persistir localmente. Não reenvie; consulte a situação."
      );
    }

    return {
      ok: true,
      emissao_id: emissaoId,
      status: "inutilizada",
      situacao,
      mensagem,
      cstat,
      protocolo,
      reenviou: false,
    };
  }

  if (situacao === "rejeitada") {
    await admin
      .from("fiscal_emissao_eventos")
      .update({
        status: "rejeitado",
        cstat,
        protocolo,
        motivo: mensagem,
        xml_hex: xml,
        resposta_resumo: sanitizarConsultaGeranet(resultado.resumo),
        respondido_at: respondido,
      })
      .eq("id", eventoId)
      .eq("empresa_id", empresaId);

    await admin
      .from("fiscal_emissoes")
      .update({
        status: "aguardando_inutilizacao",
        cstat,
        motivo: mensagem,
        geranet_http_status: resultado.httpStatus,
        geranet_situacao: texto(resultado.dados.situacao) || null,
        resposta_resumo: {
          ...objeto(emissao.resposta_resumo),
          inutilizacao: sanitizarConsultaGeranet(resultado.resumo),
        },
        respondida_at: respondido,
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    return {
      ok: false,
      emissao_id: emissaoId,
      status: "aguardando_inutilizacao",
      situacao,
      mensagem,
      cstat,
      protocolo,
      reenviou: false,
    };
  }

  await admin
    .from("fiscal_emissao_eventos")
    .update({
      status: "aguardando_reconciliacao",
      cstat,
      protocolo,
      motivo: mensagem,
      xml_hex: xml,
      resposta_resumo: sanitizarConsultaGeranet(resultado.resumo),
      respondido_at: respondido,
    })
    .eq("id", eventoId)
    .eq("empresa_id", empresaId);

  return {
    ok: false,
    emissao_id: emissaoId,
    status: "aguardando_inutilizacao",
    situacao: "processando",
    mensagem,
    cstat,
    protocolo,
    reenviou: false,
  };
}
