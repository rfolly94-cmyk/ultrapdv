"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DadosTransporteVenda } from "@/components/vendas/transporte-venda-form";
import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA,
  MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE,
  MENSAGEM_DOCUMENTO_OUTRA_EMPRESA,
  MENSAGEM_PRODUTO_OUTRA_EMPRESA,
} from "@/lib/fiscal/entrada/mensagens";
import {
  devolucaoPodeEditar,
  saldoDevolvivelItem,
} from "@/lib/fiscal/entrada/devolucao-status";
import {
  parseEmitenteNfeEntrada,
  parseTributosOriginaisNfe,
  impostoXmlDoSnapshot,
} from "@/lib/fiscal/entrada/parse-xml-nfe";
import { verificarDevolucaoFornecedor } from "@/lib/fiscal/entrada/verificar-devolucao";
import { resolverIcmsDevolucaoFornecedor } from "@/lib/fiscal/entrada/resolver-icms-devolucao-fornecedor";
import {
  COLUNAS_GRUPO_FISCAL_DEVOLUCAO,
  grupoFiscalDaEmpresaAtiva,
  grupoFiscalIdParaDevolucaoFornecedor,
  snapshotFiscalDevolucaoCongelado,
} from "@/lib/fiscal/entrada/resolver-grupo-fiscal-devolucao";
import {
  escolherNaturezaParaDevolucaoFornecedor,
} from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  normalizarRegrasCfopDaEmpresaAtiva,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import { MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR, montarDocumentosReferenciados } from "@/lib/fiscal/nfe55/documentos-referenciados";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import {
  normalizarDadosTransporteVenda,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { validarVolumesTransporte } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { createClient } from "@/lib/supabase/server";

type Resultado =
  | { ok: true; mensagem?: string; devolucaoId?: string }
  | { ok: false; erro: string; pendencias?: string[] };

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
  };
}

function revalidar(entradaId: string, devolucaoId?: string) {
  revalidatePath("/fiscal/entradas");
  revalidatePath(`/fiscal/entradas/${entradaId}`);
  revalidatePath(`/fiscal/entradas/${entradaId}/devolver`);
  if (devolucaoId) {
    revalidatePath(`/fiscal/entradas/devolucoes/${devolucaoId}`);
  }
  revalidatePath("/estoque");
}

function mensagemErro(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const mensagem = String((error as { message?: string }).message ?? "");
    if (mensagem) {
      return mensagem;
    }
  }
  return fallback;
}

export async function criarDevolucaoFornecedor(input: {
  documentoEntradaId: string;
  naturezaId?: string | null;
  motivo?: string | null;
  itens: Array<{ itemEntradaId: string; quantidade: number }>;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    const { data: entrada, error: entradaError } = await supabase
      .from("fiscal_documentos_entrada")
      .select(
        "id, empresa_id, status, chave_acesso, fornecedor_id, xml_original"
      )
      .eq("id", input.documentoEntradaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (entradaError) {
      return { ok: false, erro: entradaError.message };
    }
    if (!entrada || !registroPertenceAEmpresaAtiva(entrada, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (String(entrada.status) !== "entrada_concluida") {
      return { ok: false, erro: MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA };
    }
    if (!/^[0-9]{44}$/.test(String(entrada.chave_acesso ?? ""))) {
      return {
        ok: false,
        erro: "A NF-e de entrada não possui chave de acesso válida para referência.",
      };
    }

    const selecionados = input.itens.filter((item) => item.quantidade > 0);
    if (selecionados.length === 0) {
      return {
        ok: false,
        erro: "Informe a quantidade de pelo menos um item para devolver.",
      };
    }

    const { data: itensEntrada, error: itensError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, empresa_id, produto_id, grupo_fiscal_id, quantidade_entrada_efetivada, valor_unitario, valor_total, quantidade_recebida, ncm, cest, descricao_original"
      )
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", entrada.id);

    if (itensError) {
      return { ok: false, erro: itensError.message };
    }

    const { data: devolucoesAtivas } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, status, empresa_id")
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", entrada.id);

    const idsAtivos = (devolucoesAtivas ?? [])
      .filter((dev) => registroPertenceAEmpresaAtiva(dev, empresaId))
      .map((dev) => String(dev.id));

    const { data: reservas } =
      idsAtivos.length > 0
        ? await supabase
            .from("fiscal_devolucoes_fornecedor_itens")
            .select("documento_entrada_item_id, quantidade, devolucao_id")
            .eq("empresa_id", empresaId)
            .in("devolucao_id", idsAtivos)
        : { data: [] };

    const statusPorDevolucao = new Map(
      (devolucoesAtivas ?? []).map((dev) => [String(dev.id), String(dev.status)])
    );

    const reservasPorItem = new Map<
      string,
      Array<{ quantidade: number; status: string }>
    >();
    for (const reserva of reservas ?? []) {
      const status = statusPorDevolucao.get(String(reserva.devolucao_id));
      if (!status) {
        continue;
      }
      const lista =
        reservasPorItem.get(String(reserva.documento_entrada_item_id)) ?? [];
      lista.push({
        quantidade: Number(reserva.quantidade ?? 0),
        status,
      });
      reservasPorItem.set(String(reserva.documento_entrada_item_id), lista);
    }

    const linhas = [];
    for (const escolhido of selecionados) {
      const original = (itensEntrada ?? []).find(
        (item) => String(item.id) === escolhido.itemEntradaId
      );
      if (!original || !registroPertenceAEmpresaAtiva(original, empresaId)) {
        return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
      }
      if (!original.produto_id) {
        return {
          ok: false,
          erro: `${original.descricao_original}: item sem produto UltraPDV vinculado.`,
        };
      }
      const { data: produto } = await supabase
        .from("produtos")
        .select("id, empresa_id, grupo_fiscal_id")
        .eq("id", original.produto_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
        return { ok: false, erro: MENSAGEM_PRODUTO_OUTRA_EMPRESA };
      }
      const saldo = saldoDevolvivelItem({
        quantidadeEntradaEfetivada: Number(
          original.quantidade_entrada_efetivada ?? 0
        ),
        reservas: reservasPorItem.get(String(original.id)) ?? [],
      });
      if (escolhido.quantidade > saldo + 0.00005) {
        return { ok: false, erro: MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE };
      }
      const unitario = Number(original.valor_unitario ?? 0);
      linhas.push({
        empresa_id: empresaId,
        documento_entrada_item_id: original.id,
        produto_id: original.produto_id,
        grupo_fiscal_id: produto.grupo_fiscal_id,
        quantidade: escolhido.quantidade,
        valor_unitario_original: unitario,
        valor_total: Number((unitario * escolhido.quantidade).toFixed(2)),
        ncm: original.ncm,
        cest: original.cest,
      });
    }

    const { data: naturezaRows } = await supabase
      .from("fiscal_naturezas_operacao")
      .select(
        "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
      )
      .eq("empresa_id", empresaId);

    const naturezaEscolhida = escolherNaturezaParaDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      naturezaId: input.naturezaId,
      naturezas: (naturezaRows ?? []) as NaturezaOperacaoFiscal[],
    });

    const { data: devolucao, error: insertError } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .insert({
        empresa_id: empresaId,
        documento_entrada_id: entrada.id,
        fornecedor_id: entrada.fornecedor_id,
        natureza_id: naturezaEscolhida.ok ? naturezaEscolhida.natureza.id : null,
        status: naturezaEscolhida.ok
          ? "pronta_para_verificacao"
          : "rascunho",
        motivo: input.motivo?.trim() || null,
        chave_documento_origem: entrada.chave_acesso,
        natureza_descricao: naturezaEscolhida.ok
          ? naturezaEscolhida.natureza.descricao
          : null,
        tp_nf: naturezaEscolhida.ok ? naturezaEscolhida.natureza.tp_nf : null,
        fin_nfe: naturezaEscolhida.ok ? naturezaEscolhida.natureza.fin_nfe : null,
      })
      .select("id")
      .single();

    if (insertError || !devolucao) {
      return {
        ok: false,
        erro: insertError?.message ?? "Não foi possível criar a devolução.",
      };
    }

    const { error: itensInsertError } = await supabase
      .from("fiscal_devolucoes_fornecedor_itens")
      .insert(
        linhas.map((linha) => ({
          ...linha,
          devolucao_id: devolucao.id,
        }))
      );

    if (itensInsertError) {
      await supabase
        .from("fiscal_devolucoes_fornecedor")
        .update({ status: "cancelada" })
        .eq("id", devolucao.id)
        .eq("empresa_id", empresaId);
      return { ok: false, erro: itensInsertError.message };
    }

    revalidar(String(entrada.id), String(devolucao.id));
    return {
      ok: true,
      devolucaoId: String(devolucao.id),
      mensagem: "Devolução criada. O estoque ainda não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível criar a devolução."),
    };
  }
}

export async function salvarNaturezaDevolucaoFornecedor(input: {
  devolucaoId: string;
  naturezaId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, empresa_id, status, documento_entrada_id")
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (!devolucaoPodeEditar(String(devolucao.status))) {
      return {
        ok: false,
        erro: "Esta devolução já não pode ter a natureza alterada.",
      };
    }

    const { data: naturezas } = await supabase
      .from("fiscal_naturezas_operacao")
      .select(
        "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
      )
      .eq("empresa_id", empresaId);

    const escolhida = escolherNaturezaParaDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      naturezaId: input.naturezaId,
      naturezas: (naturezas ?? []) as NaturezaOperacaoFiscal[],
    });

    if (!escolhida.ok) {
      return { ok: false, erro: escolhida.mensagem };
    }

    const { error } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .update({
        natureza_id: escolhida.natureza.id,
        natureza_descricao: escolhida.natureza.descricao,
        tp_nf: escolhida.natureza.tp_nf,
        fin_nfe: escolhida.natureza.fin_nfe,
        status: "pronta_para_verificacao",
      })
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId);

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return { ok: true, mensagem: "Natureza da devolução atualizada." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar a natureza."),
    };
  }
}

export async function verificarDevolucaoFornecedorAction(input: {
  devolucaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select(
        "id, empresa_id, status, documento_entrada_id, natureza_id, chave_documento_origem, dados_transporte, informacao_complementar_usuario, informacao_adicional_fisco"
      )
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (!devolucaoPodeEditar(String(devolucao.status))) {
      return { ok: false, erro: "Esta devolução não pode ser repreparada." };
    }

    const [{ data: entrada }, { data: itens }, { data: naturezas }, { data: fiscal }, { data: regras }] =
      await Promise.all([
        supabase
          .from("fiscal_documentos_entrada")
          .select("id, empresa_id, xml_original, chave_acesso")
          .eq("id", devolucao.documento_entrada_id)
          .eq("empresa_id", empresaId)
          .maybeSingle(),
        supabase
          .from("fiscal_devolucoes_fornecedor_itens")
          .select(
            `
            id,
            empresa_id,
            quantidade,
            valor_unitario_original,
            ncm,
            cest,
            produto_id,
            grupo_fiscal_id,
            cfop_resolvido,
            documento_entrada_item_id,
            snapshot_fiscal,
            fiscal_documentos_entrada_itens!documento_entrada_item_id (
              descricao_original,
              ean,
              unidade,
              dados_fiscais_original,
              ncm,
              cest,
              quantidade_xml,
              quantidade_entrada_efetivada,
              documento_entrada_id,
              numero_item
            )
          `
          )
          .eq("empresa_id", empresaId)
          .eq("devolucao_id", devolucao.id),
        supabase
          .from("fiscal_naturezas_operacao")
          .select(
            "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
          )
          .eq("empresa_id", empresaId),
        supabase
          .from("empresas_fiscal")
          .select("empresa_id, uf, codigo_regime_tributario, ambiente")
          .eq("empresa_id", empresaId)
          .maybeSingle(),
        supabase
          .from("fiscal_natureza_cfop_regras")
          .select(
            "empresa_id, natureza_id, grupo_fiscal_id, tipo_destino, cfop, ativo"
          )
          .eq("empresa_id", empresaId)
          .eq("ativo", true),
      ]);

    if (!entrada || !registroPertenceAEmpresaAtiva(entrada, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const naturezaEscolhida = escolherNaturezaParaDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      naturezaId: devolucao.natureza_id,
      naturezas: (naturezas ?? []) as NaturezaOperacaoFiscal[],
    });

    const emitente = entrada.xml_original
      ? parseEmitenteNfeEntrada(String(entrada.xml_original))
      : null;

    const { data: produtos, error: produtosError } = await supabase
      .from("produtos")
      .select("id, empresa_id, codigo, nome, grupo_fiscal_id")
      .eq("empresa_id", empresaId)
      .in(
        "id",
        (itens ?? []).map((item) => item.produto_id).filter(Boolean)
      );

    if (produtosError) {
      return { ok: false, erro: produtosError.message };
    }

    const produtoPorId = new Map(
      (produtos ?? [])
        .filter((produto) => registroPertenceAEmpresaAtiva(produto, empresaId))
        .map((produto) => [String(produto.id), produto])
    );

    const grupoIds = [
      ...new Set(
        (itens ?? [])
          .map((item) => {
            const produto = produtoPorId.get(String(item.produto_id));
            return grupoFiscalIdParaDevolucaoFornecedor({
              empresaIdAtiva: empresaId,
              snapshotFiscal: item.snapshot_fiscal,
              grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
              produtoEmpresaId: produto?.empresa_id,
              produtoGrupoFiscalId: produto?.grupo_fiscal_id,
            }).grupoFiscalId;
          })
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const { data: grupos, error: gruposError } =
      grupoIds.length > 0
        ? await supabase
            .from("grupos_fiscais")
            .select(COLUNAS_GRUPO_FISCAL_DEVOLUCAO)
            .eq("empresa_id", empresaId)
            .in("id", grupoIds)
        : { data: [], error: null };

    if (gruposError) {
      return { ok: false, erro: gruposError.message };
    }

    const grupoPorId = new Map(
      (grupos ?? [])
        .filter((grupo) => registroPertenceAEmpresaAtiva(grupo, empresaId))
        .map((grupo) => [String(grupo.id), grupo])
    );

    const entradaIdsItens = [
      ...new Set(
        (itens ?? [])
          .map((item) => {
            const original = Array.isArray(item.fiscal_documentos_entrada_itens)
              ? item.fiscal_documentos_entrada_itens[0]
              : item.fiscal_documentos_entrada_itens;
            return original?.documento_entrada_id
              ? String(original.documento_entrada_id)
              : "";
          })
          .filter(Boolean)
      ),
    ];
    const { data: entradasItens } =
      entradaIdsItens.length > 0
        ? await supabase
            .from("fiscal_documentos_entrada")
            .select("id, empresa_id, chave_acesso, numero, serie")
            .eq("empresa_id", empresaId)
            .in("id", entradaIdsItens)
        : { data: [] };
    const entradaPorId = new Map(
      (entradasItens ?? [])
        .filter((item) => registroPertenceAEmpresaAtiva(item, empresaId))
        .map((item) => [String(item.id), item])
    );

    const itensResolvidos = (itens ?? []).map((item) => {
      const original = Array.isArray(item.fiscal_documentos_entrada_itens)
        ? item.fiscal_documentos_entrada_itens[0]
        : item.fiscal_documentos_entrada_itens;
      const produto = produtoPorId.get(String(item.produto_id));
      const resolucaoGrupo = grupoFiscalIdParaDevolucaoFornecedor({
        empresaIdAtiva: empresaId,
        snapshotFiscal: item.snapshot_fiscal,
        grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
        produtoEmpresaId: produto?.empresa_id,
        produtoGrupoFiscalId: produto?.grupo_fiscal_id,
      });
      const grupo = grupoFiscalDaEmpresaAtiva(
        resolucaoGrupo.grupoFiscalId
          ? grupoPorId.get(resolucaoGrupo.grupoFiscalId)
          : null,
        empresaId
      );
      const icmsSnapshot = snapshotFiscalDevolucaoCongelado(item.snapshot_fiscal)
        ? String(
            (item.snapshot_fiscal as { icms_resolvido?: unknown })
              .icms_resolvido ?? ""
          ).trim() || null
        : null;
      return {
        item,
        original,
        produto,
        resolucaoGrupo,
        grupo,
        icmsSnapshot,
      };
    });

    for (const resolvido of itensResolvidos) {
      if (resolvido.resolucaoGrupo.origem !== "produto") {
        continue;
      }
      const grupoAtualId = resolvido.grupo?.id ?? null;
      if (String(resolvido.item.grupo_fiscal_id ?? "") === String(grupoAtualId ?? "")) {
        continue;
      }
      const { error: grupoItemError } = await supabase
        .from("fiscal_devolucoes_fornecedor_itens")
        .update({ grupo_fiscal_id: grupoAtualId })
        .eq("id", resolvido.item.id)
        .eq("empresa_id", empresaId);
      if (grupoItemError) {
        return { ok: false, erro: grupoItemError.message };
      }
    }

    const verificacao = verificarDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      natureza: naturezaEscolhida.ok ? naturezaEscolhida.natureza : null,
      chaveOrigem: String(devolucao.chave_documento_origem),
      ufEmpresa: fiscal?.uf,
      emitente,
      itens: itensResolvidos.map(({ item, original, produto, grupo, icmsSnapshot }) => {
        return {
          id: String(item.id),
          descricao:
            original?.descricao_original || produto?.nome || "Item",
          quantidade: Number(item.quantidade),
          ncm: item.ncm || original?.ncm,
          cest: item.cest || original?.cest,
          ean: original?.ean,
          unidade: original?.unidade,
          codigoProduto: produto?.codigo,
          valorUnitario: Number(item.valor_unitario_original ?? 0),
          grupoFiscalId: grupo?.id ?? null,
          grupoFiscalNome: grupo?.nome,
          regraIcmsDevolucao: icmsSnapshot,
          icmsCstCsosnGrupo: grupo?.icms_cst_csosn,
          grupoFiscalEmpresaId: grupo?.empresa_id,
          produtoEmpresaId: produto?.empresa_id,
          quantidadeOriginal:
            Number(original?.quantidade_entrada_efetivada ?? 0) ||
            Number(original?.quantidade_xml ?? 0),
          dadosFiscaisOriginal: original?.dados_fiscais_original,
          cfopResolvido: item.cfop_resolvido,
        };
      }),
      regrasCfop: normalizarRegrasCfopDaEmpresaAtiva(regras, empresaId),
      codigoRegimeTributario: lerCodigoRegimeTributario(
        fiscal?.codigo_regime_tributario
      ),
      ambiente: Number(fiscal?.ambiente) === 1 ? "1" : "2",
      dataEmissao: new Date(),
      gruposIbs: Object.fromEntries(
        (grupos ?? []).map((grupo) => [
          String(grupo.id),
          {
            cstIbscbs: grupo.cst_ibscbs,
            classificacaoIbscbs: grupo.classificacao_ibscbs,
            aliquotaIbsUf: grupo.aliquota_ibs_uf,
            aliquotaIbsMunicipio: grupo.aliquota_ibs_municipio,
            aliquotaCbs: grupo.aliquota_cbs,
          },
        ])
      ),
    });

    if (!verificacao.ok) {
      return {
        ok: false,
        erro: "A verificação fiscal bloqueou a emissão.",
        pendencias: verificacao.pendencias.map((item) => item.mensagem),
      };
    }

    for (const item of verificacao.itens) {
      const resolvido = itensResolvidos.find(
        (linha) => String(linha.item.id) === item.id
      );
      const originalEntrada = resolvido?.original ?? null;
      const tributos = parseTributosOriginaisNfe(
        impostoXmlDoSnapshot(originalEntrada?.dados_fiscais_original)
      );
      const grupo = resolvido?.grupo ?? null;
      const icmsResolvido = resolverIcmsDevolucaoFornecedor({
        codigoRegimeTributario: lerCodigoRegimeTributario(
          fiscal?.codigo_regime_tributario
        ),
        ambiente: Number(fiscal?.ambiente) === 1 ? "1" : "2",
        dataEmissao: new Date(),
        tributosOriginais: tributos,
        regraIcmsDevolucao: resolvido?.icmsSnapshot,
        icmsCstCsosnGrupo: grupo?.icms_cst_csosn,
        grupoFiscalNome: grupo?.nome,
        empresaIdAtiva: empresaId,
        produtoEmpresaId: resolvido?.produto?.empresa_id,
        grupoFiscalEmpresaId: grupo?.empresa_id,
      });
      const snapshotCongelado = snapshotFiscalDevolucaoCongelado(
        resolvido?.item.snapshot_fiscal
      );
      const entradaItem = originalEntrada?.documento_entrada_id
        ? entradaPorId.get(String(originalEntrada.documento_entrada_id))
        : null;
      const chaveItem = String(entradaItem?.chave_acesso ?? "");
      await supabase
        .from("fiscal_devolucoes_fornecedor_itens")
        .update({
          cfop_resolvido: item.cfop,
          grupo_fiscal_id: snapshotCongelado
            ? resolvido?.item.grupo_fiscal_id
            : grupo?.id ?? null,
          snapshot_fiscal: {
            ncm: item.ncm,
            cest: item.cest,
            cfop: item.cfop,
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            origem: tributos.origem,
            tipo_grupo_icms_original: tributos.tipoGrupoIcms,
            cst_original: tributos.cstOriginal,
            csosn_original: tributos.csosnOriginal,
            icms_cst_csosn: icmsResolvido.ok
              ? icmsResolvido.icmsCst
              : tributos.icmsCstCsosn,
            icms_resolvido: icmsResolvido.ok ? icmsResolvido.icmsCst : null,
            grupo_fiscal_id: grupo?.id ?? null,
            grupo_fiscal_nome: grupo?.nome ?? null,
            pis_cst: tributos.pisCst,
            cofins_cst: tributos.cofinsCst,
            ipi_cst: tributos.ipiCst,
            chave_documento_origem: chaveItem || devolucao.chave_documento_origem,
            documento_entrada_id: originalEntrada?.documento_entrada_id ?? null,
            numero_item_original: originalEntrada?.numero_item ?? null,
            numero_documento_origem: entradaItem?.numero ?? null,
            serie_documento_origem: entradaItem?.serie ?? null,
          },
        })
        .eq("id", item.id)
        .eq("empresa_id", empresaId);
    }

    const documentosReferenciados = montarDocumentosReferenciados(
      (itensResolvidos ?? []).map((resolvido) => {
        const entradaItem = resolvido.original?.documento_entrada_id
          ? entradaPorId.get(String(resolvido.original.documento_entrada_id))
          : null;
        return {
          chave: String(entradaItem?.chave_acesso ?? devolucao.chave_documento_origem),
          numero: entradaItem?.numero ?? null,
          serie: entradaItem?.serie ?? null,
          numeroItem: resolvido.original?.numero_item ?? null,
          documentoEntradaId: resolvido.original?.documento_entrada_id ?? null,
        };
      })
    );

    const { error } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .update({
        status: "pronta_para_emissao",
        tipo_destino: verificacao.tipoDestino,
        uf_empresa: fiscal?.uf ? String(fiscal.uf).toUpperCase() : null,
        uf_fornecedor: emitente?.uf ?? null,
        snapshot_fiscal: {
          chave_documento_origem: devolucao.chave_documento_origem,
          documentos_referenciados: documentosReferenciados,
          natureza_id: naturezaEscolhida.ok ? naturezaEscolhida.natureza.id : null,
          tp_nf: naturezaEscolhida.ok ? naturezaEscolhida.natureza.tp_nf : null,
          fin_nfe: naturezaEscolhida.ok ? naturezaEscolhida.natureza.fin_nfe : null,
          tipo_destino: verificacao.tipoDestino,
          fornecedor: emitente,
          transporte: devolucao.dados_transporte,
          informacao_complementar_usuario:
            devolucao.informacao_complementar_usuario ?? null,
          informacao_adicional_fisco:
            devolucao.informacao_adicional_fisco ?? null,
        },
      })
      .eq("id", devolucao.id)
      .eq("empresa_id", empresaId);

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return {
      ok: true,
      mensagem: "Verificação fiscal concluída. O estoque ainda não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível verificar a devolução."),
    };
  }
}

export async function confirmarSaidaDevolucaoFornecedor(input: {
  devolucaoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, empresa_id, status, documento_entrada_id")
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const { data, error } = await supabase.rpc(
      "rpc_confirmar_saida_devolucao_fornecedor",
      {
        p_empresa_id: empresaId,
        p_devolucao_id: input.devolucaoId,
      }
    );

    if (error) {
      return { ok: false, erro: error.message };
    }

    const registro = Array.isArray(data) ? data[0] : data;
    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return {
      ok: true,
      mensagem: `Saída confirmada. ${Number(registro?.itens_movimentados ?? 0)} item(ns) movimentados no estoque.`,
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível confirmar a saída."),
    };
  }
}

export async function salvarTransporteDevolucaoFornecedor(input: {
  devolucaoId: string;
  dadosTransporte: DadosTransporteVenda;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, empresa_id, status, documento_entrada_id")
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (!devolucaoPodeEditar(devolucao.status) && devolucao.status !== "pronta_para_emissao") {
      return { ok: false, erro: "Esta devolução não pode mais alterar transporte." };
    }

    const dados = normalizarDadosTransporteVenda(input.dadosTransporte);
    const errosVolume = validarVolumesTransporte(dados);
    if (errosVolume.length > 0) {
      return { ok: false, erro: errosVolume[0] };
    }

    const persistido = {
      ...dados,
      transportadora_id:
        dados.mod_frete === "9"
          ? null
          : input.dadosTransporte.transportadora_id || null,
      veiculo_id:
        dados.mod_frete === "9"
          ? null
          : input.dadosTransporte.veiculo_id || null,
    };

    const proximoStatus =
      devolucao.status === "pronta_para_emissao"
        ? "pronta_para_verificacao"
        : devolucao.status;

    const { error } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .update({
        dados_transporte: persistido,
        status: proximoStatus,
      })
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId);

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return {
      ok: true,
      mensagem: "Transporte e volumes salvos. O estoque não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o transporte."),
    };
  }
}

export async function salvarInformacoesAdicionaisDevolucao(input: {
  devolucaoId: string;
  informacaoComplementarUsuario?: string | null;
  informacaoAdicionalFisco?: string | null;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, empresa_id, status, documento_entrada_id")
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (!devolucaoPodeEditar(devolucao.status) && devolucao.status !== "pronta_para_emissao") {
      return {
        ok: false,
        erro: "Esta devolução não pode mais alterar informações adicionais.",
      };
    }

    const proximoStatus =
      devolucao.status === "pronta_para_emissao"
        ? "pronta_para_verificacao"
        : devolucao.status;

    const { error } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .update({
        informacao_complementar_usuario:
          String(input.informacaoComplementarUsuario ?? "").trim() || null,
        informacao_adicional_fisco:
          String(input.informacaoAdicionalFisco ?? "").trim() || null,
        status: proximoStatus,
      })
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId);

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return {
      ok: true,
      mensagem: "Informações adicionais salvas. O estoque não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar as informações adicionais."),
    };
  }
}

export async function listarEntradasElegiveisDevolucao(input: {
  devolucaoId: string;
}): Promise<
  | {
      ok: true;
      entradas: Array<{
        id: string;
        numero: string;
        serie: string;
        chave: string;
        itens: Array<{
          id: string;
          descricao: string;
          numeroItem: number;
          quantidadeRecebida: number;
          saldo: number;
        }>;
      }>;
    }
  | { ok: false; erro: string }
> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select("id, empresa_id, documento_entrada_id, status")
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const { data: origem } = await supabase
      .from("fiscal_documentos_entrada")
      .select("id, empresa_id, cnpj_emitente")
      .eq("id", devolucao.documento_entrada_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!origem || !registroPertenceAEmpresaAtiva(origem, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const { data: entradas } = await supabase
      .from("fiscal_documentos_entrada")
      .select(
        "id, empresa_id, numero, serie, chave_acesso, cnpj_emitente, status"
      )
      .eq("empresa_id", empresaId)
      .eq("cnpj_emitente", origem.cnpj_emitente)
      .eq("status", "entrada_concluida")
      .order("created_at", { ascending: false })
      .limit(50);

    const entradasEmpresa = (entradas ?? []).filter((entrada) =>
      registroPertenceAEmpresaAtiva(entrada, empresaId)
    );
    const entradaIds = entradasEmpresa.map((entrada) => String(entrada.id));
    if (entradaIds.length === 0) {
      return { ok: true, entradas: [] };
    }

    const { data: itensEntrada } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, empresa_id, documento_entrada_id, numero_item, descricao_original, quantidade_entrada_efetivada, produto_id"
      )
      .eq("empresa_id", empresaId)
      .in("documento_entrada_id", entradaIds);

    const { data: reservas } = await supabase
      .from("fiscal_devolucoes_fornecedor_itens")
      .select("documento_entrada_item_id, quantidade, devolucao_id")
      .eq("empresa_id", empresaId)
      .in(
        "documento_entrada_item_id",
        (itensEntrada ?? []).map((item) => item.id)
      );

    const idsDevolucao = [
      ...new Set((reservas ?? []).map((item) => String(item.devolucao_id))),
    ];
    const { data: statusDevolucoes } =
      idsDevolucao.length > 0
        ? await supabase
            .from("fiscal_devolucoes_fornecedor")
            .select("id, status, empresa_id")
            .eq("empresa_id", empresaId)
            .in("id", idsDevolucao)
        : { data: [] };

    const statusPorId = new Map(
      (statusDevolucoes ?? [])
        .filter((dev) => registroPertenceAEmpresaAtiva(dev, empresaId))
        .map((dev) => [String(dev.id), String(dev.status)])
    );

    const reservasPorItem = new Map<
      string,
      Array<{ quantidade: number; status: string }>
    >();
    for (const reserva of reservas ?? []) {
      const status = statusPorId.get(String(reserva.devolucao_id));
      if (!status) continue;
      const lista =
        reservasPorItem.get(String(reserva.documento_entrada_item_id)) ?? [];
      lista.push({ quantidade: Number(reserva.quantidade ?? 0), status });
      reservasPorItem.set(String(reserva.documento_entrada_item_id), lista);
    }

    const itensPorEntrada = new Map<string, typeof itensEntrada>();
    for (const item of itensEntrada ?? []) {
      if (!registroPertenceAEmpresaAtiva(item, empresaId) || !item.produto_id) {
        continue;
      }
      const lista = itensPorEntrada.get(String(item.documento_entrada_id)) ?? [];
      lista.push(item);
      itensPorEntrada.set(String(item.documento_entrada_id), lista);
    }

    return {
      ok: true,
      entradas: entradasEmpresa
        .map((entrada) => {
          const itens = (itensPorEntrada.get(String(entrada.id)) ?? [])
            .map((item) => {
              const saldo = saldoDevolvivelItem({
                quantidadeEntradaEfetivada: Number(
                  item.quantidade_entrada_efetivada ?? 0
                ),
                reservas: reservasPorItem.get(String(item.id)) ?? [],
              });
              return {
                id: String(item.id),
                descricao: String(item.descricao_original ?? "Item"),
                numeroItem: Number(item.numero_item ?? 0),
                quantidadeRecebida: Number(
                  item.quantidade_entrada_efetivada ?? 0
                ),
                saldo,
              };
            })
            .filter((item) => item.saldo > 0);
          return {
            id: String(entrada.id),
            numero: String(entrada.numero ?? ""),
            serie: String(entrada.serie ?? ""),
            chave: String(entrada.chave_acesso ?? ""),
            itens,
          };
        })
        .filter((entrada) => entrada.itens.length > 0),
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível listar as entradas elegíveis."),
    };
  }
}

export async function adicionarItensDevolucaoFornecedor(input: {
  devolucaoId: string;
  itens: Array<{ itemEntradaId: string; quantidade: number }>;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select(
        "id, empresa_id, status, documento_entrada_id, saida_estoque_processada_at"
      )
      .eq("id", input.devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }
    if (devolucao.saida_estoque_processada_at) {
      return { ok: false, erro: "A saída desta devolução já foi processada." };
    }
    if (!devolucaoPodeEditar(devolucao.status) && devolucao.status !== "pronta_para_emissao") {
      return { ok: false, erro: "Esta devolução não aceita novos itens." };
    }

    const selecionados = input.itens.filter((item) => item.quantidade > 0);
    if (selecionados.length === 0) {
      return { ok: false, erro: "Informe a quantidade de pelo menos um item." };
    }

    const { data: origem } = await supabase
      .from("fiscal_documentos_entrada")
      .select("id, empresa_id, cnpj_emitente")
      .eq("id", devolucao.documento_entrada_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!origem || !registroPertenceAEmpresaAtiva(origem, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const { data: itensAtuais } = await supabase
      .from("fiscal_devolucoes_fornecedor_itens")
      .select("id, documento_entrada_item_id, quantidade")
      .eq("empresa_id", empresaId)
      .eq("devolucao_id", devolucao.id);

    const atualPorOrigem = new Map(
      (itensAtuais ?? []).map((item) => [
        String(item.documento_entrada_item_id),
        item,
      ])
    );

    for (const escolhido of selecionados) {
      const { data: original } = await supabase
        .from("fiscal_documentos_entrada_itens")
        .select(
          `
          id, empresa_id, documento_entrada_id, produto_id, grupo_fiscal_id,
          quantidade_entrada_efetivada, valor_unitario, ncm, cest
        `
        )
        .eq("id", escolhido.itemEntradaId)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (!original || !registroPertenceAEmpresaAtiva(original, empresaId)) {
        return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
      }
      if (!original.produto_id) {
        return {
          ok: false,
          erro: "Item sem produto UltraPDV vinculado.",
        };
      }

      const { data: entradaItem } = await supabase
        .from("fiscal_documentos_entrada")
        .select("id, empresa_id, cnpj_emitente, status")
        .eq("id", original.documento_entrada_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (!entradaItem || !registroPertenceAEmpresaAtiva(entradaItem, empresaId)) {
        return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
      }
      if (String(entradaItem.status) !== "entrada_concluida") {
        return { ok: false, erro: MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA };
      }
      if (String(entradaItem.cnpj_emitente) !== String(origem.cnpj_emitente)) {
        return { ok: false, erro: MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR };
      }

      const { data: produto } = await supabase
        .from("produtos")
        .select("id, empresa_id, grupo_fiscal_id")
        .eq("id", original.produto_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
        return { ok: false, erro: MENSAGEM_PRODUTO_OUTRA_EMPRESA };
      }

      const { data: reservas } = await supabase
        .from("fiscal_devolucoes_fornecedor_itens")
        .select("quantidade, devolucao_id")
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_item_id", original.id);

      const idsDev = [
        ...new Set((reservas ?? []).map((item) => String(item.devolucao_id))),
      ];
      const { data: statusDev } =
        idsDev.length > 0
          ? await supabase
              .from("fiscal_devolucoes_fornecedor")
              .select("id, status")
              .eq("empresa_id", empresaId)
              .in("id", idsDev)
          : { data: [] };
      const statusPorId = new Map(
        (statusDev ?? []).map((dev) => [String(dev.id), String(dev.status)])
      );
      const reservasOutras = (reservas ?? [])
        .filter((item) => String(item.devolucao_id) !== String(devolucao.id))
        .map((item) => ({
          quantidade: Number(item.quantidade ?? 0),
          status: statusPorId.get(String(item.devolucao_id)) ?? "rascunho",
        }));

      const existente = atualPorOrigem.get(String(original.id));
      const quantidadeNova =
        Number(existente?.quantidade ?? 0) + Number(escolhido.quantidade);
      const saldo = saldoDevolvivelItem({
        quantidadeEntradaEfetivada: Number(
          original.quantidade_entrada_efetivada ?? 0
        ),
        reservas: reservasOutras,
      });
      if (quantidadeNova > saldo + 0.00005) {
        return { ok: false, erro: MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE };
      }

      const unitario = Number(original.valor_unitario ?? 0);
      if (existente) {
        const { error } = await supabase
          .from("fiscal_devolucoes_fornecedor_itens")
          .update({
            quantidade: quantidadeNova,
            valor_total: Number((unitario * quantidadeNova).toFixed(2)),
          })
          .eq("id", existente.id)
          .eq("empresa_id", empresaId);
        if (error) {
          return { ok: false, erro: error.message };
        }
      } else {
        const { error } = await supabase
          .from("fiscal_devolucoes_fornecedor_itens")
          .insert({
            empresa_id: empresaId,
            devolucao_id: devolucao.id,
            documento_entrada_item_id: original.id,
            produto_id: original.produto_id,
            grupo_fiscal_id: produto.grupo_fiscal_id,
            quantidade: escolhido.quantidade,
            valor_unitario_original: unitario,
            valor_total: Number((unitario * escolhido.quantidade).toFixed(2)),
            ncm: original.ncm,
            cest: original.cest,
          });
        if (error) {
          return { ok: false, erro: error.message };
        }
      }
    }

    const proximoStatus =
      devolucao.status === "pronta_para_emissao"
        ? "pronta_para_verificacao"
        : devolucao.status === "rascunho"
          ? "rascunho"
          : "pronta_para_verificacao";

    await supabase
      .from("fiscal_devolucoes_fornecedor")
      .update({ status: proximoStatus })
      .eq("id", devolucao.id)
      .eq("empresa_id", empresaId);

    revalidar(String(devolucao.documento_entrada_id), input.devolucaoId);
    return {
      ok: true,
      mensagem: "Itens adicionados. O estoque não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível adicionar os itens."),
    };
  }
}
