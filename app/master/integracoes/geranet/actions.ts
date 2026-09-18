"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  GERANET_NFE_BASE_URL,
  MENSAGEM_API_GERANET_PLATAFORMA_AUSENTE,
  obterApiKeyGeranetPlataforma,
} from "@/lib/fiscal/geranet/credencial-plataforma";
import { exigirMaster } from "@/lib/master/exigir-master";
import { registrarAuditoriaPlataforma } from "@/lib/plataforma/auditoria";

const BASE = "/master/integracoes/geranet";

function irComErro(mensagem: string): never {
  redirect(`${BASE}?erro=${encodeURIComponent(mensagem)}`);
}

function irComSucesso(mensagem: string): never {
  redirect(`${BASE}?sucesso=${encodeURIComponent(mensagem)}`);
}

async function validarApiKeyNaGeranet(apiKey: string) {
  let resposta: Response;
  try {
    resposta = await fetch(`${GERANET_NFE_BASE_URL}/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    irComErro("Não foi possível conectar à API da Geranet.");
  }

  if (!resposta.ok) {
    irComErro(`A Geranet recusou a API Key. HTTP ${resposta.status}.`);
  }
}

export async function masterSalvarApiKeyGeranet(formData: FormData) {
  const { supabase, admin, usuarioId } = await exigirMaster();
  const apiKey = String(formData.get("api_key") ?? "").trim();

  if (apiKey.length < 20) {
    irComErro("Informe uma API Key Geranet válida.");
  }

  await validarApiKeyNaGeranet(apiKey);

  const { error } = await supabase.rpc("rpc_master_salvar_api_key_geranet", {
    p_valor: apiKey,
  });

  if (error) {
    const codigo = String(error.code ?? "");
    const mensagem = String(error.message ?? "").toLowerCase();
    if (codigo === "42501" || mensagem.includes("nao_autorizado")) {
      irComErro("Somente o Master da plataforma pode alterar a API Geranet.");
    }
    console.error("Erro ao armazenar API Key Geranet da plataforma:", {
      code: error.code,
    });
    irComErro("Não foi possível armazenar a API Key.");
  }

  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: "geranet.api_key.salvar",
    metadados: { configurada: true },
  });

  revalidatePath(BASE);
  irComSucesso("API Key Geranet validada e armazenada na plataforma.");
}

export async function masterTestarConexaoGeranet() {
  const { admin } = await exigirMaster();
  let apiKey = "";
  try {
    apiKey = await obterApiKeyGeranetPlataforma(admin);
  } catch {
    irComErro("Não foi possível acessar o cofre da plataforma.");
  }

  if (!apiKey) {
    irComErro(MENSAGEM_API_GERANET_PLATAFORMA_AUSENTE);
  }

  await validarApiKeyNaGeranet(apiKey);
  irComSucesso("Conexão com a Geranet funcionando.");
}
