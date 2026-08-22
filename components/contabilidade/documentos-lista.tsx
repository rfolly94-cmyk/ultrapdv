"use client";

import { useMemo, useState } from "react";

import { ConsultarSituacaoButton } from "@/components/contabilidade/consultar-situacao-button";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DocumentoFiscalContabil } from "@/lib/contabilidade/documentos";
import { modeloFiscalRotulo } from "@/lib/contabilidade/regras";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(valor: string) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleDateString("pt-BR");
}

export function ContabilidadeDocumentosLista({
  documentos,
  somenteLeitura,
}: {
  documentos: DocumentoFiscalContabil[];
  somenteLeitura: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [modelo, setModelo] = useState("");
  const [status, setStatus] = useState("");
  const podeBaixarXml = useTemPermissao("contabilidade", "baixar_xml");

  const filtrados = useMemo(() => {
    return documentos.filter((item) => {
      if (modelo && item.modelo !== modelo) return false;
      if (status === "pendente") {
        if (
          item.status !== "aguardando_reconciliacao" &&
          item.status !== "aguardando_inutilizacao"
        ) {
          return false;
        }
      } else if (status && item.status !== status) {
        return false;
      }

      const termo = busca.trim().toLowerCase();
      if (!termo) return true;
      return [item.numero, item.chave, item.cliente, item.documento]
        .join(" ")
        .toLowerCase()
        .includes(termo);
    });
  }, [busca, documentos, modelo, status]);

  return (
    <>
      <ListToolbar
        searchPlaceholder="Número, chave, cliente ou CPF/CNPJ"
        searchValue={busca}
        onSearchChange={setBusca}
        filters={
          <div className="flex items-center gap-1.5">
            <select
              value={modelo}
              onChange={(event) => setModelo(event.target.value)}
              className="updv-input h-8 text-[12px]"
            >
              <option value="">Todos</option>
              <option value="55">NF-e</option>
              <option value="65">NFC-e</option>
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="updv-input h-8 text-[12px]"
            >
              <option value="">Situação</option>
              <option value="autorizada">Autorizada</option>
              <option value="cancelada">Cancelada</option>
              <option value="rejeitada">Rejeitada</option>
              <option value="inutilizada">Inutilizada</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>
        }
      />

      <DataTable minWidth={1100}>
        <thead>
          <tr>
            <th>Data</th>
            <th>Modelo</th>
            <th>Série</th>
            <th>Número</th>
            <th>Cliente/destinatário</th>
            <th>Chave</th>
            <th className="num">Valor</th>
            <th>Situação</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.length === 0 && (
            <DataTableEmpty colSpan={9}>
              Nenhum documento nesta competência.
            </DataTableEmpty>
          )}
          {filtrados.map((doc) => {
            const podeArquivo =
              doc.status === "autorizada" || doc.status === "cancelada";

            return (
              <tr key={doc.id}>
                <td>{formatarData(doc.data)}</td>
                <td>{modeloFiscalRotulo(doc.modelo)}</td>
                <td>{doc.serie}</td>
                <td className="font-medium">{doc.numero.padStart(6, "0")}</td>
                <td className="max-w-[220px] truncate">{doc.cliente}</td>
                <td className="max-w-[180px] truncate font-mono text-[11px]">
                  {doc.chave ?? "—"}
                </td>
                <td className="num">{moeda.format(doc.valor)}</td>
                <td>
                  <StatusBadge status={doc.status} />
                </td>
                <td>
                  <RowActions
                    extra={
                      podeBaixarXml && podeArquivo ? (
                        <a
                          href={`/api/fiscal/emissoes/${doc.id}/arquivo?tipo=xml&download=1`}
                          className="updv-btn-row"
                        >
                          XML
                        </a>
                      ) : null
                    }
                    items={[
                      {
                        label: "Abrir DANFE",
                        href: `/api/fiscal/emissoes/${doc.id}/arquivo?tipo=pdf`,
                        hidden: !podeArquivo,
                      },
                      {
                        label: "Baixar XML",
                        href: `/api/fiscal/emissoes/${doc.id}/arquivo?tipo=xml&download=1`,
                        hidden: !podeArquivo || !podeBaixarXml,
                      },
                      {
                        label: "XML de cancelamento",
                        href: `/contabilidade/xmls`,
                        hidden: doc.status !== "cancelada",
                      },
                    ]}
                  />
                  <ConsultarSituacaoButton emissaoId={doc.id} />
                  {somenteLeitura ? null : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </>
  );
}
