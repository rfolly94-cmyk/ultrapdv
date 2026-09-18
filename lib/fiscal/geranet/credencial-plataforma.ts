import type { SupabaseClient } from "@supabase/supabase-js";

export const GERANET_NFE_BASE_URL = "https://nfe.geranet.net/api/v1";

export const MENSAGEM_API_GERANET_PLATAFORMA_AUSENTE =
  "A API Geranet da plataforma ainda não está configurada.";

export type SegredosFiscaisEmissao = {
  geranet_api_key?: string | null;
  certificado_a1?: string | null;
  senha_certificado?: string | null;
  csc?: string | null;
  [chave: string]: unknown;
};

export type DiagnosticoApiKeyGeranet = {
  configurada: boolean;
  mascara: string | null;
  migracao: "pendente" | "vazia" | "copiada" | "divergente" | string;
  empresas_com_chave: number;
  chaves_empresa_distintas: number;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function rpcAusente(error: { message?: string; code?: string } | null) {
  const mensagem = texto(error?.message).toLowerCase();
  const codigo = texto(error?.code);
  return (
    codigo === "PGRST202" ||
    codigo === "42883" ||
    mensagem.includes("could not find the function") ||
    mensagem.includes("does not exist")
  );
}

export function mascararApiKeyGeranet(valor: unknown) {
  const chave = texto(valor);
  if (!chave) {
    return "";
  }
  if (chave.length <= 4) {
    return "••••";
  }
  return `••••${chave.slice(-4)}`;
}

export function mesclarApiKeyGeranetEmissao(
  empresa: SegredosFiscaisEmissao,
  global: string
): SegredosFiscaisEmissao {
  return {
    ...empresa,
    geranet_api_key: texto(global) || texto(empresa.geranet_api_key) || null,
  };
}

export async function obterApiKeyGeranetPlataforma(
  admin: SupabaseClient
): Promise<string> {
  const { data, error } = await admin.rpc("obter_api_key_geranet_plataforma");
  if (error) {
    if (rpcAusente(error)) {
      return "";
    }
    throw new Error("Não foi possível ler a API Geranet da plataforma.");
  }
  return texto(data);
}

export async function obterSegredosFiscaisEmissao(
  admin: SupabaseClient,
  empresaId: string
): Promise<{
  data: SegredosFiscaisEmissao | null;
  error: { message: string; code?: string } | null;
}> {
  const empresa = await admin.rpc("obter_segredos_fiscais", {
    p_empresa_id: empresaId,
  });

  if (empresa.error) {
    return { data: null, error: empresa.error };
  }

  const base =
    empresa.data && typeof empresa.data === "object"
      ? (empresa.data as SegredosFiscaisEmissao)
      : {};

  let global = "";
  try {
    global = await obterApiKeyGeranetPlataforma(admin);
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível ler a API Geranet da plataforma.",
      },
    };
  }

  return {
    data: mesclarApiKeyGeranetEmissao(base, global),
    error: null,
  };
}

export async function carregarDiagnosticoApiKeyGeranet(
  admin: SupabaseClient
): Promise<DiagnosticoApiKeyGeranet> {
  const { data, error } = await admin.rpc(
    "diagnostico_api_key_geranet_plataforma"
  );
  if (error) {
    if (rpcAusente(error)) {
      return {
        configurada: false,
        mascara: null,
        migracao: "pendente",
        empresas_com_chave: 0,
        chaves_empresa_distintas: 0,
      };
    }
    throw new Error("Não foi possível consultar o status da API Geranet.");
  }

  const bruto =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};

  return {
    configurada: Boolean(bruto.configurada),
    mascara: texto(bruto.mascara) || null,
    migracao: texto(bruto.migracao) || "pendente",
    empresas_com_chave: Number(bruto.empresas_com_chave ?? 0) || 0,
    chaves_empresa_distintas: Number(bruto.chaves_empresa_distintas ?? 0) || 0,
  };
}
