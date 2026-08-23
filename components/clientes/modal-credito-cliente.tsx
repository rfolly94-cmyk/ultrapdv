"use client";

import { AppModal } from "@/components/ui/app-modal";
import type { CreditoAbertoListagem } from "@/lib/clientes/carregar-resumo-carteira";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

function dataCurta(valor: string | null) {
  if (!valor) {
    return "—";
  }
  return new Date(valor).toLocaleDateString("pt-BR");
}

export function ModalCreditoCliente({
  open,
  clienteNome,
  creditos,
  onClose,
}: {
  open: boolean;
  clienteNome: string;
  creditos: CreditoAbertoListagem[];
  onClose: () => void;
}) {
  return (
    <AppModal
      open={open}
      title={`Créditos · ${clienteNome}`}
      onClose={onClose}
      size="lg"
    >
      {creditos.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum crédito disponível.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-zinc-500">
            Consulta dos créditos ainda disponíveis. A Carteira atual não
            aplica crédito em débitos por esta tela.
          </p>
          <div className="overflow-x-auto">
            <table className="updv-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Origem</th>
                  <th className="num">Original</th>
                  <th className="num">Utilizado</th>
                  <th className="num">Disponível</th>
                </tr>
              </thead>
              <tbody>
                {creditos.map((credito) => (
                  <tr key={credito.id}>
                    <td>{dataCurta(credito.data)}</td>
                    <td>
                      <p>{credito.origem}</p>
                      {credito.observacao ? (
                        <p className="text-xs text-zinc-400">
                          {credito.observacao}
                        </p>
                      ) : null}
                    </td>
                    <td className="num">
                      {formatarMoeda(credito.valor_original)}
                    </td>
                    <td className="num">
                      {formatarMoeda(credito.valor_utilizado)}
                    </td>
                    <td className="num font-medium text-emerald-600">
                      {formatarMoeda(credito.valor_disponivel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppModal>
  );
}
