"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

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

function texto(
  valor: FormDataEntryValue | null
) {
  return String(valor ?? "").trim();
}

function somenteDigitos(
  valor: FormDataEntryValue | string | null
) {
  return String(valor ?? "").replace(/\D/g, "");
}

function numeroDecimal(
  valor: FormDataEntryValue | null
) {
  let valorTexto = texto(valor);

  if (!valorTexto) return 0;

  if (
    valorTexto.includes(".") &&
    valorTexto.includes(",")
  ) {
    valorTexto = valorTexto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (valorTexto.includes(",")) {
    valorTexto =
      valorTexto.replace(",", ".");
  }

  const numero = Number(valorTexto);

  return Number.isFinite(numero) ? numero : 0;
}

function inteiroOuNull(
  valor: FormDataEntryValue | null
) {
  const valorTexto = texto(valor);

  if (!valorTexto) return null;

  const numero = Number(valorTexto);

  if (!Number.isInteger(numero)) {
    return null;
  }

  return numero;
}

function checkbox(
  formData: FormData,
  nome: string
) {
  return formData.get(nome) === "on";
}

function voltarErro(
  mensagem: string,
  editarId?: string,
  novo = false
): never {
  const params = new URLSearchParams({
    erro: mensagem,
  });

  if (editarId) {
    params.set("editar", editarId);
  } else if (novo) {
    params.set("novo", "1");
  }

  redirect(`/clientes?${params.toString()}`);
}

function documentoValido(
  tipoPessoa: string,
  documento: string
) {
  if (!documento) return true;

  if (tipoPessoa === "F") {
    return documento.length === 11;
  }

  if (tipoPessoa === "J") {
    return documento.length === 14;
  }

  return false;
}

function lerClienteForm(
  formData: FormData
) {
  const tipoPessoa =
    texto(formData.get("tipo_pessoa"))
      .toUpperCase() || "F";

  const documento = somenteDigitos(
    formData.get("cpf_cnpj")
  );

  const uf =
    texto(formData.get("uf"))
      .toUpperCase();

  const limiteCredito = numeroDecimal(
    formData.get("limite_credito")
  );

  const diaVencimento = inteiroOuNull(
    formData.get("dia_vencimento")
  );

  const indicadorIe = texto(
    formData.get("indicador_ie_destinatario")
  );
  const indicadorIeDestinatario =
    indicadorIe === "1" || indicadorIe === "2" || indicadorIe === "9"
      ? indicadorIe
      : checkbox(formData, "contribuinte_icms")
        ? "1"
        : "9";

  return {
    nome:
      texto(formData.get("nome")),

    nome_fantasia:
      texto(
        formData.get("nome_fantasia")
      ) || null,

    tipo_pessoa:
      tipoPessoa,

    cpf_cnpj:
      documento || null,

    inscricao_estadual:
      texto(
        formData.get("inscricao_estadual")
      ) || null,

    indicador_ie_destinatario: indicadorIeDestinatario,

    contribuinte_icms: indicadorIeDestinatario === "1",

    consumidor_final:
      checkbox(
        formData,
        "consumidor_final"
      ),

    telefone:
      somenteDigitos(
        formData.get("telefone")
      ) || null,

    email:
      texto(formData.get("email"))
        .toLowerCase() || null,

    cep:
      somenteDigitos(
        formData.get("cep")
      ) || null,

    logradouro:
      texto(
        formData.get("logradouro")
      ) || null,

    numero:
      texto(
        formData.get("numero")
      ) || null,

    complemento:
      texto(
        formData.get("complemento")
      ) || null,

    bairro:
      texto(
        formData.get("bairro")
      ) || null,

    municipio:
      texto(
        formData.get("municipio")
      ) || null,

    codigo_municipio_ibge:
      somenteDigitos(
        formData.get(
          "codigo_municipio_ibge"
        )
      ) || null,

    uf:
      uf || null,

    limite_credito:
      limiteCredito,

    bloqueado:
      checkbox(
        formData,
        "bloqueado"
      ),

    dia_vencimento:
      diaVencimento,

    observacao:
      texto(
        formData.get("observacao")
      ) || null,

    ativo:
      formData.has("ativo")
        ? checkbox(formData, "ativo")
        : true,
  };
}

function validarCliente(
  dados: ReturnType<
    typeof lerClienteForm
  >,
  editarId?: string
) {
  const novo = !editarId;
  if (dados.nome.length < 2) {
    voltarErro(
      "Informe o nome do cliente.",
      editarId,
      novo
    );
  }

  if (
    dados.tipo_pessoa !== "F" &&
    dados.tipo_pessoa !== "J"
  ) {
    voltarErro(
      "Tipo de pessoa inválido.",
      editarId,
      novo
    );
  }

  if (
    !documentoValido(
      dados.tipo_pessoa,
      dados.cpf_cnpj ?? ""
    )
  ) {
    voltarErro(
      dados.tipo_pessoa === "F"
        ? "CPF deve conter 11 dígitos."
        : "CNPJ deve conter 14 dígitos.",
      editarId,
      novo
    );
  }

  if (
    dados.indicador_ie_destinatario === "1" &&
    !dados.inscricao_estadual
  ) {
    voltarErro(
      "Contribuinte ICMS precisa de Inscrição Estadual.",
      editarId,
      novo
    );
  }

  if (
    dados.email &&
    !dados.email.includes("@")
  ) {
    voltarErro(
      "Informe um e-mail válido.",
      editarId,
      novo
    );
  }

  if (
    dados.uf &&
    !/^[A-Z]{2}$/.test(dados.uf)
  ) {
    voltarErro(
      "UF deve conter 2 letras.",
      editarId,
      novo
    );
  }

  if (
    dados.cep &&
    dados.cep.length !== 8
  ) {
    voltarErro(
      "CEP deve conter 8 dígitos.",
      editarId,
      novo
    );
  }

  if (
    dados.codigo_municipio_ibge &&
    dados.codigo_municipio_ibge.length !== 7
  ) {
    voltarErro(
      "Código IBGE do município deve conter 7 dígitos.",
      editarId,
      novo
    );
  }

  if (dados.limite_credito < 0) {
    voltarErro(
      "Limite de crédito não pode ser negativo.",
      editarId,
      novo
    );
  }

  if (
    dados.dia_vencimento !== null &&
    (
      dados.dia_vencimento < 1 ||
      dados.dia_vencimento > 31
    )
  ) {
    voltarErro(
      "Dia de vencimento deve ficar entre 1 e 31.",
      editarId,
      novo
    );
  }
}

// =========================================================
// CADASTRAR CLIENTE
// =========================================================

export async function cadastrarCliente(
  formData: FormData
) {
  try {
    await exigirPermissao({ modulo: "clientes", acao: "criar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      if (error.status === 401) redirect("/login");
      voltarErro(error.message);
    }
    throw error;
  }

  const { supabase, empresaId } =
    await getContexto();

  const dados =
    lerClienteForm(formData);

  validarCliente(dados);

  const { error } = await supabase
    .from("clientes")
    .insert({
      empresa_id: empresaId,
      ...dados,
      saldo_devedor: 0,
    });

  if (error) {
    console.error(
      "ERRO AO CADASTRAR CLIENTE:",
      error
    );

    if (error.code === "23505") {
      voltarErro(
        "Já existe um cliente com esse CPF/CNPJ.",
        undefined,
        true
      );
    }

    voltarErro(error.message, undefined, true);
  }

  revalidatePath("/clientes");

  redirect(
    "/clientes?sucesso=" +
      encodeURIComponent(
        "Cliente cadastrado com sucesso."
      )
  );
}

// =========================================================
// EDITAR CLIENTE
// =========================================================

export async function editarCliente(
  formData: FormData
) {
  try {
    await exigirPermissao({ modulo: "clientes", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      if (error.status === 401) redirect("/login");
      voltarErro(error.message);
    }
    throw error;
  }

  const { supabase, empresaId } =
    await getContexto();

  const id =
    texto(formData.get("id"));

  if (!id) {
    voltarErro(
      "Cliente inválido."
    );
  }

  const dados =
    lerClienteForm(formData);

  validarCliente(dados, id);

  // saldo_devedor não é editado pelo cadastro.
  // Futuramente será mantido exclusivamente pela Carteira.
  const { error } = await supabase
    .from("clientes")
    .update(dados)
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    console.error(
      "ERRO AO EDITAR CLIENTE:",
      error
    );

    if (error.code === "23505") {
      voltarErro(
        "Já existe outro cliente com esse CPF/CNPJ.",
        id
      );
    }

    voltarErro(error.message, id);
  }

  revalidatePath("/clientes");

  redirect(
    "/clientes?sucesso=" +
      encodeURIComponent(
        "Cliente alterado com sucesso."
      )
  );
}

// =========================================================
// EXCLUIR / DESATIVAR CLIENTE
// =========================================================

export async function excluirCliente(
  formData: FormData
) {
  try {
    await exigirPermissao({ modulo: "clientes", acao: "excluir" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      if (error.status === 401) redirect("/login");
      voltarErro(error.message);
    }
    throw error;
  }

  const {
    supabase,
    empresaId,
  } = await getContexto();

  const id =
    texto(formData.get("id"));

  if (!id) {
    voltarErro(
      "Cliente inválido."
    );
  }

  const { error } = await supabase
    .from("clientes")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (!error) {
    revalidatePath("/clientes");

    redirect(
      "/clientes?sucesso=" +
        encodeURIComponent(
          "Cliente excluído com sucesso."
        )
    );
  }

  // Quando já houver vendas/carteira vinculadas,
  // preservamos o histórico e apenas desativamos.
  if (error.code === "23503") {
    const { error: erroDesativar } =
      await supabase
        .from("clientes")
        .update({
          ativo: false,
        })
        .eq("id", id)
        .eq("empresa_id", empresaId);

    if (erroDesativar) {
      voltarErro(
        erroDesativar.message
      );
    }

    revalidatePath("/clientes");

    redirect(
      "/clientes?sucesso=" +
        encodeURIComponent(
          "O cliente possui movimentações e foi desativado para preservar o histórico."
        )
    );
  }

  voltarErro(error.message);
}