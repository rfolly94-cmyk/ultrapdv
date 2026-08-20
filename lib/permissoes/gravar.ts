import "server-only";

import { linhasDaMatriz } from "./matriz";
import { presetDoPerfil } from "./presets";
import type { PermissoesEfetivas } from "./tipos";

export async function substituirPermissoesUsuarioEmpresa(input: {
  admin: {
    from: (tabela: string) => any;
  };
  usuarioId: string;
  empresaId: string;
  perfil: string;
  matriz?: PermissoesEfetivas | null;
}) {
  const perfil = String(input.perfil ?? "").trim().toLowerCase();

  const { error: deleteError } = await input.admin
    .from("usuarios_permissoes_empresas")
    .delete()
    .eq("usuario_id", input.usuarioId)
    .eq("empresa_id", input.empresaId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (perfil === "administrador") {
    return;
  }

  const linhas = linhasDaMatriz(input.matriz ?? presetDoPerfil(perfil));

  const { error: insertError } = await input.admin
    .from("usuarios_permissoes_empresas")
    .insert(
      linhas.map((linha) => ({
        usuario_id: input.usuarioId,
        empresa_id: input.empresaId,
        modulo: linha.modulo,
        permissoes: linha.permissoes,
      }))
    );

  if (insertError) {
    throw new Error(insertError.message);
  }
}
