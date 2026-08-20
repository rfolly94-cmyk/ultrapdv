"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { VendasModuleTabs } from "@/components/vendas/vendas-module-tabs";
import {
  codigoPedidoAmigavel,
  formatarMoeda,
  formatarWhatsappExibicao,
  pedidoPodeConverter,
} from "@/lib/catalogo/regras";
import type { CatalogoPedido } from "@/lib/catalogo/tipos";
import { urlWhatsapp } from "@/lib/catalogo/whatsapp";

import {
  aceitarPedidoCatalogo,
  cancelarPedidoCatalogo,
  converterPedidoParaVenda,
} from "@/app/vendas/pedidos/actions";

function formatarData(valor: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(valor));
}

function pendente(pedido: CatalogoPedido) {
  return pedidoPodeConverter(pedido.status, pedido.venda_id);
}

export function PedidosOnlineWorkspace({
  pedidos,
  pedidosNovos,
}: {
  pedidos: CatalogoPedido[];
  pedidosNovos: number;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<CatalogoPedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    if (!termo) {
      return pedidos;
    }

    return pedidos.filter((pedido) =>
      [
        String(pedido.codigo),
        pedido.cliente_nome,
        pedido.cliente_whatsapp,
        pedido.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(termo)
    );
  }, [busca, pedidos]);

  function executar(
    acao: () => Promise<{
      ok: boolean;
      erro?: string;
      mensagem?: string;
      vendaId?: string | null;
    }>,
    depois?: () => void
  ) {
    startTransition(async () => {
      const resultado = await acao();

      if (!resultado.ok) {
        setErro(resultado.erro ?? "Não foi possível atualizar o pedido.");
        return;
      }

      setErro(null);
      depois?.();
      router.refresh();
    });
  }

  function converter(pedido: CatalogoPedido) {
    if (!pendente(pedido)) {
      if (pedido.venda_id) {
        router.push(`/vendas/${pedido.venda_id}`);
      }
      return;
    }

    executar(
      () => converterPedidoParaVenda(pedido.id),
      () => {
        router.push(`/pdv?pedido=${pedido.id}`);
      }
    );
  }

  return (
    <section className="updv-page">
      <PageHeader
        title="Pedidos Online"
        description="Pedidos recebidos pelo catálogo."
        count={filtrados.length}
        breadcrumb={[
          { label: "Vendas", href: "/vendas" },
          { label: "Pedidos Online" },
        ]}
      />
      <VendasModuleTabs pedidosNovos={pedidosNovos} />
      <ListToolbar
        searchPlaceholder="Buscar pedido, cliente ou WhatsApp"
        searchValue={busca}
        onSearchChange={setBusca}
      />

      {erro && (
        <div className="mx-4 mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </div>
      )}

      <DataTable minWidth={980}>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>WhatsApp</th>
            <th>Tipo</th>
            <th>Itens</th>
            <th className="num">Total</th>
            <th>Status</th>
            <th className="sticky right-0 z-10 bg-[#f4f4f5]">Ações</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((pedido) => (
            <tr
              key={pedido.id}
              className={pedido.status === "NOVO" ? "bg-sky-50/60" : undefined}
            >
              <td>
                <button
                  type="button"
                  className="font-medium text-zinc-950"
                  onClick={() => {
                    setErro(null);
                    setSelecionado(pedido);
                  }}
                >
                  {codigoPedidoAmigavel(pedido.codigo)}
                </button>
              </td>
              <td>{formatarData(pedido.created_at)}</td>
              <td>{pedido.cliente_nome}</td>
              <td>{formatarWhatsappExibicao(pedido.cliente_whatsapp)}</td>
              <td>
                {pedido.tipo_entrega === "entrega" ? "Entrega" : "Retirada"}
              </td>
              <td>{pedido.itens.length}</td>
              <td className="num">{formatarMoeda(pedido.total)}</td>
              <td>
                <StatusBadge status={pedido.status.toLowerCase()}>
                  {pedido.status.replace("_", " ")}
                </StatusBadge>
              </td>
              <td className="sticky right-0 z-10 bg-white">
                <div className="flex items-center justify-end gap-1.5">
                  <RowActions
                    items={[
                      {
                        label: "Ver detalhes",
                        onClick: () => {
                          setErro(null);
                          setSelecionado(pedido);
                        },
                      },
                      {
                        label: "Chamar no WhatsApp",
                        href: urlWhatsapp(
                          pedido.cliente_whatsapp,
                          `Olá, ${pedido.cliente_nome}! Sobre o pedido ${codigoPedidoAmigavel(pedido.codigo)}`
                        ),
                      },
                      {
                        label: "Aceitar",
                        hidden: !pendente(pedido) || pedido.status === "ACEITO",
                        onClick: () =>
                          executar(() => aceitarPedidoCatalogo(pedido.id)),
                      },
                      {
                        label: "Cancelar",
                        danger: true,
                        hidden: !pendente(pedido),
                        onClick: () =>
                          executar(() => cancelarPedidoCatalogo(pedido.id)),
                      },
                    ]}
                  />
                  {pendente(pedido) ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => converter(pedido)}
                      className="updv-btn updv-btn-primary"
                    >
                      Converter para venda
                    </button>
                  ) : pedido.venda_id ? (
                    <a
                      href={`/vendas/${pedido.venda_id}`}
                      className="updv-btn updv-btn-ghost"
                    >
                      Abrir venda
                      {pedido.venda_numero
                        ? ` #${pedido.venda_numero}`
                        : ""}
                    </a>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {filtrados.length === 0 && (
            <DataTableEmpty colSpan={9}>
              Nenhum pedido online encontrado.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>

      <DetailDrawer
        open={Boolean(selecionado)}
        title={
          selecionado
            ? `Pedido ${codigoPedidoAmigavel(selecionado.codigo)}`
            : ""
        }
        onClose={() => setSelecionado(null)}
        size="md"
        footer={
          selecionado && (
            <div className="grid gap-2">
              {pendente(selecionado) ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => converter(selecionado)}
                  className="updv-btn updv-btn-primary w-full"
                >
                  Converter para venda
                </button>
              ) : selecionado.venda_id ? (
                <a
                  href={`/vendas/${selecionado.venda_id}`}
                  className="updv-btn updv-btn-primary w-full text-center"
                >
                  Abrir venda
                  {selecionado.venda_numero
                    ? ` #${selecionado.venda_numero}`
                    : ""}
                </a>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={urlWhatsapp(
                    selecionado.cliente_whatsapp,
                    `Olá, ${selecionado.cliente_nome}! Sobre o pedido ${codigoPedidoAmigavel(selecionado.codigo)}`
                  )}
                  className="updv-btn updv-btn-ghost text-center"
                >
                  Chamar no WhatsApp
                </a>
                <button
                  type="button"
                  disabled={isPending || !pendente(selecionado)}
                  onClick={() =>
                    executar(
                      () => cancelarPedidoCatalogo(selecionado.id),
                      () => setSelecionado(null)
                    )
                  }
                  className="updv-btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )
        }
      >
        {selecionado && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Cliente</p>
              <p className="font-medium">{selecionado.cliente_nome}</p>
              <p className="text-zinc-600">
                {formatarWhatsappExibicao(selecionado.cliente_whatsapp)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Cliente do catálogo não é cadastrado automaticamente.
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Tipo</p>
              <p>
                {selecionado.tipo_entrega === "entrega"
                  ? "Entrega"
                  : "Retirada"}
              </p>
              {selecionado.tipo_entrega === "entrega" && (
                <p className="mt-1 text-zinc-600">
                  {[
                    selecionado.rua,
                    selecionado.numero,
                    selecionado.bairro,
                    selecionado.cidade,
                    selecionado.cep,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {selecionado.complemento
                    ? ` · ${selecionado.complemento}`
                    : ""}
                  {selecionado.referencia
                    ? ` · Ref: ${selecionado.referencia}`
                    : ""}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-zinc-500">Itens</p>
              <ul className="mt-1 space-y-1">
                {selecionado.itens.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3">
                    <span>
                      {item.quantidade}x {item.nome_produto}
                    </span>
                    <span>{formatarMoeda(item.subtotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatarMoeda(selecionado.total)}</span>
            </div>
            {selecionado.observacao && (
              <div>
                <p className="text-xs text-zinc-500">Observação</p>
                <p>{selecionado.observacao}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-zinc-500">Data</p>
              <p>{formatarData(selecionado.created_at)}</p>
            </div>
            {selecionado.venda_id && (
              <p className="text-xs text-emerald-700">
                Convertido na venda
                {selecionado.venda_numero
                  ? ` nº ${selecionado.venda_numero}`
                  : ""}
                .
              </p>
            )}
            <StatusBadge status={selecionado.status.toLowerCase()}>
              {selecionado.status.replace("_", " ")}
            </StatusBadge>
          </div>
        )}
      </DetailDrawer>
    </section>
  );
}
