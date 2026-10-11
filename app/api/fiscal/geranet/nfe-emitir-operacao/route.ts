import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  capturaErroAutorizacaoFiscal,
  exigirEmissaoNfe,
} from "@/lib/fiscal/acesso-operacao";
import {
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import {
  avaliarBloqueioRascunhoFiscal,
  carregarEmissaoPorChaveIdempotencia,
  claimTentativaEmissaoFiscal,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
  snapshotItensDaTransmissao,
} from "@/lib/fiscal/emissao-tentativas";
import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
  patchEmissaoFalhaComunicacao,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  classificarRespostaEmitir,
  extraBloqueioRetransmissaoFiscal,
  historicoErroTecnico,
  mensagemBloqueioEmissao,
  montarErroEmitirNaoAutorizada,
  persistirClassificacaoNaoAutorizada,
} from "@/lib/fiscal/geranet/classificar-emissao";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";
import { prepararNfeOperacao } from "@/lib/fiscal/nfe55/preparar-nfe-operacao";
import { montarPayloadNfeOperacaoPreparada } from "@/lib/fiscal/nfe55/payload-nfe-operacao";
import { argsNumeroManualReservaNfe } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { assertIdentidadeFiscalNfe } from "@/lib/fiscal/operacoes/resolver-natureza";
import { operacaoPodeEmitir } from "@/lib/fiscal/operacoes/status-operacao";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function erro(mensagem: string, status = 422, extra?: Record<string, unknown>) {
  return json({ ok: false, erro: mensagem, ...(extra ?? {}) }, status);
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function chaveIdempotenciaOperacao(operacaoId: string) {
  const bytes = createHash("sha256")
    .update(`ultrapdv:nfe55:operacao-fiscal:${operacaoId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims();
    if (authError || !claimsData?.claims?.sub) {
      return erro("Não autenticado.", 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();
    if (!vinculo) {
      return erro("Empresa ativa não encontrada.", 403);
    }

    try {
      await exigirEmissaoNfe({
        empresaId: String(vinculo.empresa_id),
        origem: "nfe-emitir-operacao",
      });
      await exigirEmpresaOperacional(String(vinculo.empresa_id));
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return erro(authz.mensagem, authz.status);
      }
      if (error instanceof ErroAssinaturaRestrita) {
        return erro(error.message, 403);
      }
      throw error;
    }

    const empresaId = String(vinculo.empresa_id);
    const body = (await request.json().catch(() => ({}))) as {
      operacao_id?: string;
    };
    const operacaoId = texto(body.operacao_id);
    if (!operacaoId) {
      return erro("Informe a operação fiscal.");
    }
    if (texto(request.headers.get("Idempotency-Key")) !== operacaoId) {
      return erro(
        "O header Idempotency-Key deve conter o UUID da operação fiscal.",
        400
      );
    }

    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        `
        id, empresa_id, status, tipo_operacao_interno, natureza_id,
        destinatario_tipo, destinatario_id, destino_empresa_id,
        vinculo_transferencia_id, destino_gerenciado_no_ultra,
        tp_nf, fin_nfe, natureza_descricao, saida_estoque_processada_at,
        snapshot_fiscal, dados_transporte, informacao_complementar_usuario,
        informacao_adicional_fisco, emissao_fiscal_id, venda_id
      `
      )
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return erro("Operação não encontrada nesta empresa.", 404);
    }
    if (
      operacao.tipo_operacao_interno !== "bonificacao" &&
      operacao.tipo_operacao_interno !== "transferencia"
    ) {
      return erro("Tipo de operação não implementado nesta emissão.");
    }
    if (operacao.saida_estoque_processada_at) {
      return erro("A saída desta operação já foi processada.");
    }
    if (!operacaoPodeEmitir(operacao.status) && operacao.status !== "enviando") {
      return erro("Conclua a verificação fiscal antes de emitir.");
    }

    const preparado = await prepararNfeOperacao({
      supabase,
      admin,
      empresaId,
      operacaoId,
      modo: "emissao",
    });
    if (!preparado.ok) {
      return erro(preparado.erro, preparado.status);
    }

    const chaveIdempotencia = chaveIdempotenciaOperacao(operacaoId);
    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      chaveIdempotencia
    );
    const bloqueioRascunho = avaliarBloqueioRascunhoFiscal(emissaoPrevia);
    if (bloqueioRascunho.tipo === "autorizada") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: bloqueioRascunho.emissao.id,
        chave: bloqueioRascunho.emissao.chave_acesso,
        protocolo: bloqueioRascunho.emissao.protocolo,
        mensagem: "Esta operação já possui NF-e autorizada.",
      });
    }
    if (bloqueioRascunho.tipo === "bloquear" || bloqueioRascunho.tipo === "inutilizacao" || bloqueioRascunho.tipo === "inutilizada") {
      if (bloqueioRascunho.emissao.status === "aguardando_reconciliacao") {
        await admin
          .from("fiscal_operacoes")
          .update({ status: "aguardando_reconciliacao" })
          .eq("id", operacaoId)
          .eq("empresa_id", empresaId);
      }
      return erro(
        bloqueioRascunho.tipo === "bloquear"
          ? bloqueioRascunho.mensagem
          : bloqueioRascunho.tipo === "inutilizacao"
            ? "Conclua a inutilização da numeração anterior antes de emitir novamente."
            : "Esta emissão foi inutilizada e não pode receber novo rascunho fiscal.",
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const { data: reservaData, error: reservaError } = await admin.rpc(
      "rpc_reservar_emissao_fiscal",
      {
        p_empresa_id: empresaId,
        p_modelo: "55",
        p_serie: preparado.numeracao.serie,
        p_ambiente: preparado.ambienteNumero,
        p_chave_idempotencia: chaveIdempotencia,
        p_origem_tipo: "operacao_fiscal",
        p_origem_id: operacaoId,
        ...argsNumeroManualReservaNfe(preparado.cabecalhoRascunho),
      }
    );
    if (reservaError) {
      return erro(`Falha ao reservar numeração NF-e: ${reservaError.message}`, 500);
    }
    const reserva = Array.isArray(reservaData) ? reservaData[0] : reservaData;
    if (!reserva?.emissao_id) {
      return erro("A reserva fiscal não retornou uma emissão válida.", 500);
    }
    const emissaoId = String(reserva.emissao_id);

    let identidadeFiscal: ReturnType<typeof assertIdentidadeFiscalNfe>;
    try {
      identidadeFiscal = assertIdentidadeFiscalNfe({
        naturezaId: preparado.naturezaCongelada.id,
        descricao: preparado.naturezaCongelada.descricao,
        tpNf: preparado.naturezaCongelada.tp_nf,
        finNfe: preparado.naturezaCongelada.fin_nfe,
      });
    } catch (errorIdentidade) {
      return erro(
        errorIdentidade instanceof Error
          ? errorIdentidade.message
          : "Identidade fiscal incompleta."
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        tipo_operacao_interno: operacao.tipo_operacao_interno,
        natureza_id: identidadeFiscal.naturezaId,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    await admin
      .from("fiscal_operacoes")
      .update({
        emissao_fiscal_id: emissaoId,
        natureza_id: identidadeFiscal.naturezaId,
        natureza_descricao: identidadeFiscal.descricao,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
      })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);

    const { data: emissaoAtual, error: emissaoAtualError } = await admin
      .from("fiscal_emissoes")
      .select(
        "id, status, numero, serie, codigo_numerico, chave_acesso, protocolo, cstat, motivo, geranet_http_status, erro_comunicacao, resposta_resumo"
      )
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (emissaoAtualError || !emissaoAtual) {
      return erro("Reserva criada, mas não foi possível reler a emissão.", 500, {
        emissao_id: emissaoId,
      });
    }
    if (emissaoAtual.status === "autorizada") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: emissaoId,
        chave: emissaoAtual.chave_acesso,
        protocolo: emissaoAtual.protocolo,
        mensagem: "Esta operação já possui NF-e autorizada.",
      });
    }
    if (emissaoAtual.status === "aguardando_reconciliacao") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_reconciliacao" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return erro(
        mensagemBloqueioEmissao(emissaoAtual),
        409,
        extraBloqueioRetransmissaoFiscal({
          id: emissaoId,
          status: emissaoAtual.status,
        })
      );
    }
    if (emissaoAtual.status === "enviando") {
      return erro(
        mensagemBloqueioEmissao(emissaoAtual),
        409,
        extraBloqueioRetransmissaoFiscal({
          id: emissaoId,
          status: emissaoAtual.status,
        })
      );
    }

    let fusoHorario: string;
    try {
      fusoHorario = exigirFusoHorarioFiscalDaEmissao({
        empresaIdDaEmissao: empresaId,
        fiscal: preparado.fiscal,
      });
    } catch (errorFuso) {
      return erro(
        errorFuso instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal da empresa não está configurado."
      );
    }

    const dataHora = formatarDataHoraGeranet(
      new Date(),
      fusoHorario
    );

    const itensFiscais = preparado.itensFiscais;
    const apiKey = preparado.apiKey;
    const { payload } = montarPayloadNfeOperacaoPreparada({
      preparada: preparado,
      logomarca: await obterLogomarcaFiscalHex(empresaId),
      serie: emissaoAtual.serie,
      numeroNota: emissaoAtual.numero,
      codigoNumerico: texto(emissaoAtual.codigo_numerico),
      dataHora,
      fusoHorario,
    });

    const claim = await claimTentativaEmissaoFiscal({
      admin,
      empresaId,
      emissaoId,
      usuarioId: String(claimsData.claims.sub),
      payload,
      snapshotItens: snapshotItensDaTransmissao(itensFiscais),
    });
    if (!claim.ok) {
      return erro(claim.mensagem, claim.motivo === "erro" ? 500 : 409, {
        emissao_id: emissaoId,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }
    const tentativaId = claim.tentativaId;

    await admin
      .from("fiscal_operacoes")
      .update({ status: "enviando" })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);

    let resultadoGeranet: Awaited<ReturnType<typeof chamarGeranet>>;
    try {
      resultadoGeranet = await chamarGeranet({
        apiKey,
        endpoint: "/api/v1/nfe/emitir",
        payload,
        timeoutMs: 45_000,
      });
    } catch (e) {
      const persistencia = persistenciaFalhaComunicacaoEmitir(e);
      await admin
        .from("fiscal_emissoes")
        .update(patchEmissaoFalhaComunicacao(persistencia))
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
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
      await admin
        .from("fiscal_operacoes")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      const respostaErro = montarErroEmitirNaoAutorizada({
        persistencia: persistirClassificacaoNaoAutorizada(
          persistencia.retransmitir ? "erro_envio" : "aguardando_reconciliacao"
        ),
        motivoTecnico: persistencia.motivo,
        emissaoId,
        modelo: "55",
      });
      return erro(
        respostaErro.mensagem,
        respostaErro.statusHttp,
        respostaErro.extra
      );
    }

    const geranet = resultadoGeranet.dados;
    const chave = texto(geranet.chave);
    const protocolo = texto(geranet.protocolo);
    const situacao = texto(geranet.situacao).toLowerCase();
    const autorizado =
      resultadoGeranet.httpOk &&
      situacao === "sucesso" &&
      /^\d{44}$/.test(chave) &&
      protocolo.length > 0;

    if (autorizado) {
      await admin
        .from("fiscal_emissoes")
        .update({
          status: "autorizada",
          chave_acesso: chave,
          protocolo,
          cstat: texto(geranet.cstat) || null,
          motivo: texto(geranet.mensagem) || null,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          resposta_resumo: resultadoGeranet.resumo,
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          erro_comunicacao: null,
          respondida_at: new Date().toISOString(),
          autorizada_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: geranet.mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultadoGeranet.resumo,
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: "autorizada",
      });
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        emissao_id: emissaoId,
        chave,
        protocolo,
        mensagem: "NF-e autorizada. O estoque ainda não foi movimentado.",
      });
    }

    const classificacaoEmissao = classificarRespostaEmitir({
      httpOk: resultadoGeranet.httpOk,
      httpStatus: resultadoGeranet.httpStatus,
      situacao,
      cstat: geranet.cstat,
      mensagem: geranet.mensagem,
      chave,
      protocolo,
    });

    if (classificacaoEmissao !== "rejeitada") {
      const persistencia = persistirClassificacaoNaoAutorizada(
        classificacaoEmissao === "erro_envio"
          ? "erro_envio"
          : "aguardando_reconciliacao"
      );
      const motivoTecnico = texto(geranet.mensagem) || persistencia.mensagemPadrao;
      await admin
        .from("fiscal_emissoes")
        .update({
          status: persistencia.status,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          cstat: texto(geranet.cstat) || null,
          motivo: motivoTecnico,
          erro_comunicacao: motivoTecnico,
          resposta_resumo: {
            ...resultadoGeranet.resumo,
            classificacao: persistencia.classificacaoResumo,
            historico: [historicoErroTecnico(motivoTecnico)],
          },
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          respondida_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: motivoTecnico,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: {
          ...resultadoGeranet.resumo,
          classificacao: persistencia.classificacaoResumo,
        },
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: persistencia.status,
      });
      await admin
        .from("fiscal_operacoes")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      const respostaErro = montarErroEmitirNaoAutorizada({
        persistencia,
        motivoTecnico,
        emissaoId,
        httpGeranet: resultadoGeranet.httpStatus,
        geranet: resultadoGeranet.resumo,
        modelo: "55",
      });
      return erro(
        respostaErro.mensagem,
        respostaErro.statusHttp,
        respostaErro.extra
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        status: "rejeitada",
        cstat: texto(geranet.cstat) || null,
        motivo: texto(geranet.mensagem) || "Documento rejeitado.",
        geranet_http_status: resultadoGeranet.httpStatus,
        geranet_situacao: texto(geranet.situacao) || null,
        erro_comunicacao: null,
        resposta_resumo: {
          ...(resultadoGeranet.resumo ?? {}),
          classificacao: "rejeitada",
        },
        respondida_at: new Date().toISOString(),
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);
    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: resultadoGeranet.httpStatus,
      cstat: geranet.cstat,
      motivo: geranet.mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: {
        ...(resultadoGeranet.resumo ?? {}),
        classificacao: "rejeitada",
      },
      xmlHex: texto(geranet.xml) || null,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "rejeitada",
    });
    await admin
      .from("fiscal_operacoes")
      .update({ status: "rejeitada" })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);
    return erro(texto(geranet.mensagem) || "NF-e rejeitada.", 422, {
      emissao_id: emissaoId,
      status: "rejeitada",
    });
  } catch (error) {
    return erro(
      error instanceof Error ? error.message : "Falha inesperada ao emitir a NF-e.",
      500
    );
  }
}
