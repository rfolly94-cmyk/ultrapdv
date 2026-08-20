export function buscarDaEmpresaAtiva<T extends { id: string; empresa_id: string }>(
  registros: T[],
  empresaIdAtiva: string,
  id: string
) {
  return (
    registros.find(
      (registro) => registro.id === id && registro.empresa_id === empresaIdAtiva
    ) ?? null
  );
}

export function recusarCruzado(
  registro: { empresa_id: string } | null,
  empresaIdAtiva: string
) {
  if (!registro || registro.empresa_id !== empresaIdAtiva) {
    return { ok: false as const, status: 404 as const, erro: "Não encontrado." };
  }

  return { ok: true as const, status: 200 as const };
}
