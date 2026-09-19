import "server-only";

import { carregarEstadoAcessoSessao } from "@/lib/auth/carregar-estado-acesso";
import {
  CODIGO_ACESSO_DESATIVADO,
  CODIGO_EMPRESA_NAO_OPERACIONAL,
  CODIGO_NAO_AUTENTICADO,
  CODIGO_SEM_EMPRESA,
  MENSAGEM_ACESSO_DESATIVADO,
  MENSAGEM_SEM_EMPRESA,
} from "@/lib/auth/mensagens-acesso";
import {
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { extrairBearerAuthorization } from "@/lib/supabase/bearer";

export { carregarEstadoAcessoSessao };

export class ErroAcessoSessao extends Error {
  status: number;
  codigo: string;

  constructor(mensagem: string, status: number, codigo: string) {
    super(mensagem);
    this.name = "ErroAcessoSessao";
    this.status = status;
    this.codigo = codigo;
  }
}

export async function resolverContextoAutorizadoEmpresa(opcoes?: {
  authorization?: string | null;
  exigirBearer?: boolean;
}) {
  if (
    opcoes?.exigirBearer &&
    !extrairBearerAuthorization(opcoes.authorization ?? null)
  ) {
    throw new ErroAcessoSessao("Não autenticado.", 401, CODIGO_NAO_AUTENTICADO);
  }

  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await obterClaimsSessao(supabase);
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    throw new ErroAcessoSessao("Não autenticado.", 401, CODIGO_NAO_AUTENTICADO);
  }

  const estado = await carregarEstadoAcessoSessao(supabase, String(usuarioId));

  if (!estado.usuarioAtivo || (estado.teveVinculo && !estado.temVinculoOperacional)) {
    throw new ErroAcessoSessao(
      MENSAGEM_ACESSO_DESATIVADO,
      403,
      CODIGO_ACESSO_DESATIVADO
    );
  }

  if (!estado.temVinculoOperacional || !estado.empresaId) {
    throw new ErroAcessoSessao(MENSAGEM_SEM_EMPRESA, 403, CODIGO_SEM_EMPRESA);
  }

  try {
    await exigirEmpresaOperacional(estado.empresaId);
  } catch (error) {
    if (error instanceof ErroAssinaturaRestrita) {
      throw new ErroAcessoSessao(error.message, 403, CODIGO_EMPRESA_NAO_OPERACIONAL);
    }
    throw error;
  }

  return {
    supabase,
    usuarioId: String(usuarioId),
    empresaId: estado.empresaId,
    perfil: estado.perfil,
    estado,
  };
}
