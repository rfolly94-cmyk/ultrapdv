"use server";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GERANET_BASE_URL = "https://nfe.geranet.net/api/v1";

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
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !vinculo) {
    redirect("/onboarding");
  }

  if (vinculo.perfil !== "administrador") {
    irComErro(
      "Somente administradores podem configurar a integração fiscal."
    );
  }

  return {
    supabase,
    empresaId: vinculo.empresa_id,
  };
}

// =========================================================
// API KEY GERANET
// =========================================================

export async function salvarApiGeranet(
  formData: FormData
) {
  const { supabase, empresaId } =
    await getContextoAdministrador();

  const apiKey = String(
    formData.get("api_key") ?? ""
  ).trim();

  if (apiKey.length < 20) {
    irComErro("Informe uma API Key Geranet válida.");
  }

  // Primeiro validamos a chave diretamente na Geranet.
  // Não salvamos uma chave inválida.
  let resposta: Response;

  try {
    resposta = await fetch(
      `${GERANET_BASE_URL}/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
  } catch {
    irComErro(
      "Não foi possível conectar à API da Geranet."
    );
  }

  if (!resposta.ok) {
    irComErro(
      `A Geranet recusou a API Key. HTTP ${resposta.status}.`
    );
  }

  const { error } = await supabase.rpc(
    "salvar_segredo_fiscal",
    {
      p_empresa_id: empresaId,
      p_tipo: "geranet_api_key",
      p_valor: apiKey,
    }
  );

  if (error) {
    console.error(
      "Erro ao armazenar API Key Geranet:",
      {
        message: error.message,
        code: error.code,
      }
    );

    irComErro(
      "Não foi possível armazenar a API Key."
    );
  }

  revalidatePath(
    "/configuracoes/fiscal/integracao"
  );

  irComSucesso(
    "API Key Geranet validada e armazenada com segurança."
  );
}

// =========================================================
// CERTIFICADO A1
// =========================================================

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

  // Certificados A1 normalmente são pequenos.
  // Este limite evita uploads acidentais enormes.
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

  // Salva certificado em hexadecimal.
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

  // Salva a senha separadamente.
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

  // Apenas o nome do arquivo pode ficar na tabela pública
  // de status. O certificado e sua senha permanecem no Vault.
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

// =========================================================
// NFC-e / CSC
// =========================================================

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

// =========================================================
// TESTE DO COFRE + GERANET
// =========================================================

export async function testarConexaoGeranet() {
  const { empresaId } =
    await getContextoAdministrador();

  const admin =
    createAdminClient();

  const { data, error } =
    await admin.rpc(
      "obter_segredos_fiscais",
      {
        p_empresa_id: empresaId,
      }
    );

  if (error) {
    console.error(
      "Erro ao recuperar segredos:",
      error.message
    );

    irComErro(
      "Não foi possível acessar o cofre fiscal."
    );
  }

  const segredos =
    data as {
      geranet_api_key?: string | null;
      certificado_a1?: string | null;
      senha_certificado?: string | null;
      csc?: string | null;
    } | null;

  const apiKey =
    segredos?.geranet_api_key;

  if (!apiKey) {
    irComErro(
      "A API Key Geranet ainda não está configurada."
    );
  }

  let resposta: Response;

  try {
    resposta = await fetch(
      `${GERANET_BASE_URL}/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
  } catch {
    irComErro(
      "Não foi possível alcançar a API Geranet."
    );
  }

  if (!resposta.ok) {
    irComErro(
      `Falha ao autenticar na Geranet. HTTP ${resposta.status}.`
    );
  }

  irComSucesso(
    "Conexão com a Geranet funcionando e leitura do cofre fiscal confirmada."
  );
}