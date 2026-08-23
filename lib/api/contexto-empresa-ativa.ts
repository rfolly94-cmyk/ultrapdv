import { exigirEmpresaOperacional } from "@/lib/assinatura/exigir-empresa-operacional";
import { ErroAssinaturaRestrita } from "@/lib/assinatura/exigir-empresa-operacional";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { extrairBearerAuthorization } from "@/lib/supabase/bearer";

export type ContextoEmpresaAtiva =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      empresaId: string;
      usuarioId: string;
    }
  | {
      ok: false;
      status: number;
      erro: string;
      codigo?: "NAO_AUTENTICADO" | "SEM_EMPRESA";
    };

export async function resolverContextoEmpresaAtiva(
  authorization: string | null
): Promise<ContextoEmpresaAtiva> {
  if (!extrairBearerAuthorization(authorization)) {
    return {
      ok: false,
      status: 401,
      erro: "Não autenticado.",
      codigo: "NAO_AUTENTICADO",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await obterClaimsSessao(supabase);

  if (authError || !claimsData?.claims?.sub) {
    return {
      ok: false,
      status: 401,
      erro: "Não autenticado.",
      codigo: "NAO_AUTENTICADO",
    };
  }

  const usuarioId = String(claimsData.claims.sub);
  const { data: vinculo, error: vinculoError } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", usuarioId)
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (vinculoError || !vinculo) {
    return {
      ok: false,
      status: 403,
      erro: "Empresa ativa não encontrada.",
      codigo: "SEM_EMPRESA",
    };
  }

  try {
    await exigirEmpresaOperacional(String(vinculo.empresa_id));
  } catch (error) {
    if (error instanceof ErroAssinaturaRestrita) {
      return { ok: false, status: 403, erro: error.message };
    }
    throw error;
  }

  return {
    ok: true,
    supabase,
    empresaId: String(vinculo.empresa_id),
    usuarioId,
  };
}
