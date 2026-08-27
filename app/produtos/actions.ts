"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import {
  exigirRecursoEmpresa,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import {
  bucketCatalogo,
  caminhoImagemProduto,
} from "@/lib/catalogo/storage";

import {
  avaliarStatusFiscalProduto,
} from "@/lib/fiscal/status-fiscal-produto";
import {
  MENSAGEM_FISCAL_NAO_GRAVADO,
  lerDadosFiscaisProduto,
  payloadAtualizacaoFiscalProduto,
  validarDadosFiscaisProduto,
} from "@/lib/produtos/dados-fiscais-produto";
import {
  normalizarCenqInformado,
  validarConfiguracaoIpiGrupo,
} from "@/lib/fiscal/ipi";

import {
  CFOPS_INTERNOS,
  CFOPS_INTERESTADUAIS,
  CSOSN,
  CST_ICMS,
  CST_PIS_COFINS,
  existeCodigo,
} from "@/lib/fiscal/tabelas-fiscais";
import {
  UNIDADE_MEDIDA_PADRAO,
  normalizarUnidadeMedida,
  unidadeMedidaValida,
} from "@/lib/produtos/unidades-medida";
import {
  MENSAGEM_CODIGO_AUTOMATICO_FALHOU,
  MENSAGEM_CODIGO_OBRIGATORIO,
  formMarcouCodigoAutomatico,
  mensagemCodigoDuplicado,
} from "@/lib/produtos/codigo-automatico";
import {
  MENSAGEM_CONTROLE_VALIDADE_INATIVO,
  MENSAGEM_LOTE_DUPLICADO,
  normalizarDadosLoteProduto,
  ordenarLotesFefo,
  validarDadosLoteProduto,
  validarQuantidadeContraEstoque,
  type LoteEstoque,
} from "@/lib/produtos/lotes";

type ResultadoProduto =
  | {
      ok: true;
      mensagem: string;
    }
  | {
      ok: false;
      erro: string;
    };

async function getContexto() {
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo, error } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !vinculo) {
    redirect("/onboarding");
  }

  await exigirEmpresaOperacionalOuRedirecionar(String(vinculo.empresa_id));

  return {
    supabase,
    empresaId: vinculo.empresa_id,
    perfil: vinculo.perfil,
  };
}

async function exigirProduto(
  empresaId: string,
  acao: AcaoDoModulo<"produtos">,
  origem: string
) {
  await exigirOperacaoProduto({
    empresaId: String(empresaId),
    acao,
    origem,
  });
}

function redirecionarNegacaoProduto(
  error: unknown,
  destino: (mensagem: string) => never
): never {
  if (error instanceof ErroPermissao && error.status === 401) {
    redirect("/login");
  }
  if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
    destino(error.message);
  }
  throw error;
}

function resultadoNegacaoProduto(error: unknown): {
  ok: false;
  erro: string;
} {
  if (error instanceof ErroPermissao && error.status === 401) {
    redirect("/login");
  }
  if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
    return { ok: false, erro: error.message };
  }
  throw error;
}

function voltarErro(mensagem: string): never {
  redirect(
    "/produtos?erro=" +
      encodeURIComponent(mensagem)
  );
}

function numeroDecimal(
  valor: FormDataEntryValue | null
) {
  let texto = String(valor ?? "").trim();

  if (
    texto.includes(".") &&
    texto.includes(",")
  ) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : 0;
}

async function validarRelacionado(
  tabela:
    | "categorias"
    | "marcas"
    | "grupos_fiscais",
  id: string,
  empresaId: string,
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  permitirInativoId?: string
) {
  const consulta = supabase
    .from(tabela)
    .select("id, ativo")
    .eq("id", id)
    .eq("empresa_id", empresaId);

  const { data, error } = await consulta.maybeSingle();

  if (error || !data) {
    return false;
  }

  if (data.ativo) {
    return true;
  }

  return data.id === permitirInativoId;
}

function parseNumeroFormulario(
  valor: FormDataEntryValue | null
) {
  let texto = String(valor ?? "").trim();

  if (!texto) {
    return null;
  }

  if (
    texto.includes(".") &&
    texto.includes(",")
  ) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : null;
}

function lerDadosComerciaisProduto(
  formData: FormData,
  opcoes?: {
    permitirAutomatico?: boolean;
  }
) {
  const codigoAutomatico =
    opcoes?.permitirAutomatico === true &&
    formMarcouCodigoAutomatico(formData);

  const codigo = String(
    formData.get("codigo") ?? ""
  ).trim();

  const codigoBarras = String(
    formData.get("codigo_barras") ?? ""
  ).trim();

  const nome = String(
    formData.get("nome") ?? ""
  ).trim();

  const descricao = String(
    formData.get("descricao") ?? ""
  ).trim();

  const categoriaId = String(
    formData.get("categoria_id") ?? ""
  ).trim();

  const marcaId = String(
    formData.get("marca_id") ?? ""
  ).trim();

  const grupoFiscalId = String(
    formData.get("grupo_fiscal_id") ?? ""
  ).trim();

  const unidade = normalizarUnidadeMedida(
    String(
      formData.get("unidade_medida") ??
        UNIDADE_MEDIDA_PADRAO
    )
  );

  const precoCusto = parseNumeroFormulario(
    formData.get("preco_custo")
  );

  const precoVenda = parseNumeroFormulario(
    formData.get("preco_venda")
  );

  const estoqueInicial = parseNumeroFormulario(
    formData.get("estoque_inicial")
  );

  return {
    codigoAutomatico,
    codigo: codigoAutomatico ? "" : codigo,
    codigoBarras: codigoBarras || null,
    nome,
    descricao: descricao || null,
    categoriaId: categoriaId || null,
    marcaId: marcaId || null,
    grupoFiscalId: grupoFiscalId || null,
    unidade,
    precoCusto: precoCusto ?? 0,
    precoVenda: precoVenda ?? 0,
    estoqueInicial: estoqueInicial ?? 0,
    precoCustoInformado: precoCusto,
    precoVendaInformado: precoVenda,
    estoqueInicialInformado: estoqueInicial,
    ativo: formData.get("ativo") === "1",
    controlarValidade: formData.get("controlar_validade") === "1",
  };
}

function lerDadosCatalogoProduto(formData: FormData) {
  return {
    publicado: formData.get("catalogo_publicado") === "1",
    destaque: formData.get("catalogo_destaque") === "1",
    mostrarPreco: formData.get("catalogo_mostrar_preco") === "1",
    descricao:
      String(formData.get("catalogo_descricao") ?? "").trim() || null,
    removerImagem: formData.get("catalogo_remover_imagem") === "1",
    imagem: formData.get("catalogo_imagem"),
  };
}

function payloadCatalogoProduto(
  dados: ReturnType<typeof lerDadosCatalogoProduto>,
  imagemPath?: string | null
) {
  return {
    catalogo_publicado: dados.publicado,
    catalogo_destaque: dados.destaque,
    catalogo_mostrar_preco: dados.mostrarPreco,
    catalogo_descricao: dados.descricao,
    ...(imagemPath !== undefined
      ? { catalogo_imagem_path: imagemPath }
      : {}),
  };
}

async function enviarImagemProdutoCatalogo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  produtoId: string,
  arquivo: FormDataEntryValue | null
) {
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return undefined;
  }

  if (arquivo.size > 5 * 1024 * 1024) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }

  const tipo = arquivo.type || "image/webp";

  if (!["image/jpeg", "image/png", "image/webp"].includes(tipo)) {
    throw new Error("Envie uma imagem JPEG, PNG ou WebP.");
  }

  const path = caminhoImagemProduto(empresaId, produtoId);
  const buffer = Buffer.from(await arquivo.arrayBuffer());

  const { error } = await supabase.storage
    .from(bucketCatalogo())
    .upload(path, buffer, {
      contentType: "image/webp",
      upsert: true,
    });

  if (error) {
    throw new Error(
      error.message || "Não foi possível enviar a imagem do produto."
    );
  }

  return path;
}

async function removerImagemProdutoCatalogo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null | undefined
) {
  if (!path) {
    return;
  }

  await supabase.storage.from(bucketCatalogo()).remove([path]);
}

// =========================================================
// CADASTRAR PRODUTO
// =========================================================

async function validarDadosComerciaisProduto(
  dados: ReturnType<typeof lerDadosComerciaisProduto>,
  empresaId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  atuais?: {
    categoriaId?: string | null;
    marcaId?: string | null;
    grupoFiscalId?: string | null;
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

  if (
    dados.precoCustoInformado !== null &&
    dados.precoCusto < 0
  ) {
    return "Os preços não podem ser negativos.";
  }

  if (
    dados.precoVendaInformado !== null &&
    dados.precoVenda < 0
  ) {
    return "Os preços não podem ser negativos.";
  }

  const [
    categoriaValida,
    marcaValida,
    grupoFiscalValido,
  ] = await Promise.all([
    dados.categoriaId
      ? validarRelacionado(
          "categorias",
          dados.categoriaId,
          empresaId,
          supabase,
          atuais?.categoriaId ?? undefined
        )
      : Promise.resolve(true),
    dados.marcaId
      ? validarRelacionado(
          "marcas",
          dados.marcaId,
          empresaId,
          supabase,
          atuais?.marcaId ?? undefined
        )
      : Promise.resolve(true),
    dados.grupoFiscalId
      ? validarRelacionado(
          "grupos_fiscais",
          dados.grupoFiscalId,
          empresaId,
          supabase,
          atuais?.grupoFiscalId ?? undefined
        )
      : Promise.resolve(true),
  ]);

  if (!categoriaValida) {
    return "Categoria inválida ou inativa.";
  }

  if (!marcaValida) {
    return "Marca inválida ou inativa.";
  }

  if (!grupoFiscalValido) {
    return "Grupo fiscal inválido ou inativo.";
  }

  return null;
}

function payloadComercialProduto(
  empresaId: string,
  dados: ReturnType<typeof lerDadosComerciaisProduto>
) {
  return {
    empresa_id: empresaId,
    codigo: dados.codigo,
    codigo_barras: dados.codigoBarras,
    nome: dados.nome,
    descricao: dados.descricao,
    categoria_id: dados.categoriaId,
    marca_id: dados.marcaId,
    grupo_fiscal_id: dados.grupoFiscalId,
    unidade_medida: dados.unidade,
    tipo_item: "00",
    preco_custo: dados.precoCusto,
    preco_venda: dados.precoVenda,
    ativo: dados.ativo,
    controlar_validade: dados.controlarValidade,
  };
}

const GRUPO_FISCAL_STATUS_SELECT = `
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
  ipi_cst,
  ipi_aliquota,
  cst_ibscbs,
  classificacao_ibscbs,
  aliquota_ibs_uf,
  aliquota_ibs_municipio,
  aliquota_cbs
`;

async function persistirDadosFiscaisProduto({
  supabase,
  empresaId,
  produtoId,
  dadosFiscais,
  grupoFiscalId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  produtoId: string;
  dadosFiscais: ReturnType<typeof lerDadosFiscaisProduto>;
  grupoFiscalId: string | null;
}): Promise<ResultadoProduto> {
  let grupoResumo = null;

  if (grupoFiscalId) {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos_fiscais")
      .select(GRUPO_FISCAL_STATUS_SELECT)
      .eq("empresa_id", empresaId)
      .eq("id", grupoFiscalId)
      .maybeSingle();

    if (grupoError || !grupo) {
      return {
        ok: false,
        erro: "Grupo fiscal inválido ou de outra empresa.",
      };
    }

    grupoResumo = grupo;
  }

  const status = avaliarStatusFiscalProduto({
    ncm: dadosFiscais.ncm,
    grupo: grupoResumo,
  });

  const { error: erroProduto } = await supabase
    .from("produtos")
    .update({
      grupo_fiscal_id: grupoFiscalId || null,
    })
    .eq("empresa_id", empresaId)
    .eq("id", produtoId);

  if (erroProduto) {
    return { ok: false, erro: erroProduto.message };
  }

  const { data, error } = await supabase
    .from("produtos_fiscal")
    .update(
      payloadAtualizacaoFiscalProduto(dadosFiscais, status.ok)
    )
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("ERRO AO SALVAR FISCAL DO PRODUTO:", error);
    return { ok: false, erro: error.message };
  }

  if (!data) {
    return {
      ok: false,
      erro: "Configuração fiscal do produto não encontrada.",
    };
  }

  return { ok: true, mensagem: "Configuração fiscal salva com sucesso." };
}

export async function cadastrarProduto(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(empresaId, "criar", "cadastrarProduto");
  } catch (error) {
    redirecionarNegacaoProduto(error, voltarErro);
  }

  const dados = lerDadosComerciaisProduto(formData, {
    permitirAutomatico: true,
  });
  const dadosFiscais = lerDadosFiscaisProduto(formData);
  const erroDados = await validarDadosComerciaisProduto(
    dados,
    empresaId,
    supabase
  );

  if (erroDados) {
    voltarErro(erroDados);
  }

  const erroFiscal = validarDadosFiscaisProduto(dadosFiscais);

  if (erroFiscal) {
    voltarErro(erroFiscal);
  }

  const estoqueTexto = String(
    formData.get("estoque_inicial") ?? ""
  ).trim();

  if (estoqueTexto && dados.estoqueInicialInformado === null) {
    voltarErro("Informe um estoque inicial válido.");
  }

  if (dados.estoqueInicial < 0) {
    voltarErro("O estoque inicial não pode ser negativo.");
  }

  if (dados.estoqueInicial > 0) {
    try {
      await exigirPermissao({ modulo: "estoque", acao: "ajustar" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        voltarErro(error.message);
      }
      throw error;
    }
  }

  let produtoId: string | null = null;
  let codigoCriado = dados.codigo;
  const usarRpc =
    dados.codigoAutomatico || dados.estoqueInicial > 0;

  if (usarRpc) {
    const { data, error } = await supabase.rpc(
      "rpc_cadastrar_produto",
      {
        p_empresa_id: empresaId,
        p_codigo: dados.codigoAutomatico ? "" : dados.codigo,
        p_codigo_barras: dados.codigoBarras,
        p_nome: dados.nome,
        p_descricao: dados.descricao,
        p_categoria_id: dados.categoriaId,
        p_marca_id: dados.marcaId,
        p_grupo_fiscal_id: dados.grupoFiscalId,
        p_unidade_medida: dados.unidade,
        p_preco_custo: dados.precoCusto,
        p_preco_venda: dados.precoVenda,
        p_estoque_inicial: dados.estoqueInicial,
      }
    );

    if (error) {
      console.error(
        "ERRO AO CADASTRAR PRODUTO:",
        error
      );

      if (
        error.message.includes(
          "Não foi possível gerar o código automático"
        )
      ) {
        voltarErro(MENSAGEM_CODIGO_AUTOMATICO_FALHOU);
      }

      if (
        error.code === "23505" ||
        error.message.includes("Já existe um produto com o código")
      ) {
        voltarErro(
          error.message.includes("nesta empresa")
            ? error.message
            : mensagemCodigoDuplicado(dados.codigo)
        );
      }

      if (
        error.code === "42883" ||
        error.message.includes("rpc_cadastrar_produto")
      ) {
        voltarErro(
          dados.codigoAutomatico
            ? MENSAGEM_CODIGO_AUTOMATICO_FALHOU
            : "O cadastro com estoque inicial ainda depende da função transacional rpc_cadastrar_produto. Aplique a migration antes de usar estoque inicial."
        );
      }

      voltarErro(error.message);
    }

    const registro = Array.isArray(data) ? data[0] : data;
    produtoId = registro?.produto_id ? String(registro.produto_id) : null;
    if (registro?.codigo) {
      codigoCriado = String(registro.codigo);
    }
  } else {
    const { data, error } = await supabase
      .from("produtos")
      .insert(payloadComercialProduto(empresaId, dados))
      .select("id, codigo")
      .maybeSingle();

    if (error) {
      console.error(
        "ERRO AO CADASTRAR PRODUTO:",
        error
      );

      if (error.code === "23505") {
        voltarErro(mensagemCodigoDuplicado(dados.codigo));
      }

      voltarErro(error.message);
    }

    produtoId = data?.id ?? null;
    if (data?.codigo) {
      codigoCriado = String(data.codigo);
    }
  }

  if (!produtoId && codigoCriado) {
    const { data: criado } = await supabase
      .from("produtos")
      .select("id, codigo")
      .eq("empresa_id", empresaId)
      .eq("codigo", codigoCriado)
      .maybeSingle();

    produtoId = criado?.id ?? null;
    if (criado?.codigo) {
      codigoCriado = String(criado.codigo);
    }
  }

  if (dados.codigoAutomatico && !codigoCriado) {
    voltarErro(MENSAGEM_CODIGO_AUTOMATICO_FALHOU);
  }

  if (produtoId) {
    const catalogoNoPlano = await planoPermiteRecursoEmpresa(
      String(empresaId),
      "catalogo"
    );
    if (catalogoNoPlano.permitido) {
      const catalogo = lerDadosCatalogoProduto(formData);
      let imagemPath: string | null | undefined;

      try {
        imagemPath = await enviarImagemProdutoCatalogo(
          supabase,
          empresaId,
          produtoId,
          catalogo.imagem
        );
      } catch (error) {
        voltarErro(
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a imagem."
        );
      }

      const { error: erroCatalogo } = await supabase
        .from("produtos")
        .update(payloadCatalogoProduto(catalogo, imagemPath))
        .eq("empresa_id", empresaId)
        .eq("id", produtoId);

      if (erroCatalogo) {
        voltarErro(erroCatalogo.message);
      }
    }

    const fiscal = await persistirDadosFiscaisProduto({
      supabase,
      empresaId,
      produtoId,
      dadosFiscais,
      grupoFiscalId: dados.grupoFiscalId,
    });

    if (!fiscal.ok) {
      voltarErro(`${MENSAGEM_FISCAL_NAO_GRAVADO} ${fiscal.erro}`);
    }

    if (!dados.ativo || dados.controlarValidade) {
      const { error: erroFlags } = await supabase
        .from("produtos")
        .update({
          ativo: dados.ativo,
          controlar_validade: dados.controlarValidade,
        })
        .eq("empresa_id", empresaId)
        .eq("id", produtoId);

      if (erroFlags) {
        voltarErro(erroFlags.message);
      }
    }
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");

  redirect(
    "/produtos?sucesso=" +
      encodeURIComponent(
        codigoCriado
          ? `Produto cadastrado com código ${codigoCriado}.`
          : "Produto cadastrado com sucesso."
      )
  );
}

export async function editarProduto(
  formData: FormData
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "editarProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const produtoId = String(formData.get("id") ?? "").trim();
  const dados = lerDadosComerciaisProduto(formData);
  const dadosFiscais = lerDadosFiscaisProduto(formData);

  if (!produtoId) {
    return { ok: false, erro: "Produto inválido." };
  }

  const { data: atual, error: erroAtual } = await supabase
    .from("produtos")
    .select("id, categoria_id, marca_id, grupo_fiscal_id")
    .eq("empresa_id", empresaId)
    .eq("id", produtoId)
    .maybeSingle();

  if (erroAtual || !atual) {
    return {
      ok: false,
      erro: "Produto não encontrado nesta empresa.",
    };
  }

  const erroDados = await validarDadosComerciaisProduto(
    dados,
    empresaId,
    supabase,
    {
      categoriaId: atual.categoria_id,
      marcaId: atual.marca_id,
      grupoFiscalId: atual.grupo_fiscal_id,
    }
  );

  if (erroDados) {
    return { ok: false, erro: erroDados };
  }

  const erroFiscal = validarDadosFiscaisProduto(dadosFiscais);

  if (erroFiscal) {
    return { ok: false, erro: erroFiscal };
  }

  const catalogoNoPlano = await planoPermiteRecursoEmpresa(
    String(empresaId),
    "catalogo"
  );
  const catalogo = catalogoNoPlano.permitido
    ? lerDadosCatalogoProduto(formData)
    : null;
  let imagemPath: string | null | undefined;

  if (catalogo) {
    try {
      if (catalogo.removerImagem) {
        const { data: atualImagem } = await supabase
          .from("produtos")
          .select("catalogo_imagem_path")
          .eq("empresa_id", empresaId)
          .eq("id", produtoId)
          .maybeSingle();

        await removerImagemProdutoCatalogo(
          supabase,
          atualImagem?.catalogo_imagem_path
        );
        imagemPath = null;
      }

      const enviado = await enviarImagemProdutoCatalogo(
        supabase,
        empresaId,
        produtoId,
        catalogo.imagem
      );

      if (enviado) {
        imagemPath = enviado;
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
  }

  const { error } = await supabase
    .from("produtos")
    .update({
      codigo: dados.codigo,
      codigo_barras: dados.codigoBarras,
      nome: dados.nome,
      descricao: dados.descricao,
      categoria_id: dados.categoriaId,
      marca_id: dados.marcaId,
      grupo_fiscal_id: dados.grupoFiscalId,
      unidade_medida: dados.unidade,
      preco_custo: dados.precoCusto,
      preco_venda: dados.precoVenda,
      ativo: dados.ativo,
      controlar_validade: dados.controlarValidade,
      ...(catalogo ? payloadCatalogoProduto(catalogo, imagemPath) : {}),
    })
    .eq("empresa_id", empresaId)
    .eq("id", produtoId);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        erro: mensagemCodigoDuplicado(dados.codigo),
      };
    }

    return { ok: false, erro: error.message };
  }

  const fiscal = await persistirDadosFiscaisProduto({
    supabase,
    empresaId,
    produtoId,
    dadosFiscais,
    grupoFiscalId: dados.grupoFiscalId,
  });

  revalidatePath("/produtos");
  revalidatePath("/estoque");

  if (!fiscal.ok) {
    return {
      ok: false,
      erro: `${MENSAGEM_FISCAL_NAO_GRAVADO} ${fiscal.erro}`,
    };
  }

  return {
    ok: true,
    mensagem: "Alteração realizada com sucesso",
  };
}

const LOTE_SELECT =
  "id, empresa_id, produto_id, codigo_lote, data_fabricacao, data_validade, quantidade, observacao, created_at, updated_at";

function mapearLote(registro: Record<string, unknown>): LoteEstoque {
  return {
    id: String(registro.id),
    empresa_id: String(registro.empresa_id),
    produto_id: String(registro.produto_id),
    codigo_lote: String(registro.codigo_lote),
    data_fabricacao: registro.data_fabricacao
      ? String(registro.data_fabricacao).slice(0, 10)
      : null,
    data_validade: String(registro.data_validade).slice(0, 10),
    quantidade: Number(registro.quantidade ?? 0),
    observacao: registro.observacao ? String(registro.observacao) : null,
    created_at: String(registro.created_at),
    updated_at: String(registro.updated_at),
  };
}

async function carregarProdutoValidade(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  produtoId: string
) {
  const { data, error } = await supabase
    .from("produtos")
    .select("id, controlar_validade")
    .eq("empresa_id", empresaId)
    .eq("id", produtoId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function carregarEstoqueAtualProduto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  produtoId: string
) {
  const { data, error } = await supabase
    .from("estoque_atual")
    .select("quantidade")
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  return {
    ok: true as const,
    quantidade: Number(data?.quantidade ?? 0),
  };
}

async function carregarLotesProduto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  produtoId: string
) {
  const { data, error } = await supabase
    .from("estoque_lotes")
    .select(LOTE_SELECT)
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId);

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  const lotes = ordenarLotesFefo(
    (data ?? []).map((registro) => mapearLote(registro as Record<string, unknown>))
  );

  return { ok: true as const, lotes };
}

export async function listarLotesProduto(produtoId: string): Promise<
  | {
      ok: true;
      lotes: LoteEstoque[];
      estoqueAtual: number;
    }
  | { ok: false; erro: string }
> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "acessar", "listarLotesProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const id = String(produtoId ?? "").trim();
  if (!id) {
    return { ok: false, erro: "Produto inválido." };
  }

  const produto = await carregarProdutoValidade(supabase, empresaId, id);
  if (!produto) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  const [lotes, estoque] = await Promise.all([
    carregarLotesProduto(supabase, empresaId, id),
    carregarEstoqueAtualProduto(supabase, empresaId, id),
  ]);
  if (!lotes.ok) {
    return lotes;
  }
  if (!estoque.ok) {
    return estoque;
  }

  return {
    ok: true,
    lotes: lotes.lotes,
    estoqueAtual: estoque.quantidade,
  };
}

export async function salvarControleValidadeProduto(
  produtoId: string,
  controlar: boolean
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "salvarControleValidadeProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const id = String(produtoId ?? "").trim();
  if (!id) {
    return { ok: false, erro: "Produto inválido." };
  }

  const produto = await carregarProdutoValidade(supabase, empresaId, id);
  if (!produto) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  const { error } = await supabase
    .from("produtos")
    .update({ controlar_validade: controlar === true })
    .eq("empresa_id", empresaId)
    .eq("id", id);

  if (error) {
    return { ok: false, erro: error.message };
  }

  revalidatePath("/produtos");
  return {
    ok: true,
    mensagem: controlar
      ? "Controle de validade ativado."
      : "Controle de validade desativado.",
  };
}

export async function salvarLoteProduto(input: {
  produtoId: string;
  loteId?: string | null;
  codigoLote: string;
  dataFabricacao?: string | null;
  dataValidade: string;
  quantidade: number | string;
  observacao?: string | null;
}): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "salvarLoteProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const produtoId = String(input.produtoId ?? "").trim();
  if (!produtoId) {
    return { ok: false, erro: "Produto inválido." };
  }

  const produto = await carregarProdutoValidade(
    supabase,
    empresaId,
    produtoId
  );
  if (!produto) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  if (!produto.controlar_validade) {
    return { ok: false, erro: MENSAGEM_CONTROLE_VALIDADE_INATIVO };
  }

  const quantidade =
    parseNumeroFormulario(String(input.quantidade ?? "")) ??
    Number.NaN;

  const dados = normalizarDadosLoteProduto({
    codigoLote: input.codigoLote,
    dataFabricacao: input.dataFabricacao,
    dataValidade: input.dataValidade,
    quantidade,
    observacao: input.observacao,
  });
  const erroDados = validarDadosLoteProduto(dados);
  if (erroDados) {
    return { ok: false, erro: erroDados };
  }

  const loteId = String(input.loteId ?? "").trim();
  const [lotes, estoque] = await Promise.all([
    carregarLotesProduto(supabase, empresaId, produtoId),
    carregarEstoqueAtualProduto(supabase, empresaId, produtoId),
  ]);
  if (!lotes.ok) {
    return lotes;
  }
  if (!estoque.ok) {
    return estoque;
  }

  if (loteId) {
    const existente = lotes.lotes.find((lote) => lote.id === loteId);
    if (!existente) {
      return { ok: false, erro: "Lote não encontrado nesta empresa." };
    }
  }

  const erroEstoque = validarQuantidadeContraEstoque({
    estoqueAtual: estoque.quantidade,
    lotes: lotes.lotes,
    quantidadeNova: dados.quantidade,
    loteId: loteId || null,
  });
  if (erroEstoque) {
    return { ok: false, erro: erroEstoque };
  }

  const payload = {
    empresa_id: empresaId,
    produto_id: produtoId,
    codigo_lote: dados.codigoLote,
    data_fabricacao: dados.dataFabricacao,
    data_validade: dados.dataValidade,
    quantidade: dados.quantidade,
    observacao: dados.observacao,
  };

  if (loteId) {
    const { data, error } = await supabase
      .from("estoque_lotes")
      .update({
        codigo_lote: payload.codigo_lote,
        data_fabricacao: payload.data_fabricacao,
        data_validade: payload.data_validade,
        quantidade: payload.quantidade,
        observacao: payload.observacao,
      })
      .eq("empresa_id", empresaId)
      .eq("produto_id", produtoId)
      .eq("id", loteId)
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, erro: MENSAGEM_LOTE_DUPLICADO };
      }
      return { ok: false, erro: error.message };
    }

    if (!data) {
      return { ok: false, erro: "Lote não encontrado nesta empresa." };
    }
  } else {
    const { error } = await supabase.from("estoque_lotes").insert(payload);

    if (error) {
      if (error.code === "23505") {
        return { ok: false, erro: MENSAGEM_LOTE_DUPLICADO };
      }
      return { ok: false, erro: error.message };
    }
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");
  return {
    ok: true,
    mensagem: loteId ? "Lote atualizado." : "Lote cadastrado.",
  };
}

export async function excluirLoteProduto(
  produtoId: string,
  loteId: string
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "excluirLoteProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const idProduto = String(produtoId ?? "").trim();
  const idLote = String(loteId ?? "").trim();
  if (!idProduto || !idLote) {
    return { ok: false, erro: "Lote inválido." };
  }

  const produto = await carregarProdutoValidade(
    supabase,
    empresaId,
    idProduto
  );
  if (!produto) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  if (!produto.controlar_validade) {
    return { ok: false, erro: MENSAGEM_CONTROLE_VALIDADE_INATIVO };
  }

  const { data, error } = await supabase
    .from("estoque_lotes")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("produto_id", idProduto)
    .eq("id", idLote)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, erro: error.message };
  }

  if (!data) {
    return { ok: false, erro: "Lote não encontrado nesta empresa." };
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");
  return { ok: true, mensagem: "Lote excluído." };
}

export async function atualizarPublicacaoCatalogo(
  produtoIds: string[],
  publicado: boolean
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirRecursoEmpresa({
      empresaId: String(empresaId),
      recurso: "catalogo",
      origem: "atualizarPublicacaoCatalogo",
    });
    await exigirProduto(
      empresaId,
      "editar",
      "atualizarPublicacaoCatalogo"
    );
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }
  const ids = Array.from(
    new Set(
      produtoIds.filter(
        (id) => typeof id === "string" && id.length > 0
      )
    )
  );

  if (ids.length === 0) {
    return { ok: false, erro: "Selecione pelo menos um produto." };
  }

  if (ids.length > 200) {
    return {
      ok: false,
      erro: "Selecione no máximo 200 produtos por vez.",
    };
  }

  const { error } = await supabase
    .from("produtos")
    .update({ catalogo_publicado: publicado })
    .eq("empresa_id", empresaId)
    .in("id", ids);

  if (error) {
    return { ok: false, erro: error.message };
  }

  revalidatePath("/produtos");

  return {
    ok: true,
    mensagem: publicado
      ? `${ids.length} produto(s) publicados no catálogo.`
      : `${ids.length} produto(s) removidos do catálogo.`,
  };
}

async function contarUsoProduto(
  tabela: string,
  coluna: string,
  produtoId: string,
  empresaId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { count, error } = await supabase
    .from(tabela)
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq(coluna, produtoId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function excluirOuInativarProduto(
  produtoId: string
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(
      empresaId,
      "excluir",
      "excluirOuInativarProduto"
    );
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }
  const id = String(produtoId ?? "").trim();

  if (!id) {
    return { ok: false, erro: "Produto inválido." };
  }

  const { data: produto, error: erroProduto } =
    await supabase
      .from("produtos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();

  if (erroProduto || !produto) {
    return {
      ok: false,
      erro: "Produto não encontrado nesta empresa.",
    };
  }

  let usos = 0;

  try {
    const [vendas, movimentacoes, carteira] =
      await Promise.all([
        contarUsoProduto(
          "vendas_itens",
          "produto_id",
          id,
          empresaId,
          supabase
        ),
        contarUsoProduto(
          "estoque_movimentacoes",
          "produto_id",
          id,
          empresaId,
          supabase
        ),
        contarUsoProduto(
          "carteira_cliente_itens",
          "produto_id",
          id,
          empresaId,
          supabase
        ),
      ]);

    usos = vendas + movimentacoes + carteira;
  } catch {
    usos = 0;
  }

  if (usos > 0) {
    const { error } = await supabase
      .from("produtos")
      .update({ ativo: false })
      .eq("empresa_id", empresaId)
      .eq("id", id);

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidatePath("/produtos");
    revalidatePath("/estoque");
    revalidatePath("/pdv");

    return {
      ok: true,
      mensagem:
        "O produto possui movimentações e foi inativado para preservar o histórico.",
    };
  }

  const { error: deleteError } = await supabase
    .from("produtos")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("id", id);

  if (deleteError) {
    const { error: updateError } = await supabase
      .from("produtos")
      .update({ ativo: false })
      .eq("empresa_id", empresaId)
      .eq("id", id);

    if (updateError) {
      return { ok: false, erro: deleteError.message };
    }

    revalidatePath("/produtos");
    revalidatePath("/estoque");
    revalidatePath("/pdv");

    return {
      ok: true,
      mensagem:
        "O produto possui movimentações e foi inativado para preservar o histórico.",
    };
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");
  revalidatePath("/pdv");

  return {
    ok: true,
    mensagem: "Produto excluído com sucesso.",
  };
}

export async function reativarProduto(
  produtoId: string
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "reativarProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }
  const id = String(produtoId ?? "").trim();

  if (!id) {
    return { ok: false, erro: "Produto inválido." };
  }

  const { data, error } = await supabase
    .from("produtos")
    .update({ ativo: true })
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, erro: error.message };
  }

  if (!data) {
    return {
      ok: false,
      erro: "Produto não encontrado nesta empresa.",
    };
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");
  revalidatePath("/pdv");

  return {
    ok: true,
    mensagem: "Produto reativado com sucesso.",
  };
}

export async function inativarProduto(
  produtoId: string
): Promise<ResultadoProduto> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirProduto(empresaId, "excluir", "inativarProduto");
  } catch (error) {
    return resultadoNegacaoProduto(error);
  }

  const id = String(produtoId ?? "").trim();
  if (!id) {
    return { ok: false, erro: "Produto inválido." };
  }

  const { data: produto, error: erroProduto } = await supabase
    .from("produtos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();

  if (erroProduto || !produto) {
    return {
      ok: false,
      erro: "Produto não encontrado nesta empresa.",
    };
  }

  const { data: estoque } = await supabase
    .from("estoque_atual")
    .select("quantidade")
    .eq("empresa_id", empresaId)
    .eq("produto_id", id)
    .maybeSingle();

  const quantidade = Number(estoque?.quantidade ?? 0);

  const { error } = await supabase
    .from("produtos")
    .update({ ativo: false })
    .eq("empresa_id", empresaId)
    .eq("id", id);

  if (error) {
    return { ok: false, erro: error.message };
  }

  revalidatePath("/produtos");
  revalidatePath("/estoque");
  revalidatePath("/pdv");

  const quantidadeTexto = quantidade.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  return {
    ok: true,
    mensagem:
      quantidade > 0
        ? `Produto inativado. Ele permanece no histórico com ${quantidadeTexto} em estoque e saiu do PDV e do catálogo.`
        : "Produto inativado com sucesso.",
  };
}

// =========================================================
// CADASTRO RÁPIDO - CATEGORIA / MARCA
// =========================================================

type ResultadoRapido = {
  ok: boolean;
  item?: {
    id: string;
    nome: string;
  };
  erro?: string;
};

async function cadastrarRelacionadoRapido(
  tabela: "categorias" | "marcas",
  nomeRecebido: string
): Promise<ResultadoRapido> {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(
      empresaId,
      "criar",
      `cadastrar${tabela === "categorias" ? "Categoria" : "Marca"}Rapida`
    );
  } catch (error) {
    const negacao = resultadoNegacaoProduto(error);
    return { ok: false, erro: negacao.erro };
  }

  const nome = nomeRecebido.trim();

  if (nome.length < 2) {
    return {
      ok: false,
      erro: "Informe pelo menos 2 caracteres.",
    };
  }

  const { data, error } = await supabase
    .from(tabela)
    .insert({
      empresa_id: empresaId,
      nome,
      ativo: true,
    })
    .select("id, nome")
    .single();

  if (!error && data) {
    revalidatePath("/produtos");
    revalidatePath(`/produtos/${tabela}`);

    return {
      ok: true,
      item: data,
    };
  }

  if (error?.code === "23505") {
    const { data: existente } = await supabase
      .from(tabela)
      .select("id, nome, ativo")
      .eq("empresa_id", empresaId)
      .ilike("nome", nome)
      .maybeSingle();

    if (existente) {
      if (!existente.ativo) {
        const { data: reativado, error: erroReativar } =
          await supabase
            .from(tabela)
            .update({ ativo: true })
            .eq("id", existente.id)
            .eq("empresa_id", empresaId)
            .select("id, nome")
            .single();

        if (erroReativar || !reativado) {
          return {
            ok: false,
            erro:
              erroReativar?.message ??
              "Não foi possível reativar o registro.",
          };
        }

        revalidatePath("/produtos");
        revalidatePath(`/produtos/${tabela}`);

        return {
          ok: true,
          item: reativado,
        };
      }

      return {
        ok: true,
        item: {
          id: existente.id,
          nome: existente.nome,
        },
      };
    }
  }

  return {
    ok: false,
    erro:
      error?.message ??
      "Não foi possível cadastrar.",
  };
}

export async function cadastrarCategoriaRapida(
  nome: string
) {
  return cadastrarRelacionadoRapido(
    "categorias",
    nome
  );
}

export async function cadastrarMarcaRapida(
  nome: string
) {
  return cadastrarRelacionadoRapido(
    "marcas",
    nome
  );
}

// =========================================================
// CRUD CATEGORIAS / MARCAS
// =========================================================

async function salvarNovoRelacionado(
  tabela: "categorias" | "marcas",
  caminho: string,
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(
      empresaId,
      "criar",
      `cadastrar${tabela === "categorias" ? "Categoria" : "Marca"}`
    );
  } catch (error) {
    redirecionarNegacaoProduto(error, (mensagem) =>
      redirect(`${caminho}?erro=${encodeURIComponent(mensagem)}`)
    );
  }

  const nome = String(
    formData.get("nome") ?? ""
  ).trim();

  if (nome.length < 2) {
    redirect(
      `${caminho}?erro=${encodeURIComponent(
        "Informe pelo menos 2 caracteres."
      )}`
    );
  }

  const { error } = await supabase
    .from(tabela)
    .insert({
      empresa_id: empresaId,
      nome,
      ativo: true,
    });

  if (error) {
    const mensagem =
      error.code === "23505"
        ? "Já existe um registro com esse nome."
        : error.message;

    redirect(
      `${caminho}?erro=${encodeURIComponent(
        mensagem
      )}`
    );
  }

  revalidatePath(caminho);
  revalidatePath("/produtos");

  redirect(
    `${caminho}?sucesso=${encodeURIComponent(
      "Cadastro realizado com sucesso."
    )}`
  );
}

async function editarRelacionado(
  tabela: "categorias" | "marcas",
  caminho: string,
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(
      empresaId,
      "editar",
      `editar${tabela === "categorias" ? "Categoria" : "Marca"}`
    );
  } catch (error) {
    redirecionarNegacaoProduto(error, (mensagem) =>
      redirect(`${caminho}?erro=${encodeURIComponent(mensagem)}`)
    );
  }

  const id = String(
    formData.get("id") ?? ""
  ).trim();

  const nome = String(
    formData.get("nome") ?? ""
  ).trim();

  const ativo =
    String(formData.get("ativo") ?? "true") ===
    "true";

  if (!id || nome.length < 2) {
    redirect(
      `${caminho}?erro=${encodeURIComponent(
        "Dados inválidos."
      )}`
    );
  }

  const { error } = await supabase
    .from(tabela)
    .update({
      nome,
      ativo,
    })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    const mensagem =
      error.code === "23505"
        ? "Já existe um registro com esse nome."
        : error.message;

    redirect(
      `${caminho}?erro=${encodeURIComponent(
        mensagem
      )}`
    );
  }

  revalidatePath(caminho);
  revalidatePath("/produtos");

  redirect(
    `${caminho}?sucesso=${encodeURIComponent(
      "Alteração realizada com sucesso."
    )}`
  );
}

async function excluirOuDesativarRelacionado(
  tabela: "categorias" | "marcas",
  colunaProduto: "categoria_id" | "marca_id",
  caminho: string,
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(
      empresaId,
      "excluir",
      `excluir${tabela === "categorias" ? "Categoria" : "Marca"}`
    );
  } catch (error) {
    redirecionarNegacaoProduto(error, (mensagem) =>
      redirect(`${caminho}?erro=${encodeURIComponent(mensagem)}`)
    );
  }

  const id = String(
    formData.get("id") ?? ""
  ).trim();

  if (!id) {
    redirect(
      `${caminho}?erro=${encodeURIComponent(
        "Registro inválido."
      )}`
    );
  }

  const { count, error: countError } =
    await supabase
      .from("produtos")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("empresa_id", empresaId)
      .eq(colunaProduto, id);

  if (countError) {
    redirect(
      `${caminho}?erro=${encodeURIComponent(
        countError.message
      )}`
    );
  }

  if ((count ?? 0) > 0) {
    const { error } = await supabase
      .from(tabela)
      .update({ ativo: false })
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (error) {
      redirect(
        `${caminho}?erro=${encodeURIComponent(
          error.message
        )}`
      );
    }

    revalidatePath(caminho);
    revalidatePath("/produtos");

    redirect(
      `${caminho}?sucesso=${encodeURIComponent(
        "Registro em uso por produtos: foi desativado para preservar o histórico."
      )}`
    );
  }

  const { error: deleteError } = await supabase
    .from(tabela)
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (deleteError) {
    // Se o usuário não tiver permissão de DELETE,
    // preservamos o cadastro e o desativamos.
    const { error: updateError } = await supabase
      .from(tabela)
      .update({ ativo: false })
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (updateError) {
      redirect(
        `${caminho}?erro=${encodeURIComponent(
          deleteError.message
        )}`
      );
    }
  }

  revalidatePath(caminho);
  revalidatePath("/produtos");

  redirect(
    `${caminho}?sucesso=${encodeURIComponent(
      "Exclusão realizada com sucesso."
    )}`
  );
}

export async function cadastrarCategoria(
  formData: FormData
) {
  return salvarNovoRelacionado(
    "categorias",
    "/produtos/categorias",
    formData
  );
}

export async function editarCategoria(
  formData: FormData
) {
  return editarRelacionado(
    "categorias",
    "/produtos/categorias",
    formData
  );
}

export async function excluirCategoria(
  formData: FormData
) {
  return excluirOuDesativarRelacionado(
    "categorias",
    "categoria_id",
    "/produtos/categorias",
    formData
  );
}

export async function cadastrarMarca(
  formData: FormData
) {
  return salvarNovoRelacionado(
    "marcas",
    "/produtos/marcas",
    formData
  );
}

export async function editarMarca(
  formData: FormData
) {
  return editarRelacionado(
    "marcas",
    "/produtos/marcas",
    formData
  );
}

export async function excluirMarca(
  formData: FormData
) {
  return excluirOuDesativarRelacionado(
    "marcas",
    "marca_id",
    "/produtos/marcas",
    formData
  );
}

async function montarDadosFiscaisGrupo(
  formData: FormData,
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  empresaId: string
) {
  const campo = (nome: string) => {
    const valor = String(
      formData.get(nome) ?? ""
    ).trim();

    return valor || null;
  };

  const cfopInterno =
    campo("cfop_interno");

  const cfopInterestadual =
    campo("cfop_interestadual");

  const icmsCstCsosn =
    campo("icms_cst_csosn");

  const pisCst = campo("pis_cst");
  const cofinsCst =
    campo("cofins_cst");
  const ipiCst = campo("ipi_cst");
  const ipiAplicavel =
    String(formData.get("ipi_aplicavel") ?? "") ===
    "true";
  const ipiEnquadramento = normalizarCenqInformado(
    campo("ipi_enquadramento")
  );

  const cstIbscbs =
    campo("cst_ibscbs");

  const classificacaoIbscbs =
    campo("classificacao_ibscbs");

  if (
    !existeCodigo(
      CFOPS_INTERNOS,
      cfopInterno
    )
  ) {
    throw new Error(
      "Selecione um CFOP interno válido."
    );
  }

  if (
    !existeCodigo(
      CFOPS_INTERESTADUAIS,
      cfopInterestadual
    )
  ) {
    throw new Error(
      "Selecione um CFOP interestadual válido."
    );
  }

  const { data: fiscalEmpresa } =
    await supabase
      .from("empresas_fiscal")
      .select("codigo_regime_tributario")
      .eq("empresa_id", empresaId)
      .maybeSingle();

  const crt =
    fiscalEmpresa?.codigo_regime_tributario ??
    null;

  const opcoesIcms =
    crt === 1 || crt === 4
      ? CSOSN
      : crt === 2 || crt === 3
        ? CST_ICMS
        : [...CSOSN, ...CST_ICMS];

  if (
    !existeCodigo(
      opcoesIcms,
      icmsCstCsosn
    )
  ) {
    throw new Error(
      "Selecione um CSOSN/CST de ICMS válido para o CRT da empresa."
    );
  }

  if (
    !existeCodigo(
      CST_PIS_COFINS,
      pisCst
    )
  ) {
    throw new Error(
      "Selecione um CST PIS válido."
    );
  }

  if (
    !existeCodigo(
      CST_PIS_COFINS,
      cofinsCst
    )
  ) {
    throw new Error(
      "Selecione um CST COFINS válido."
    );
  }

  const erroIpi = validarConfiguracaoIpiGrupo({
    ipiAplicavel,
    ipiCst,
    ipiAliquota: String(formData.get("ipi_aliquota") ?? ""),
    ipiEnquadramento,
  });

  if (erroIpi) {
    throw new Error(erroIpi);
  }

  if (!cstIbscbs) {
    throw new Error(
      "Selecione o CST IBS/CBS."
    );
  }

  if (!classificacaoIbscbs) {
    throw new Error(
      "Selecione o cClassTrib."
    );
  }

  const {
    data: cstIbscbsCatalogo,
    error: cstIbscbsError,
  } = await supabase
    .from("fiscal_cst_ibscbs_catalogo")
    .select(
      "codigo, permite_nfe, permite_nfce"
    )
    .eq("codigo", cstIbscbs)
    .eq("ativo", true)
    .maybeSingle();

  if (
    cstIbscbsError ||
    !cstIbscbsCatalogo ||
    (
      !cstIbscbsCatalogo.permite_nfe &&
      !cstIbscbsCatalogo.permite_nfce
    )
  ) {
    throw new Error(
      "CST IBS/CBS inválido para NF-e/NFC-e."
    );
  }

  const {
    data: classificacaoCatalogo,
    error: classificacaoError,
  } = await supabase
    .from("fiscal_cclasstrib_catalogo")
    .select(`
      codigo,
      cst_codigo,
      percentual_reducao_ibs,
      percentual_reducao_cbs,
      permite_nfe,
      permite_nfce
    `)
    .eq(
      "codigo",
      classificacaoIbscbs
    )
    .eq("ativo", true)
    .maybeSingle();

  if (
    classificacaoError ||
    !classificacaoCatalogo
  ) {
    throw new Error(
      "cClassTrib inválido."
    );
  }

  if (
    classificacaoCatalogo.cst_codigo !==
    cstIbscbs
  ) {
    throw new Error(
      "O cClassTrib selecionado não pertence ao CST IBS/CBS informado."
    );
  }

  if (
    !classificacaoCatalogo.permite_nfe &&
    !classificacaoCatalogo.permite_nfce
  ) {
    throw new Error(
      "O cClassTrib selecionado não é aplicável a NF-e/NFC-e."
    );
  }

  const reducaoIbs = Number(
    classificacaoCatalogo
      .percentual_reducao_ibs ?? 0
  );

  const reducaoCbs = Number(
    classificacaoCatalogo
      .percentual_reducao_cbs ?? 0
  );

  return {
    cfop_interno: cfopInterno,
    cfop_interestadual:
      cfopInterestadual,
    icms_cst_csosn:
      icmsCstCsosn,
    icms_aliquota: numeroDecimal(
      formData.get("icms_aliquota")
    ),
    pis_cst: pisCst,
    pis_aliquota: numeroDecimal(
      formData.get("pis_aliquota")
    ),
    cofins_cst: cofinsCst,
    cofins_aliquota: numeroDecimal(
      formData.get("cofins_aliquota")
    ),
    ipi_aplicavel: ipiAplicavel,
    ipi_cst: ipiCst,
    ipi_aliquota: numeroDecimal(
      formData.get("ipi_aliquota")
    ),
    ipi_enquadramento:
      ipiEnquadramento || null,

    cst_ibscbs: cstIbscbs,
    classificacao_ibscbs:
      classificacaoIbscbs,

    aliquota_ibs_uf: numeroDecimal(
      formData.get("aliquota_ibs_uf")
    ),

    aliquota_ibs_municipio:
      numeroDecimal(
        formData.get(
          "aliquota_ibs_municipio"
        )
      ),

    aliquota_cbs: numeroDecimal(
      formData.get("aliquota_cbs")
    ),

    percentual_reducao_ibs_uf:
      reducaoIbs,

    percentual_reducao_ibs_municipio:
      reducaoIbs,

    percentual_reducao_cbs:
      reducaoCbs,

    ibscbs_manual: false,
  };
}

function erroGrupoFiscal(
  mensagem: string
): never {
  redirect(
    "/produtos/grupos-fiscais?erro=" +
      encodeURIComponent(mensagem)
  );
}

// =========================================================
// CRUD GRUPOS FISCAIS
// =========================================================

export async function cadastrarGrupoFiscal(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(empresaId, "criar", "cadastrarGrupoFiscal");
  } catch (error) {
    redirecionarNegacaoProduto(error, erroGrupoFiscal);
  }

  const nome = String(
    formData.get("nome") ?? ""
  ).trim();

  const descricao = String(
    formData.get("descricao") ?? ""
  ).trim();

  if (nome.length < 2) {
    erroGrupoFiscal(
      "Informe o nome do grupo fiscal."
    );
  }

  let dadosFiscais;

  try {
    dadosFiscais =
      await montarDadosFiscaisGrupo(
        formData,
        supabase,
        empresaId
      );
  } catch (error) {
    erroGrupoFiscal(
      error instanceof Error
        ? error.message
        : "Configuração fiscal inválida."
    );
  }

  const { error } = await supabase
    .from("grupos_fiscais")
    .insert({
      empresa_id: empresaId,
      nome,
      descricao: descricao || null,
      ...dadosFiscais,
      ativo: true,
    });

  if (error) {
    const mensagem =
      error.code === "23505"
        ? "Já existe um grupo fiscal com esse nome."
        : error.message;

    redirect(
      "/produtos/grupos-fiscais?erro=" +
        encodeURIComponent(mensagem)
    );
  }

  revalidatePath("/produtos");
  revalidatePath("/produtos/grupos-fiscais");

  redirect(
    "/produtos/grupos-fiscais?sucesso=" +
      encodeURIComponent(
        "Cadastro realizado com sucesso."
      )
  );
}

export async function editarGrupoFiscal(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "editarGrupoFiscal");
  } catch (error) {
    redirecionarNegacaoProduto(error, erroGrupoFiscal);
  }

  const id = String(
    formData.get("id") ?? ""
  ).trim();

  const nome = String(
    formData.get("nome") ?? ""
  ).trim();

  const descricao = String(
    formData.get("descricao") ?? ""
  ).trim();

  const ativo =
    String(formData.get("ativo") ?? "true") ===
    "true";

  if (!id || nome.length < 2) {
    erroGrupoFiscal(
      "Dados do grupo fiscal inválidos."
    );
  }

  let dadosFiscais;

  try {
    dadosFiscais =
      await montarDadosFiscaisGrupo(
        formData,
        supabase,
        empresaId
      );
  } catch (error) {
    erroGrupoFiscal(
      error instanceof Error
        ? error.message
        : "Configuração fiscal inválida."
    );
  }

  const { error } = await supabase
    .from("grupos_fiscais")
    .update({
      nome,
      descricao: descricao || null,
      ...dadosFiscais,
      ativo,
    })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    const mensagem =
      error.code === "23505"
        ? "Já existe um grupo fiscal com esse nome."
        : error.message;

    redirect(
      "/produtos/grupos-fiscais?erro=" +
        encodeURIComponent(mensagem)
    );
  }

  revalidatePath("/produtos");
  revalidatePath("/produtos/grupos-fiscais");

  redirect(
    "/produtos/grupos-fiscais?sucesso=" +
      encodeURIComponent(
        "Alteração realizada com sucesso."
      )
  );
}

export async function excluirGrupoFiscal(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(empresaId, "excluir", "excluirGrupoFiscal");
  } catch (error) {
    redirecionarNegacaoProduto(error, erroGrupoFiscal);
  }

  const id = String(
    formData.get("id") ?? ""
  ).trim();

  if (!id) {
    redirect(
      "/produtos/grupos-fiscais?erro=" +
        encodeURIComponent(
          "Grupo fiscal inválido."
        )
    );
  }

  const { count, error: countError } =
    await supabase
      .from("produtos")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("empresa_id", empresaId)
      .eq("grupo_fiscal_id", id);

  if (countError) {
    redirect(
      "/produtos/grupos-fiscais?erro=" +
        encodeURIComponent(
          countError.message
        )
    );
  }

  if ((count ?? 0) > 0) {
    const { error } = await supabase
      .from("grupos_fiscais")
      .update({ ativo: false })
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (error) {
      redirect(
        "/produtos/grupos-fiscais?erro=" +
          encodeURIComponent(error.message)
      );
    }

    revalidatePath("/produtos");
    revalidatePath(
      "/produtos/grupos-fiscais"
    );

    redirect(
      "/produtos/grupos-fiscais?sucesso=" +
        encodeURIComponent(
          "Grupo em uso por produtos: foi desativado para preservar o histórico."
        )
    );
  }

  const { error: deleteError } = await supabase
    .from("grupos_fiscais")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (deleteError) {
    const { error: updateError } =
      await supabase
        .from("grupos_fiscais")
        .update({ ativo: false })
        .eq("id", id)
        .eq("empresa_id", empresaId);

    if (updateError) {
      redirect(
        "/produtos/grupos-fiscais?erro=" +
          encodeURIComponent(
            deleteError.message
          )
      );
    }
  }

  revalidatePath("/produtos");
  revalidatePath("/produtos/grupos-fiscais");

  redirect(
    "/produtos/grupos-fiscais?sucesso=" +
      encodeURIComponent(
        "Exclusão realizada com sucesso."
      )
  );
}

// =========================================================
// SALVAR FISCAL DO PRODUTO
// =========================================================

export async function salvarFiscalProduto(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContexto();

  try {
    await exigirProduto(empresaId, "editar", "salvarFiscalProduto");
  } catch (error) {
    redirecionarNegacaoProduto(error, voltarErro);
  }

  const produtoId = String(
    formData.get("produto_id") ?? ""
  ).trim();

  const grupoFiscalId = String(
    formData.get("grupo_fiscal_id") ?? ""
  ).trim();

  const dadosFiscais = lerDadosFiscaisProduto(formData);

  if (!produtoId) {
    voltarErro("Produto inválido.");
  }

  const erroFiscal = validarDadosFiscaisProduto(dadosFiscais);

  if (erroFiscal) {
    voltarErro(erroFiscal);
  }

  const { data: produto } = await supabase
    .from("produtos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", produtoId)
    .maybeSingle();

  if (!produto) {
    voltarErro("Produto não encontrado.");
  }

  const fiscal = await persistirDadosFiscaisProduto({
    supabase,
    empresaId,
    produtoId,
    dadosFiscais,
    grupoFiscalId: grupoFiscalId || null,
  });

  if (!fiscal.ok) {
    voltarErro(fiscal.erro);
  }

  revalidatePath("/produtos");

  redirect(
    "/produtos?sucesso=" +
      encodeURIComponent(
        "Configuração fiscal salva com sucesso."
      )
  );
}
