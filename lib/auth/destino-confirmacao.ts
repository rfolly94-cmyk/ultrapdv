export function destinoAposConfirmacaoAuth(
  type: string | null | undefined,
  temEmpresaPrincipal: boolean,
  teveVinculo = false
) {
  if (String(type ?? "").toLowerCase() === "recovery") {
    return "/nova-senha";
  }

  if (temEmpresaPrincipal) {
    return "/painel";
  }

  if (teveVinculo) {
    return "/acesso-desativado";
  }

  return "/onboarding";
}
