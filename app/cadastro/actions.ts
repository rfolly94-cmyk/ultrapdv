"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { createClient } from "@/lib/supabase/server";
import { exigirPermissaoOuRedirecionar } from "@/lib/permissoes/exigir-permissao";

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

function voltarErro(mensagem: string): never {
  redirect(
    "/produtos?erro=" +
      encodeURIComponent(mensagem)
  );
}

function numeroDecimal(
  valor: FormDataEntryValue | null
) {
  const texto = String(valor ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : 0;
}

async function validarRelacionado(
  tabela: "categorias" | "marcas",
  id: string,
  empresaId: string,
  supabase: Awaited<
    ReturnType<typeof createClient>
  >
) {
  const { data, error } = await supabase
    .from(tabela)
    .select("id")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .maybeSingle();

  return !error && !!data;
}

// =========================================================
// CADASTRAR PRODUTO
// =========================================================

export async function cadastrarProduto(
  formData: FormData
) {
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "criar" });
  const { supabase, empresaId } =
    await getContexto();

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

  const unidade = String(
    formData.get("unidade_medida") ?? "UN"
  )
    .trim()
    .toUpperCase();

  const precoCusto = numeroDecimal(
    formData.get("preco_custo")
  );

  const precoVenda = numeroDecimal(
    formData.get("preco_venda")
  );

  if (!codigo) {
    voltarErro("Informe o código do produto.");
  }

  if (nome.length < 2) {
    voltarErro("Informe o nome do produto.");
  }

  if (!categoriaId) {
    voltarErro("Selecione uma categoria.");
  }

  if (!marcaId) {
    voltarErro("Selecione uma marca.");
  }

  if (!unidade) {
    voltarErro("Informe a unidade de medida.");
  }

  if (precoCusto < 0 || precoVenda < 0) {
    voltarErro(
      "Os preços não podem ser negativos."
    );
  }

  const [categoriaValida, marcaValida] =
    await Promise.all([
      validarRelacionado(
        "categorias",
        categoriaId,
        empresaId,
        supabase
      ),
      validarRelacionado(
        "marcas",
        marcaId,
        empresaId,
        supabase
      ),
    ]);

  if (!categoriaValida) {
    voltarErro(
      "Categoria inválida ou inativa."
    );
  }

  if (!marcaValida) {
    voltarErro("Marca inválida ou inativa.");
  }

  const { error } = await supabase
    .from("produtos")
    .insert({
      empresa_id: empresaId,
      codigo,
      codigo_barras: codigoBarras || null,
      nome,
      descricao: descricao || null,
      categoria_id: categoriaId,
      marca_id: marcaId,
      unidade_medida: unidade,
      tipo_item: "00",
      preco_custo: precoCusto,
      preco_venda: precoVenda,
      ativo: true,
    });

  if (error) {
    console.error(
      "ERRO AO CADASTRAR PRODUTO:",
      error
    );

    if (error.code === "23505") {
      voltarErro(
        "Já existe um produto com esse código."
      );
    }

    voltarErro(error.message);
  }

  revalidatePath("/produtos");

  redirect(
    "/produtos?sucesso=" +
      encodeURIComponent(
        "Produto cadastrado com sucesso."
      )
  );
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
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "criar" });
  const { supabase, empresaId } =
    await getContexto();

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
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "criar" });
  const { supabase, empresaId } =
    await getContexto();

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
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "editar" });
  const { supabase, empresaId } =
    await getContexto();

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
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "excluir" });
  const { supabase, empresaId } =
    await getContexto();

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

// =========================================================
// SALVAR FISCAL DO PRODUTO
// =========================================================

export async function salvarFiscalProduto(
  formData: FormData
) {
  await exigirPermissaoOuRedirecionar({ modulo: "produtos", acao: "editar" });
  const { supabase, empresaId } =
    await getContexto();

  const produtoId = String(
    formData.get("produto_id") ?? ""
  ).trim();

  const apenasNumeros = (nome: string) =>
    String(formData.get(nome) ?? "").replace(
      /\D/g,
      ""
    );

  const campo = (nome: string) => {
    const valor = String(
      formData.get(nome) ?? ""
    ).trim();

    return valor || null;
  };

  const ncm = apenasNumeros("ncm");
  const cest = apenasNumeros("cest");
  const cfopInterno =
    apenasNumeros("cfop_interno");
  const cfopInterestadual =
    apenasNumeros("cfop_interestadual");

  if (!produtoId) {
    voltarErro("Produto inválido.");
  }

  if (ncm.length !== 8) {
    voltarErro(
      "O NCM deve possuir exatamente 8 dígitos."
    );
  }

  if (cest && cest.length !== 7) {
    voltarErro(
      "O CEST deve possuir exatamente 7 dígitos."
    );
  }

  if (cfopInterno.length !== 4) {
    voltarErro(
      "O CFOP interno deve possuir 4 dígitos."
    );
  }

  if (
    cfopInterestadual &&
    cfopInterestadual.length !== 4
  ) {
    voltarErro(
      "O CFOP interestadual deve possuir 4 dígitos."
    );
  }

  const csosn = campo("icms_cst_csosn");
  const pisCst = campo("pis_cst");
  const cofinsCst = campo("cofins_cst");

  if (!csosn) {
    voltarErro(
      "Informe o CSOSN/CST do ICMS."
    );
  }

  if (!pisCst) {
    voltarErro(
      "Informe o CST do PIS."
    );
  }

  if (!cofinsCst) {
    voltarErro(
      "Informe o CST do COFINS."
    );
  }

  const { data, error } = await supabase
    .from("produtos_fiscal")
    .update({
      ncm,
      cest: cest || null,
      origem_produto:
        campo("origem_produto") ?? "0",
      cfop_interno: cfopInterno,
      cfop_interestadual:
        cfopInterestadual || null,
      icms_cst_csosn: csosn,
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
      cst_ibscbs: campo("cst_ibscbs"),
      classificacao_ibscbs: campo(
        "classificacao_ibscbs"
      ),
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
      fiscal_configurado: true,
    })
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(
      "ERRO AO SALVAR FISCAL DO PRODUTO:",
      error
    );

    voltarErro(error.message);
  }

  if (!data) {
    voltarErro(
      "Configuração fiscal do produto não encontrada."
    );
  }

  revalidatePath("/produtos");

  redirect(
    "/produtos?sucesso=" +
      encodeURIComponent(
        "Configuração fiscal salva com sucesso."
      )
  );
}
