import {
  classificarEstadoAcesso,
  type EstadoAcessoSessao,
  type VinculoAcesso,
} from "@/lib/auth/estado-acesso";

type ClienteConsulta = {
  from: (tabela: string) => {
    select: (colunas: string) => any;
  };
};

export async function carregarEstadoAcessoSessao(
  supabase: ClienteConsulta,
  usuarioId: string
): Promise<EstadoAcessoSessao> {
  const [{ data: vinculos }, { data: usuario }] = await Promise.all([
    supabase
      .from("usuarios_empresas")
      .select("empresa_id, perfil, principal, ativo")
      .eq("usuario_id", usuarioId),
    supabase.from("usuarios").select("ativo").eq("id", usuarioId).maybeSingle(),
  ]);

  return classificarEstadoAcesso({
    usuarioAtivo: usuario ? usuario.ativo !== false : true,
    vinculos: (vinculos ?? []) as VinculoAcesso[],
  });
}
