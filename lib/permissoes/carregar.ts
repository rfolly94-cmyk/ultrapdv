import { resolverPermissoesEfetivas } from "./resolver";
import type { LinhaPermissao, PermissoesEfetivas } from "./tipos";

export type SessaoPermissoes = {
  usuarioId: string;
  empresaId: string;
  perfil: string;
  permissoes: PermissoesEfetivas;
  linhas: LinhaPermissao[];
};

export async function carregarPermissoesDoVinculo(input: {
  supabase: { from: (tabela: string) => any };
  usuarioId: string;
  empresaId: string;
  perfil: string;
}): Promise<SessaoPermissoes> {
  const perfil = String(input.perfil ?? "").trim().toLowerCase();
  let linhas: LinhaPermissao[] = [];

  if (perfil !== "administrador") {
    const consulta = await input.supabase
      .from("usuarios_permissoes_empresas")
      .select("modulo, permissoes")
      .eq("usuario_id", input.usuarioId)
      .eq("empresa_id", input.empresaId);

    linhas = (consulta.data ?? []).map((linha) => ({
      modulo: String(linha.modulo ?? ""),
      permissoes:
        linha.permissoes && typeof linha.permissoes === "object"
          ? (linha.permissoes as Record<string, boolean>)
          : {},
    }));
  }

  return {
    usuarioId: input.usuarioId,
    empresaId: input.empresaId,
    perfil,
    linhas,
    permissoes: resolverPermissoesEfetivas({ perfil, linhas }),
  };
}
