import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

import type {
  SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";

import {
  chamarGeranet,
  ErroComunicacaoGeranet,
} from "@/lib/fiscal/geranet/cliente-geranet";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  confirmar?: string;
  texto_correcao?: string;
};

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

function erro(
  mensagem: string,
  status = 422,
  extra?: Record<
    string,
    unknown
  >
) {
  return json(
    {
      ok: false,
      erro: mensagem,
      ...(extra ?? {}),
    },
    status
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function somenteDigitos(
  valor: unknown
) {
  return texto(valor)
    .replace(/\D/g, "");
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id: emissaoId,
  } =
    await context.params;

  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  try {
    // ========================================================
    // 1. Autenticação / tenant
    // ========================================================
    const {
      data: claimsData,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claimsData
        ?.claims
        ?.sub
    ) {
      return erro(
        "Não autenticado.",
        401
      );
    }

    const {
      data: vinculo,
    } =
      await supabase
        .from(
          "usuarios_empresas"
        )
        .select(
          "empresa_id"
        )
        .eq(
          "usuario_id",
          String(claimsData.claims.sub)
        )
        .eq(
          "principal",
          true
        )
        .eq(
          "ativo",
          true
        )
        .maybeSingle();

    if (!vinculo) {
      return erro(
        "Empresa ativa não encontrada.",
        403
      );
    }

    try {
      await exigirPermissao({ modulo: "fiscal", acao: "carta_correcao" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return erro(error.message, error.status);
      }
      throw error;
    }

    const empresaId =
      vinculo.empresa_id;

    // ========================================================
    // 2. Body
    // ========================================================
    let body: Body;

    try {
      body =
        await request.json();
    } catch {
      return erro(
        "JSON inválido.",
        400
      );
    }

    if (
      body.confirmar !==
      "REGISTRAR_CARTA_CORRECAO"
    ) {
      return erro(
        "Confirmação explícita ausente.",
        400
      );
    }

    const textoCorrecao =
      texto(
        body.texto_correcao
      );

    if (
      textoCorrecao.length <
      15
    ) {
      return erro(
        "A Carta de Correção deve possuir pelo menos 15 caracteres.",
        400
      );
    }

    if (
      textoCorrecao.length >
      1000
    ) {
      return erro(
        "A Carta de Correção deve possuir no máximo 1000 caracteres.",
        400
      );
    }

    // ========================================================
    // 3. Emissão autorizada NF-e 55
    // ========================================================
    const {
      data: emissao,
      error: emissaoError,
    } =
      await supabase
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          empresa_id,
          origem_tipo,
          origem_id,
          modelo,
          serie,
          numero,
          ambiente,
          status,
          chave_acesso,
          protocolo,
          cstat,
          cancelada_at
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          emissaoId
        )
        .maybeSingle();

    if (
      emissaoError ||
      !emissao
    ) {
      return erro(
        emissaoError
          ?.message ??
          "Emissão fiscal não encontrada.",
        404
      );
    }

    if (
      emissao.modelo !==
      "55"
    ) {
      return erro(
        "Carta de Correção é permitida somente para NF-e modelo 55.",
        409
      );
    }

    if (
      emissao.status !==
      "autorizada"
    ) {
      return erro(
        `Somente NF-e autorizada pode receber Carta de Correção. Status atual: ${emissao.status}.`,
        409
      );
    }

    if (
      emissao.cancelada_at
    ) {
      return erro(
        "NF-e cancelada não pode receber Carta de Correção.",
        409
      );
    }

    const chave =
      somenteDigitos(
        emissao.chave_acesso
      );

    if (
      chave.length !==
      44
    ) {
      return erro(
        "Chave de acesso autorizada inválida.",
        409
      );
    }

    if (
      ![1, 2].includes(
        Number(
          emissao.ambiente
        )
      )
    ) {
      return erro(
        "Ambiente fiscal da NF-e é inválido.",
        409
      );
    }

    // ========================================================
    // 4. Configuração fiscal, segredos e histórico
    // ========================================================
    const [
      fiscalResult,
      segredosResult,
      eventosResult,
    ] =
      await Promise.all([
        supabase
          .from(
            "empresas_fiscal"
          )
          .select(`
            empresa_id,
            uf,
            ambiente,
            ativo
          `)
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

        admin
          .from(
            "fiscal_emissao_eventos"
          )
          .select(`
            id,
            status,
            sequencia,
            tentativas,
            texto_correcao,
            cstat,
            protocolo,
            motivo,
            erro_comunicacao,
            concluido_at,
            created_at
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "emissao_id",
            emissao.id
          )
          .eq(
            "tipo",
            "carta_correcao"
          )
          .order(
            "sequencia",
            {
              ascending:
                false,
            }
          ),
      ]);

    if (
      fiscalResult.error ||
      !fiscalResult.data ||
      !fiscalResult.data.ativo
    ) {
      return erro(
        fiscalResult.error
          ?.message ??
          "Configuração fiscal da empresa não encontrada ou inativa.",
        409
      );
    }

    if (
      segredosResult.error
    ) {
      return erro(
        "Não foi possível ler os segredos fiscais.",
        500
      );
    }

    if (
      eventosResult.error
    ) {
      return erro(
        eventosResult
          .error
          .message,
        500
      );
    }

    const eventos =
      eventosResult.data ??
      [];

    const eventoPendente =
      eventos.find(
        (evento) =>
          [
            "processando",
            "aguardando_reconciliacao",
          ].includes(
            evento.status
          )
      );

    if (
      eventoPendente
    ) {
      return erro(
        "Existe uma Carta de Correção em processamento ou com resposta ambígua. Não reenvie automaticamente; reconcilie esse evento antes.",
        409,
        {
          evento_id:
            eventoPendente.id,
          sequencia:
            eventoPendente.sequencia,
          status:
            eventoPendente.status,
        }
      );
    }

    const sequenciasSucesso =
      eventos
        .filter(
          (evento) =>
            evento.status ===
            "sucesso"
        )
        .map(
          (evento) =>
            Number(
              evento.sequencia
            )
        )
        .filter(
          (sequencia) =>
            Number.isInteger(
              sequencia
            )
        );

    const ultimaSequencia =
      sequenciasSucesso.length
        ? Math.max(
            ...sequenciasSucesso
          )
        : 0;

    const proximaSequencia =
      ultimaSequencia + 1;

    if (
      proximaSequencia >
      20
    ) {
      return erro(
        "A NF-e já atingiu a sequência máxima de 20 Cartas de Correção.",
        409
      );
    }

    // Uma tentativa rejeitada não foi registrada na SEFAZ.
    // Reutilizamos a mesma sequência em vez de pular número.
    const eventoRejeitado =
      eventos.find(
        (evento) =>
          Number(
            evento.sequencia
          ) ===
            proximaSequencia &&
          evento.status ===
            "rejeitado"
      ) ??
      null;

    const fiscal =
      fiscalResult.data;

    const uf =
      texto(
        fiscal.uf
      ).toUpperCase();

    if (
      !/^[A-Z]{2}$/.test(
        uf
      )
    ) {
      return erro(
        "UF fiscal do emitente inválida.",
        409
      );
    }

    if (
      Number(
        fiscal.ambiente
      ) !==
      Number(
        emissao.ambiente
      )
    ) {
      return erro(
        "O ambiente fiscal atual é diferente do ambiente em que a NF-e foi autorizada.",
        409
      );
    }

    const segredos =
      (
        segredosResult.data ??
        {}
      ) as
        SegredosFiscaisGeranet;

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

    const senhaCertificado =
      texto(
        segredos
          .senha_certificado
      );

    if (
      !apiKey ||
      !certificado ||
      !senhaCertificado
    ) {
      return erro(
        "API Key/certificado/senha fiscal incompletos.",
        409
      );
    }

    // ========================================================
    // 5. Persistência ANTES da chamada externa
    // ========================================================
    const payloadResumo = {
      acao:
        "cartaCorrecao",
      modeloDocumento:
        "nfe",
      chave,
      numeroCorrecao:
        String(
          proximaSequencia
        ),
      textoCorrecao,
      ambiente:
        String(
          emissao.ambiente
        ),
      modelo:
        "55",
      ufEmitente:
        uf,
    };

    let eventoId:
      string;

    if (
      eventoRejeitado
    ) {
      const {
        data:
          eventoAtualizado,
        error:
          eventoAtualizadoError,
      } =
        await admin
          .from(
            "fiscal_emissao_eventos"
          )
          .update({
            status:
              "processando",
            tentativas:
              Number(
                eventoRejeitado
                  .tentativas ??
                0
              ) + 1,
            texto_correcao:
              textoCorrecao,
            justificativa:
              null,
            payload_resumo:
              payloadResumo,
            resposta_resumo:
              {},
            cstat:
              null,
            protocolo:
              null,
            motivo:
              null,
            xml_hex:
              null,
            pdf_hex:
              null,
            erro_comunicacao:
              null,
            enviado_at:
              new Date()
                .toISOString(),
            respondido_at:
              null,
            concluido_at:
              null,
          })
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            eventoRejeitado.id
          )
          .select("id")
          .single();

      if (
        eventoAtualizadoError ||
        !eventoAtualizado
      ) {
        return erro(
          eventoAtualizadoError
            ?.message ??
            "Não foi possível reiniciar a Carta de Correção rejeitada.",
          500
        );
      }

      eventoId =
        eventoAtualizado.id;
    } else {
      const {
        data: novoEvento,
        error:
          novoEventoError,
      } =
        await admin
          .from(
            "fiscal_emissao_eventos"
          )
          .insert({
            empresa_id:
              empresaId,
            emissao_id:
              emissao.id,
            tipo:
              "carta_correcao",
            status:
              "processando",
            sequencia:
              proximaSequencia,
            tentativas:
              1,
            texto_correcao:
              textoCorrecao,
            payload_resumo:
              payloadResumo,
            enviado_at:
              new Date()
                .toISOString(),
          })
          .select("id")
          .single();

      if (
        novoEventoError ||
        !novoEvento
      ) {
        if (
          novoEventoError
            ?.code ===
          "23505"
        ) {
          return erro(
            "Já existe uma Carta de Correção para esta sequência. Atualize a tela antes de tentar novamente.",
            409
          );
        }

        return erro(
          novoEventoError
            ?.message ??
            "Não foi possível registrar a Carta de Correção.",
          500
        );
      }

      eventoId =
        novoEvento.id;
    }

    // ========================================================
    // 6. Geranet
    // ========================================================
    const payloadGeranet = {
      ...payloadResumo,
      certificadoDigital:
        certificado,
      senhaCertificadoDigital:
        senhaCertificado,
    };

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
            "/api/v1/nfe/carta-correcao",
          payload:
            payloadGeranet,
          timeoutMs:
            45_000,
        });
    } catch (e) {
      const motivo =
        e instanceof
        ErroComunicacaoGeranet
          ? e.message
          : "Falha inesperada depois de iniciar a Carta de Correção.";

      await admin
        .from(
          "fiscal_emissao_eventos"
        )
        .update({
          status:
            "aguardando_reconciliacao",
          erro_comunicacao:
            motivo,
          motivo,
          respondido_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          eventoId
        );

      return erro(
        `${motivo} Não repita a Carta de Correção automaticamente; confira a situação do evento antes.`,
        502,
        {
          evento_id:
            eventoId,
          sequencia:
            proximaSequencia,
          status:
            "aguardando_reconciliacao",
        }
      );
    }

    const geranet =
      resultado.dados;

    const resumo =
      resultado.resumo;

    const situacao =
      texto(
        geranet.situacao
      ).toLowerCase();

    const mensagem =
      texto(
        geranet.mensagem
      );

    const cstat =
      texto(
        geranet.cstat
      );

    const protocoloEvento =
      texto(
        geranet.protocolo
      );

    const sucesso =
      resultado.httpOk &&
      situacao ===
      "sucesso";

    const agora =
      new Date()
        .toISOString();

    if (
      sucesso
    ) {
      const {
        error:
          eventoUpdateError,
      } =
        await admin
          .from(
            "fiscal_emissao_eventos"
          )
          .update({
            status:
              "sucesso",
            cstat:
              cstat || null,
            protocolo:
              protocoloEvento ||
              null,
            motivo:
              mensagem ||
              "Carta de Correção registrada.",
            resposta_resumo:
              resumo,
            xml_hex:
              texto(
                geranet.xml
              ) || null,
            pdf_hex:
              texto(
                geranet.pdf
              ) || null,
            erro_comunicacao:
              null,
            respondido_at:
              agora,
            concluido_at:
              agora,
          })
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            eventoId
          );

      if (
        eventoUpdateError
      ) {
        return erro(
          "A Geranet confirmou a Carta de Correção, mas houve falha ao persistir o evento local. Não reenvie.",
          500,
          {
            evento_id:
              eventoId,
            sequencia:
              proximaSequencia,
            cstat:
              cstat || null,
            protocolo:
              protocoloEvento ||
              null,
          }
        );
      }

      return json({
        ok: true,
        carta_correcao: true,
        emissao_id:
          emissao.id,
        evento_id:
          eventoId,
        sequencia:
          proximaSequencia,
        modelo:
          "55",
        serie:
          emissao.serie,
        numero:
          String(
            emissao.numero
          ),
        cstat:
          cstat || null,
        protocolo:
          protocoloEvento ||
          null,
        mensagem:
          mensagem ||
          "Carta de Correção registrada com sucesso.",
        xml_armazenado:
          Boolean(
            texto(
              geranet.xml
            )
          ),
      });
    }

    // ========================================================
    // 7. Rejeição explícita — mesma sequência pode ser corrigida
    // ========================================================
    await admin
      .from(
        "fiscal_emissao_eventos"
      )
      .update({
        status:
          "rejeitado",
        cstat:
          cstat || null,
        protocolo:
          protocoloEvento ||
          null,
        motivo:
          mensagem ||
          `Geranet HTTP ${resultado.httpStatus}`,
        resposta_resumo:
          resumo,
        xml_hex:
          texto(
            geranet.xml
          ) || null,
        pdf_hex:
          texto(
            geranet.pdf
          ) || null,
        respondido_at:
          agora,
      })
      .eq(
        "empresa_id",
        empresaId
      )
      .eq(
        "id",
        eventoId
      );

    return erro(
      mensagem ||
      "Carta de Correção rejeitada.",
      resultado.httpStatus ===
      401
        ? 401
        : 422,
      {
        emissao_id:
          emissao.id,
        evento_id:
          eventoId,
        sequencia:
          proximaSequencia,
        cstat:
          cstat || null,
        geranet:
          resumo,
      }
    );
  } catch (e) {
    console.error(
      "[CARTA CORRECAO NF-E]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      e instanceof Error
        ? e.message
        : "Erro interno na Carta de Correção.",
      500
    );
  }
}
