"use server";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

function irComErro(mensagem: string): never {
  redirect(
    "/configuracoes/fiscal/integracao?erro=" +
      encodeURIComponent(mensagem)
  );
}

function irComSucesso(mensagem: string): never {
  redirect(
    "/configuracoes/fiscal/integracao?sucesso=" +
      encodeURIComponent(mensagem)
  );
}

async function getContextoAdministrador() {
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

  try {
    await exigirPermissao({ modulo: "fiscal", acao: "configurar_fiscal" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      irComErro(error.message);
    }
    throw error;
  }

  return {
    supabase,
    empresaId: vinculo.empresa_id,
  };
}

export async function salvarCertificadoA1(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContextoAdministrador();

  const arquivo =
    formData.get("certificado");

  const senha = String(
    formData.get("senha_certificado") ?? ""
  );

  if (!(arquivo instanceof File)) {
    irComErro("Selecione o certificado A1.");
  }

  if (arquivo.size === 0) {
    irComErro(
      "O arquivo do certificado está vazio."
    );
  }

  const LIMITE = 2 * 1024 * 1024;

  if (arquivo.size > LIMITE) {
    irComErro(
      "O certificado não pode ultrapassar 2 MB."
    );
  }

  const nomeArquivo =
    arquivo.name.toLowerCase();

  if (
    !nomeArquivo.endsWith(".pfx") &&
    !nomeArquivo.endsWith(".p12")
  ) {
    irComErro(
      "O certificado deve ser um arquivo .pfx ou .p12."
    );
  }

  if (!senha) {
    irComErro(
      "Informe a senha do certificado A1."
    );
  }

  const arrayBuffer =
    await arquivo.arrayBuffer();

  const certificadoHex =
    Buffer.from(arrayBuffer).toString("hex");

  if (!certificadoHex) {
    irComErro(
      "Não foi possível converter o certificado."
    );
  }

  const { error: certificadoError } =
    await supabase.rpc(
      "salvar_segredo_fiscal",
      {
        p_empresa_id: empresaId,
        p_tipo: "certificado_a1",
        p_valor: certificadoHex,
      }
    );

  if (certificadoError) {
    console.error(
      "Erro ao salvar certificado:",
      certificadoError.message
    );

    irComErro(
      "Não foi possível armazenar o certificado."
    );
  }

  const { error: senhaError } =
    await supabase.rpc(
      "salvar_segredo_fiscal",
      {
        p_empresa_id: empresaId,
        p_tipo: "senha_certificado",
        p_valor: senha,
      }
    );

  if (senhaError) {
    console.error(
      "Erro ao salvar senha do certificado:",
      senhaError.message
    );

    irComErro(
      "O certificado foi recebido, mas não foi possível armazenar sua senha."
    );
  }

  const admin = createAdminClient();

  const { error: statusError } = await admin
    .from("fiscal_credenciais_status")
    .update({
      certificado_nome: arquivo.name,
      certificado_configurado: true,
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId);

  if (statusError) {
    console.error(
      "Erro ao atualizar status do certificado:",
      statusError.message
    );
  }

  revalidatePath(
    "/configuracoes/fiscal/integracao"
  );

  irComSucesso(
    "Certificado A1 armazenado com segurança."
  );
}

export async function salvarConfiguracaoNfce(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContextoAdministrador();

  const idCsc = String(
    formData.get("id_csc") ?? ""
  ).trim();

  const csc = String(
    formData.get("csc") ?? ""
  ).trim();

  if (!idCsc) {
    irComErro(
      "Informe o identificador do CSC."
    );
  }

  if (!csc) {
    irComErro(
      "Informe o CSC da NFC-e."
    );
  }

  const { error: cscError } =
    await supabase.rpc(
      "salvar_segredo_fiscal",
      {
        p_empresa_id: empresaId,
        p_tipo: "csc",
        p_valor: csc,
      }
    );

  if (cscError) {
    console.error(
      "Erro ao armazenar CSC:",
      cscError.message
    );

    irComErro(
      "Não foi possível armazenar o CSC."
    );
  }

  const { error: configError } =
    await supabase
      .from("fiscal_nfce_config")
      .update({
        id_csc: idCsc,
        csc_configurado: true,
      })
      .eq("empresa_id", empresaId);

  if (configError) {
    console.error(
      "Erro ao salvar ID CSC:",
      configError.message
    );

    irComErro(
      "Não foi possível salvar o identificador do CSC."
    );
  }

  revalidatePath(
    "/configuracoes/fiscal/integracao"
  );

  irComSucesso(
    "Configuração da NFC-e salva com sucesso."
  );
}
