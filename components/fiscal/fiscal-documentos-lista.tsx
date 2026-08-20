"use client";

import { useMemo, useState } from "react";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolverApresentacaoEmissaoFiscal } from "@/lib/fiscal/apresentacao-emissao";

type Documento = {
  id: string;
  origemHref: string | null;
  origemLabel: string;
  tipoOperacao?: string;
  tipoLabel?: string;
  modelo: string;
  serie: number;
  numero: string;
  status: string;
  cstat?: string | null;
  motivo?: string | null;
  geranetHttpStatus?: number | null;
  geranetSituacao?: string | null;
  erroComunicacao?: string | null;
  classificacao?: string | null;
  protocolo?: string | null;
  chaveAcesso?: string | null;
  cliente: string;
  valor: number;
  data: string;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(valor: string) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }

  return data.toLocaleDateString("pt-BR");
}

export function FiscalDocumentosLista({
  documentos,
}: {
  documentos: Documento[];
}) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return documentos.filter((item) => {
      if (tipo !== "todos" && item.tipoOperacao !== tipo) {
        return false;
      }
      if (!termo) {
        return true;
      }
      return [item.numero, item.cliente, item.status, item.modelo, item.tipoLabel]
        .join(" ")
        .toLowerCase()
        .includes(termo);
    });
  }, [busca, documentos, tipo]);

  return (
    <>
      <ListToolbar
        searchPlaceholder="Buscar número, cliente ou situação"
        searchValue={busca}
        onSearchChange={setBusca}
        filters={
          <select
            value={tipo}
            onChange={(event) => setTipo(event.target.value)}
            className="updv-select w-[180px]"
            aria-label="Tipo de operação"
          >
            <option value="todos">Todos os tipos</option>
            <option value="venda">Venda</option>
            <option value="devolucao_fornecedor">Devolução</option>
            <option value="bonificacao">Bonificação</option>
            <option value="transferencia">Transferência</option>
          </select>
        }
      />

      <DataTable minWidth={980}>
        <thead>
          <tr>
            <th>Número</th>
            <th>Modelo</th>
            <th>Tipo</th>
            <th>Série</th>
            <th>Data</th>
            <th>Nome</th>
            <th>Situação</th>
            <th className="num">Valor</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((doc) => {
            const autorizada = doc.status === "autorizada";
            const cancelada = doc.status === "cancelada";
            const apresentacao = resolverApresentacaoEmissaoFiscal({
              modelo: doc.modelo,
              status: doc.status,
              classificacao: doc.classificacao,
              cstat: doc.cstat,
              motivo: doc.motivo,
              protocolo: doc.protocolo,
              chaveAcesso: doc.chaveAcesso,
              geranetHttpStatus: doc.geranetHttpStatus,
              geranetSituacao: doc.geranetSituacao,
              erroComunicacao: doc.erroComunicacao,
            });
            const inutilizar = doc.status === "aguardando_inutilizacao";

            return (
              <tr
                key={doc.id}
                data-selected={selecionado === doc.id}
                data-clickable="true"
                onClick={() => setSelecionado(doc.id)}
              >
                <td className="font-medium">{doc.numero.padStart(6, "0")}</td>
                <td>{doc.modelo === "55" ? "NF-e" : "NFC-e"}</td>
                <td>{doc.tipoLabel ?? "—"}</td>
                <td>{doc.serie}</td>
                <td>{formatarData(doc.data)}</td>
                <td className="max-w-[240px] truncate">{doc.cliente}</td>
                <td>
                  <StatusBadge status={doc.status} />
                </td>
                <td className="num font-medium">{moeda.format(doc.valor)}</td>
                <td>
                  <RowActions
                    extra={
                      (autorizada || cancelada) && (
                        <a
                          href={`/api/fiscal/emissoes/${doc.id}/arquivo?tipo=pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="updv-btn-row"
                        >
                          DANFE
                        </a>
                      )
                    }
                    items={[
                      {
                        label: doc.origemLabel,
                        href: doc.origemHref ?? undefined,
                        hidden: !doc.origemHref,
                      },
                      {
                        label: "Abrir DANFE",
                        href: `/api/fiscal/emissoes/${doc.id}/arquivo?tipo=pdf`,
                        hidden: !autorizada && !cancelada,
                      },
                      {
                        label: "Baixar XML",
                        href: `/api/fiscal/emissoes/${doc.id}/arquivo?tipo=xml&download=1`,
                        hidden: !autorizada && !cancelada,
                      },
                      {
                        label: "Consultar situação",
                        href: doc.origemHref ?? undefined,
                        hidden: !doc.origemHref,
                      },
                      {
                        label: "Cancelar",
                        href: doc.origemHref ?? undefined,
                        hidden: !autorizada || !doc.origemHref,
                        danger: true,
                      },
                      {
                        label: "Carta de Correção",
                        href: doc.origemHref ?? undefined,
                        hidden: !(autorizada && doc.modelo === "55") || !doc.origemHref,
                      },
                      {
                        label: "Reconciliar emissão",
                        href: doc.origemHref ?? undefined,
                        hidden:
                          apresentacao.acaoPrincipal !== "reconciliar" ||
                          !doc.origemHref,
                      },
                      {
                        label: "Tentar novamente",
                        href: doc.origemHref ?? undefined,
                        hidden:
                          apresentacao.acaoPrincipal !== "tentar_novamente" ||
                          !doc.origemHref,
                      },
                      {
                        label: "Inutilizar numeração",
                        href: doc.origemHref ?? undefined,
                        hidden: !inutilizar || !doc.origemHref,
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}

          {filtrados.length === 0 && (
            <DataTableEmpty colSpan={9}>
              Nenhum documento fiscal encontrado.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>
    </>
  );
}
