"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertRegistroDaEmpresaAtiva,
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_DESTINATARIO_DIVERGENTE,
  MENSAGEM_DOCUMENTO_OUTRA_EMPRESA,
  MENSAGEM_ENTRADA_JA_PROCESSADA,
  MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO,
  MENSAGEM_ITENS_SEM_VINCULO,
  MENSAGEM_NFE_JA_IMPORTADA,
  MENSAGEM_PRODUTO_OUTRA_EMPRESA,
  MENSAGEM_VINCULO_CONFLITANTE,
  MENSAGEM_XML_INVALIDO,
} from "@/lib/fiscal/entrada/mensagens";
import {
  codigoFornecedorNormalizado,
  fatorConversaoPodeConfirmar,
  unidadesEntradaDiferentes,
} from "@/lib/fiscal/entrada/vinculo-fornecedor";
import {
  destinatarioConfereComEmpresa,
  parseXmlNfeEntrada,
} from "@/lib/fiscal/entrada/parse-xml-nfe";
import {
  documentoEntradaPodeEditar,
  statusAposItens,
} from "@/lib/fiscal/entrada/status";
import {
  UNIDADE_MEDIDA_PADRAO,
  normalizarUnidadeMedida,
  unidadeMedidaValida,
} from "@/lib/produtos/unidades-medida";
import { createClient } from "@/lib/supabase/server";

type ConflitoVinculo = {
  produtoId: string;
  produtoNome: string;
  codigoFornecedor: string;
};

type Resultado =
  | { ok: true; mensagem?: string; documentoId?: string; jaExistia?: boolean }
  | { ok: false; erro: string; conflito?: ConflitoVinculo };

const XML_MAX_BYTES = 5 * 1024 * 1024;

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
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

function revalidarEntrada(documentoId?: string) {
  revalidatePath("/fiscal/entradas");
  revalidatePath("/estoque");
  if (documentoId) {
    revalidatePath(`/fiscal/entradas/${documentoId}`);
  }
}

function mensagemErro(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const mensagem = String((error as { message?: string }).message ?? "");
    if (mensagem) {
      return mensagem;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function carregarDocumentoDaEmpresa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  documentoId: string
) {
  const { data, error } = await supabase
    .from("fiscal_documentos_entrada")
    .select(
      "id, empresa_id, status, chave_acesso, numero, fornecedor_id"
    )
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || !registroPertenceAEmpresaAtiva(data, empresaId)) {
    throw new Error(MENSAGEM_DOCUMENTO_OUTRA_EMPRESA);
  }

  return data;
}

async function entradaJaMovimentouEstoque(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  documentoId: string
) {
  const [{ data: movimentos, error: movError }, { data: itens, error: itemError }] =
    await Promise.all([
      supabase
        .from("estoque_movimentacoes")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documentoId)
        .limit(1),
      supabase
        .from("fiscal_documentos_entrada_itens")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documentoId)
        .gt("quantidade_entrada_efetivada", 0)
        .limit(1),
    ]);

  if (movError) {
    throw new Error(movError.message);
  }
  if (itemError) {
    throw new Error(itemError.message);
  }

  return (movimentos?.length ?? 0) > 0 || (itens?.length ?? 0) > 0;
}

async function marcarEntradaConcluida(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  documentoId: string
) {
  const { error } = await supabase
    .from("fiscal_documentos_entrada")
    .update({
      status: "entrada_concluida",
      data_entrada: new Date().toISOString(),
    })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .neq("status", "entrada_concluida")
    .neq("status", "cancelada");

  if (error) {
    throw new Error(error.message);
  }
}

async function atualizarStatusDocumento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  documentoId: string
) {
  if (await entradaJaMovimentouEstoque(supabase, empresaId, documentoId)) {
    await marcarEntradaConcluida(supabase, empresaId, documentoId);
    return "entrada_concluida";
  }

  const { data: itens, error } = await supabase
    .from("fiscal_documentos_entrada_itens")
    .select("produto_id, quantidade_xml, quantidade_recebida")
    .eq("empresa_id", empresaId)
    .eq("documento_entrada_id", documentoId);

  if (error) {
    throw new Error(error.message);
  }

  const status = statusAposItens(
    (itens ?? []).map((item) => ({
      produto_id: item.produto_id,
      quantidade_xml: Number(item.quantidade_xml ?? 0),
      quantidade_recebida: Number(item.quantidade_recebida ?? 0),
    }))
  );

  const { error: updateError } = await supabase
    .from("fiscal_documentos_entrada")
    .update({ status })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .neq("status", "entrada_concluida")
    .neq("status", "processando_entrada")
    .neq("status", "cancelada");

  if (updateError) {
    throw new Error(updateError.message);
  }

  return status;
}

async function upsertVinculoFornecedor(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  fornecedorId: string;
  produtoId: string;
  codigoFornecedor: string;
  ean?: string | null;
  descricao?: string | null;
  unidade?: string | null;
  fatorConversao: number;
}) {
  const codigo = codigoFornecedorNormalizado(params.codigoFornecedor);
  if (!codigo || !params.fornecedorId) {
    return;
  }

  const { error } = await params.supabase
    .from("fornecedores_produtos_vinculos")
    .upsert(
      {
        empresa_id: params.empresaId,
        fornecedor_id: params.fornecedorId,
        produto_id: params.produtoId,
        codigo_produto_fornecedor: codigo,
        ean_fornecedor: params.ean || null,
        descricao_fornecedor: params.descricao || null,
        unidade_fornecedor: params.unidade || null,
        fator_conversao: params.fatorConversao,
        ativo: true,
      },
      { onConflict: "empresa_id,fornecedor_id,codigo_produto_fornecedor" }
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function aplicarVinculosConhecidos(input: {
  documentoId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (!documentoEntradaPodeEditar(String(documento.status))) {
      return { ok: true };
    }

    if (await entradaJaMovimentouEstoque(supabase, empresaId, input.documentoId)) {
      await marcarEntradaConcluida(supabase, empresaId, input.documentoId);
      return { ok: true };
    }

    if (!documento.fornecedor_id) {
      return { ok: true };
    }

    const [{ data: itens }, { data: vinculos }] = await Promise.all([
      supabase
        .from("fiscal_documentos_entrada_itens")
        .select(
          "id, empresa_id, produto_id, codigo_fornecedor, unidade"
        )
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", input.documentoId),
      supabase
        .from("fornecedores_produtos_vinculos")
        .select(
          "id, empresa_id, fornecedor_id, produto_id, codigo_produto_fornecedor, fator_conversao, ativo"
        )
        .eq("empresa_id", empresaId)
        .eq("fornecedor_id", documento.fornecedor_id)
        .eq("ativo", true),
    ]);

    const pendentes = (itens ?? []).filter(
      (item) =>
        registroPertenceAEmpresaAtiva(item, empresaId) && !item.produto_id
    );

    for (const item of pendentes) {
      const codigo = codigoFornecedorNormalizado(item.codigo_fornecedor);
      const vinculo = (vinculos ?? []).find(
        (linha) =>
          registroPertenceAEmpresaAtiva(linha, empresaId) &&
          codigoFornecedorNormalizado(linha.codigo_produto_fornecedor) ===
            codigo
      );
      if (!vinculo) {
        continue;
      }

      const { data: produto } = await supabase
        .from("produtos")
        .select("id, empresa_id, grupo_fiscal_id, unidade_medida")
        .eq("id", vinculo.produto_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
        continue;
      }

      const unidadesIguais = !unidadesEntradaDiferentes(
        item.unidade,
        produto.unidade_medida
      );

      const { error } = await supabase
        .from("fiscal_documentos_entrada_itens")
        .update({
          produto_id: produto.id,
          grupo_fiscal_id: produto.grupo_fiscal_id,
          fator_conversao: Number(vinculo.fator_conversao ?? 1),
          fator_conversao_confirmado:
            unidadesIguais || Number(vinculo.fator_conversao ?? 1) !== 1,
        })
        .eq("id", item.id)
        .eq("empresa_id", empresaId)
        .is("produto_id", null);

      if (error) {
        return { ok: false, erro: error.message };
      }
    }

    await atualizarStatusDocumento(supabase, empresaId, input.documentoId);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível aplicar os vínculos conhecidos."),
    };
  }
}

export async function importarXmlNfeEntrada(
  formData: FormData
): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const arquivo = formData.get("xml");

    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return { ok: false, erro: "Selecione o XML da NF-e." };
    }

    if (arquivo.size > XML_MAX_BYTES) {
      return {
        ok: false,
        erro: "O XML da NF-e excede o tamanho máximo permitido.",
      };
    }

    const xml = (await arquivo.text()).replace(/^\uFEFF/, "");
    if (!xml.includes("<")) {
      return { ok: false, erro: MENSAGEM_XML_INVALIDO };
    }

    const nfe = parseXmlNfeEntrada(xml);

    const { data: empresa, error: empresaError } = await supabase
      .from("empresas")
      .select("id, cnpj")
      .eq("id", empresaId)
      .maybeSingle();

    if (empresaError) {
      return { ok: false, erro: empresaError.message };
    }

    if (!empresa || String(empresa.id) !== empresaId) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    if (
      !destinatarioConfereComEmpresa(
        nfe.cnpjDestinatario,
        String(empresa.cnpj ?? "")
      )
    ) {
      return { ok: false, erro: MENSAGEM_DESTINATARIO_DIVERGENTE };
    }

    const { data, error } = await supabase.rpc(
      "rpc_importar_documento_entrada",
      {
        p_empresa_id: empresaId,
        p_xml: xml,
        p_payload: {
          chaveAcesso: nfe.chaveAcesso,
          modelo: nfe.modelo,
          serie: nfe.serie,
          numero: nfe.numero,
          dataEmissao: nfe.dataEmissao,
          cnpjEmitente: nfe.cnpjEmitente,
          razaoSocialEmitente: nfe.razaoSocialEmitente,
          ieEmitente: nfe.ieEmitente,
          cnpjDestinatario: nfe.cnpjDestinatario,
          valorProdutos: nfe.valorProdutos,
          valorTotal: nfe.valorTotal,
          protocolo: nfe.protocolo,
          itens: nfe.itens.map((item) => ({
            numeroItem: item.numeroItem,
            codigoFornecedor: item.codigoFornecedor,
            descricao: item.descricao,
            ean: item.ean,
            ncm: item.ncm,
            cest: item.cest,
            cfop: item.cfop,
            unidade: item.unidade,
            quantidade: item.quantidade,
            valorUnitario: item.valorUnitario,
            valorTotal: item.valorTotal,
            desconto: item.desconto,
            dadosFiscais: item.dadosFiscais,
          })),
        },
      }
    );

    if (error) {
      if (error.code === "23505" || /chave/i.test(error.message)) {
        const { data: existente } = await supabase
          .from("fiscal_documentos_entrada")
          .select("id, empresa_id")
          .eq("empresa_id", empresaId)
          .eq("chave_acesso", nfe.chaveAcesso)
          .maybeSingle();

        if (
          existente &&
          registroPertenceAEmpresaAtiva(existente, empresaId)
        ) {
          revalidarEntrada(String(existente.id));
          return {
            ok: true,
            jaExistia: true,
            documentoId: String(existente.id),
            mensagem: MENSAGEM_NFE_JA_IMPORTADA,
          };
        }

        return { ok: false, erro: MENSAGEM_NFE_JA_IMPORTADA };
      }

      return { ok: false, erro: error.message };
    }

    const registro = Array.isArray(data) ? data[0] : data;
    const documentoId = registro?.documento_id
      ? String(registro.documento_id)
      : "";

    if (!documentoId) {
      return { ok: false, erro: "Não foi possível importar a NF-e." };
    }

    await aplicarVinculosConhecidos({ documentoId });
    revalidarEntrada(documentoId);

    return {
      ok: true,
      documentoId,
      jaExistia: Boolean(registro?.ja_existia),
      mensagem: registro?.ja_existia
        ? MENSAGEM_NFE_JA_IMPORTADA
        : "NF-e importada. O estoque ainda não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível importar o XML."),
    };
  }
}

export async function vincularItemEntrada(input: {
  documentoId: string;
  itemId: string;
  produtoId: string | null;
  confirmarTrocaVinculo?: boolean;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (!documentoEntradaPodeEditar(String(documento.status))) {
      return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
    }

    const { data: item, error: itemError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, empresa_id, documento_entrada_id, codigo_fornecedor, descricao_original, ean, unidade"
      )
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId)
      .maybeSingle();

    if (itemError) {
      return { ok: false, erro: itemError.message };
    }

    if (!item || !registroPertenceAEmpresaAtiva(item, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    let grupoFiscalId: string | null = null;
    let unidadeProduto: string | null = null;
    let fatorConversao = 1;
    let fatorConfirmado = true;

    if (input.produtoId) {
      const { data: produto, error: produtoError } = await supabase
        .from("produtos")
        .select("id, empresa_id, grupo_fiscal_id, unidade_medida")
        .eq("id", input.produtoId)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (produtoError) {
        return { ok: false, erro: produtoError.message };
      }

      if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
        return { ok: false, erro: MENSAGEM_PRODUTO_OUTRA_EMPRESA };
      }

      grupoFiscalId = produto.grupo_fiscal_id
        ? String(produto.grupo_fiscal_id)
        : null;
      unidadeProduto = produto.unidade_medida;

      const codigo = codigoFornecedorNormalizado(item.codigo_fornecedor);
      if (documento.fornecedor_id && codigo) {
        const { data: vinculoExistente } = await supabase
          .from("fornecedores_produtos_vinculos")
          .select(
            "id, empresa_id, produto_id, fator_conversao, ativo"
          )
          .eq("empresa_id", empresaId)
          .eq("fornecedor_id", documento.fornecedor_id)
          .eq("codigo_produto_fornecedor", codigo)
          .maybeSingle();

        if (
          vinculoExistente &&
          registroPertenceAEmpresaAtiva(vinculoExistente, empresaId) &&
          String(vinculoExistente.produto_id) !== String(input.produtoId)
        ) {
          if (!input.confirmarTrocaVinculo) {
            const { data: produtoAtual } = await supabase
              .from("produtos")
              .select("id, nome")
              .eq("id", vinculoExistente.produto_id)
              .eq("empresa_id", empresaId)
              .maybeSingle();

            return {
              ok: false,
              erro: MENSAGEM_VINCULO_CONFLITANTE,
              conflito: {
                produtoId: String(vinculoExistente.produto_id),
                produtoNome: String(produtoAtual?.nome ?? "Produto vinculado"),
                codigoFornecedor: codigo,
              },
            };
          }
        }

        if (
          vinculoExistente &&
          String(vinculoExistente.produto_id) === String(input.produtoId)
        ) {
          fatorConversao = Number(vinculoExistente.fator_conversao ?? 1);
        }
      }

      const unidadesIguais = !unidadesEntradaDiferentes(
        item.unidade,
        unidadeProduto
      );
      fatorConfirmado =
        unidadesIguais ||
        (fatorConversao !== 1 && Number.isFinite(fatorConversao));
    }

    const { error: updateError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .update({
        produto_id: input.produtoId,
        grupo_fiscal_id: grupoFiscalId,
        fator_conversao: fatorConversao,
        fator_conversao_confirmado: fatorConfirmado,
      })
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId);

    if (updateError) {
      return { ok: false, erro: updateError.message };
    }

    if (input.produtoId && documento.fornecedor_id) {
      await upsertVinculoFornecedor({
        supabase,
        empresaId,
        fornecedorId: String(documento.fornecedor_id),
        produtoId: input.produtoId,
        codigoFornecedor: item.codigo_fornecedor,
        ean: item.ean,
        descricao: item.descricao_original,
        unidade: item.unidade,
        fatorConversao,
      });
    }

    await atualizarStatusDocumento(supabase, empresaId, input.documentoId);
    revalidarEntrada(input.documentoId);

    return {
      ok: true,
      mensagem: input.produtoId
        ? "Produto vinculado. O estoque ainda não foi movimentado."
        : "Vínculo removido. Item pendente.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível vincular o item."),
    };
  }
}

export async function criarProdutoEVincularItem(input: {
  documentoId: string;
  itemId: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (!documentoEntradaPodeEditar(String(documento.status))) {
      return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
    }

    const { data: item, error: itemError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, empresa_id, documento_entrada_id, descricao_original, ean, ncm, cest, unidade, valor_unitario"
      )
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId)
      .maybeSingle();

    if (itemError) {
      return { ok: false, erro: itemError.message };
    }

    if (!item || !registroPertenceAEmpresaAtiva(item, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const unidadeBruta = normalizarUnidadeMedida(item.unidade);
    const unidade = unidadeMedidaValida(unidadeBruta)
      ? unidadeBruta
      : UNIDADE_MEDIDA_PADRAO;

    const { data, error } = await supabase.rpc("rpc_cadastrar_produto", {
      p_empresa_id: empresaId,
      p_codigo: "",
      p_codigo_barras: item.ean || null,
      p_nome: String(item.descricao_original ?? "Produto"),
      p_descricao: null,
      p_categoria_id: null,
      p_marca_id: null,
      p_grupo_fiscal_id: null,
      p_unidade_medida: unidade,
      p_preco_custo: Number(item.valor_unitario ?? 0),
      p_preco_venda: 0,
      p_estoque_inicial: 0,
    });

    if (error) {
      return { ok: false, erro: error.message };
    }

    const registro = Array.isArray(data) ? data[0] : data;
    const produtoId = registro?.produto_id
      ? String(registro.produto_id)
      : "";

    if (!produtoId) {
      return { ok: false, erro: "Não foi possível criar o produto." };
    }

    const { data: produtoCriado } = await supabase
      .from("produtos")
      .select("id, empresa_id")
      .eq("id", produtoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    assertRegistroDaEmpresaAtiva(
      produtoCriado,
      empresaId,
      MENSAGEM_PRODUTO_OUTRA_EMPRESA
    );

    const ncm = String(item.ncm ?? "").replace(/\D/g, "").slice(0, 8);
    const cest = String(item.cest ?? "").replace(/\D/g, "").slice(0, 7);
    if (ncm.length === 8 || cest.length === 7) {
      await supabase
        .from("produtos_fiscal")
        .update({
          ...(ncm.length === 8 ? { ncm } : {}),
          ...(cest.length === 7 ? { cest } : {}),
        })
        .eq("produto_id", produtoId)
        .eq("empresa_id", empresaId);
    }

    return vincularItemEntrada({
      documentoId: input.documentoId,
      itemId: input.itemId,
      produtoId,
    });
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível criar o produto."),
    };
  }
}

export async function salvarFatorConversaoEntrada(input: {
  documentoId: string;
  itemId: string;
  fatorConversao: number;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (!documentoEntradaPodeEditar(String(documento.status))) {
      return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
    }

    const fator = Number(input.fatorConversao);
    if (!Number.isFinite(fator) || fator <= 0) {
      return { ok: false, erro: "Informe um fator de conversão maior que zero." };
    }

    const { data: item, error: itemError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, empresa_id, produto_id, codigo_fornecedor, descricao_original, ean, unidade"
      )
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId)
      .maybeSingle();

    if (itemError) {
      return { ok: false, erro: itemError.message };
    }

    if (!item || !registroPertenceAEmpresaAtiva(item, empresaId)) {
      return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
    }

    const { error: updateError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .update({
        fator_conversao: fator,
        fator_conversao_confirmado: true,
      })
      .eq("id", input.itemId)
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId);

    if (updateError) {
      return { ok: false, erro: updateError.message };
    }

    if (item.produto_id && documento.fornecedor_id) {
      await upsertVinculoFornecedor({
        supabase,
        empresaId,
        fornecedorId: String(documento.fornecedor_id),
        produtoId: String(item.produto_id),
        codigoFornecedor: item.codigo_fornecedor,
        ean: item.ean,
        descricao: item.descricao_original,
        unidade: item.unidade,
        fatorConversao: fator,
      });
    }

    revalidarEntrada(input.documentoId);
    return {
      ok: true,
      mensagem: "Fator de conversão salvo. O estoque ainda não foi movimentado.",
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar o fator de conversão."),
    };
  }
}

export async function salvarConferenciaEntrada(input: {
  documentoId: string;
  itens: Array<{ id: string; quantidadeRecebida: number }>;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (!documentoEntradaPodeEditar(String(documento.status))) {
      return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
    }

    for (const item of input.itens) {
      if (!Number.isFinite(item.quantidadeRecebida) || item.quantidadeRecebida < 0) {
        return { ok: false, erro: "A quantidade recebida não pode ser negativa." };
      }

      const { data: atual, error: itemError } = await supabase
        .from("fiscal_documentos_entrada_itens")
        .select("id, empresa_id")
        .eq("id", item.id)
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", input.documentoId)
        .maybeSingle();

      if (itemError) {
        return { ok: false, erro: itemError.message };
      }

      if (!atual || !registroPertenceAEmpresaAtiva(atual, empresaId)) {
        return { ok: false, erro: MENSAGEM_DOCUMENTO_OUTRA_EMPRESA };
      }

      const { error: updateError } = await supabase
        .from("fiscal_documentos_entrada_itens")
        .update({ quantidade_recebida: item.quantidadeRecebida })
        .eq("id", item.id)
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", input.documentoId);

      if (updateError) {
        return { ok: false, erro: updateError.message };
      }
    }

    await atualizarStatusDocumento(supabase, empresaId, input.documentoId);
    revalidarEntrada(input.documentoId);

    return { ok: true, mensagem: "Conferência salva. O estoque ainda não foi movimentado." };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível salvar a conferência."),
    };
  }
}

export async function confirmarEntradaEstoque(input: {
  documentoId: string;
  itens?: Array<{ id: string; quantidadeRecebida: number }>;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const documento = await carregarDocumentoDaEmpresa(
      supabase,
      empresaId,
      input.documentoId
    );

    if (String(documento.status) === "entrada_concluida") {
      return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
    }

    if (input.itens && input.itens.length > 0) {
      const conferencia = await salvarConferenciaEntrada({
        documentoId: input.documentoId,
        itens: input.itens,
      });
      if (!conferencia.ok) {
        return conferencia;
      }
    }

    const { data: pendentes, error: pendentesError } = await supabase
      .from("fiscal_documentos_entrada_itens")
      .select(
        "id, produto_id, quantidade_recebida, empresa_id, unidade, fator_conversao, fator_conversao_confirmado"
      )
      .eq("empresa_id", empresaId)
      .eq("documento_entrada_id", input.documentoId);

    if (pendentesError) {
      return { ok: false, erro: pendentesError.message };
    }

    const semVinculo = (pendentes ?? []).filter(
      (item) =>
        Number(item.quantidade_recebida ?? 0) > 0 && !item.produto_id
    );

    if (semVinculo.length > 0) {
      return { ok: false, erro: MENSAGEM_ITENS_SEM_VINCULO };
    }

    const produtoIds = [
      ...new Set(
        (pendentes ?? [])
          .map((item) => item.produto_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const { data: produtos } =
      produtoIds.length > 0
        ? await supabase
            .from("produtos")
            .select("id, empresa_id, unidade_medida")
            .eq("empresa_id", empresaId)
            .in("id", produtoIds)
        : { data: [] };

    const produtosPorId = new Map(
      (produtos ?? [])
        .filter((produto) => registroPertenceAEmpresaAtiva(produto, empresaId))
        .map((produto) => [String(produto.id), produto])
    );

    const semFator = (pendentes ?? []).some((item) => {
      if (Number(item.quantidade_recebida ?? 0) <= 0 || !item.produto_id) {
        return false;
      }
      const produto = produtosPorId.get(String(item.produto_id));
      return !fatorConversaoPodeConfirmar({
        unidadeXml: item.unidade,
        unidadeProduto: produto?.unidade_medida,
        fatorConversao: Number(item.fator_conversao ?? 1),
        confirmado: item.fator_conversao_confirmado,
      });
    });

    if (semFator) {
      return { ok: false, erro: MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO };
    }

    const { data, error } = await supabase.rpc("rpc_confirmar_entrada_nfe", {
      p_empresa_id: empresaId,
      p_documento_id: input.documentoId,
    });

    if (error) {
      if (/já teve a entrada/i.test(error.message)) {
        return { ok: false, erro: MENSAGEM_ENTRADA_JA_PROCESSADA };
      }
      return { ok: false, erro: error.message };
    }

    const registro = Array.isArray(data) ? data[0] : data;
    await marcarEntradaConcluida(supabase, empresaId, input.documentoId);

    revalidarEntrada(input.documentoId);

    return {
      ok: true,
      documentoId: input.documentoId,
      mensagem: `Entrada concluída. ${Number(registro?.itens_movimentados ?? 0)} item(ns) movimentados no estoque.`,
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErro(error, "Não foi possível confirmar a entrada."),
    };
  }
}
