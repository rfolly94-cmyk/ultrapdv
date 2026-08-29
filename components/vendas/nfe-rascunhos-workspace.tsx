"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { VendasModuleTabs } from "@/components/vendas/vendas-module-tabs";
import type { ItemListaRascunhoNfe55 } from "@/lib/fiscal/nfe55/rascunhos-nfe";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";

function formatarData(valor: string | null) {
  if (!valor) {
    return "—";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function NfeRascunhosWorkspace({
  rascunhos,
  rascunhosNfe = 0,
  pedidosNovos = 0,
}: {
  rascunhos: ItemListaRascunhoNfe55[];
  rascunhosNfe?: number;
  pedidosNovos?: number;
}) {
  const router = useRouter();
  const nfeLiberada = useRecursoLiberado("nfe");
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) {
      return rascunhos;
    }
    return rascunhos.filter((item) =>
      [
        item.identificacao,
        item.destinatario,
        item.natureza,
        item.statusRotulo,
        item.usuario,
      ]
        .join(" ")
        .toLowerCase()
        .includes(termo)
    );
  }, [busca, rascunhos]);

  return (
    <section className="updv-page">
      <PageHeader
        title="Rascunhos NF-e"
        description="NF-e modelo 55 salvas e ainda não emitidas."
        count={filtrados.length}
        breadcrumb={[
          { label: "Vendas", href: "/vendas" },
          { label: "Rascunhos NF-e" },
        ]}
        actions={
          nfeLiberada ? (
            <a href="/fiscal/nfe/nova" className="updv-btn updv-btn-primary">
              Nova NF-e
            </a>
          ) : null
        }
      />
      <VendasModuleTabs
        pedidosNovos={pedidosNovos}
        rascunhosNfe={rascunhosNfe}
      />
      <ListToolbar
        searchPlaceholder="Buscar rascunho, destinatário ou natureza"
        searchValue={busca}
        onSearchChange={setBusca}
      />

      <DataTable minWidth={1080}>
        <thead>
          <tr>
            <th>Rascunho</th>
            <th>Data</th>
            <th>Destinatário</th>
            <th className="num">Itens</th>
            <th className="num">Total</th>
            <th>Natureza</th>
            <th>Status</th>
            <th>Usuário</th>
            <th>Atualizado</th>
            <th className="sticky right-0 z-10 bg-[#f4f4f5]">Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.length === 0 ? (
            <DataTableEmpty colSpan={10}>
              Nenhum rascunho de NF-e nesta empresa.
            </DataTableEmpty>
          ) : (
            filtrados.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer"
                onClick={() => router.push(item.href)}
              >
                <td>{item.identificacao}</td>
                <td>{formatarData(item.data)}</td>
                <td>{item.destinatario}</td>
                <td className="num">{item.quantidadeItens}</td>
                <td className="num">{moeda.format(item.valorTotal)}</td>
                <td>{item.natureza}</td>
                <td>
                  <StatusBadge status={item.status}>
                    {item.statusRotulo}
                  </StatusBadge>
                </td>
                <td>{item.usuario}</td>
                <td>{formatarData(item.atualizadoEm)}</td>
                <td className="sticky right-0 z-10 bg-white">
                  <RowActions editHref={item.href} editLabel="Continuar" />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </section>
  );
}
