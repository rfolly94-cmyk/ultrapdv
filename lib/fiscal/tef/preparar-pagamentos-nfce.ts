import "server-only";

import { bloqueioTefHomologacaoNfceProducao } from "@/lib/fiscal/tef/ambiente-tef-nfce";
import {
  avaliarPagamentosFiscaisTef,
  type PagamentoFiscalCartao,
} from "@/lib/fiscal/tef/dados-fiscais-cartao";
import { listarDadosFiscaisTefDaVenda } from "@/lib/pdv/tef/persistencia";

export async function prepararPagamentosNfceTef<T extends PagamentoFiscalCartao>(
  empresaId: string,
  vendaId: string,
  pagamentos: T[]
) {
  let operacoes: Awaited<ReturnType<typeof listarDadosFiscaisTefDaVenda>> = [];
  try {
    operacoes = await listarDadosFiscaisTefDaVenda(empresaId, vendaId);
  } catch {
    operacoes = [];
  }
  return avaliarPagamentosFiscaisTef({
    pagamentos,
    operacoes,
  });
}

export async function bloqueioTefHomologacaoNaNfce(
  consultar: () => Promise<{
    quantidade: number;
    ambienteTef: string | null;
    consultaInconclusiva?: boolean;
    ambientesEfetivos?: string[] | null;
  }>,
  ambienteFiscal: unknown
) {
  const consulta = await consultar();
  return bloqueioTefHomologacaoNfceProducao({
    ambienteFiscal,
    ambienteTef: consulta.ambienteTef,
    possuiTransacaoTef: consulta.quantidade > 0,
    consultaInconclusiva: consulta.consultaInconclusiva === true,
    ambientesEfetivos: consulta.ambientesEfetivos,
  });
}
