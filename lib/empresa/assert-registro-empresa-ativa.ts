export const MENSAGEM_REGISTRO_OUTRA_EMPRESA =
  "O registro não pertence à empresa ativa.";

export const MENSAGEM_RECURSO_NAO_ENCONTRADO =
  "Recurso não encontrado.";

export function idEmpresaAtiva(valor: unknown) {
  return String(valor ?? "").trim();
}

export function registroPertenceAEmpresaAtiva(
  registro: { empresa_id?: string | null } | null | undefined,
  empresaIdAtiva: unknown
) {
  const empresaDoRegistro = idEmpresaAtiva(registro?.empresa_id);
  const empresaAtiva = idEmpresaAtiva(empresaIdAtiva);

  return Boolean(
    empresaAtiva &&
    empresaDoRegistro &&
    empresaDoRegistro === empresaAtiva
  );
}

export function filtrarRegistrosDaEmpresaAtiva<
  T extends { empresa_id?: string | null },
>(
  registros: T[] | null | undefined,
  empresaIdAtiva: unknown
) {
  return (registros ?? []).filter((registro) =>
    registroPertenceAEmpresaAtiva(registro, empresaIdAtiva)
  );
}

export function assertRegistroDaEmpresaAtiva(
  registro: { empresa_id?: string | null } | null | undefined,
  empresaIdAtiva: unknown,
  mensagem = MENSAGEM_REGISTRO_OUTRA_EMPRESA
) {
  if (!registroPertenceAEmpresaAtiva(registro, empresaIdAtiva)) {
    throw new Error(mensagem);
  }
}
