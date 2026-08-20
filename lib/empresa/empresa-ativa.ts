export type VinculoEmpresaAtiva = {
  usuario_id: string;
  empresa_id: string;
  principal: boolean;
  ativo: boolean;
};

function idUsuario(valor: unknown) {
  return String(valor ?? "").trim();
}

export function selecionarVinculoEmpresaAtiva<T extends VinculoEmpresaAtiva>(
  vinculos: T[],
  usuarioId: unknown
): T | null {
  const sub = idUsuario(usuarioId);

  if (!sub) {
    return null;
  }

  const encontrados = vinculos.filter(
    (vinculo) =>
      String(vinculo.usuario_id) === sub &&
      vinculo.principal === true &&
      vinculo.ativo === true
  );

  if (encontrados.length !== 1) {
    return null;
  }

  return encontrados[0];
}

export async function buscarVinculoEmpresaAtiva<T = { empresa_id: string }>(
  db: {
    from: (tabela: string) => {
      select: (colunas: string) => unknown;
    };
  },
  usuarioId: unknown,
  colunas = "empresa_id"
): Promise<{ data: T | null; error: { message: string } | null }> {
  const sub = idUsuario(usuarioId);

  if (!sub) {
    return { data: null, error: null };
  }

  const consulta = db.from("usuarios_empresas").select(colunas) as {
    eq: (coluna: string, valor: string | boolean) => {
      eq: (coluna: string, valor: string | boolean) => {
        eq: (coluna: string, valor: string | boolean) => {
          maybeSingle: () => Promise<{
            data: unknown;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await consulta
    .eq("usuario_id", sub)
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  return {
    data: (data as T | null) ?? null,
    error: error ?? null,
  };
}
