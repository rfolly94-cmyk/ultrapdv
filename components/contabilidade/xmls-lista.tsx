"use client";

import { useMemo, useState } from "react";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DocumentoFiscalContabil } from "@/lib/contabilidade/documentos";
import { modeloFiscalRotulo } from "@/lib/contabilidade/regras";

type EventoXml = {
  id: string;
  tipo: string;
  emissaoId: string;
  temXml: boolean;
};

export function ContabilidadeXmlsLista({
  documentos,
  eventos,
  competencia,
}: {
  documentos: DocumentoFiscalContabil[];
  eventos: EventoXml[];
  competencia: string;
}) {
  const [modelo, setModelo] = useState("");
  const [tipo, setTipo] = useState("documentos");

  const eventosPorEmissao = useMemo(() => {
    const mapa = new Map<string, EventoXml[]>();
    for (const evento of eventos) {
      const lista = mapa.get(evento.emissaoId) ?? [];
      lista.push(evento);
      mapa.set(evento.emissaoId, lista);
    }
    return mapa;
  }, [eventos]);

  const filtrados = useMemo(() => {
    return documentos.filter((item) => {
      if (modelo && item.modelo !== modelo) return false;
      if (tipo === "cancelamentos") return item.status === "cancelada";
      if (tipo === "cce") {
        return (eventosPorEmissao.get(item.id) ?? []).some(
          (evento) => evento.tipo === "carta_correcao"
        );
      }
      return item.status === "autorizada" || item.status === "cancelada";
    });
  }, [documentos, eventosPorEmissao, modelo, tipo]);

  return (
    <>
      <ListToolbar
        searchPlaceholder="Filtrar XMLs da competência"
        searchValue=""
        onSearchChange={() => undefined}
        filters={
          <div className="flex items-center gap-1.5">
            <select
              value={modelo}
              onChange={(event) => setModelo(event.target.value)}
              className="updv-input h-8 text-[12px]"
            >
              <option value="">NF-e e NFC-e</option>
              <option value="55">NF-e</option>
              <option value="65">NFC-e</option>
            </select>
            <select
              value={tipo}
              onChange={(event) => setTipo(event.target.value)}
              className="updv-input h-8 text-[12px]"
            >
              <option value="documentos">Documentos</option>
              <option value="cancelamentos">Cancelamentos</option>
              <option value="cce">CC-e</option>
            </select>
          </div>
        }
        actions={
          <a
            href={`/api/contabilidade/zip?competencia=${competencia}`}
            className="updv-btn updv-btn-primary"
          >
            Baixar XMLs da competência
          </a>
        }
      />

      <DataTable minWidth={900}>
        <thead>
          <tr>
            <th>Modelo</th>
            <th>Número</th>
            <th>Chave</th>
            <th>XML</th>
            <th>Eventos</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.length === 0 && (
            <DataTableEmpty colSpan={6}>
              Nenhum XML nesta competência.
            </DataTableEmpty>
          )}
          {filtrados.map((doc) => {
            const eventosDoc = eventosPorEmissao.get(doc.id) ?? [];
            return (
              <tr key={doc.id}>
                <td>{modeloFiscalRotulo(doc.modelo)}</td>
                <td className="font-medium">{doc.numero.padStart(6, "0")}</td>
                <td className="max-w-[220px] truncate font-mono text-[11px]">
                  {doc.chave ?? "—"}
                </td>
                <td>
                  <StatusBadge status={doc.temXml ? "sucesso" : "pendente"}>
                    {doc.temXml ? "Disponível" : "Ausente"}
                  </StatusBadge>
                </td>
                <td className="text-[12px] text-zinc-500">
                  {eventosDoc.map((evento) => evento.tipo).join(", ") || "—"}
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    {(doc.status === "autorizada" || doc.status === "cancelada") && (
                      <a
                        href={`/api/fiscal/emissoes/${doc.id}/arquivo?tipo=xml&download=1`}
                        className="updv-btn-row"
                      >
                        XML
                      </a>
                    )}
                    {eventosDoc
                      .filter((evento) => evento.temXml)
                      .map((evento) => (
                        <a
                          key={evento.id}
                          href={`/api/fiscal/eventos/${evento.id}/arquivo?tipo=xml&download=1`}
                          className="updv-btn-row"
                        >
                          {evento.tipo === "cancelamento"
                            ? "Canc."
                            : evento.tipo === "carta_correcao"
                              ? "CC-e"
                              : "Evento"}
                        </a>
                      ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </>
  );
}
