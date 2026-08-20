import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
  patchEmissaoFalhaComunicacao,
} from "@/lib/fiscal/geranet/cliente-geranet";
import { ehRejeicaoFiscalReal } from "@/lib/fiscal/geranet/classificar-emissao";
import {
  anexarTentativaTransmissaoContingencia,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
} from "@/lib/fiscal/emissao-tentativas";

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

async function registrarEvento(
  admin: SupabaseClient,
  empresaId: string,
  emissaoId: string,
  tipo:
    | "autorizada"
    | "rejeitada"
    | "comunicacao_ambigua",
  detalhes:
    Record<string, unknown>
) {
  await admin
    .from(
      "fiscal_contingencia_eventos"
    )
    .insert({
      empresa_id:
        empresaId,
      emissao_id:
        emissaoId,
      tipo,
      detalhes,
    });
}

export type ResultadoTransmissaoContingencia = {
  ok: boolean;
  status:
    | "autorizada"
    | "rejeitada"
    | "aguardando_reconciliacao"
    | "erro_comunicacao"
    | "nao_processada";
  emissao_id: string;
  mensagem: string;
  chave?: string | null;
  protocolo?: string | null;
  cstat?: string | null;
};

export async function transmitirContingenciaNfce({
  admin,
  empresaId,
  emissaoId,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
}): Promise<ResultadoTransmissaoContingencia> {
  const {
    data: claimData,
    error: claimError,
  } =
    await admin.rpc(
      "rpc_iniciar_transmissao_contingencia",
      {
        p_empresa_id:
          empresaId,
        p_emissao_id:
          emissaoId,
      }
    );

  if (claimError) {
    return {
      ok: false,
      status:
        "nao_processada",
      emissao_id:
        emissaoId,
      mensagem:
        claimError.message,
    };
  }

  const claim =
    Array.isArray(
      claimData
    )
      ? claimData[0]
      : claimData;

  if (
    !claim?.emissao_id
  ) {
    const {
      data: atual,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(
          "status, chave_acesso, protocolo, cstat"
        )
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle();

    if (
      atual?.status ===
      "autorizada"
    ) {
      return {
        ok: true,
        status:
          "autorizada",
        emissao_id:
          emissaoId,
        mensagem:
          "A NFC-e já está autorizada.",
        chave:
          atual.chave_acesso,
        protocolo:
          atual.protocolo,
        cstat:
          atual.cstat,
      };
    }

    return {
      ok: false,
      status:
        "nao_processada",
      emissao_id:
        emissaoId,
      mensagem:
        `A emissão não está disponível para transmissão. Status atual: ${
          atual?.status ??
          "desconhecido"
        }.`,
    };
  }

  const [
    emissaoResult,
    fiscalResult,
    segredosResult,
  ] =
    await Promise.all([
      admin
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          modelo,
          ambiente,
          status,
          tipo_emissao,
          xml_contingencia_hex,
          serie,
          numero
        `)
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      admin
        .from(
          "empresas_fiscal"
        )
        .select(
          "uf, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      ),
    ]);

  if (
    emissaoResult.error ||
    !emissaoResult.data
  ) {
    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "aguardando_reconciliacao",
        contingencia_erro:
          "Falha ao reler a emissão após assumir a transmissão.",
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    return {
      ok: false,
      status:
        "aguardando_reconciliacao",
      emissao_id:
        emissaoId,
      mensagem:
        "Falha ao reler a emissão após iniciar a transmissão. Não retransmita automaticamente.",
    };
  }

  const emissao =
    emissaoResult.data;

  const fiscal =
    fiscalResult.data;

  if (
    !fiscal ||
    !fiscal.ativo
  ) {
    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "aguardando_transmissao_contingencia",
        contingencia_erro:
          "Configuração fiscal ausente ou inativa.",
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    return {
      ok: false,
      status:
        "nao_processada",
      emissao_id:
        emissaoId,
      mensagem:
        "Configuração fiscal ausente ou inativa.",
    };
  }

  if (
    segredosResult.error
  ) {
    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "aguardando_transmissao_contingencia",
        contingencia_erro:
          "Não foi possível ler os segredos fiscais.",
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    return {
      ok: false,
      status:
        "nao_processada",
      emissao_id:
        emissaoId,
      mensagem:
        "Não foi possível ler os segredos fiscais.",
    };
  }

  const segredos =
    (segredosResult.data ??
      {}) as {
      geranet_api_key?: unknown;
      certificado_a1?: unknown;
      senha_certificado?: unknown;
    };

  const apiKey =
    texto(
      segredos
        .geranet_api_key
    );

  const certificado =
    texto(
      segredos
        .certificado_a1
    );

  const senha =
    texto(
      segredos
        .senha_certificado
    );

  const uf =
    texto(
      fiscal.uf
    ).toUpperCase();

  const xmlContingencia =
    texto(
      emissao
        .xml_contingencia_hex
    );

  if (
    !apiKey ||
    !certificado ||
    !senha ||
    !/^[A-Z]{2}$/.test(
      uf
    ) ||
    !xmlContingencia
  ) {
    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "aguardando_transmissao_contingencia",
        contingencia_erro:
          "API Key, certificado, senha, UF ou XML de contingência está incompleto.",
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    return {
      ok: false,
      status:
        "nao_processada",
      emissao_id:
        emissaoId,
      mensagem:
        "API Key, certificado, senha, UF ou XML de contingência está incompleto.",
    };
  }

  const payload = {
    acao:
      "transmitirContingencia",
    modeloDocumento:
      "nfe",
    certificadoDigital:
      certificado,
    senhaCertificadoDigital:
      senha,
    modelo:
      "65",
    ambiente:
      String(
        emissao.ambiente
      ),
    ufEmitente:
      uf,
    xmlContingencia,
  };

  const tentativa = await anexarTentativaTransmissaoContingencia({
    admin,
    empresaId,
    emissaoId,
    usuarioId: null,
    payload,
  });

  if (!tentativa.ok) {
    return {
      ok: false,
      status: "nao_processada",
      emissao_id: emissaoId,
      mensagem: tentativa.mensagem,
    };
  }

  const tentativaId = tentativa.tentativaId;

  let resultado:
    Awaited<
      ReturnType<
        typeof chamarGeranet
      >
    >;

  try {
    resultado =
      await chamarGeranet({
        apiKey,
        endpoint:
          "/api/v1/nfe/emitir",
        payload,
        timeoutMs:
          45_000,
      });
  } catch (error) {
    const persistencia =
      persistenciaFalhaComunicacaoEmitir(error);

    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          persistencia.status,
        contingencia_erro:
          persistencia.motivo,
        erro_comunicacao:
          persistencia.motivo,
        motivo: persistencia.motivo,
        resposta_resumo: {
          classificacao: persistencia.classificacaoResumo,
        },
        respondida_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      motivo: persistencia.motivo,
      resposta: {
        erro: persistencia.motivo,
        classificacao: persistencia.classificacaoResumo,
      },
      classificacaoInicial: persistencia.status,
    });

    await registrarEvento(
      admin,
      empresaId,
      emissaoId,
      "comunicacao_ambigua",
      {
        motivo: persistencia.motivo,
        fase:
          "transmissao_contingencia",
      }
    );

    return {
      ok: false,
      status:
        persistencia.status,
      emissao_id:
        emissaoId,
      mensagem:
        persistencia.retransmitir
          ? persistencia.motivo
          : `${persistencia.motivo} A situação ficou ambígua; não retransmita automaticamente.`,
    };
  }

  const geranet =
    resultado.dados;

  const situacao =
    texto(
      geranet.situacao
    ).toLowerCase();

  const chave =
    texto(
      geranet.chave
    );

  const protocolo =
    texto(
      geranet.protocolo
    );

  const cstat =
    texto(
      geranet.cstat
    );

  const mensagem =
    texto(
      geranet.mensagem
    );

  const agora =
    new Date()
      .toISOString();

  const autorizado =
    resultado.httpOk &&
    resultado.httpStatus ===
      200 &&
    situacao ===
      "sucesso" &&
    /^\d{44}$/.test(
      chave
    ) &&
    Boolean(
      protocolo
    );

  if (autorizado) {
    const {
      error:
        updateError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            "autorizada",
          chave_acesso:
            chave,
          protocolo,
          cstat:
            cstat ||
            null,
          motivo:
            mensagem ||
            "Autorizado o uso da NFC-e transmitida após contingência.",
          geranet_http_status:
            resultado
              .httpStatus,
          geranet_situacao:
            texto(
              geranet.situacao
            ) ||
            null,
          resposta_resumo:
            resultado.resumo,
          xml_hex:
            texto(
              geranet.xml
            ) ||
            xmlContingencia,
          pdf_hex:
            texto(
              geranet.pdf
            ) ||
            null,
          erro_comunicacao:
            null,
          contingencia_erro:
            null,
          respondida_at:
            agora,
          autorizada_at:
            agora,
          contingencia_transmitida_at:
            agora,
        })
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        );

    if (
      updateError
    ) {
      return {
        ok: false,
        status:
          "aguardando_reconciliacao",
        emissao_id:
          emissaoId,
        mensagem:
          "A Geranet informou autorização, mas houve falha ao persistir localmente. NÃO retransmita.",
        chave,
        protocolo,
        cstat:
          cstat ||
          null,
      };
    }

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: resultado.httpStatus,
      cstat,
      motivo: mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: resultado.resumo,
      xmlHex: texto(geranet.xml) || xmlContingencia,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "autorizada",
    });

    await registrarEvento(
      admin,
      empresaId,
      emissaoId,
      "autorizada",
      {
        chave,
        protocolo,
        cstat:
          cstat ||
          null,
      }
    );

    return {
      ok: true,
      status:
        "autorizada",
      emissao_id:
        emissaoId,
      mensagem:
        mensagem ||
        "NFC-e de contingência autorizada.",
      chave,
      protocolo,
      cstat:
        cstat ||
        null,
    };
  }

  const rejeicaoExplicita = ehRejeicaoFiscalReal({
    httpOk: resultado.httpOk,
    httpStatus: resultado.httpStatus,
    situacao,
    cstat,
    mensagem,
  });

  if (
    rejeicaoExplicita
  ) {
    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "rejeitada",
        cstat:
          cstat ||
          null,
        motivo:
          mensagem ||
          "NFC-e rejeitada ao transmitir a contingência.",
        geranet_http_status:
          resultado
            .httpStatus,
        geranet_situacao:
          texto(
            geranet.situacao
          ) ||
          null,
        resposta_resumo:
          resultado.resumo,
        xml_hex:
          texto(
            geranet.xml
          ) ||
          null,
        pdf_hex:
          texto(
            geranet.pdf
          ) ||
          null,
        contingencia_erro:
          mensagem ||
          "Rejeição após contingência.",
        respondida_at:
          agora,
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: resultado.httpStatus,
      cstat,
      motivo: mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: resultado.resumo,
      xmlHex: texto(geranet.xml) || null,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "rejeitada",
    });

    await registrarEvento(
      admin,
      empresaId,
      emissaoId,
      "rejeitada",
      {
        http_status:
          resultado
            .httpStatus,
        cstat:
          cstat ||
          null,
        mensagem:
          mensagem ||
          null,
      }
    );

    return {
      ok: false,
      status:
        "rejeitada",
      emissao_id:
        emissaoId,
      mensagem:
        mensagem ||
        "NFC-e rejeitada ao transmitir a contingência.",
      cstat:
        cstat ||
        null,
    };
  }

  const motivoAmbiguo =
    mensagem ||
    `Resposta não conclusiva da Geranet (HTTP ${resultado.httpStatus}).`;

  await admin
    .from(
      "fiscal_emissoes"
    )
    .update({
      status:
        "aguardando_reconciliacao",
      motivo:
        motivoAmbiguo,
      contingencia_erro:
        motivoAmbiguo,
      geranet_http_status:
        resultado
          .httpStatus,
      geranet_situacao:
        texto(
          geranet.situacao
        ) ||
        null,
      resposta_resumo:
        resultado.resumo,
      respondida_at:
        agora,
    })
    .eq(
      "id",
      emissaoId
    )
    .eq(
      "empresa_id",
      empresaId
    );

  await registrarRespostaTentativaFiscal({
    admin,
    empresaId,
    tentativaId,
    httpStatus: resultado.httpStatus,
    cstat,
    motivo: motivoAmbiguo,
    geranetLogId: geranetLogIdDe(geranet),
    resposta: resultado.resumo,
    xmlHex: texto(geranet.xml) || null,
    pdfHex: texto(geranet.pdf) || null,
    classificacaoInicial: "aguardando_reconciliacao",
  });

  await registrarEvento(
    admin,
    empresaId,
    emissaoId,
    "comunicacao_ambigua",
    {
      http_status:
        resultado
          .httpStatus,
      situacao:
        texto(
          geranet.situacao
        ) ||
        null,
      mensagem:
        mensagem ||
        null,
    }
  );

  return {
    ok: false,
    status:
      "aguardando_reconciliacao",
    emissao_id:
      emissaoId,
    mensagem:
      `${motivoAmbiguo} Não retransmita automaticamente.`,
  };
}
