export const MENSAGEM_BALANCA_MIGRATION =
  "Aplique a migration de balanças neste ambiente antes de usar este recurso.";

export function tabelaBalancaIndisponivel(
  error: { message?: string; code?: string } | null | undefined
) {
  if (!error) {
    return false;
  }

  const mensagem = String(error.message ?? "");
  const codigo = String(error.code ?? "");

  return (
    codigo === "42P01" ||
    codigo === "PGRST205" ||
    (/produtos_balancas|balancas_configuracoes_produtos|balancas_configuracoes/i.test(
      mensagem
    ) &&
      /schema cache|does not exist|não existe|could not find the table/i.test(
        mensagem
      ))
  );
}
