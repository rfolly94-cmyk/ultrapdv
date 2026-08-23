export function mensagemErroFinalizacaoPublica(erro: unknown) {
  const texto =
    erro instanceof Error
      ? erro.message
      : typeof erro === "string"
        ? erro
        : "";

  const limpo = String(texto ?? "").trim();
  if (!limpo) {
    return "Não foi possível finalizar a venda.";
  }

  if (
    /rpc_|postgres|permission denied|jwt|stack|function public\./i.test(limpo)
  ) {
    return "Não foi possível finalizar a venda.";
  }

  return limpo;
}
