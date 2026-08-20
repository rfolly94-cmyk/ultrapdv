"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

async function getEmpresaPrincipal() {
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo, error } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !vinculo) {
    redirect("/onboarding");
  }

  return {
    supabase,
    empresaId: vinculo.empresa_id,
    perfil: vinculo.perfil,
  };
}

function redirecionarErro(mensagem: string): never {
  redirect(
    "/configuracoes/fiscal?erro=" +
      encodeURIComponent(mensagem)
  );
}

// =========================================================
// INICIALIZAR FISCAL
// =========================================================

export async function inicializarFiscal() {
  const { supabase, empresaId, perfil } =
    await getEmpresaPrincipal();

  if (perfil !== "administrador") {
    redirecionarErro(
      "Somente administradores podem configurar o fiscal."
    );
  }

  const { error } = await supabase.rpc(
    "criar_configuracao_fiscal_inicial",
    {
      p_empresa_id: empresaId,
    }
  );

  if (error) {
    console.error("ERRO INICIALIZAR FISCAL:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });

    redirecionarErro(error.message);
  }

  revalidatePath("/configuracoes/fiscal");

  redirect("/configuracoes/fiscal");
}

// =========================================================
// SALVAR FISCAL
// =========================================================

export async function salvarFiscal(formData: FormData) {
  const { supabase, empresaId, perfil } =
    await getEmpresaPrincipal();

  if (perfil !== "administrador") {
    redirecionarErro(
      "Somente administradores podem alterar a configuração fiscal."
    );
  }

  const campo = (nome: string) => {
    const valor = String(
      formData.get(nome) ?? ""
    ).trim();

    return valor || null;
  };

  const apenasNumeros = (
    valor: FormDataEntryValue | null
  ) => String(valor ?? "").replace(/\D/g, "");

  // -------------------------------------------------------
  // NORMALIZAÇÃO
  // -------------------------------------------------------

  const cep =
    apenasNumeros(formData.get("cep"));

  const codigoIbge =
    apenasNumeros(
      formData.get("codigo_municipio_ibge")
    );

  const telefone =
    apenasNumeros(formData.get("telefone"));

  const uf =
    campo("uf")?.toUpperCase() ?? null;

  const crtRaw =
    campo("codigo_regime_tributario");

  const ambienteRaw =
    campo("ambiente") ?? "2";

  const presencaRaw =
    campo("indicador_presenca_padrao") ?? "1";

  const intermediadorRaw =
    campo("indicativo_intermediador_padrao") ?? "0";

  // -------------------------------------------------------
  // VALIDAÇÕES
  // -------------------------------------------------------

  if (cep && cep.length !== 8) {
    redirecionarErro(
      "O CEP deve possuir exatamente 8 dígitos."
    );
  }

  if (codigoIbge && codigoIbge.length !== 7) {
    redirecionarErro(
      "O código IBGE do município deve possuir exatamente 7 dígitos."
    );
  }

  if (uf && uf.length !== 2) {
    redirecionarErro(
      "A UF deve possuir exatamente 2 caracteres."
    );
  }

  const crt =
    crtRaw ? Number(crtRaw) : null;

  if (
    crt !== null &&
    ![1, 2, 3].includes(crt)
  ) {
    redirecionarErro(
      "Regime tributário inválido."
    );
  }

  const ambiente =
    Number(ambienteRaw);

  if (![1, 2].includes(ambiente)) {
    redirecionarErro(
      "Ambiente fiscal inválido."
    );
  }

  const indicadorPresenca =
    Number(presencaRaw);

  if (
    ![0, 1, 2, 3, 4, 5, 9].includes(
      indicadorPresenca
    )
  ) {
    redirecionarErro(
      "Indicador de presença inválido."
    );
  }

  const indicativoIntermediador =
    Number(intermediadorRaw);

  if (
    ![0, 1].includes(
      indicativoIntermediador
    )
  ) {
    redirecionarErro(
      "Indicativo de intermediador inválido."
    );
  }

  // -------------------------------------------------------
  // DADOS
  // -------------------------------------------------------

  const dados = {
    inscricao_estadual:
      campo("inscricao_estadual"),

    inscricao_municipal:
      campo("inscricao_municipal"),

    codigo_regime_tributario:
      crt,

    telefone:
      telefone || null,

    email:
      campo("email"),

    logradouro:
      campo("logradouro"),

    numero:
      campo("numero"),

    complemento:
      campo("complemento"),

    bairro:
      campo("bairro"),

    cep:
      cep || null,

    municipio:
      campo("municipio"),

    codigo_municipio_ibge:
      codigoIbge || null,

    uf,

    tipo_atividade:
      campo("tipo_atividade"),

    natureza_operacao_padrao:
      campo("natureza_operacao_padrao") ??
      "Venda",

    indicador_presenca_padrao:
      indicadorPresenca,

    indicativo_intermediador_padrao:
      indicativoIntermediador,

    informacao_complementar_padrao:
      campo(
        "informacao_complementar_padrao"
      ),

    ambiente,
  };

  // -------------------------------------------------------
  // BANCO
  // -------------------------------------------------------

  const { data, error } = await supabase
    .from("empresas_fiscal")
    .update(dados)
    .eq("empresa_id", empresaId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(
      "ERRO AO SALVAR CONFIGURAÇÃO FISCAL:",
      {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      }
    );

    redirecionarErro(error.message);
  }

  if (!data) {
    redirecionarErro(
      "Configuração fiscal não encontrada."
    );
  }

  revalidatePath("/configuracoes/fiscal");
  revalidatePath(
    "/configuracoes/fiscal/prontidao"
  );

  redirect(
    "/configuracoes/fiscal?sucesso=" +
      encodeURIComponent(
        "Configuração fiscal salva com sucesso."
      )
  );
}