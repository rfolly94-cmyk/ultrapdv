import { deveUsarLivroCaixa } from "@/lib/caixa/controle";
import { MENSAGEM_CAIXA_FECHADO_NFE_VENDA } from "@/lib/caixa/mensagens";

/**
 * Exigência de Caixa na NF-e 55: venda comercial ainda não materializada.
 * Não depende da URL (Nova vs Editar) nem do rótulo da natureza.
 *
 * Exige Caixa quando NÃO há venda_id e:
 * - `tipo_operacao_interno` (código do catálogo) é venda; ou
 * - `vincula_venda` do tipo de operação é true.
 */
function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function vendaIdNfeMaterializada(vendaId?: string | null) {
  const id = texto(vendaId);
  return Boolean(id) && id !== "null" && id !== "undefined";
}

export function nfeVendaNovaExigeCaixa(input: {
  tipoOperacaoInterno?: string | null;
  vinculaVenda?: boolean | null;
  vendaId?: string | null;
}): boolean {
  if (vendaIdNfeMaterializada(input.vendaId)) {
    return false;
  }
  const tipo = texto(input.tipoOperacaoInterno).toLowerCase();
  if (tipo === "venda") {
    return true;
  }
  return input.vinculaVenda === true;
}

/**
 * Bloqueio imediato ao iniciar/continuar NF-e de venda nova sem sessão aberta.
 * Venda já materializada (`vendaId`) e naturezas sem financeiro não bloqueiam.
 */
export function recusarInicioVendaNfeSemCaixa(input: {
  tipoOperacaoInterno?: string | null;
  vinculaVenda?: boolean | null;
  vendaId?: string | null;
  controleAtivo: boolean;
  caixaAberto: boolean;
}): string | null {
  const fluxoExigeCaixa = nfeVendaNovaExigeCaixa({
    tipoOperacaoInterno: input.tipoOperacaoInterno,
    vinculaVenda: input.vinculaVenda,
    vendaId: input.vendaId,
  });
  if (
    !deveUsarLivroCaixa({
      controleAtivo: input.controleAtivo,
      fluxoExigeCaixa,
    })
  ) {
    return null;
  }
  if (input.caixaAberto) {
    return null;
  }
  return MENSAGEM_CAIXA_FECHADO_NFE_VENDA;
}
