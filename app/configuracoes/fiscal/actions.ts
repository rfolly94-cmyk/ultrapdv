"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  montarUpdateFusoHorarioDaEmpresaAtiva,
} from "@/lib/fiscal/fuso-horario-empresa";
import { validarResponsavelTecnicoCadastro } from "@/lib/fiscal/nfe55/responsavel-tecnico";

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
    .eq("usuario_id", String(claimsData.claims.sub))
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
  try {
    await exigirPermissao({ modulo: "fiscal", acao: "configurar_fiscal" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      redirecionarErro(error.message);
    }
    throw error;
  }

  const { supabase, empresaId } =
    await getEmpresaPrincipal();

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
  try {
    await exigirPermissao({ modulo: "fiscal", acao: "configurar_fiscal" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      redirecionarErro(error.message);
    }
    throw error;
  }

  const { supabase, empresaId } =
    await getEmpresaPrincipal();

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

  const perfilIpi = campo("perfil_ipi");

  if (
    perfilIpi &&
    ![
      "NAO_CONTRIBUINTE",
      "INDUSTRIAL",
      "EQUIPARADO_INDUSTRIAL",
    ].includes(perfilIpi)
  ) {
    redirecionarErro(
      "Perfil perante o IPI inválido."
    );
  }

  const rtCnpj = apenasNumeros(formData.get("responsavel_tecnico_cnpj"));
  const rtContato = campo("responsavel_tecnico_contato");
  const rtEmail = campo("responsavel_tecnico_email");
  const rtFone = apenasNumeros(formData.get("responsavel_tecnico_fone"));
  const rtIdCsrt = apenasNumeros(formData.get("responsavel_tecnico_id_csrt"));
  const rtCsrt = String(formData.get("responsavel_tecnico_csrt") ?? "").trim();

  const erroResponsavel = validarResponsavelTecnicoCadastro({
    cnpj: rtCnpj,
    contato: rtContato,
    email: rtEmail,
    fone: rtFone,
    idCSRT: rtIdCsrt,
  });
  if (erroResponsavel) {
    redirecionarErro(erroResponsavel);
  }

  let fusoHorario: string | null;

  try {
    fusoHorario = montarUpdateFusoHorarioDaEmpresaAtiva({
      empresaIdAtiva: empresaId,
      empresaIdSolicitada: formData.get("empresa_id"),
      fusoHorario: formData.get("fuso_horario"),
    }).fuso_horario;
  } catch (erroFuso) {
    redirecionarErro(
      erroFuso instanceof Error
        ? erroFuso.message
        : "Fuso horário fiscal inválido."
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

    perfil_ipi:
      campo("perfil_ipi"),

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

    fuso_horario: fusoHorario,

    ambiente,

    responsavel_tecnico_cnpj: rtCnpj || null,
    responsavel_tecnico_contato: rtContato,
    responsavel_tecnico_email: rtEmail,
    responsavel_tecnico_fone: rtFone || null,
    responsavel_tecnico_id_csrt: rtIdCsrt || null,
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

  if (rtCsrt) {
    const { error: csrtError } = await supabase.rpc("salvar_csrt_fiscal", {
      p_empresa_id: empresaId,
      p_valor: rtCsrt,
    });
    if (csrtError) {
      console.error("Erro ao armazenar CSRT:", {
        message: csrtError.message,
        code: csrtError.code,
      });
      redirecionarErro("Não foi possível armazenar o CSRT no cofre fiscal.");
    }
    const { error: flagError } = await supabase
      .from("empresas_fiscal")
      .update({ responsavel_tecnico_csrt_configurado: true })
      .eq("empresa_id", empresaId);
    if (flagError) {
      redirecionarErro(
        "CSRT salvo no cofre, mas não foi possível atualizar o status."
      );
    }
  }

  const emitirNfceAutomaticoPdv =
    String(formData.get("emitir_nfce_automatico_pdv") ?? "") === "1";
  const { data: nfceAtualizado, error: nfceAutoError } = await supabase
    .from("fiscal_nfce_config")
    .update({ emitir_nfce_automatico_pdv: emitirNfceAutomaticoPdv })
    .eq("empresa_id", empresaId)
    .select("empresa_id")
    .maybeSingle();
  if (nfceAutoError) {
    redirecionarErro(
      "Não foi possível salvar a emissão automática de NFC-e no PDV."
    );
  }
  if (!nfceAtualizado) {
    const { error: nfceInsertError } = await supabase
      .from("fiscal_nfce_config")
      .insert({
        empresa_id: empresaId,
        emitir_nfce_automatico_pdv: emitirNfceAutomaticoPdv,
      });
    if (nfceInsertError) {
      redirecionarErro(
        "Não foi possível salvar a emissão automática de NFC-e no PDV."
      );
    }
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