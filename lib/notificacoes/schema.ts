export const MENSAGEM_NOTIFICACOES_MIGRATION =
  "Aplique a migration de notificações neste ambiente antes de usar a central.";

export function tabelaNotificacoesIndisponivel(
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
    (/notificacoes/i.test(mensagem) &&
      /schema cache|does not exist|não existe|could not find the table/i.test(
        mensagem
      ))
  );
}
