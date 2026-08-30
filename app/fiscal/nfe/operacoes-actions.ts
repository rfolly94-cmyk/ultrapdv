"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { executarFinalizacaoVendaPdv } from "@/app/pdv/actions";
import { MENSAGEM_CAIXA_FECHADO_FINALIZAR, MENSAGEM_CAIXA_FECHADO_NFE_VENDA } from "@/lib/caixa/mensagens";
import { nfeVendaNovaExigeCaixa, vendaIdNfeMaterializada } from "@/lib/caixa/nfe-venda";
import { recusarNovaVendaNfeSemCaixaAberto } from "@/lib/caixa/nfe-venda-servidor";
import { deveUsarLivroCaixa } from "@/lib/caixa/controle";
import { controleCaixaAtivo } from "@/lib/caixa/controle-servidor";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA,
  MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV,
  MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA,
  MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE,
  MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL,
  ehFinNfeSuportada,
  ehTpNf,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  destinatarioTipoPeloTipoOperacao,
  mensagemNaturezaNaoEmitivelNestaTela,
  tipoOperacaoEmitivelNestaTela,
} from "@/lib/fiscal/nfe55/defaults-natureza";
import {
  anexarAuditoriaCabecalhoFiscal,
  camposCabecalhoParaSnapshot,
  escolherNumeracaoNfe55,
  ehIndicadorIntermediadorNfe,
  ehIndicadorPresencaNfe,
  lerCabecalhoFiscalDoSnapshot,
  MENSAGEM_NUMERO_NFE_INVALIDO,
  MENSAGEM_SERIE_NFE_INVALIDA,
  numeroNfeEmConflito,
  recorteAuditoriaCabecalho,
  validarDataFiscal,
  validarHoraFiscal,
  validarDataSaidaFiscal,
  validarHoraSaidaFiscal,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import {
  LIMITE_INF_ADFISCO_NFE,
  LIMITE_INF_CPL_NFE,
  persistirTextoInfAdicNfe,
  textoUsuarioInfAdFiscoNfe,
  textoUsuarioInfCplNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";
import {
  mesclarSnapshotItemComercial,
  totalItemNfe,
  validarQuantidadeItemNfe,
  validarValorUnitarioItemNfe,
} from "@/lib/fiscal/nfe55/item-comercial";
import {
  mesclarSnapshotOperacao,
  pagamentosRascunhoDoSnapshot,
  type PagamentoRascunhoNfe,
} from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import {
  faturaNfeDoSnapshot,
  snapshotFaturaNfe,
  type CondicaoPagamentoNfe,
  type FaturaNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import { mesclarPagamentoDuplicataMercantil } from "@/lib/fiscal/nfe55/pagamento-fiscal-nfe";
import {
  normalizarTotaisNota,
  totaisNotaCentavos,
  totaisNotaDoSnapshot,
  validarTotaisNota,
  type TotaisNotaNfe,
} from "@/lib/fiscal/nfe55/totais-nota";
import { escolherNaturezaParaTipoOperacao } from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  indicadorIeParaContribuinteIcms,
  lerSnapshotDestinatarioFiscal,
  modeloDocumentoNfeOperacao,
  normalizarIndicadorIeDestinatario,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { normalizarRegrasCfopDaEmpresaAtiva } from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL,
  MENSAGEM_NUMERACAO_IMUTAVEL,
  operacaoPodeConfirmarRecebimento,
  operacaoPodeConfirmarSaida,
  podeEditarDocumentoFiscal,
  podeEditarNumeracaoFiscal,
  statusAposEdicaoDocumentoFiscal,
} from "@/lib/fiscal/operacoes/status-operacao";
import { destinoTransferenciaElegivel } from "@/lib/fiscal/operacoes/elegibilidade-transferencia";
import { verificarOperacaoFiscal } from "@/lib/fiscal/operacoes/verificar-operacao";
import { parsePerfilIpi } from "@/lib/fiscal/ipi";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  normalizarDadosTransporteVenda,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { validarVolumesTransporte } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import {
  snapshotParaPersistirEnderecoEntrega,
  validarEnderecoEntrega,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import {
  snapshotParaPersistirAutorizadosXml,
  validarAutorizadosXml,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import { paraCentavos } from "@/lib/fiscal/distribuir-desconto-itens";
import { compensarDiferencaSubtotalCatalogo } from "@/lib/fiscal/nfe55/sincronizar-pagamentos";
import { validarPixNaFinalizacaoComercial } from "@/lib/pagamentos/pix/modo-ativo-servidor";
import { avaliarTetoPagamentosNoServidor } from "@/lib/pdv/validar-teto-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DadosTransporteVenda } from "@/components/vendas/transporte-venda-form";

type Resultado =
  | { ok: true; mensagem?: string; operacaoId?: string; vendaId?: string }
  | { ok: false; erro: string; pendencias?: string[] };

type TipoOperacaoNova = "venda" | "bonificacao" | "transferencia";

function mensagemErro(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function revalidar(operacaoId?: string, vendaId?: string) {
  revalidatePath("/fiscal");
  revalidatePath("/fiscal/nfe/nova");
  revalidatePath("/vendas");
  revalidatePath("/vendas/rascunhos-nfe");
  revalidatePath("/clientes");
  if (operacaoId) {
    revalidatePath(`/fiscal/nfe/${operacaoId}/editar`);
  }
  if (vendaId) {
    revalidatePath("/vendas");
    revalidatePath(`/vendas/${vendaId}`);
  }
}

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();
  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }
  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();
  if (!vinculo) {
    redirect("/onboarding");
  }
  return {
    supabase,
    empresaId: String(vinculo.empresa_id),
    usuarioId: String(claimsData.claims.sub),
  };
}

const COLUNAS_EMISSAO_EDICAO_DOCUMENTO =
  "empresa_id, status, modelo, classificacao, resposta_resumo, cstat, motivo, protocolo, chave_acesso, geranet_http_status, geranet_situacao, erro_comunicacao";

async function carregarEmissaoParaEdicaoDocumento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  emissaoFiscalId: string | null | undefined
) {
  if (!emissaoFiscalId) {
    return null;
  }
  const { data } = await supabase
    .from("fiscal_emissoes")
    .select(COLUNAS_EMISSAO_EDICAO_DOCUMENTO)
    .eq("id", emissaoFiscalId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!data || !registroPertenceAEmpresaAtiva(data, empresaId)) {
    return null;
  }
  return data;
}

function recusarEdicaoDocumentoFiscal(
  operacao: { status?: string | null },
  emissao: Awaited<ReturnType<typeof carregarEmissaoParaEdicaoDocumento>>
) {
  const gate = podeEditarDocumentoFiscal({
    statusOperacao: operacao.status,
    emissao,
  });
  if (!gate.permitido) {
    return {
      ok: false as const,
      erro: gate.motivo ?? MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL,
    };
  }
  return null;
}

function recusarNumeracaoFiscal(
  operacao: { status?: string | null },
  emissao: Awaited<ReturnType<typeof carregarEmissaoParaEdicaoDocumento>>
) {
  const gate = podeEditarNumeracaoFiscal({
    statusOperacao: operacao.status,
    emissao,
  });
  if (!gate.permitido) {
    return {
      ok: false as const,
      erro: gate.motivo ?? MENSAGEM_NUMERACAO_IMUTAVEL,
    };
  }
  return null;
}

export async function criarOperacaoFiscal(input: {
  tipo?: TipoOperacaoNova;
  naturezaId?: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    let tipo: TipoOperacaoNova | null =
      input.tipo === "venda" ||
      input.tipo === "bonificacao" ||
      input.tipo === "transferencia"
        ? input.tipo
        : null;
    let natureza: NaturezaOperacaoFiscal | null = null;

    if (input.naturezaId) {
      const { data } = await supabase
        .from("fiscal_naturezas_operacao")
        .select(
          "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
        )
        .eq("id", input.naturezaId)
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .maybeSingle();
      if (!data || !registroPertenceAEmpresaAtiva(data, empresaId)) {
        return { ok: false, erro: "Natureza não encontrada na empresa ativa." };
      }
      if (!tipoOperacaoEmitivelNestaTela(String(data.tipo_operacao_interno))) {
        return {
          ok: false,
          erro: mensagemNaturezaNaoEmitivelNestaTela(String(data.tipo_operacao_interno)),
        };
      }
      natureza = data as NaturezaOperacaoFiscal;
      tipo = data.tipo_operacao_interno as TipoOperacaoNova;
    }

    if (!tipo) {
      return { ok: false, erro: "Operação ainda não implementada nesta tela." };
    }

    const recusaCaixa = await recusarNovaVendaNfeSemCaixaAberto({
      supabase,
      empresaId,
      tipoOperacaoInterno: tipo,
    });
    if (recusaCaixa) {
      return recusaCaixa;
    }

    const destinatarioTipo = destinatarioTipoPeloTipoOperacao(tipo);
    const { data, error } = await supabase
      .from("fiscal_operacoes")
      .insert({
        empresa_id: empresaId,
        tipo_operacao_interno: tipo,
        destinatario_tipo: destinatarioTipo,
        natureza_id: natureza?.id ?? null,
        natureza_descricao: natureza?.descricao ?? null,
        tp_nf: natureza?.tp_nf ?? null,
        fin_nfe: natureza?.fin_nfe ?? null,
        status: "rascunho",
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, erro: error?.message ?? "Não foi possível criar a operação." };
    }
    revalidar(String(data.id));
    return { ok: true, operacaoId: String(data.id) };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível criar a NF-e.") };
  }
}

export async function salvarDestinatarioBonificacao(input: {
  operacaoId: string;
  clienteId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno, snapshot_fiscal, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (
      !tipoOperacaoEmitivelNestaTela(String(operacao.tipo_operacao_interno)) ||
      destinatarioTipoPeloTipoOperacao(String(operacao.tipo_operacao_interno)) !==
        "cliente"
    ) {
      return {
        ok: false,
        erro: "Esta operação não usa destinatário de cadastro de cliente.",
      };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: cliente } = await supabase
      .from("clientes")
      .select(
        "id, empresa_id, ativo, contribuinte_icms, consumidor_final, indicador_ie_destinatario"
      )
      .eq("id", input.clienteId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!cliente || !registroPertenceAEmpresaAtiva(cliente, empresaId)) {
      return { ok: false, erro: "Destinatário não pertence à empresa ativa." };
    }
    const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
      modelo: "55",
      tipoOperacaoInterno: String(operacao.tipo_operacao_interno),
      origemVenda: "nfe_manual",
      contribuinteIcms: Boolean(cliente.contribuinte_icms),
      indicadorIeCadastro: cliente.indicador_ie_destinatario
        ? String(cliente.indicador_ie_destinatario)
        : null,
      consumidorFinalCadastro: cliente.consumidor_final,
    });
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        destinatario_tipo: "cliente",
        destinatario_id: cliente.id,
        destino_empresa_id: null,
        destino_gerenciado_no_ultra: false,
        vinculo_transferencia_id: null,
        snapshot_fiscal: mesclarSnapshotOperacao(
          operacao.snapshot_fiscal,
          snapshotDestinatarioParaPersistir({
            consumidorFinal: destinatarioFiscal.consumidorFinal === "1",
            origem: "operacao",
            indicadorIe: destinatarioFiscal.indicadorIEdestinatario,
          })
        ),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Destinatário salvo. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível salvar o destinatário.") };
  }
}

export async function salvarDestinoTransferencia(input: {
  operacaoId: string;
  vinculoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (operacao.tipo_operacao_interno !== "transferencia") {
      return { ok: false, erro: "Esta operação não é uma transferência." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: vinculo } = await supabase
      .from("fiscal_vinculos_transferencia")
      .select("id, empresa_origem_id, empresa_destino_id, ativo")
      .eq("id", input.vinculoId)
      .eq("empresa_origem_id", empresaId)
      .maybeSingle();
    if (
      !vinculo ||
      vinculo.ativo === false ||
      !destinoTransferenciaElegivel({
        empresaOrigemId: empresaId,
        destinoEmpresaId: String(vinculo.empresa_destino_id),
        vinculos: [vinculo],
      })
    ) {
      return { ok: false, erro: MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL };
    }
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        destinatario_tipo: "estabelecimento",
        destinatario_id: vinculo.id,
        vinculo_transferencia_id: vinculo.id,
        destino_empresa_id: vinculo.empresa_destino_id,
        destino_gerenciado_no_ultra: true,
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Destino da transferência salvo. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL) };
  }
}

export async function vincularEstabelecimentoTransferencia(input: {
  empresaDestinoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    if (String(input.empresaDestinoId) === empresaId) {
      return { ok: false, erro: "Origem e destino devem ser estabelecimentos distintos." };
    }
    const { data, error } = await supabase.rpc(
      "rpc_vincular_estabelecimento_transferencia",
      {
        p_empresa_origem_id: empresaId,
        p_empresa_destino_id: input.empresaDestinoId,
      }
    );
    if (error) {
      return { ok: false, erro: error.message || MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL };
    }
    revalidar();
    return {
      ok: true,
      mensagem: "Estabelecimento vinculado como destino elegível de transferência.",
      operacaoId: data ? String(data) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL),
    };
  }
}

export async function salvarNaturezaOperacaoFiscal(input: {
  operacaoId: string;
  naturezaId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId, usuarioId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        "id, empresa_id, status, tipo_operacao_interno, venda_id, natureza_id, fin_nfe, snapshot_fiscal, emissao_fiscal_id"
      )
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: natureza } = await supabase
      .from("fiscal_naturezas_operacao")
      .select("id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo")
      .eq("id", input.naturezaId)
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .maybeSingle();
    if (!natureza || !registroPertenceAEmpresaAtiva(natureza, empresaId)) {
      return { ok: false, erro: "Natureza não encontrada na empresa ativa." };
    }
    if (operacao.venda_id && String(natureza.tipo_operacao_interno) !== "venda") {
      return { ok: false, erro: MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV };
    }
    if (!tipoOperacaoEmitivelNestaTela(String(natureza.tipo_operacao_interno))) {
      return {
        ok: false,
        erro: mensagemNaturezaNaoEmitivelNestaTela(String(natureza.tipo_operacao_interno)),
      };
    }
    const tipoNovo = natureza.tipo_operacao_interno as TipoOperacaoNova;
    const recusaCaixa = await recusarNovaVendaNfeSemCaixaAberto({
      supabase,
      empresaId,
      tipoOperacaoInterno: tipoNovo,
      vendaId: operacao.venda_id,
    });
    if (recusaCaixa) {
      return recusaCaixa;
    }
    const tipoMudou = !operacao.venda_id && tipoNovo !== operacao.tipo_operacao_interno;
    const destinatarioTipo = destinatarioTipoPeloTipoOperacao(
      operacao.venda_id ? "venda" : tipoNovo
    );
    const cabecalhoAtual = lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal);
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        tipo_operacao_interno: operacao.venda_id ? operacao.tipo_operacao_interno : tipoNovo,
        natureza_id: natureza.id,
        natureza_descricao: natureza.descricao,
        tp_nf: natureza.tp_nf,
        fin_nfe: natureza.fin_nfe,
        destinatario_tipo: destinatarioTipo,
        ...(tipoMudou
          ? {
              destinatario_id: null,
              destino_empresa_id: null,
              vinculo_transferencia_id: null,
              destino_gerenciado_no_ultra: false,
            }
          : {}),
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          natureza_id: natureza.id,
          ...camposCabecalhoParaSnapshot({
            tpNf: natureza.tp_nf,
            finNfe: natureza.fin_nfe,
          }),
          auditoria_cabecalho: anexarAuditoriaCabecalhoFiscal(operacao.snapshot_fiscal, {
            usuario_id: usuarioId,
            empresa_id: empresaId,
            em: new Date().toISOString(),
            antes: recorteAuditoriaCabecalho({
              naturezaId: operacao.natureza_id,
              tpNf: cabecalhoAtual.tpNf,
              serie: cabecalhoAtual.serie,
              numero: cabecalhoAtual.numero,
              finNfe: cabecalhoAtual.finNfe ?? operacao.fin_nfe,
              indicadorPresenca: cabecalhoAtual.indicadorPresenca,
              indicativoIntermediador: cabecalhoAtual.indicativoIntermediador,
              dataEmissao: cabecalhoAtual.dataEmissao,
              horaEmissao: cabecalhoAtual.horaEmissao,
              dataSaida: cabecalhoAtual.dataSaida,
              horaSaida: cabecalhoAtual.horaSaida,
            }),
            depois: recorteAuditoriaCabecalho({
              naturezaId: natureza.id,
              tpNf: natureza.tp_nf,
              serie: cabecalhoAtual.serie,
              numero: cabecalhoAtual.numero,
              finNfe: natureza.fin_nfe,
              indicadorPresenca: cabecalhoAtual.indicadorPresenca,
              indicativoIntermediador: cabecalhoAtual.indicativoIntermediador,
              dataEmissao: cabecalhoAtual.dataEmissao,
              horaEmissao: cabecalhoAtual.horaEmissao,
              dataSaida: cabecalhoAtual.dataSaida,
              horaSaida: cabecalhoAtual.horaSaida,
            }),
          }),
        }),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Natureza salva. O estoque não foi movimentado." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(
        error,
        input.operacaoId
          ? MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA
          : MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA
      ),
    };
  }
}

export async function salvarCabecalhoFiscalOperacao(input: {
  operacaoId: string;
  tpNf?: string | null;
  serie?: number | string | null;
  numero?: number | string | null;
  numeracaoAutomatica?: boolean | null;
  finNfe?: string | null;
  indicadorPresenca?: string | null;
  indicativoIntermediador?: string | null;
  dataEmissao?: string | null;
  horaEmissao?: string | null;
  dataSaida?: string | null;
  horaSaida?: string | null;
  informacaoComplementarUsuario?: string | null;
  informacaoAdicionalFisco?: string | null;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId, usuarioId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        `
        id, empresa_id, status, natureza_id, tp_nf, fin_nfe, snapshot_fiscal,
        informacao_complementar_usuario, informacao_adicional_fisco,
        emissao_fiscal_id, venda_id
      `
      )
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    if (input.tpNf != null && String(input.tpNf).trim() && !ehTpNf(input.tpNf)) {
      return { ok: false, erro: "Tipo da NF-e inválido." };
    }
    if (input.finNfe != null && String(input.finNfe).trim() && !ehFinNfeSuportada(input.finNfe)) {
      return { ok: false, erro: "Finalidade da NF-e inválida." };
    }
    if (
      input.indicadorPresenca != null &&
      String(input.indicadorPresenca).trim() &&
      !ehIndicadorPresencaNfe(input.indicadorPresenca)
    ) {
      return { ok: false, erro: "Indicador de presença inválido." };
    }
    if (
      input.indicativoIntermediador != null &&
      String(input.indicativoIntermediador).trim() &&
      !ehIndicadorIntermediadorNfe(input.indicativoIntermediador)
    ) {
      return { ok: false, erro: "Indicador de intermediador inválido." };
    }
    const dataEmissao = String(input.dataEmissao ?? "").trim();
    const horaEmissao = String(input.horaEmissao ?? "").trim();
    const dataSaida = String(input.dataSaida ?? "").trim();
    const horaSaida = String(input.horaSaida ?? "").trim();
    if (dataEmissao && !validarDataFiscal(dataEmissao)) {
      return { ok: false, erro: "Data de emissão inválida." };
    }
    if (horaEmissao && !validarHoraFiscal(horaEmissao)) {
      return { ok: false, erro: "Hora de emissão inválida." };
    }
    if (dataSaida && !validarDataSaidaFiscal(dataSaida)) {
      return { ok: false, erro: "Data de saída inválida." };
    }
    if (horaSaida && !validarHoraSaidaFiscal(horaSaida)) {
      return { ok: false, erro: "Hora de saída inválida." };
    }
    const cabecalhoAtual = lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal);
    const querAlterarNumeracao =
      input.serie !== undefined ||
      input.numero !== undefined ||
      input.numeracaoAutomatica !== undefined;
    let serie = cabecalhoAtual.serie;
    let numero = cabecalhoAtual.numero;
    let numeracaoAutomatica = cabecalhoAtual.numeracaoAutomatica;
    if (querAlterarNumeracao) {
      const bloqueioNumeracao = recusarNumeracaoFiscal(operacao, emissao);
      if (bloqueioNumeracao) {
        return bloqueioNumeracao;
      }
      const { data: fiscalEmpresa } = await supabase
        .from("empresas_fiscal")
        .select("empresa_id, ambiente")
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!fiscalEmpresa || !registroPertenceAEmpresaAtiva(fiscalEmpresa, empresaId)) {
        return { ok: false, erro: "Configuração fiscal da empresa ativa não encontrada." };
      }
      const ambiente = Number(fiscalEmpresa.ambiente) === 1 ? 1 : 2;
      const { data: numeracoes } = await supabase
        .from("fiscal_numeracoes")
        .select("modelo, ambiente, serie, proximo_numero, ativo")
        .eq("empresa_id", empresaId)
        .eq("modelo", "55")
        .eq("ambiente", ambiente)
        .eq("ativo", true);
      numeracaoAutomatica =
        input.numeracaoAutomatica !== undefined
          ? input.numeracaoAutomatica !== false
          : cabecalhoAtual.numeracaoAutomatica;
      const serieInformada =
        input.serie !== undefined && String(input.serie ?? "").trim()
          ? Number(input.serie)
          : cabecalhoAtual.serie;
      const escolhida = escolherNumeracaoNfe55({
        numeracoes: numeracoes ?? [],
        ambiente,
        serieEscolhida: serieInformada,
      });
      if (!escolhida.ok) {
        return { ok: false, erro: escolhida.mensagem || MENSAGEM_SERIE_NFE_INVALIDA };
      }
      serie = Number(escolhida.numeracao.serie);
      if (numeracaoAutomatica) {
        numero = null;
      } else {
        const numeroInformado =
          input.numero !== undefined ? input.numero : cabecalhoAtual.numero;
        numero = Number(String(numeroInformado ?? "").trim());
        if (!Number.isInteger(numero) || numero <= 0) {
          return { ok: false, erro: MENSAGEM_NUMERO_NFE_INVALIDO };
        }
        const [{ data: emissoes }, { data: rascunhos }] = await Promise.all([
          supabase
            .from("fiscal_emissoes")
            .select("empresa_id, modelo, ambiente, serie, numero, status")
            .eq("empresa_id", empresaId)
            .eq("modelo", "55")
            .eq("ambiente", ambiente)
            .eq("serie", serie)
            .eq("numero", numero),
          supabase
            .from("fiscal_operacoes")
            .select("id, empresa_id, snapshot_fiscal")
            .eq("empresa_id", empresaId)
            .in("status", [
              "rascunho",
              "pronta_para_verificacao",
              "pronta_para_emissao",
              "rejeitada",
            ]),
        ]);
        const conflito = numeroNfeEmConflito({
          empresaId,
          ambiente,
          modelo: "55",
          serie,
          numero,
          operacaoIdAtual: operacao.id,
          emissoes: emissoes ?? [],
          rascunhos: rascunhos ?? [],
        });
        if (conflito) {
          return { ok: false, erro: conflito };
        }
      }
    }
    const tpNf = ehTpNf(input.tpNf) ? input.tpNf : cabecalhoAtual.tpNf ?? operacao.tp_nf;
    const finNfe = ehFinNfeSuportada(input.finNfe)
      ? input.finNfe
      : cabecalhoAtual.finNfe ?? operacao.fin_nfe;
    const indicadorPresenca = ehIndicadorPresencaNfe(input.indicadorPresenca)
      ? input.indicadorPresenca
      : cabecalhoAtual.indicadorPresenca;
    const indicativoIntermediador = ehIndicadorIntermediadorNfe(input.indicativoIntermediador)
      ? input.indicativoIntermediador
      : cabecalhoAtual.indicativoIntermediador;
    const infoUsuario =
      input.informacaoComplementarUsuario !== undefined
        ? persistirTextoInfAdicNfe(
            input.informacaoComplementarUsuario,
            LIMITE_INF_CPL_NFE
          )
        : persistirTextoInfAdicNfe(
            operacao.informacao_complementar_usuario,
            LIMITE_INF_CPL_NFE
          );
    const infoFisco =
      input.informacaoAdicionalFisco !== undefined
        ? persistirTextoInfAdicNfe(
            input.informacaoAdicionalFisco,
            LIMITE_INF_ADFISCO_NFE
          )
        : persistirTextoInfAdicNfe(
            operacao.informacao_adicional_fisco,
            LIMITE_INF_ADFISCO_NFE
          );
    const dataEmissaoPersistida =
      input.dataEmissao !== undefined ? dataEmissao || null : cabecalhoAtual.dataEmissao;
    const horaEmissaoPersistida =
      input.horaEmissao !== undefined ? horaEmissao || null : cabecalhoAtual.horaEmissao;
    const dataSaidaPersistida =
      input.dataSaida !== undefined ? dataSaida || null : cabecalhoAtual.dataSaida;
    const horaSaidaPersistida =
      input.horaSaida !== undefined ? horaSaida || null : cabecalhoAtual.horaSaida;
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        tp_nf: tpNf,
        fin_nfe: finNfe,
        informacao_complementar_usuario: infoUsuario,
        informacao_adicional_fisco: infoFisco,
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          ...camposCabecalhoParaSnapshot({
            tpNf,
            serie,
            numero,
            numeracaoAutomatica,
            indicadorPresenca,
            indicativoIntermediador,
            finNfe,
            dataEmissao: dataEmissaoPersistida,
            horaEmissao: horaEmissaoPersistida,
            dataSaida: dataSaidaPersistida,
            horaSaida: horaSaidaPersistida,
            informacaoComplementarUsuario: infoUsuario,
            informacaoAdicionalFisco: infoFisco,
          }),
          auditoria_cabecalho: anexarAuditoriaCabecalhoFiscal(operacao.snapshot_fiscal, {
            usuario_id: usuarioId,
            empresa_id: empresaId,
            em: new Date().toISOString(),
            antes: recorteAuditoriaCabecalho({
              naturezaId: operacao.natureza_id,
              tpNf: cabecalhoAtual.tpNf ?? operacao.tp_nf,
              serie: cabecalhoAtual.serie,
              numero: cabecalhoAtual.numero,
              numeracaoAutomatica: cabecalhoAtual.numeracaoAutomatica,
              finNfe: cabecalhoAtual.finNfe ?? operacao.fin_nfe,
              indicadorPresenca: cabecalhoAtual.indicadorPresenca,
              indicativoIntermediador: cabecalhoAtual.indicativoIntermediador,
              dataEmissao: cabecalhoAtual.dataEmissao,
              horaEmissao: cabecalhoAtual.horaEmissao,
              dataSaida: cabecalhoAtual.dataSaida,
              horaSaida: cabecalhoAtual.horaSaida,
              informacaoComplementarUsuario: operacao.informacao_complementar_usuario,
              informacaoAdicionalFisco: operacao.informacao_adicional_fisco,
            }),
            depois: recorteAuditoriaCabecalho({
              naturezaId: operacao.natureza_id,
              tpNf,
              serie,
              numero,
              numeracaoAutomatica,
              finNfe,
              indicadorPresenca,
              indicativoIntermediador,
              dataEmissao: dataEmissaoPersistida,
              horaEmissao: horaEmissaoPersistida,
              dataSaida: dataSaidaPersistida,
              horaSaida: horaSaidaPersistida,
              informacaoComplementarUsuario: infoUsuario,
              informacaoAdicionalFisco: infoFisco,
            }),
          }),
        }),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem: "Cabeçalho fiscal salvo. A venda, o estoque e o pagamento não foram alterados.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o cabeçalho fiscal."),
    };
  }
}

export async function adicionarItemOperacaoFiscal(input: {
  operacaoId: string;
  produtoId: string;
  quantidade: number;
  valorUnitario: number;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: produto } = await supabase
      .from("produtos")
      .select("id, empresa_id, nome, preco_venda, grupo_fiscal_id, unidade_medida, ativo")
      .eq("id", input.produtoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
      return { ok: false, erro: "Produto não pertence à empresa ativa." };
    }
    if (produto.ativo === false) {
      return { ok: false, erro: "Produto inativo." };
    }
    const quantidadeOk = validarQuantidadeItemNfe({
      quantidade: input.quantidade,
      unidade: produto.unidade_medida,
    });
    if (!quantidadeOk.ok) {
      return { ok: false, erro: quantidadeOk.erro };
    }
    if (
      operacao.tipo_operacao_interno === "venda" &&
      !Number.isInteger(quantidadeOk.quantidade)
    ) {
      return {
        ok: false,
        erro: "Venda usa o motor do PDV: a quantidade precisa ser um número inteiro.",
      };
    }
    const precoOk = validarValorUnitarioItemNfe(input.valorUnitario);
    if (!precoOk.ok) {
      return { ok: false, erro: precoOk.erro };
    }
    const valorTotal = totalItemNfe(quantidadeOk.quantidade, precoOk.valorUnitario);
    const { error } = await supabase.from("fiscal_operacoes_itens").insert({
      empresa_id: empresaId,
      operacao_id: operacao.id,
      produto_id: produto.id,
      quantidade: quantidadeOk.quantidade,
      valor_unitario: precoOk.valorUnitario,
      valor_total: valorTotal,
      grupo_fiscal_id: produto.grupo_fiscal_id,
      snapshot_fiscal: mesclarSnapshotItemComercial(null, {
        quantidade: quantidadeOk.quantidade,
        valor_unitario: precoOk.valorUnitario,
        valor_total: valorTotal,
      }),
    });
    if (error) {
      return { ok: false, erro: error.message };
    }
    await supabase
      .from("fiscal_operacoes")
      .update({
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    revalidar(operacao.id);
    return { ok: true, mensagem: "Item adicionado. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível adicionar o item.") };
  }
}

export async function atualizarItemOperacaoFiscal(input: {
  operacaoId: string;
  itemId: string;
  quantidade: number;
  valorUnitario: number;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: item } = await supabase
      .from("fiscal_operacoes_itens")
      .select("id, empresa_id, produto_id, snapshot_fiscal, cfop_resolvido, grupo_fiscal_id")
      .eq("id", input.itemId)
      .eq("operacao_id", operacao.id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!item || !registroPertenceAEmpresaAtiva(item, empresaId)) {
      return { ok: false, erro: "Item não encontrado nesta operação." };
    }
    const { data: produto } = await supabase
      .from("produtos")
      .select("id, empresa_id, unidade_medida")
      .eq("id", item.produto_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
      return { ok: false, erro: "Produto não pertence à empresa ativa." };
    }
    const quantidadeOk = validarQuantidadeItemNfe({
      quantidade: input.quantidade,
      unidade: produto.unidade_medida,
    });
    if (!quantidadeOk.ok) {
      return { ok: false, erro: quantidadeOk.erro };
    }
    if (
      operacao.tipo_operacao_interno === "venda" &&
      !Number.isInteger(quantidadeOk.quantidade)
    ) {
      return {
        ok: false,
        erro: "Venda usa o motor do PDV: a quantidade precisa ser um número inteiro.",
      };
    }
    const precoOk = validarValorUnitarioItemNfe(input.valorUnitario);
    if (!precoOk.ok) {
      return { ok: false, erro: precoOk.erro };
    }
    const valorTotal = totalItemNfe(quantidadeOk.quantidade, precoOk.valorUnitario);
    const { error } = await supabase
      .from("fiscal_operacoes_itens")
      .update({
        quantidade: quantidadeOk.quantidade,
        valor_unitario: precoOk.valorUnitario,
        valor_total: valorTotal,
        cfop_resolvido: item.cfop_resolvido,
        grupo_fiscal_id: item.grupo_fiscal_id,
        snapshot_fiscal: mesclarSnapshotItemComercial(item.snapshot_fiscal, {
          quantidade: quantidadeOk.quantidade,
          valor_unitario: precoOk.valorUnitario,
          valor_total: valorTotal,
        }),
      })
      .eq("id", item.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    await supabase
      .from("fiscal_operacoes")
      .update({
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    revalidar(operacao.id);
    return { ok: true, mensagem: "Item atualizado. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível atualizar o item.") };
  }
}

export async function removerItemOperacaoFiscal(input: {
  operacaoId: string;
  itemId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { error } = await supabase
      .from("fiscal_operacoes_itens")
      .delete()
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("operacao_id", operacao.id);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Item removido. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível remover o item.") };
  }
}

export async function salvarTransporteOperacaoFiscal(input: {
  operacaoId: string;
  dadosTransporte: DadosTransporteVenda;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, emissao_fiscal_id, snapshot_fiscal")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return { ok: false, erro: bloqueio.erro };
    }
    const dados = normalizarDadosTransporteVenda(input.dadosTransporte);
    if (transporteConflitaComFrete9(dados)) {
      return { ok: false, erro: MENSAGEM_FRETE_9_COM_DADOS };
    }
    const errosVolume = validarVolumesTransporte(dados);
    if (errosVolume.length > 0) {
      return { ok: false, erro: errosVolume[0] };
    }
    const persistido = {
      ...dados,
      transportadora_id: input.dadosTransporte.transportadora_id || null,
      veiculo_id: input.dadosTransporte.veiculo_id || null,
    };
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        dados_transporte: persistido,
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          transporte: persistido,
        }),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Transporte salvo. O estoque não foi movimentado." };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível salvar o transporte.") };
  }
}

export async function salvarEnderecoEntregaOperacaoFiscal(input: {
  operacaoId: string;
  diferente: boolean;
  entrega?: unknown;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, emissao_fiscal_id, snapshot_fiscal")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return { ok: false, erro: bloqueio.erro };
    }
    const erroEntrega = validarEnderecoEntrega({
      diferente: input.diferente,
      entrega: input.entrega,
    });
    if (erroEntrega) {
      return { ok: false, erro: erroEntrega };
    }
    const persistido = snapshotParaPersistirEnderecoEntrega({
      diferente: input.diferente,
      entrega: input.entrega,
    });
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, persistido),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem: "Endereço de entrega salvo. O cadastro do cliente e o estoque não foram alterados.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o endereço de entrega."),
    };
  }
}

export async function salvarAutorizadosXmlOperacaoFiscal(input: {
  operacaoId: string;
  autorizadosXml?: unknown;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, emissao_fiscal_id, snapshot_fiscal")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return { ok: false, erro: bloqueio.erro };
    }
    const erroAutorizados = validarAutorizadosXml(input.autorizadosXml);
    if (erroAutorizados) {
      return { ok: false, erro: erroAutorizados };
    }
    const persistido = snapshotParaPersistirAutorizadosXml(input.autorizadosXml);
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, persistido),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem: "Autorizados a acessar o XML salvos. Destinatário, entrega e transporte não foram alterados.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar os autorizados a acessar o XML."),
    };
  }
}

export async function salvarInformacoesAdicionaisOperacao(input: {
  operacaoId: string;
  informacaoComplementarUsuario?: string | null;
  informacaoAdicionalFisco?: string | null;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, emissao_fiscal_id, snapshot_fiscal")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const infoUsuario = persistirTextoInfAdicNfe(
      input.informacaoComplementarUsuario,
      LIMITE_INF_CPL_NFE
    );
    const infoFisco = persistirTextoInfAdicNfe(
      input.informacaoAdicionalFisco,
      LIMITE_INF_ADFISCO_NFE
    );
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        informacao_complementar_usuario: infoUsuario,
        informacao_adicional_fisco: infoFisco,
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          informacao_complementar_usuario: infoUsuario,
          informacao_adicional_fisco: infoFisco,
        }),
        status: statusAposEdicaoDocumentoFiscal(String(operacao.status)),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Informações adicionais salvas. O estoque não foi movimentado." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar as informações adicionais."),
    };
  }
}

export async function verificarOperacaoFiscalAction(input: {
  operacaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        `
        id, empresa_id, status, tipo_operacao_interno, natureza_id,
        destinatario_tipo, destinatario_id, destino_empresa_id,
        vinculo_transferencia_id, dados_transporte,
        informacao_complementar_usuario, informacao_adicional_fisco,
        snapshot_fiscal, venda_id, emissao_fiscal_id
      `
      )
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissaoVerificacao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueioVerificacao = recusarEdicaoDocumentoFiscal(
      operacao,
      emissaoVerificacao
    );
    if (bloqueioVerificacao) {
      return bloqueioVerificacao;
    }
    if (operacao.tipo_operacao_interno === "transferencia" && operacao.destinatario_tipo === "cliente") {
      return { ok: false, erro: MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE };
    }

    const [
      { data: naturezas },
      { data: itens },
      { data: regras },
      { data: fiscal },
      { data: vinculos },
    ] = await Promise.all([
      supabase
        .from("fiscal_naturezas_operacao")
        .select("id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo")
        .eq("empresa_id", empresaId)
        .eq("tipo_operacao_interno", operacao.tipo_operacao_interno)
        .eq("ativo", true),
      supabase
        .from("fiscal_operacoes_itens")
        .select("id, produto_id, quantidade, valor_unitario, grupo_fiscal_id, snapshot_fiscal")
        .eq("empresa_id", empresaId)
        .eq("operacao_id", operacao.id),
      supabase
        .from("fiscal_natureza_cfop_regras")
        .select("empresa_id, natureza_id, grupo_fiscal_id, tipo_destino, cfop, ativo")
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
      supabase
        .from("empresas_fiscal")
        .select("empresa_id, uf, perfil_ipi, ambiente, codigo_regime_tributario")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("fiscal_vinculos_transferencia")
        .select("id, empresa_origem_id, empresa_destino_id, ativo")
        .eq("empresa_origem_id", empresaId)
        .eq("ativo", true),
    ]);

    const produtoIds = [...new Set((itens ?? []).map((item) => String(item.produto_id)))];
    const { data: produtos } =
      produtoIds.length > 0
        ? await supabase
            .from("produtos")
            .select("id, empresa_id, nome, grupo_fiscal_id")
            .eq("empresa_id", empresaId)
            .in("id", produtoIds)
        : { data: [] };
    const { data: produtosFiscal } =
      produtoIds.length > 0
        ? await supabase
            .from("produtos_fiscal")
            .select("produto_id, empresa_id, ncm")
            .eq("empresa_id", empresaId)
            .in("produto_id", produtoIds)
        : { data: [] };
    const grupoIds = [
      ...new Set(
        (produtos ?? [])
          .map((produto) => produto.grupo_fiscal_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const { data: grupos } =
      grupoIds.length > 0
        ? await supabase
            .from("grupos_fiscais")
            .select(
              "id, empresa_id, nome, icms_cst_csosn, ipi_aplicavel, ipi_cst, ipi_aliquota, ipi_enquadramento, cfop_interno, cfop_interestadual"
            )
            .eq("empresa_id", empresaId)
            .in("id", grupoIds)
        : { data: [] };

    let ufDestinatario: string | null = null;
    let indicadorIeDestinatario: string | null = null;
    let consumidorFinal: boolean | null = null;
    let modeloDocumento = "55";
    if (
      (operacao.tipo_operacao_interno === "bonificacao" ||
        operacao.tipo_operacao_interno === "venda") &&
      operacao.destinatario_id
    ) {
      const { data: cliente } = await supabase
        .from("clientes")
        .select(
          "id, empresa_id, uf, nome, contribuinte_icms, consumidor_final, indicador_ie_destinatario"
        )
        .eq("id", operacao.destinatario_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      ufDestinatario = cliente?.uf ? String(cliente.uf).toUpperCase() : null;
      modeloDocumento = modeloDocumentoNfeOperacao({
        tipoOperacaoInterno: operacao.tipo_operacao_interno,
        vendaId: operacao.venda_id,
      });
      const origemVenda = operacao.venda_id ? "pdv" : "nfe_manual";
      const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
        modelo: modeloDocumento,
        tipoOperacaoInterno: String(operacao.tipo_operacao_interno),
        origemVenda,
        snapshotOperacao: operacao.snapshot_fiscal,
        contribuinteIcms: Boolean(cliente?.contribuinte_icms),
        indicadorIeCadastro: cliente?.indicador_ie_destinatario
          ? String(cliente.indicador_ie_destinatario)
          : null,
        consumidorFinalCadastro: cliente?.consumidor_final,
      });
      indicadorIeDestinatario = destinatarioFiscal.indicadorIEdestinatario;
      consumidorFinal = destinatarioFiscal.consumidorFinal === "1";
      const snapAtual = lerSnapshotDestinatarioFiscal(operacao.snapshot_fiscal);
      if (!snapAtual.consumidorFinalDefinido || !snapAtual.indicadorIe) {
        await supabase
          .from("fiscal_operacoes")
          .update({
            snapshot_fiscal: mesclarSnapshotOperacao(
              operacao.snapshot_fiscal,
              snapshotDestinatarioParaPersistir({
                consumidorFinal: Boolean(consumidorFinal),
                origem:
                  snapAtual.origem ??
                  origemSnapshotAInicializar({
                    origemVenda,
                    tipoOperacaoInterno: String(operacao.tipo_operacao_interno),
                  }),
                indicadorIe: destinatarioFiscal.indicadorIEdestinatario,
              })
            ),
          })
          .eq("id", operacao.id)
          .eq("empresa_id", empresaId);
      }
    }
    if (operacao.tipo_operacao_interno === "transferencia" && operacao.destino_empresa_id) {
      const { data: destFiscal } = await supabase
        .from("empresas_fiscal")
        .select("empresa_id, uf")
        .eq("empresa_id", operacao.destino_empresa_id)
        .maybeSingle();
      ufDestinatario = destFiscal?.uf ? String(destFiscal.uf).toUpperCase() : null;
    }

    const naturezaEscolhida = escolherNaturezaParaTipoOperacao({
      empresaIdAtiva: empresaId,
      tipoOperacaoInterno: operacao.tipo_operacao_interno as TipoOperacaoNova,
      naturezaId: operacao.natureza_id,
      naturezas: (naturezas ?? []) as NaturezaOperacaoFiscal[],
    });

    const produtoPorId = new Map((produtos ?? []).map((p) => [String(p.id), p]));
    const fiscalProdutoPorId = new Map(
      (produtosFiscal ?? []).map((item) => [String(item.produto_id), item])
    );
    const grupoPorId = new Map((grupos ?? []).map((g) => [String(g.id), g]));

    const verificacao = verificarOperacaoFiscal({
      empresaIdAtiva: empresaId,
      tipoOperacaoInterno: operacao.tipo_operacao_interno as TipoOperacaoNova,
      natureza: naturezaEscolhida.ok ? naturezaEscolhida.natureza : null,
      ufEmpresa: fiscal?.uf,
      ufDestinatario,
      destinatarioTipo: String(operacao.destinatario_tipo),
      destinatarioId: operacao.destinatario_id,
      destinoEmpresaId: operacao.destino_empresa_id,
      vinculosTransferencia: vinculos ?? [],
      itens: (itens ?? []).map((item) => {
        const produto = produtoPorId.get(String(item.produto_id));
        const fiscalProduto = fiscalProdutoPorId.get(String(item.produto_id));
        const grupo = grupoPorId.get(String(produto?.grupo_fiscal_id ?? item.grupo_fiscal_id));
        return {
          id: String(item.id),
          descricao: String(produto?.nome ?? "Item"),
          produtoId: String(item.produto_id),
          produtoEmpresaId: produto?.empresa_id,
          grupoFiscalId: grupo?.id ?? produto?.grupo_fiscal_id,
          grupoFiscalEmpresaId: grupo?.empresa_id,
          grupoFiscalNome: grupo?.nome,
          icmsCstCsosn: grupo?.icms_cst_csosn,
          ncm: fiscalProduto?.ncm,
          cfopInterno: grupo?.cfop_interno,
          cfopInterestadual: grupo?.cfop_interestadual,
          quantidade: Number(item.quantidade),
          valorUnitario: Number(item.valor_unitario),
        };
      }),
      regrasCfop: normalizarRegrasCfopDaEmpresaAtiva(regras, empresaId),
      codigoRegimeTributario: lerCodigoRegimeTributario(
        fiscal?.codigo_regime_tributario
      ),
      ambiente: Number(fiscal?.ambiente) === 1 ? "1" : "2",
      perfilIpi: parsePerfilIpi(fiscal?.perfil_ipi),
      gruposIpi: grupos ?? [],
      modeloDocumento,
      indicadorIeDestinatario,
      consumidorFinal,
    });

    if (!verificacao.ok) {
      return {
        ok: false,
        erro: "A verificação fiscal encontrou pendências.",
        pendencias: verificacao.pendencias.map((item) => item.mensagem),
      };
    }

    if (operacao.tipo_operacao_interno === "venda") {
      const pagamentos = pagamentosRascunhoDoSnapshot(operacao.snapshot_fiscal);
      const coberturaDuplicataCentavos =
        faturaNfeDoSnapshot(operacao.snapshot_fiscal)?.valorLiquidoCentavos ?? 0;
      if (pagamentos.length === 0 && coberturaDuplicataCentavos <= 0) {
        return {
          ok: false,
          erro: "Informe o pagamento da venda antes de validar.",
        };
      }
      const itensVenda = (itens ?? []).map((item) => ({
        produtoId: String(item.produto_id),
        quantidade: Number(item.quantidade),
        precoUnitarioCentavos: paraCentavos(item.valor_unitario),
      }));
      if (itensVenda.some((item) => !Number.isInteger(item.quantidade))) {
        return {
          ok: false,
          erro: "Venda usa o motor do PDV: a quantidade precisa ser um número inteiro.",
        };
      }
      const totaisNota = totaisNotaDoSnapshot(operacao.snapshot_fiscal);
      const totaisCentavos = totaisNotaCentavos(totaisNota);
      const teto = await avaliarTetoPagamentosNoServidor({
        supabase,
        empresaId,
        itens: itensVenda,
        descontoCentavos: totaisCentavos.desconto,
        freteCentavos: totaisCentavos.frete,
        acrescimoCentavos: totaisCentavos.seguro + totaisCentavos.outro,
        pagamentos,
        rejeitarPagamentoIncompleto: true,
        coberturaDuplicataCentavos,
      });
      if (!teto.ok) {
        return { ok: false, erro: teto.erro };
      }
    }

    for (const item of verificacao.itens) {
      const persistido = (itens ?? []).find((linha) => String(linha.id) === item.id);
      await supabase
        .from("fiscal_operacoes_itens")
        .update({
          cfop_resolvido: item.cfop,
          grupo_fiscal_id: item.grupoFiscalId,
          snapshot_fiscal: mesclarSnapshotOperacao(persistido?.snapshot_fiscal, {
            cfop: item.cfop,
            ncm: item.ncm,
            icms_cst_csosn: item.icmsCstCsosn,
            grupo_fiscal_id: item.grupoFiscalId,
            grupo_fiscal_nome: item.grupoFiscalNome,
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            valor_total: totalItemNfe(item.quantidade, item.valorUnitario),
          }),
        })
        .eq("id", item.id)
        .eq("empresa_id", empresaId);
    }

    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        status: "pronta_para_emissao",
        tipo_destino: verificacao.tipoDestino,
        uf_empresa: fiscal?.uf ? String(fiscal.uf).toUpperCase() : null,
        uf_destinatario: ufDestinatario,
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          tipo_operacao_interno: operacao.tipo_operacao_interno,
          natureza_id: naturezaEscolhida.ok ? naturezaEscolhida.natureza.id : null,
          tp_nf:
            lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal).tpNf ??
            (naturezaEscolhida.ok ? naturezaEscolhida.natureza.tp_nf : null),
          fin_nfe:
            lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal).finNfe ??
            (naturezaEscolhida.ok ? naturezaEscolhida.natureza.fin_nfe : null),
          tipo_destino: verificacao.tipoDestino,
          destinatario_tipo: operacao.destinatario_tipo,
          destinatario_id: operacao.destinatario_id,
          destino_empresa_id: operacao.destino_empresa_id,
          transporte: operacao.dados_transporte,
          informacao_complementar_usuario: textoUsuarioInfCplNfe({
            snapshot: operacao.snapshot_fiscal,
            coluna: operacao.informacao_complementar_usuario,
          }),
          informacao_adicional_fisco: textoUsuarioInfAdFiscoNfe({
            snapshot: operacao.snapshot_fiscal,
            coluna: operacao.informacao_adicional_fisco,
          }),
          alertas: verificacao.alertas,
        }),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem:
        "NF-e pronta para emissão. Verificação fiscal concluída. O estoque ainda não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível verificar a operação."),
    };
  }
}

export async function confirmarSaidaOperacaoFiscal(input: {
  operacaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (operacao.tipo_operacao_interno === "venda") {
      return {
        ok: false,
        erro: "Estoque da venda já foi baixado pelo PDV na finalização comercial.",
      };
    }
    if (
      !operacaoPodeConfirmarSaida(operacao.status) &&
      operacao.status !== "em_transito" &&
      operacao.status !== "concluida"
    ) {
      return { ok: false, erro: "A saída só pode ser confirmada após a NF-e autorizada." };
    }
    const { data, error } = await supabase.rpc("rpc_confirmar_saida_operacao_fiscal", {
      p_empresa_id: empresaId,
      p_operacao_id: input.operacaoId,
    });
    if (error) {
      return { ok: false, erro: error.message };
    }
    const registro = Array.isArray(data) ? data[0] : data;
    const movimentados = Number(registro?.itens_movimentados ?? 0);
    revalidar(input.operacaoId);
    return {
      ok: true,
      mensagem:
        movimentados > 0
          ? `Saída confirmada. ${movimentados} item(ns) movimentados.`
          : "Saída já processada. O estoque não foi movimentado novamente.",
    };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível confirmar a saída.") };
  }
}

export async function confirmarRecebimentoTransferencia(input: {
  operacaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (operacao.tipo_operacao_interno !== "transferencia") {
      return { ok: false, erro: "Somente transferência possui recebimento." };
    }
    if (
      !operacaoPodeConfirmarRecebimento(operacao.status) &&
      operacao.status !== "concluida"
    ) {
      return { ok: false, erro: "Confirme a saída da origem antes do recebimento." };
    }
    const { data, error } = await supabase.rpc(
      "rpc_confirmar_recebimento_transferencia",
      {
        p_empresa_id: empresaId,
        p_operacao_id: input.operacaoId,
      }
    );
    if (error) {
      return { ok: false, erro: error.message };
    }
    const registro = Array.isArray(data) ? data[0] : data;
    const movimentados = Number(registro?.itens_movimentados ?? 0);
    revalidar(input.operacaoId);
    return {
      ok: true,
      mensagem:
        movimentados > 0
          ? `Recebimento confirmado. ${movimentados} item(ns) no destino.`
          : "Recebimento já processado. O estoque não foi movimentado novamente.",
    };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível confirmar o recebimento.") };
  }
}

export async function buscarProdutosOperacaoFiscal(input: {
  busca: string;
}): Promise<
  | {
      ok: true;
      produtos: Array<{
        id: string;
        nome: string;
        codigo: string;
        unidade: string;
        ncm: string | null;
        estoque: number;
        preco: number;
      }>;
    }
  | { ok: false; erro: string }
> {
  try {
    const { supabase, empresaId } = await getContexto();
    const termo = String(input.busca ?? "")
      .trim()
      .replace(/[%_,()]/g, " ")
      .slice(0, 80);
    if (termo.length < 2) {
      return { ok: true, produtos: [] };
    }
    const { data: produtos } = await supabase
      .from("produtos")
      .select("id, empresa_id, nome, codigo, codigo_barras, unidade_medida, preco_venda, ativo")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .or(
        `nome.ilike.%${termo}%,codigo.ilike.%${termo}%,codigo_barras.ilike.%${termo}%`
      )
      .order("nome")
      .limit(20);
    const daEmpresa = (produtos ?? []).filter((produto) =>
      registroPertenceAEmpresaAtiva(produto, empresaId)
    );
    const ids = daEmpresa.map((item) => String(item.id));
    const [{ data: estoques }, { data: fiscais }] = await Promise.all([
      ids.length > 0
        ? supabase
            .from("estoque_atual")
            .select("produto_id, quantidade")
            .eq("empresa_id", empresaId)
            .in("produto_id", ids)
        : Promise.resolve({ data: [] as Array<{ produto_id: string; quantidade: number }> }),
      ids.length > 0
        ? supabase
            .from("produtos_fiscal")
            .select("produto_id, ncm")
            .eq("empresa_id", empresaId)
            .in("produto_id", ids)
        : Promise.resolve({ data: [] as Array<{ produto_id: string; ncm: string | null }> }),
    ]);
    const estoquePorId = new Map(
      (estoques ?? []).map((item) => [String(item.produto_id), Number(item.quantidade ?? 0)])
    );
    const ncmPorId = new Map(
      (fiscais ?? []).map((item) => [String(item.produto_id), item.ncm ?? null])
    );
    return {
      ok: true,
      produtos: daEmpresa.map((produto) => ({
        id: String(produto.id),
        nome: String(produto.nome),
        codigo: String(produto.codigo ?? ""),
        unidade: String(produto.unidade_medida ?? "UN"),
        ncm: ncmPorId.get(String(produto.id)) ?? null,
        estoque: estoquePorId.get(String(produto.id)) ?? 0,
        preco: Number(produto.preco_venda ?? 0),
      })),
    };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível buscar produtos.") };
  }
}

export async function buscarClientesOperacaoFiscal(input: {
  busca: string;
}): Promise<
  | {
      ok: true;
      clientes: Array<{
        id: string;
        nome: string;
        nomeFantasia: string | null;
        tipoPessoa: string;
        cpfCnpj: string;
        inscricaoEstadual: string | null;
        contribuinteIcms: boolean;
        indicadorIe: "1" | "2" | "9";
        consumidorFinal: boolean;
        telefone: string | null;
        email: string | null;
        cep: string | null;
        uf: string | null;
        municipio: string | null;
        bairro: string | null;
        logradouro: string | null;
        numero: string | null;
        complemento: string | null;
        codigoMunicipioIbge: string | null;
      }>;
    }
  | { ok: false; erro: string }
> {
  try {
    const { supabase, empresaId } = await getContexto();
    const termo = String(input.busca ?? "")
      .trim()
      .replace(/[%_,()]/g, " ")
      .slice(0, 80);
    if (termo.length < 2) {
      return { ok: true, clientes: [] };
    }
    const { data: clientes } = await supabase
      .from("clientes")
      .select(
        `id, empresa_id, nome, nome_fantasia, tipo_pessoa, cpf_cnpj, inscricao_estadual,
         contribuinte_icms, indicador_ie_destinatario, consumidor_final, telefone, email, cep, uf, municipio, bairro,
         logradouro, numero, complemento, codigo_municipio_ibge`
      )
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .or(`nome.ilike.%${termo}%,cpf_cnpj.ilike.%${termo}%,nome_fantasia.ilike.%${termo}%`)
      .order("nome")
      .limit(20);
    return {
      ok: true,
      clientes: (clientes ?? [])
        .filter((cliente) => registroPertenceAEmpresaAtiva(cliente, empresaId))
        .map((cliente) => ({
          id: String(cliente.id),
          nome: String(cliente.nome),
          nomeFantasia: cliente.nome_fantasia ? String(cliente.nome_fantasia) : null,
          tipoPessoa: String(cliente.tipo_pessoa ?? ""),
          cpfCnpj: String(cliente.cpf_cnpj ?? ""),
          inscricaoEstadual: cliente.inscricao_estadual
            ? String(cliente.inscricao_estadual)
            : null,
          contribuinteIcms: Boolean(cliente.contribuinte_icms),
          indicadorIe: normalizarIndicadorIeDestinatario(
            cliente.indicador_ie_destinatario,
            Boolean(cliente.contribuinte_icms)
          ),
          consumidorFinal: Boolean(cliente.consumidor_final),
          telefone: cliente.telefone ? String(cliente.telefone) : null,
          email: cliente.email ? String(cliente.email) : null,
          cep: cliente.cep ? String(cliente.cep) : null,
          uf: cliente.uf ? String(cliente.uf) : null,
          municipio: cliente.municipio ? String(cliente.municipio) : null,
          bairro: cliente.bairro ? String(cliente.bairro) : null,
          logradouro: cliente.logradouro ? String(cliente.logradouro) : null,
          numero: cliente.numero ? String(cliente.numero) : null,
          complemento: cliente.complemento ? String(cliente.complemento) : null,
          codigoMunicipioIbge: cliente.codigo_municipio_ibge
            ? String(cliente.codigo_municipio_ibge)
            : null,
        })),
    };
  } catch (error) {
    return { ok: false, erro: mensagemErro(error, "Não foi possível buscar destinatários.") };
  }
}

export async function atualizarIdentidadeDestinatarioOperacao(input: {
  operacaoId: string;
  clienteId: string;
  tipoPessoa: "F" | "J";
  consumidorFinal: boolean;
  origemConsumidorFinal?: "cadastro" | "manual" | "operacao" | "origem_pdv";
  indicadorIe?: string | null;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    if (input.tipoPessoa !== "F" && input.tipoPessoa !== "J") {
      return { ok: false, erro: "Tipo de pessoa inválido." };
    }
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        "id, empresa_id, status, tipo_operacao_interno, destinatario_id, snapshot_fiscal, venda_id, emissao_fiscal_id"
      )
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, empresa_id, contribuinte_icms, indicador_ie_destinatario")
      .eq("id", input.clienteId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!cliente || !registroPertenceAEmpresaAtiva(cliente, empresaId)) {
      return { ok: false, erro: "Destinatário não pertence à empresa ativa." };
    }
    if (operacao.destinatario_id && String(operacao.destinatario_id) !== String(cliente.id)) {
      return { ok: false, erro: "O destinatário informado não é o desta operação." };
    }
    const { error: clienteErro } = await supabase
      .from("clientes")
      .update({
        tipo_pessoa: input.tipoPessoa,
      })
      .eq("id", cliente.id)
      .eq("empresa_id", empresaId);
    if (clienteErro) {
      return { ok: false, erro: clienteErro.message };
    }
    const snapAtual = lerSnapshotDestinatarioFiscal(operacao.snapshot_fiscal);
    const indicadorIe = normalizarIndicadorIeDestinatario(
      input.indicadorIe ?? snapAtual.indicadorIe ?? cliente.indicador_ie_destinatario,
      Boolean(cliente.contribuinte_icms)
    );
    const origemConsumidorFinal =
      input.origemConsumidorFinal === "origem_pdv" ? "origem_pdv" : "operacao";
    const modeloDocumento = modeloDocumentoNfeOperacao({
      tipoOperacaoInterno: operacao.tipo_operacao_interno,
      consumidorFinal: input.consumidorFinal,
      vendaId: operacao.venda_id,
    });
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(
          operacao.snapshot_fiscal,
          {
            modelo_documento: modeloDocumento,
            tipo_pessoa: input.tipoPessoa,
            ...snapshotDestinatarioParaPersistir({
              consumidorFinal: input.consumidorFinal,
              origem: origemConsumidorFinal,
              indicadorIe,
            }),
          }
        ),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem: "Identidade do destinatário atualizada na empresa ativa.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível atualizar o destinatário."),
    };
  }
}

export async function salvarCadastroDestinatarioOperacao(input: {
  operacaoId: string;
  clienteId: string;
  tipoPessoa: "F" | "J";
  nome: string;
  nomeFantasia: string;
  cpfCnpj: string;
  inscricaoEstadual: string;
  contribuinteIcms: boolean;
  indicadorIe?: string | null;
  telefone: string;
  email: string;
  cep: string;
  uf: string;
  municipio: string;
  codigoMunicipioIbge: string;
  bairro: string;
  logradouro: string;
  numero: string;
  complemento: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const nome = String(input.nome ?? "").trim();
    if (nome.length < 2) {
      return { ok: false, erro: "Informe o nome ou razão social do destinatário." };
    }
    if (input.tipoPessoa !== "F" && input.tipoPessoa !== "J") {
      return { ok: false, erro: "Tipo de pessoa inválido." };
    }
    const documento = String(input.cpfCnpj ?? "").replace(/\D/g, "");
    if (input.tipoPessoa === "F" && documento && documento.length !== 11) {
      return { ok: false, erro: "CPF do destinatário inválido." };
    }
    if (input.tipoPessoa === "J" && documento && documento.length !== 14) {
      return { ok: false, erro: "CNPJ do destinatário inválido." };
    }
    const ie = String(input.inscricaoEstadual ?? "").trim();
    const indicadorIe = normalizarIndicadorIeDestinatario(
      input.indicadorIe,
      Boolean(input.contribuinteIcms)
    );
    if (indicadorIe === "1" && !ie) {
      return {
        ok: false,
        erro: "Destinatário contribuinte precisa de Inscrição Estadual. Preencha a IE ou marque Isento / Não contribuinte.",
      };
    }
    const uf = String(input.uf ?? "").trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) {
      return { ok: false, erro: "UF do destinatário inválida." };
    }
    const ibge = String(input.codigoMunicipioIbge ?? "").replace(/\D/g, "");
    if (ibge && ibge.length !== 7) {
      return { ok: false, erro: "Código IBGE do município deve ter 7 dígitos." };
    }
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, destinatario_id, snapshot_fiscal, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, empresa_id")
      .eq("id", input.clienteId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!cliente || !registroPertenceAEmpresaAtiva(cliente, empresaId)) {
      return { ok: false, erro: "Destinatário não pertence à empresa ativa." };
    }
    if (operacao.destinatario_id && String(operacao.destinatario_id) !== String(cliente.id)) {
      return { ok: false, erro: "O destinatário informado não é o desta operação." };
    }
    const { error } = await supabase
      .from("clientes")
      .update({
        nome,
        nome_fantasia: String(input.nomeFantasia ?? "").trim() || null,
        tipo_pessoa: input.tipoPessoa,
        cpf_cnpj: documento || null,
        inscricao_estadual: ie || null,
        contribuinte_icms: indicadorIeParaContribuinteIcms(indicadorIe),
        indicador_ie_destinatario: indicadorIe,
        telefone: String(input.telefone ?? "").replace(/\D/g, "") || null,
        email: String(input.email ?? "").trim().toLowerCase() || null,
        cep: String(input.cep ?? "").replace(/\D/g, "") || null,
        uf: uf || null,
        municipio: String(input.municipio ?? "").trim() || null,
        codigo_municipio_ibge: ibge || null,
        bairro: String(input.bairro ?? "").trim() || null,
        logradouro: String(input.logradouro ?? "").trim() || null,
        numero: String(input.numero ?? "").trim() || null,
        complemento: String(input.complemento ?? "").trim() || null,
      })
      .eq("id", cliente.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    const { error: snapErro } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          indicador_ie_destinatario: indicadorIe,
        }),
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (snapErro) {
      return { ok: false, erro: snapErro.message };
    }
    revalidar(operacao.id);
    return {
      ok: true,
      mensagem: "Cadastro do destinatário atualizado na empresa ativa.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o cadastro do destinatário."),
    };
  }
}

export async function salvarPagamentosOperacaoVenda(input: {
  operacaoId: string;
  pagamentos: PagamentoRascunhoNfe[];
  condicaoPagamento?: CondicaoPagamentoNfe;
  fatura?: FaturaNfe | null;
  preservarStatusEmissao?: boolean;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, tipo_operacao_interno, snapshot_fiscal, venda_id, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (operacao.tipo_operacao_interno !== "venda") {
      return { ok: false, erro: "Pagamento comercial só se aplica à natureza de venda." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const pagamentos = input.pagamentos.filter(
      (pagamento) =>
        pagamento.valorCentavos > 0 && Number.isInteger(pagamento.valorCentavos)
    );
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          pagamentos_rascunho: pagamentos,
          ...snapshotFaturaNfe({
            condicao: input.condicaoPagamento ?? (input.fatura ? "prazo" : "vista"),
            fatura: input.fatura ?? null,
          }),
        }),
        status:
          operacao.status === "pronta_para_emissao" && !input.preservarStatusEmissao
            ? "pronta_para_verificacao"
            : operacao.status,
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Pagamento salvo no rascunho. O estoque não foi movimentado." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o pagamento."),
    };
  }
}

export async function salvarTotaisOperacaoFiscal(input: {
  operacaoId: string;
  totais: TotaisNotaNfe;
  totalProdutos: number;
  preservarStatusEmissao?: boolean;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, status, snapshot_fiscal, venda_id, emissao_fiscal_id")
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }
    const totais = normalizarTotaisNota(input.totais);
    const erroTotais = validarTotaisNota({
      totalProdutos: input.totalProdutos,
      totais,
    });
    if (erroTotais) {
      return { ok: false, erro: erroTotais };
    }
    const { error } = await supabase
      .from("fiscal_operacoes")
      .update({
        snapshot_fiscal: mesclarSnapshotOperacao(operacao.snapshot_fiscal, {
          totais_nota: totais,
        }),
        status:
          operacao.status === "pronta_para_emissao" && !input.preservarStatusEmissao
            ? "pronta_para_verificacao"
            : operacao.status,
      })
      .eq("id", operacao.id)
      .eq("empresa_id", empresaId);
    if (error) {
      return { ok: false, erro: error.message };
    }
    revalidar(operacao.id);
    return { ok: true, mensagem: "Totais da NF-e salvos. O estoque não foi movimentado." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar os totais da NF-e."),
    };
  }
}

export async function prepararVendaParaEmissaoNfe(input: {
  operacaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: operacao } = await supabase
      .from("fiscal_operacoes")
      .select(
        `
        id, empresa_id, status, tipo_operacao_interno, natureza_id,
        destinatario_id, snapshot_fiscal, venda_id, emissao_fiscal_id,
        informacao_complementar_usuario, informacao_adicional_fisco
      `
      )
      .eq("id", input.operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
      return { ok: false, erro: "Operação não encontrada na empresa ativa." };
    }
    if (operacao.tipo_operacao_interno !== "venda") {
      return { ok: false, erro: "Esta operação não é uma venda." };
    }
    if (!operacao.natureza_id) {
      return { ok: false, erro: "Selecione a natureza de venda da empresa ativa." };
    }
    if (!operacao.destinatario_id) {
      return { ok: false, erro: "Selecione o destinatário da venda." };
    }
    const emissao = await carregarEmissaoParaEdicaoDocumento(
      supabase,
      empresaId,
      operacao.emissao_fiscal_id
    );
    const bloqueio = recusarEdicaoDocumentoFiscal(operacao, emissao);
    if (bloqueio) {
      return bloqueio;
    }

    let vendaId = vendaIdNfeMaterializada(operacao.venda_id)
      ? String(operacao.venda_id)
      : null;

    if (!vendaId) {
      if (operacao.status !== "pronta_para_emissao") {
        return {
          ok: false,
          erro: "Valide a NF-e antes de emitir. A venda comercial ainda não foi finalizada.",
        };
      }
      const { data: itens } = await supabase
        .from("fiscal_operacoes_itens")
        .select("produto_id, quantidade, valor_unitario")
        .eq("empresa_id", empresaId)
        .eq("operacao_id", operacao.id)
        .order("created_at", { ascending: true });
      const itensVenda = (itens ?? []).map((item) => ({
        produtoId: String(item.produto_id),
        quantidade: Number(item.quantidade),
        precoUnitarioCentavos: paraCentavos(item.valor_unitario),
      }));
      if (itensVenda.length === 0) {
        return { ok: false, erro: "Inclua ao menos um produto da empresa ativa." };
      }
      if (itensVenda.some((item) => !Number.isInteger(item.quantidade) || item.quantidade <= 0)) {
        return {
          ok: false,
          erro: "Venda usa o motor do PDV: a quantidade precisa ser um número inteiro.",
        };
      }
      const coberturaDuplicataCentavos =
        faturaNfeDoSnapshot(operacao.snapshot_fiscal)?.valorLiquidoCentavos ?? 0;
      let pagamentos = pagamentosRascunhoDoSnapshot(operacao.snapshot_fiscal);
      if (pagamentos.length === 0 && coberturaDuplicataCentavos <= 0) {
        return { ok: false, erro: "Informe o pagamento da venda." };
      }

      const totaisNota = totaisNotaDoSnapshot(operacao.snapshot_fiscal);
      const totaisCentavos = totaisNotaCentavos(totaisNota);
      const tetoFiscal = await avaliarTetoPagamentosNoServidor({
        supabase,
        empresaId,
        itens: itensVenda,
        descontoCentavos: totaisCentavos.desconto,
        freteCentavos: totaisCentavos.frete,
        acrescimoCentavos: totaisCentavos.seguro + totaisCentavos.outro,
        pagamentos,
        rejeitarPagamentoIncompleto: true,
        coberturaDuplicataCentavos,
      });
      if (!tetoFiscal.ok) {
        return { ok: false, erro: tetoFiscal.erro };
      }
      if (coberturaDuplicataCentavos > 0) {
        const { data: formasEmpresa, error: formasErro } = await supabase
          .from("formas_pagamento")
          .select("id, empresa_id, codigo, nome, codigo_fiscal, permite_fiado")
          .eq("empresa_id", empresaId);
        if (formasErro) {
          return { ok: false, erro: formasErro.message };
        }
        pagamentos = mesclarPagamentoDuplicataMercantil({
          pagamentos,
          formas: (formasEmpresa ?? []).filter((forma) =>
            registroPertenceAEmpresaAtiva(forma, empresaId)
          ),
          coberturaDuplicataCentavos,
        });
        if (pagamentos.length === 0) {
          return {
            ok: false,
            erro: "Cadastre uma forma de pagamento Duplicata Mercantil (tPag 14) na empresa para finalizar a venda.",
          };
        }
      }
      const pixModo = await validarPixNaFinalizacaoComercial({
        supabase,
        empresaId,
        pagamentos,
      });
      if (!pixModo.ok) {
        return { ok: false, erro: pixModo.erro };
      }

      const { data: tipoCatalogo } = await supabase
        .from("fiscal_tipos_operacao")
        .select("codigo, vincula_venda")
        .eq("codigo", operacao.tipo_operacao_interno)
        .maybeSingle();
      const exigeCaixa = nfeVendaNovaExigeCaixa({
        tipoOperacaoInterno: operacao.tipo_operacao_interno,
        vinculaVenda: tipoCatalogo?.vincula_venda === true,
        vendaId: null,
      });
      const controleAtivo = await controleCaixaAtivo(supabase, empresaId);
      const exigirCaixaAberto = deveUsarLivroCaixa({
        controleAtivo,
        fluxoExigeCaixa: exigeCaixa,
      });

      const produtoIds = [...new Set(itensVenda.map((item) => item.produtoId))];
      const { data: produtosCatalogo } = await supabase
        .from("produtos")
        .select("id, empresa_id, preco_venda")
        .eq("empresa_id", empresaId)
        .in("id", produtoIds);
      const precoCatalogoPorId = new Map(
        (produtosCatalogo ?? [])
          .filter((produto) => registroPertenceAEmpresaAtiva(produto, empresaId))
          .map((produto) => [String(produto.id), paraCentavos(produto.preco_venda)])
      );
      const subtotalAlvoCentavos = itensVenda.reduce(
        (soma, item) => soma + Math.round(item.quantidade) * item.precoUnitarioCentavos,
        0
      );
      const subtotalCatalogoCentavos = itensVenda.reduce(
        (soma, item) =>
          soma + Math.round(item.quantidade) * (precoCatalogoPorId.get(item.produtoId) ?? 0),
        0
      );
      // Motor comercial da NF-e de venda nova: o PDV grava o preço cadastral.
      // A diferença para o preço editado na NF-e fica só no livro comercial
      // (desconto/acréscimo da venda) e NÃO vira vOutro no XML.
      const extrasComerciais = compensarDiferencaSubtotalCatalogo({
        subtotalCatalogoCentavos,
        subtotalAlvoCentavos,
        descontoCentavos: totaisCentavos.desconto,
        acrescimoCentavos: totaisCentavos.seguro + totaisCentavos.outro,
      });

      // Motor comercial da NF-e de venda nova: mesmo RPC atômico do PDV web
      // quando o controle de Caixa está ativo. Sem controle, materializa
      // pela RPC comercial sem livro. Emissão fiscal posterior não relança Caixa.
      const finalizada = await executarFinalizacaoVendaPdv(
        {
          idempotencyKey: String(operacao.id),
          clienteId: String(operacao.destinatario_id),
          descontoCentavos: extrasComerciais.descontoCentavos,
          freteCentavos: totaisCentavos.frete,
          acrescimoCentavos: extrasComerciais.acrescimoCentavos,
          trocoCentavos: tetoFiscal.trocoCentavos,
          itens: itensVenda.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
          })),
          pagamentos,
        },
        {
          exigirCaixaAberto: exigirCaixaAberto,
        }
      );
      if (!finalizada.ok) {
        const caixaFechado =
          finalizada.codigo === "CAIXA_FECHADO" ||
          finalizada.erro === MENSAGEM_CAIXA_FECHADO_FINALIZAR;
        return {
          ok: false,
          erro: caixaFechado ? MENSAGEM_CAIXA_FECHADO_NFE_VENDA : finalizada.erro,
        };
      }
      vendaId = finalizada.vendaId;

      const { error: vinculoErro } = await supabase
        .from("fiscal_operacoes")
        .update({ venda_id: vendaId })
        .eq("id", operacao.id)
        .eq("empresa_id", empresaId)
        .is("venda_id", null);
      if (vinculoErro) {
        return { ok: false, erro: vinculoErro.message };
      }
    }

    const admin = createAdminClient();
    const { data: venda } = await admin
      .from("vendas")
      .select("id, empresa_id, status, snapshot_fiscal")
      .eq("id", vendaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!venda || !registroPertenceAEmpresaAtiva(venda, empresaId)) {
      return { ok: false, erro: "A venda comercial não pertence à empresa ativa." };
    }

    const snapDest = lerSnapshotDestinatarioFiscal(operacao.snapshot_fiscal);
    const patchVenda = {
      ...(snapDest.consumidorFinalDefinido || snapDest.indicadorIe
        ? snapshotDestinatarioParaPersistir({
            consumidorFinal: Boolean(snapDest.consumidorFinal),
            origem: snapDest.origem ?? "operacao",
            indicadorIe: snapDest.indicadorIe ?? "9",
          })
        : {}),
      informacao_complementar_usuario: textoUsuarioInfCplNfe({
        snapshot: operacao.snapshot_fiscal,
        coluna: operacao.informacao_complementar_usuario,
      }),
      informacao_adicional_fisco: textoUsuarioInfAdFiscoNfe({
        snapshot: operacao.snapshot_fiscal,
        coluna: operacao.informacao_adicional_fisco,
      }),
    };
    const { error: naturezaErro } = await admin
      .from("vendas")
      .update({
        natureza_id: operacao.natureza_id,
        snapshot_fiscal: mesclarSnapshotOperacao(venda.snapshot_fiscal, patchVenda),
      })
      .eq("id", vendaId)
      .eq("empresa_id", empresaId);
    if (naturezaErro) {
      return { ok: false, erro: naturezaErro.message };
    }

    revalidar(operacao.id, vendaId);
    return {
      ok: true,
      vendaId,
      mensagem: "Venda comercial pronta. Emitindo NF-e pelo motor da venda.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível preparar a venda para emissão."),
    };
  }
}
