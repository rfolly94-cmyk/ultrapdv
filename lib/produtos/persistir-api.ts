import {
  bucketCatalogo,
  caminhoImagemProduto,
  urlPublicaCatalogo,
} from "@/lib/catalogo/storage";
import { ORIGENS_MERCADORIA } from "@/lib/fiscal/tabelas-fiscais";
import {
  avaliarStatusFiscalProduto,
  type GrupoFiscalResumo,
} from "@/lib/fiscal/status-fiscal-produto";
import {
  MENSAGEM_CODIGO_AUTOMATICO_FALHOU,
  MENSAGEM_CODIGO_OBRIGATORIO,
  mensagemCodigoDuplicado,
} from "@/lib/produtos/codigo-automatico";
import {
  MENSAGEM_FISCAL_NAO_GRAVADO,
  payloadAtualizacaoFiscalProduto,
  validarDadosFiscaisProduto,
  type DadosFiscaisProduto,
} from "@/lib/produtos/dados-fiscais-produto";
import {
  UNIDADE_MEDIDA_PADRAO,
  UNIDADES_MEDIDA,
  normalizarUnidadeMedida,
  unidadeMedidaValida,
} from "@/lib/produtos/unidades-medida";
import { createClient } from "@/lib/supabase/server";

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

export type ResultadoPersistencia =
  | { ok: true; mensagem: string; id?: string; codigo?: string }
  | { ok: false; erro: string };

export type DadosComerciaisApi = {
  codigoAutomatico?: boolean;
  codigo?: string | null;
  codigoBarras?: string | null;
  nome?: string | null;
  descricao?: string | null;
  categoriaId?: string | null;
  marcaId?: string | null;
  unidade?: string | null;
  precoCusto?: number | string | null;
  precoVenda?: number | string | null;
  ativo?: boolean;
};

export type DadosCatalogoApi = {
  publicado?: boolean;
  destaque?: boolean;
  mostrarPreco?: boolean;
  descricao?: string | null;
  removerImagem?: boolean;
  imagemBase64?: string | null;
  imagemTipo?: string | null;
};

const GRUPO_FISCAL_SELECT = `
  id,
  nome,
  ativo,
  cfop_interno,
  cfop_interestadual,
  icms_cst_csosn,
  icms_aliquota,
  pis_cst,
  pis_aliquota,
  cofins_cst,
  cofins_aliquota,
  ipi_aplicavel,
  ipi_cst,
  ipi_aliquota,
  ipi_enquadramento,
  cst_ibscbs,
  classificacao_ibscbs,
  aliquota_ibs_uf,
  aliquota_ibs_municipio,
  aliquota_cbs
`;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function idOpcional(valor: unknown) {
  const id = texto(valor);
  return id || null;
}

function parseNumero(valor: unknown): number | null {
  if (valor == null || valor === "") {
    return null;
  }
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }
  let bruto = String(valor).trim();
  if (!bruto) {
    return null;
  }
  if (bruto.includes(".") && bruto.includes(",")) {
    bruto = bruto.replace(/\./g, "").replace(",", ".");
  } else if (bruto.includes(",")) {
    bruto = bruto.replace(",", ".");
  }
  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : null;
}

async function validarRelacionado(
  supabase: ClienteSupabase,
  tabela: "categorias" | "marcas" | "grupos_fiscais",
  id: string,
  empresaId: string,
  permitirInativoId?: string
) {
  const { data, error } = await supabase
    .from(tabela)
    .select("id, ativo")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }
  if (data.ativo) {
    return true;
  }
  return data.id === permitirInativoId;
}

function normalizarComercial(dados: DadosComerciaisApi, criar: boolean) {
  const codigoAutomatico = criar && dados.codigoAutomatico === true;
  const precoCusto = parseNumero(dados.precoCusto);
  const precoVenda = parseNumero(dados.precoVenda);
  return {
    codigoAutomatico,
    codigo: codigoAutomatico ? "" : texto(dados.codigo),
    codigoBarras: texto(dados.codigoBarras) || null,
    nome: texto(dados.nome),
    descricao: texto(dados.descricao) || null,
    categoriaId: idOpcional(dados.categoriaId),
    marcaId: idOpcional(dados.marcaId),
    unidade: normalizarUnidadeMedida(texto(dados.unidade) || UNIDADE_MEDIDA_PADRAO),
    precoCusto: precoCusto ?? 0,
    precoVenda: precoVenda ?? 0,
    precoCustoInformado: precoCusto,
    precoVendaInformado: precoVenda,
    ativo: dados.ativo !== false,
  };
}

async function validarComercial(
  supabase: ClienteSupabase,
  empresaId: string,
  dados: ReturnType<typeof normalizarComercial>,
  atuais?: {
    categoriaId?: string | null;
    marcaId?: string | null;
  }
) {
  if (!dados.codigoAutomatico && !dados.codigo) {
    return MENSAGEM_CODIGO_OBRIGATORIO;
  }
  if (dados.nome.length < 2) {
    return "Informe o nome do produto.";
  }
  if (!unidadeMedidaValida(dados.unidade)) {
    return "Selecione uma unidade de medida válida.";
  }
  if (dados.precoCustoInformado !== null && dados.precoCusto < 0) {
    return "Os preços não podem ser negativos.";
  }
  if (dados.precoVendaInformado !== null && dados.precoVenda < 0) {
    return "Os preços não podem ser negativos.";
  }

  const [categoriaValida, marcaValida] = await Promise.all([
    dados.categoriaId
      ? validarRelacionado(
          supabase,
          "categorias",
          dados.categoriaId,
          empresaId,
          atuais?.categoriaId ?? undefined
        )
      : Promise.resolve(true),
    dados.marcaId
      ? validarRelacionado(
          supabase,
          "marcas",
          dados.marcaId,
          empresaId,
          atuais?.marcaId ?? undefined
        )
      : Promise.resolve(true),
  ]);

  if (!categoriaValida) {
    return "Categoria inválida ou inativa.";
  }
  if (!marcaValida) {
    return "Marca inválida ou inativa.";
  }
  return null;
}

export async function persistirFiscalProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  produtoId: string;
  ncm?: string | null;
  cest?: string | null;
  origemProduto?: string | null;
  grupoFiscalId?: string | null;
}): Promise<ResultadoPersistencia> {
  const dadosFiscais: DadosFiscaisProduto = {
    ncm: String(input.ncm ?? "").replace(/\D/g, ""),
    cest: String(input.cest ?? "").replace(/\D/g, ""),
    origemProduto: texto(input.origemProduto) || "0",
  };
  const erroFiscal = validarDadosFiscaisProduto(dadosFiscais);
  if (erroFiscal) {
    return { ok: false, erro: erroFiscal };
  }

  const grupoFiscalId = idOpcional(input.grupoFiscalId);
  let grupoResumo: GrupoFiscalResumo | null = null;

  if (grupoFiscalId) {
    const { data: grupo, error: grupoError } = await input.supabase
      .from("grupos_fiscais")
      .select(GRUPO_FISCAL_SELECT)
      .eq("empresa_id", input.empresaId)
      .eq("id", grupoFiscalId)
      .maybeSingle();

    if (grupoError || !grupo) {
      return { ok: false, erro: "Grupo fiscal inválido ou de outra empresa." };
    }
    grupoResumo = grupo as GrupoFiscalResumo;
  }

  const status = avaliarStatusFiscalProduto({
    ncm: dadosFiscais.ncm,
    grupo: grupoResumo,
  });

  const { error: erroProduto } = await input.supabase
    .from("produtos")
    .update({ grupo_fiscal_id: grupoFiscalId })
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId);

  if (erroProduto) {
    return { ok: false, erro: erroProduto.message };
  }

  const { data, error } = await input.supabase
    .from("produtos_fiscal")
    .update(payloadAtualizacaoFiscalProduto(dadosFiscais, status.ok))
    .eq("empresa_id", input.empresaId)
    .eq("produto_id", input.produtoId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, erro: error.message };
  }
  if (!data) {
    return { ok: false, erro: "Configuração fiscal do produto não encontrada." };
  }

  return { ok: true, mensagem: "Configuração fiscal salva com sucesso." };
}

async function enviarImagemBase64(
  supabase: ClienteSupabase,
  empresaId: string,
  produtoId: string,
  imagemBase64: string,
  imagemTipo?: string | null
) {
  const tipo = texto(imagemTipo) || "image/webp";
  if (!["image/jpeg", "image/png", "image/webp"].includes(tipo)) {
    throw new Error("Envie uma imagem JPEG, PNG ou WebP.");
  }

  const limpo = imagemBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  const buffer = Buffer.from(limpo, "base64");
  if (!buffer.length) {
    throw new Error("Imagem inválida.");
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }

  const path = caminhoImagemProduto(empresaId, produtoId);
  const { error } = await supabase.storage.from(bucketCatalogo()).upload(path, buffer, {
    contentType: "image/webp",
    upsert: true,
  });
  if (error) {
    throw new Error(error.message || "Não foi possível enviar a imagem do produto.");
  }
  return path;
}

export async function persistirFotoProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  produtoId: string;
  removerImagem?: boolean;
  imagemBase64?: string | null;
  imagemTipo?: string | null;
}): Promise<ResultadoPersistencia & { imagemUrl?: string | null }> {
  const { data: atual, error: erroAtual } = await input.supabase
    .from("produtos")
    .select("id, catalogo_imagem_path")
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId)
    .maybeSingle();

  if (erroAtual || !atual) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  let imagemPath: string | null | undefined;
  try {
    if (input.removerImagem) {
      if (atual.catalogo_imagem_path) {
        await input.supabase.storage
          .from(bucketCatalogo())
          .remove([String(atual.catalogo_imagem_path)]);
      }
      imagemPath = null;
    }
    if (input.imagemBase64) {
      imagemPath = await enviarImagemBase64(
        input.supabase,
        input.empresaId,
        input.produtoId,
        input.imagemBase64,
        input.imagemTipo
      );
    }
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a imagem.",
    };
  }

  if (imagemPath === undefined) {
    return { ok: false, erro: "Informe uma imagem ou a remoção da foto." };
  }

  const { error } = await input.supabase
    .from("produtos")
    .update({ catalogo_imagem_path: imagemPath })
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId);

  if (error) {
    return { ok: false, erro: error.message };
  }

  return {
    ok: true,
    mensagem: imagemPath ? "Foto atualizada." : "Foto removida.",
    imagemUrl: urlPublicaCatalogo(imagemPath),
  };
}

export async function persistirCatalogoProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  produtoId: string;
  catalogo: DadosCatalogoApi;
}): Promise<ResultadoPersistencia> {
  const { data: atual, error: erroAtual } = await input.supabase
    .from("produtos")
    .select("id, catalogo_imagem_path")
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId)
    .maybeSingle();

  if (erroAtual || !atual) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  let imagemPath: string | null | undefined;
  try {
    if (input.catalogo.removerImagem) {
      if (atual.catalogo_imagem_path) {
        await input.supabase.storage
          .from(bucketCatalogo())
          .remove([String(atual.catalogo_imagem_path)]);
      }
      imagemPath = null;
    }
    if (input.catalogo.imagemBase64) {
      imagemPath = await enviarImagemBase64(
        input.supabase,
        input.empresaId,
        input.produtoId,
        input.catalogo.imagemBase64,
        input.catalogo.imagemTipo
      );
    }
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a imagem.",
    };
  }

  const { error } = await input.supabase
    .from("produtos")
    .update({
      catalogo_publicado: Boolean(input.catalogo.publicado),
      catalogo_destaque: Boolean(input.catalogo.destaque),
      catalogo_mostrar_preco: input.catalogo.mostrarPreco !== false,
      catalogo_descricao: texto(input.catalogo.descricao) || null,
      ...(imagemPath !== undefined ? { catalogo_imagem_path: imagemPath } : {}),
    })
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId);

  if (error) {
    return { ok: false, erro: error.message };
  }

  return { ok: true, mensagem: "Catálogo salvo com sucesso." };
}

export async function persistirProdutoComercialApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  produtoId: string;
  dados: DadosComerciaisApi;
}): Promise<ResultadoPersistencia> {
  const dados = normalizarComercial(input.dados, false);
  const { data: atual, error: erroAtual } = await input.supabase
    .from("produtos")
    .select("id, categoria_id, marca_id")
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId)
    .maybeSingle();

  if (erroAtual || !atual) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  const erroDados = await validarComercial(input.supabase, input.empresaId, dados, {
    categoriaId: atual.categoria_id,
    marcaId: atual.marca_id,
  });
  if (erroDados) {
    return { ok: false, erro: erroDados };
  }

  const { error } = await input.supabase
    .from("produtos")
    .update({
      codigo: dados.codigo,
      codigo_barras: dados.codigoBarras,
      nome: dados.nome,
      descricao: dados.descricao,
      categoria_id: dados.categoriaId,
      marca_id: dados.marcaId,
      unidade_medida: dados.unidade,
      preco_custo: dados.precoCusto,
      preco_venda: dados.precoVenda,
      ativo: dados.ativo,
    })
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, erro: mensagemCodigoDuplicado(dados.codigo) };
    }
    return { ok: false, erro: error.message };
  }

  return { ok: true, mensagem: "Alteração realizada com sucesso" };
}

export async function cadastrarProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  dados: DadosComerciaisApi;
}): Promise<ResultadoPersistencia> {
  const dados = normalizarComercial(input.dados, true);
  const erroDados = await validarComercial(input.supabase, input.empresaId, dados);
  if (erroDados) {
    return { ok: false, erro: erroDados };
  }

  let produtoId: string | null = null;
  let codigoCriado = dados.codigo;

  if (dados.codigoAutomatico) {
    const { data, error } = await input.supabase.rpc("rpc_cadastrar_produto", {
      p_empresa_id: input.empresaId,
      p_codigo: "",
      p_codigo_barras: dados.codigoBarras,
      p_nome: dados.nome,
      p_descricao: dados.descricao,
      p_categoria_id: dados.categoriaId,
      p_marca_id: dados.marcaId,
      p_grupo_fiscal_id: null,
      p_unidade_medida: dados.unidade,
      p_preco_custo: dados.precoCusto,
      p_preco_venda: dados.precoVenda,
      p_estoque_inicial: 0,
    });

    if (error) {
      if (error.message.includes("Não foi possível gerar o código automático")) {
        return { ok: false, erro: MENSAGEM_CODIGO_AUTOMATICO_FALHOU };
      }
      if (
        error.code === "23505" ||
        error.message.includes("Já existe um produto com o código")
      ) {
        return { ok: false, erro: mensagemCodigoDuplicado(dados.codigo) };
      }
      return { ok: false, erro: error.message };
    }

    const registro = Array.isArray(data) ? data[0] : data;
    produtoId = registro?.produto_id ? String(registro.produto_id) : null;
    if (registro?.codigo) {
      codigoCriado = String(registro.codigo);
    }
  } else {
    const { data, error } = await input.supabase
      .from("produtos")
      .insert({
        empresa_id: input.empresaId,
        codigo: dados.codigo,
        codigo_barras: dados.codigoBarras,
        nome: dados.nome,
        descricao: dados.descricao,
        categoria_id: dados.categoriaId,
        marca_id: dados.marcaId,
        grupo_fiscal_id: null,
        unidade_medida: dados.unidade,
        tipo_item: "00",
        preco_custo: dados.precoCusto,
        preco_venda: dados.precoVenda,
        ativo: dados.ativo,
      })
      .select("id, codigo")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, erro: mensagemCodigoDuplicado(dados.codigo) };
      }
      return { ok: false, erro: error.message };
    }
    produtoId = data?.id ?? null;
    if (data?.codigo) {
      codigoCriado = String(data.codigo);
    }
  }

  if (!produtoId && codigoCriado) {
    const { data: criado } = await input.supabase
      .from("produtos")
      .select("id, codigo")
      .eq("empresa_id", input.empresaId)
      .eq("codigo", codigoCriado)
      .maybeSingle();
    produtoId = criado?.id ?? null;
    if (criado?.codigo) {
      codigoCriado = String(criado.codigo);
    }
  }

  if (dados.codigoAutomatico && !codigoCriado) {
    return { ok: false, erro: MENSAGEM_CODIGO_AUTOMATICO_FALHOU };
  }
  if (!produtoId) {
    return { ok: false, erro: "Não foi possível cadastrar o produto." };
  }

  const fiscal = await persistirFiscalProdutoApi({
    supabase: input.supabase,
    empresaId: input.empresaId,
    produtoId,
    ncm: "",
    cest: "",
    origemProduto: "0",
    grupoFiscalId: null,
  });

  if (!fiscal.ok) {
    return {
      ok: false,
      erro: `${MENSAGEM_FISCAL_NAO_GRAVADO} ${fiscal.erro}`,
    };
  }

  if (!dados.ativo) {
    const { error: erroInativo } = await input.supabase
      .from("produtos")
      .update({ ativo: false })
      .eq("empresa_id", input.empresaId)
      .eq("id", produtoId);
    if (erroInativo) {
      return { ok: false, erro: erroInativo.message };
    }
  }

  return {
    ok: true,
    mensagem: codigoCriado
      ? `Produto cadastrado com código ${codigoCriado}.`
      : "Produto cadastrado com sucesso.",
    id: produtoId,
    codigo: codigoCriado,
  };
}

export async function carregarOpcoesProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
}) {
  const [categorias, marcas, grupos] = await Promise.all([
    input.supabase
      .from("categorias")
      .select("id, nome, ativo")
      .eq("empresa_id", input.empresaId)
      .eq("ativo", true)
      .order("nome"),
    input.supabase
      .from("marcas")
      .select("id, nome, ativo")
      .eq("empresa_id", input.empresaId)
      .eq("ativo", true)
      .order("nome"),
    input.supabase
      .from("grupos_fiscais")
      .select(GRUPO_FISCAL_SELECT)
      .eq("empresa_id", input.empresaId)
      .order("nome"),
  ]);

  if (categorias.error) {
    throw new Error(categorias.error.message);
  }
  if (marcas.error) {
    throw new Error(marcas.error.message);
  }
  if (grupos.error) {
    throw new Error(grupos.error.message);
  }

  return {
    categorias: (categorias.data ?? []).map((item) => ({
      id: String(item.id),
      nome: String(item.nome),
    })),
    marcas: (marcas.data ?? []).map((item) => ({
      id: String(item.id),
      nome: String(item.nome),
    })),
    gruposFiscais: (grupos.data ?? []).map((item) => ({
      ...(item as GrupoFiscalResumo),
      id: String(item.id),
    })),
    unidades: UNIDADES_MEDIDA.map((item) => ({
      value: item.value,
      label: item.label,
    })),
    origens: ORIGENS_MERCADORIA.map((item) => ({
      codigo: item.codigo,
      descricao: item.descricao,
    })),
  };
}

export async function carregarProdutoApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  produtoId: string;
}) {
  const { data, error } = await input.supabase
    .from("produtos")
    .select(
      `
      id,
      codigo,
      codigo_barras,
      nome,
      descricao,
      categoria_id,
      marca_id,
      grupo_fiscal_id,
      unidade_medida,
      preco_custo,
      preco_venda,
      ativo,
      catalogo_publicado,
      catalogo_destaque,
      catalogo_mostrar_preco,
      catalogo_descricao,
      catalogo_imagem_path
    `
    )
    .eq("empresa_id", input.empresaId)
    .eq("id", input.produtoId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  const [fiscalResult, estoqueResult, opcoes] = await Promise.all([
    input.supabase
      .from("produtos_fiscal")
      .select("ncm, cest, origem_produto, fiscal_configurado")
      .eq("empresa_id", input.empresaId)
      .eq("produto_id", input.produtoId)
      .maybeSingle(),
    input.supabase
      .from("estoque_atual")
      .select("quantidade")
      .eq("empresa_id", input.empresaId)
      .eq("produto_id", input.produtoId),
    carregarOpcoesProdutoApi(input),
  ]);

  if (fiscalResult.error) {
    throw new Error(fiscalResult.error.message);
  }
  if (estoqueResult.error) {
    throw new Error(estoqueResult.error.message);
  }

  const grupo =
    opcoes.gruposFiscais.find((item) => item.id === data.grupo_fiscal_id) ??
    null;
  const status = avaliarStatusFiscalProduto({
    ncm: fiscalResult.data?.ncm,
    grupo,
  });
  const estoque = (estoqueResult.data ?? []).reduce(
    (soma, linha) => soma + Number(linha.quantidade ?? 0),
    0
  );

  return {
    produto: {
      id: String(data.id),
      codigo: data.codigo ? String(data.codigo) : "",
      codigoBarras: data.codigo_barras ? String(data.codigo_barras) : "",
      nome: String(data.nome ?? ""),
      descricao: data.descricao ? String(data.descricao) : "",
      categoriaId: data.categoria_id ? String(data.categoria_id) : null,
      marcaId: data.marca_id ? String(data.marca_id) : null,
      unidade: String(data.unidade_medida || UNIDADE_MEDIDA_PADRAO),
      precoCusto: Number(data.preco_custo ?? 0),
      precoVenda: Number(data.preco_venda ?? 0),
      ativo: data.ativo !== false,
      estoque,
      imagemUrl: urlPublicaCatalogo(data.catalogo_imagem_path),
    },
    fiscal: {
      ncm: fiscalResult.data?.ncm ? String(fiscalResult.data.ncm) : "",
      cest: fiscalResult.data?.cest ? String(fiscalResult.data.cest) : "",
      origemProduto: fiscalResult.data?.origem_produto
        ? String(fiscalResult.data.origem_produto)
        : "0",
      grupoFiscalId: data.grupo_fiscal_id ? String(data.grupo_fiscal_id) : null,
      status,
      grupo,
    },
    catalogo: {
      publicado: Boolean(data.catalogo_publicado),
      destaque: Boolean(data.catalogo_destaque),
      mostrarPreco: data.catalogo_mostrar_preco !== false,
      descricao: data.catalogo_descricao ? String(data.catalogo_descricao) : "",
      imagemPath: data.catalogo_imagem_path
        ? String(data.catalogo_imagem_path)
        : null,
      imagemUrl: urlPublicaCatalogo(data.catalogo_imagem_path),
    },
    opcoes,
  };
}
