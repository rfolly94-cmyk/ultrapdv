import {
  ErroAcessoSessao,
  resolverContextoAutorizadoEmpresa,
} from "@/lib/auth/contexto-autorizado";
import {
  CODIGO_ACESSO_DESATIVADO,
  CODIGO_EMPRESA_NAO_OPERACIONAL,
  CODIGO_NAO_AUTENTICADO,
  CODIGO_SEM_EMPRESA,
} from "@/lib/auth/mensagens-acesso";
import { ErroAssinaturaRestrita } from "@/lib/assinatura/exigir-empresa-operacional";
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
      codigo?:
        | "NAO_AUTENTICADO"
        | "SEM_EMPRESA"
        | "ACESSO_DESATIVADO"
        | "EMPRESA_NAO_OPERACIONAL";
    };

function erroParaContexto(error: unknown): ContextoEmpresaAtiva {
  if (error instanceof ErroAcessoSessao) {
    const codigo =
      error.codigo === CODIGO_ACESSO_DESATIVADO ||
      error.codigo === CODIGO_EMPRESA_NAO_OPERACIONAL ||
      error.codigo === CODIGO_SEM_EMPRESA ||
      error.codigo === CODIGO_NAO_AUTENTICADO
        ? error.codigo
        : undefined;
    return {
      ok: false,
      status: error.status,
      erro: error.message,
      codigo,
    };
  }

  if (error instanceof ErroAssinaturaRestrita) {
    return {
      ok: false,
      status: 403,
      erro: error.message,
      codigo: CODIGO_EMPRESA_NAO_OPERACIONAL,
    };
  }

  throw error;
}

export async function resolverContextoEmpresaAtiva(
  authorization: string | null
): Promise<ContextoEmpresaAtiva> {
  if (!extrairBearerAuthorization(authorization)) {
    return {
      ok: false,
      status: 401,
      erro: "Não autenticado.",
      codigo: CODIGO_NAO_AUTENTICADO,
    };
  }

  try {
    const ctx = await resolverContextoAutorizadoEmpresa({
      authorization,
      exigirBearer: true,
    });
    return {
      ok: true,
      supabase: ctx.supabase,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
    };
  } catch (error) {
    return erroParaContexto(error);
  }
}
