import { resolverPermissoesEfetivas } from "./resolver";
import type { LinhaPermissao, PermissoesEfetivas } from "./tipos";

export type SessaoPermissoes = {
  usuarioId: string;
  empresaId: string;
  perfil: string;
  permissoes: PermissoesEfetivas;
  linhas: LinhaPermissao[];
};

type LinhaPermissaoConsulta = {
  modulo?: unknown;
  permissoes?: unknown;
};

function permissoesDaLinha(valor: unknown): Record<string, boolean> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return {};
  }

  const saida: Record<string, boolean> = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (typeof item === "boolean") {
      saida[chave] = item;
    }
  }
  return saida;
}

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

    linhas = ((consulta.data ?? []) as LinhaPermissaoConsulta[]).map(
      (linha) => ({
        modulo: String(linha.modulo ?? ""),
        permissoes: permissoesDaLinha(linha.permissoes),
      })
    );
  }

  return {
    usuarioId: input.usuarioId,
    empresaId: input.empresaId,
    perfil,
    linhas,
    permissoes: resolverPermissoesEfetivas({ perfil, linhas }),
  };
}
