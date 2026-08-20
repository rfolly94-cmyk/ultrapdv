"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ImportarXmlEntrada } from "@/components/fiscal/entrada/importar-xml-entrada";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { MENSAGEM_DFE_EM_DESENVOLVIMENTO } from "@/lib/fiscal/entrada/mensagens";
import { rotuloStatusEntrada } from "@/lib/fiscal/entrada/status";

export type DocumentoEntradaLista = {
  id: string;
  numero: string;
  serie: string;
  fornecedor: string;
  emissao: string;
  valor: number;
  status: string;
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

export function EntradasLista({
  documentos,
}: {
  documentos: DocumentoEntradaLista[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [importarAberto, setImportarAberto] = useState(false);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) {
      return documentos;
    }

    return documentos.filter((item) =>
      [item.numero, item.fornecedor, item.status]
        .join(" ")
        .toLowerCase()
        .includes(termo)
    );
  }, [busca, documentos]);

  return (
    <>
      <ListToolbar
        searchPlaceholder="Buscar número, fornecedor ou situação"
        searchValue={busca}
        onSearchChange={setBusca}
        actions={
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              onClick={() => setImportarAberto(true)}
            >
              Importar XML
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled
              title={MENSAGEM_DFE_EM_DESENVOLVIMENTO}
            >
              Buscar documentos recebidos
            </button>
          </div>
        }
      />

      <DataTable minWidth={860}>
        <thead>
          <tr>
            <th>Número</th>
            <th>Fornecedor</th>
            <th>Emissão</th>
            <th className="num">Valor</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.length === 0 ? (
            <DataTableEmpty colSpan={6}>
              Nenhuma NF-e de entrada importada nesta empresa.
            </DataTableEmpty>
          ) : (
            filtrados.map((doc) => (
              <tr
                key={doc.id}
                className="cursor-pointer"
                onClick={() => router.push(`/fiscal/entradas/${doc.id}`)}
              >
                <td>
                  {doc.numero}
                  {doc.serie ? (
                    <span className="ml-1 text-zinc-400">s{doc.serie}</span>
                  ) : null}
                </td>
                <td>{doc.fornecedor}</td>
                <td>{formatarData(doc.emissao)}</td>
                <td className="num">{moeda.format(doc.valor)}</td>
                <td>
                  <StatusBadge status={doc.status}>
                    {rotuloStatusEntrada(doc.status)}
                  </StatusBadge>
                </td>
                <td>
                  <Link
                    href={`/fiscal/entradas/${doc.id}`}
                    className="updv-btn-row"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>

      <p className="px-4 py-2 text-[12px] text-zinc-500">
        A consulta de documentos destinados pela Geranet ainda não está
        integrada. Use a importação manual do XML.
      </p>

      <ImportarXmlEntrada
        open={importarAberto}
        onClose={() => setImportarAberto(false)}
      />
    </>
  );
}
