export function tabelaIaIndisponivel(
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
    (/ia_conversas|ia_mensagens|ia_auditoria|ia_propostas_acoes|fiscal_base_/i.test(mensagem) &&
      /schema cache|does not exist|não existe|could not find the table/i.test(
        mensagem
      ))
  );
}
