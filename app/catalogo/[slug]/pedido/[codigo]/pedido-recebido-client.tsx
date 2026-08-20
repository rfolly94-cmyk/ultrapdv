"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { codigoPedidoAmigavel, formatarMoeda } from "@/lib/catalogo/regras";
import { urlWhatsapp } from "@/lib/catalogo/whatsapp";

type Resumo = {
  total: number;
  itens: Array<{ nome: string; quantidade: number; subtotal: number | null }>;
  tipoEntrega: string;
  nome: string;
};

export function PedidoRecebidoClient({
  slug,
  codigo,
  nomeLoja,
  whatsapp,
}: {
  slug: string;
  codigo: number;
  nomeLoja: string;
  whatsapp: string | null;
}) {
  const bruto = useSyncExternalStore(
    () => () => undefined,
    () => {
      try {
        return sessionStorage.getItem(
          `ultrapdv.catalogo.pedido.${slug}.${codigo}`
        );
      } catch {
        return null;
      }
    },
    () => null
  );

  let resumo: Resumo | null = null;

  if (bruto) {
    try {
      resumo = JSON.parse(bruto) as Resumo;
    } catch {
      resumo = null;
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Pedido recebido!
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Pedido {codigoPedidoAmigavel(codigo)}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          A loja recebeu seu pedido e entrará em contato pelo WhatsApp.
        </p>

        {resumo && (
          <>
            <ul className="mt-5 space-y-2 text-sm">
              {resumo.itens.map((item, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>
                    {item.quantidade}x {item.nome}
                  </span>
                  <span>
                    {item.subtotal !== null
                      ? formatarMoeda(item.subtotal)
                      : "Consultar"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between text-sm font-semibold">
              <span>Total</span>
              <span>{formatarMoeda(resumo.total)}</span>
            </div>
            <p className="mt-4 text-sm text-zinc-500">
              {resumo.nome} ·{" "}
              {resumo.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}
            </p>
          </>
        )}

        <div className="mt-6 grid gap-2">
          {whatsapp && (
            <a
              href={urlWhatsapp(
                whatsapp,
                `Olá! Sobre o pedido ${codigoPedidoAmigavel(codigo)}`
              )}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-600 text-sm font-medium text-white"
            >
              Falar com a loja
            </a>
          )}
          <Link
            href={`/catalogo/${slug}`}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 text-sm font-medium"
          >
            Voltar ao catálogo
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-400">{nomeLoja}</p>
      </div>
    </main>
  );
}
