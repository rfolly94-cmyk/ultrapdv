import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";
import { carregarRelatorioVendas } from "./vendas";
import { carregarRelatorioProdutos } from "./produtos";
import { carregarRelatorioEstoque } from "./estoque";
import { carregarRelatorioClientes } from "./clientes";
import { carregarRelatorioCarteira } from "./carteira";
import { carregarRelatorioPagamentos } from "./pagamentos";
import { carregarRelatorioFiscal } from "./fiscal";

export async function carregarRelatorio(filtros: FiltrosRelatorio): Promise<
  RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }
> {
  switch (filtros.aba) {
    case "produtos":
      return carregarRelatorioProdutos(filtros);
    case "estoque":
      return carregarRelatorioEstoque(filtros);
    case "clientes":
      return carregarRelatorioClientes(filtros);
    case "carteira":
      return carregarRelatorioCarteira(filtros);
    case "pagamentos":
      return carregarRelatorioPagamentos(filtros);
    case "fiscal":
      return carregarRelatorioFiscal(filtros);
    default:
      return carregarRelatorioVendas(filtros);
  }
}
