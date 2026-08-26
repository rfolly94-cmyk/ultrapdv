import { MENSAGEM_CAIXA_FECHADO_FINALIZAR } from "@/lib/caixa/mensagens";
import { MENSAGEM_TROCO_SEM_FORMA } from "@/lib/pdv/pagamentos-teto";

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

  if (/O caixa foi fechado/i.test(limpo)) {
    return MENSAGEM_CAIXA_FECHADO_FINALIZAR;
  }

  if (limpo.includes(MENSAGEM_TROCO_SEM_FORMA)) {
    return MENSAGEM_TROCO_SEM_FORMA;
  }

  if (/Estoque insuficiente/i.test(limpo)) {
    return limpo;
  }

  if (
    /rpc_|postgres|permission denied|jwt|stack|function public\./i.test(limpo)
  ) {
    return "Não foi possível finalizar a venda.";
  }

  return limpo;
}
