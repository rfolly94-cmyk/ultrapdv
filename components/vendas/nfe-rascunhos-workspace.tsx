"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { excluirRascunhoOperacaoFiscal } from "@/app/fiscal/nfe/operacoes-actions";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { VendasModuleTabs } from "@/components/vendas/vendas-module-tabs";
import type { ItemListaRascunhoNfe55 } from "@/lib/fiscal/nfe55/rascunhos-nfe";
import { MENSAGEM_CONFIRMAR_EXCLUSAO_RASCUNHO_NFE } from "@/lib/fiscal/nfe55/rascunhos-nfe";
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
  const [erro, setErro] = useState<string | null>(null);
  const [excluidos, setExcluidos] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const vigentes = rascunhos.filter((item) => !excluidos.includes(item.id));
    if (!termo) {
      return vigentes;
    }
    return vigentes.filter((item) =>
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
  }, [busca, excluidos, rascunhos]);

  function excluirRascunho(item: ItemListaRascunhoNfe55) {
    if (!window.confirm(MENSAGEM_CONFIRMAR_EXCLUSAO_RASCUNHO_NFE)) {
      return;
    }
    setErro(null);
    startTransition(async () => {
      const resultado = await excluirRascunhoOperacaoFiscal({
        operacaoId: item.id,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setExcluidos((atual) =>
        atual.includes(item.id) ? atual : [...atual, item.id]
      );
      router.refresh();
    });
  }

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

      {erro ? (
        <div className="mx-4 mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </div>
      ) : null}

      <DataTable minWidth={1080}>
        <thead>
          <tr>
            <th>Ações</th>
            <th>Rascunho</th>
            <th>Data</th>
            <th>Destinatário</th>
            <th className="num">Itens</th>
            <th className="num">Total</th>
            <th>Natureza</th>
            <th>Status</th>
            <th>Usuário</th>
            <th>Atualizado</th>
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
                <td>
                  <RowActions
                    items={[
                      {
                        label: "Continuar",
                        href: item.href,
                      },
                      {
                        label: "Excluir",
                        danger: true,
                        onClick: () => excluirRascunho(item),
                      },
                    ]}
                  />
                </td>
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
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </section>
  );
}
