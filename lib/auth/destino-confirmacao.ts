export function destinoAposConfirmacaoAuth(
  type: string | null | undefined,
  temEmpresaPrincipal: boolean
) {
  if (String(type ?? "").toLowerCase() === "recovery") {
    return "/nova-senha";
  }

  if (temEmpresaPrincipal) {
    return "/painel";
  }

  return "/onboarding";
}
