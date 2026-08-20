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

import type {
  SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";

import {
  chamarGeranet,
  ErroComunicacaoGeranet,
} from "@/lib/fiscal/geranet/cliente-geranet";

import {
  avaliarEnvioCancelamentoNormal,
  resolverPoliticaCancelamentoFiscal,
  resumoAuditoriaCancelamento,
} from "@/lib/fiscal/politica-cancelamento";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  bloqueioCancelamentoDevolucaoFornecedor,
} from "@/lib/fiscal/entrada/devolucao-status";
import {
  bloqueioCancelamentoOperacaoFiscal,
} from "@/lib/fiscal/operacoes/status-operacao";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  confirmar?: string;
  justificativa?: string;
  confirmouNaoCirculacao?: boolean;
  confirmouSemDuplicataEscritural?: boolean;
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
  return texto(valor).replace(
    /\D/g,
    ""
  );
}

async function marcarDevolucaoFornecedorCancelada(params: {
  admin: ReturnType<typeof createAdminClient>;
  empresaId: string;
  origemTipo: unknown;
  origemId: unknown;
}) {
  if (texto(params.origemTipo) !== "devolucao_fornecedor") {
    return;
  }

  const origemId = texto(params.origemId);
  if (!origemId) {
    return;
  }

  await params.admin
    .from("fiscal_devolucoes_fornecedor")
    .update({
      status: "cancelada",
    })
    .eq("empresa_id", params.empresaId)
    .eq("id", origemId)
    .is("saida_estoque_processada_at", null);
}

async function marcarOperacaoFiscalCancelada(params: {
  admin: ReturnType<typeof createAdminClient>;
  empresaId: string;
  origemTipo: unknown;
  origemId: unknown;
}) {
  if (texto(params.origemTipo) !== "operacao_fiscal") {
    return;
  }

  const origemId = texto(params.origemId);
  if (!origemId) {
    return;
  }

  await params.admin
    .from("fiscal_operacoes")
    .update({
      status: "cancelada",
    })
    .eq("empresa_id", params.empresaId)
    .eq("id", origemId)
    .is("saida_estoque_processada_at", null);
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
      await exigirPermissao({ modulo: "fiscal", acao: "cancelar_nota" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return erro(error.message, error.status);
      }
      throw error;
    }

    const empresaId =
      vinculo.empresa_id;

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
      "CANCELAR_DOCUMENTO_FISCAL"
    ) {
      return erro(
        "Confirmação explícita ausente.",
        400
      );
    }

    const justificativa =
      texto(
        body.justificativa
      );

    if (
      justificativa.length <
      15
    ) {
      return erro(
        "A justificativa deve possuir pelo menos 15 caracteres.",
        400
      );
    }

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
          autorizada_at,
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
      emissao.status ===
      "cancelada"
    ) {
      const {
        data:
          eventoCancelado,
      } =
        await supabase
          .from(
            "fiscal_emissao_eventos"
          )
          .select(`
            id,
            status,
            cstat,
            protocolo,
            motivo,
            justificativa,
            concluido_at
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
            "cancelamento"
          )
          .maybeSingle();

      await marcarDevolucaoFornecedorCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });
      await marcarOperacaoFiscalCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });

      return json({
        ok: true,
        cancelada: true,
        reutilizada: true,
        emissao_id:
          emissao.id,
        evento:
          eventoCancelado,
        mensagem:
          "Documento já cancelado.",
      });
    }

    if (
      emissao.status !==
      "autorizada"
    ) {
      return erro(
        `Somente documento autorizado pode ser cancelado. Status atual: ${emissao.status}.`,
        409
      );
    }

    const chave =
      somenteDigitos(
        emissao.chave_acesso
      );

    const protocoloAutorizacao =
      somenteDigitos(
        emissao.protocolo
      );

    if (
      chave.length !== 44
    ) {
      return erro(
        "Chave de acesso autorizada inválida.",
        409
      );
    }

    if (
      !protocoloAutorizacao
    ) {
      return erro(
        "Protocolo de autorização não está armazenado.",
        409
      );
    }

    if (
      !["55", "65"].includes(
        emissao.modelo
      )
    ) {
      return erro(
        "Modelo fiscal não suportado pelo cancelamento.",
        409
      );
    }

    if (
      texto(emissao.origem_tipo) ===
      "devolucao_fornecedor"
    ) {
      const {
        data: devolucao,
        error: devolucaoError,
      } =
        await supabase
          .from(
            "fiscal_devolucoes_fornecedor"
          )
          .select(
            "id, empresa_id, saida_estoque_processada_at"
          )
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            texto(
              emissao.origem_id
            )
          )
          .maybeSingle();

      if (
        devolucaoError ||
        !devolucao ||
        !registroPertenceAEmpresaAtiva(
          devolucao,
          empresaId
        )
      ) {
        return erro(
          "Devolução ao fornecedor da emissão não encontrada na empresa ativa.",
          404
        );
      }

      const bloqueioOperacional =
        bloqueioCancelamentoDevolucaoFornecedor(
          devolucao.saida_estoque_processada_at
        );

      if (bloqueioOperacional) {
        return erro(
          bloqueioOperacional,
          409
        );
      }
    }

    if (
      texto(emissao.origem_tipo) ===
      "operacao_fiscal"
    ) {
      const {
        data: operacao,
        error: operacaoError,
      } =
        await supabase
          .from(
            "fiscal_operacoes"
          )
          .select(
            "id, empresa_id, saida_estoque_processada_at, status"
          )
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            texto(
              emissao.origem_id
            )
          )
          .maybeSingle();

      if (
        operacaoError ||
        !operacao ||
        !registroPertenceAEmpresaAtiva(
          operacao,
          empresaId
        )
      ) {
        return erro(
          "Operação fiscal da emissão não encontrada na empresa ativa.",
          404
        );
      }

      const bloqueioOperacional =
        bloqueioCancelamentoOperacaoFiscal({
          saidaEstoqueProcessadaAt:
            operacao.saida_estoque_processada_at,
          status: operacao.status,
        });

      if (bloqueioOperacional) {
        return erro(
          bloqueioOperacional,
          409
        );
      }
    }

    if (
      ![1, 2].includes(
        Number(
          emissao.ambiente
        )
      )
    ) {
      return erro(
        "Ambiente fiscal inválido.",
        409
      );
    }

    const [
      fiscalResult,
      segredosResult,
      eventoResult,
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
            fuso_horario,
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
            tentativas,
            justificativa,
            cstat,
            protocolo,
            motivo,
            concluido_at
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
            "cancelamento"
          )
          .maybeSingle(),
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
      eventoResult.error
    ) {
      return erro(
        eventoResult.error.message,
        500
      );
    }

    const eventoExistente =
      eventoResult.data;

    if (
      eventoExistente
        ?.status ===
      "sucesso"
    ) {
      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            "cancelada",
          cancelada_at:
            eventoExistente
              .concluido_at ??
            new Date()
              .toISOString(),
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          emissao.id
        );

      await marcarDevolucaoFornecedorCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });
      await marcarOperacaoFiscalCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });

      return json({
        ok: true,
        cancelada: true,
        reutilizada: true,
        emissao_id:
          emissao.id,
        evento:
          eventoExistente,
        mensagem:
          "Cancelamento já havia sido concluído.",
      });
    }

    if (
      eventoExistente &&
      [
        "processando",
        "aguardando_reconciliacao",
      ].includes(
        eventoExistente.status
      )
    ) {
      return erro(
        "Existe uma tentativa de cancelamento com resultado pendente. Consulte a situação antes de reenviar.",
        409,
        {
          evento_id:
            eventoExistente.id,
          status:
            eventoExistente.status,
        }
      );
    }

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
        "O ambiente fiscal atual é diferente do ambiente em que a nota foi autorizada.",
        409
      );
    }

    const agoraPedido =
      new Date();

    const politica =
      resolverPoliticaCancelamentoFiscal({
        uf,
        modelo:
          texto(
            emissao.modelo
          ),
        status:
          texto(
            emissao.status
          ),
        autorizadoEm:
          emissao.autorizada_at,
        agora:
          agoraPedido,
        fusoHorario:
          texto(
            fiscal.fuso_horario
          ) || null,
      });

    const avaliacaoEnvio =
      avaliarEnvioCancelamentoNormal({
        statusEmissao:
          texto(
            emissao.status
          ),
        statusEventoCancelamento:
          eventoExistente
            ?.status,
        politica,
        confirmouNaoCirculacao:
          body.confirmouNaoCirculacao ===
          true,
        confirmouSemDuplicataEscritural:
          body.confirmouSemDuplicataEscritural ===
          true,
        justificativa,
      });

    if (
      !avaliacaoEnvio.permitirEnvio
    ) {
      return erro(
        avaliacaoEnvio.motivo ??
          "Cancelamento normal não permitido.",
        avaliacaoEnvio.codigo ===
          "prazo_encerrado"
          ? 409
          : 422,
        {
          codigo:
            avaliacaoEnvio.codigo,
          politica:
            politica.codigo,
        }
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

    const payloadGeranet = {
      acao:
        "cancelar",
      modeloDocumento:
        "nfe",
      chave,
      protocolo:
        protocoloAutorizacao,
      justificativa,
      ambiente:
        String(
          emissao.ambiente
        ),
      modelo:
        emissao.modelo,
      ufEmitente:
        uf,
    };

    const payloadResumo = {
      ...payloadGeranet,
      ...resumoAuditoriaCancelamento({
        politica,
        confirmouNaoCirculacao:
          body.confirmouNaoCirculacao ===
          true,
        confirmouSemDuplicataEscritural:
          body.confirmouSemDuplicataEscritural ===
          true,
        solicitadoEm:
          agoraPedido,
      }),
    };

    let eventoId:
      string;

    if (
      eventoExistente
    ) {
      const {
        data:
          eventoAtualizado,
        error:
          atualizarEventoError,
      } =
        await admin
          .from(
            "fiscal_emissao_eventos"
          )
          .update({
            status:
              "processando",
            justificativa,
            tentativas:
              Number(
                eventoExistente.tentativas ??
                0
              ) + 1,
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
            eventoExistente.id
          )
          .select("id")
          .single();

      if (
        atualizarEventoError ||
        !eventoAtualizado
      ) {
        return erro(
          atualizarEventoError
            ?.message ??
            "Não foi possível reiniciar o evento de cancelamento.",
          500
        );
      }

      eventoId =
        eventoAtualizado.id;
    } else {
      const {
        data:
          novoEvento,
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
              "cancelamento",
            status:
              "processando",
            sequencia:
              1,
            tentativas:
              1,
            justificativa,
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
        // Duplo clique/concorrrência: não arrisca nova chamada.
        if (
          novoEventoError?.code ===
          "23505"
        ) {
          return erro(
            "Já existe um cancelamento registrado para esta emissão. Atualize a tela antes de tentar novamente.",
            409
          );
        }

        return erro(
          novoEventoError
            ?.message ??
            "Não foi possível registrar o evento de cancelamento.",
          500
        );
      }

      eventoId =
        novoEvento.id;
    }

    const payloadEnvioGeranet = {
      ...payloadGeranet,
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
            "/api/v1/nfe/cancelar",
          payload:
            payloadEnvioGeranet,
          timeoutMs:
            45_000,
        });
    } catch (e) {
      const motivo =
        e instanceof
        ErroComunicacaoGeranet
          ? e.message
          : "Falha inesperada depois de iniciar o cancelamento.";

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
          payload_resumo: {
            ...payloadResumo,
            resultado:
              "aguardando_reconciliacao",
            motivo,
          },
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
        `${motivo} Não repita o cancelamento automaticamente; confira a situação do evento antes.`,
        502,
        {
          evento_id:
            eventoId,
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

    if (
      sucesso
    ) {
      const agora =
        new Date()
          .toISOString();

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
              "Cancelamento autorizado.",
            payload_resumo: {
              ...payloadResumo,
              resultado:
                "sucesso",
              cstat:
                cstat || null,
              motivo:
                mensagem ||
                "Cancelamento autorizado.",
            },
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
          "A Geranet confirmou o cancelamento, mas houve falha ao persistir o evento local. Não reenvie.",
          500,
          {
            evento_id:
              eventoId,
            cstat,
            protocolo:
              protocoloEvento,
          }
        );
      }

      const {
        error:
          emissaoUpdateError,
      } =
        await admin
          .from(
            "fiscal_emissoes"
          )
          .update({
            status:
              "cancelada",
            cancelada_at:
              agora,
          })
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            emissao.id
          )
          .eq(
            "status",
            "autorizada"
          );

      if (
        emissaoUpdateError
      ) {
        return erro(
          "O cancelamento foi confirmado, mas não foi possível atualizar o status da emissão local. Não reenvie.",
          500,
          {
            evento_id:
              eventoId,
            cstat,
            protocolo:
              protocoloEvento,
          }
          );
      }

      await marcarDevolucaoFornecedorCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });
      await marcarOperacaoFiscalCancelada({
        admin,
        empresaId,
        origemTipo: emissao.origem_tipo,
        origemId: emissao.origem_id,
      });

      return json({
        ok: true,
        cancelada: true,
        emissao_id:
          emissao.id,
        evento_id:
          eventoId,
        modelo:
          emissao.modelo,
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
          "Documento fiscal cancelado.",
        xml_armazenado:
          Boolean(
            texto(
              geranet.xml
            )
          ),
        pdf_armazenado:
          Boolean(
            texto(
              geranet.pdf
            )
          ),
      });
    }

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
        payload_resumo: {
          ...payloadResumo,
          resultado:
            "rejeitado",
          cstat:
            cstat || null,
          motivo:
            mensagem ||
            `Geranet HTTP ${resultado.httpStatus}`,
        },
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
      mensagem ||
      "Cancelamento rejeitado.",
      resultado.httpStatus ===
      401
        ? 401
        : 422,
      {
        emissao_id:
          emissao.id,
        evento_id:
          eventoId,
        cstat:
          cstat || null,
        geranet:
          resumo,
      }
    );
  } catch (e) {
    console.error(
      "[CANCELAMENTO FISCAL]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      e instanceof Error
        ? e.message
        : "Erro interno no cancelamento fiscal.",
      500
    );
  }
}
