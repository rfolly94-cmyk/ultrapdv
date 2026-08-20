import { notFound } from "next/navigation";

import { carregarCatalogoPublico } from "@/lib/catalogo/publico";

import { PedidoRecebidoClient } from "./pedido-recebido-client";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string; codigo: string }>;
};

export default async function PedidoRecebidoPage({ params }: Props) {
  const { slug, codigo } = await params;
  const numero = Number(codigo);
  const catalogo = await carregarCatalogoPublico(slug);

  if (catalogo.status === "nao_encontrado" || !Number.isInteger(numero)) {
    notFound();
  }

  return (
    <PedidoRecebidoClient
      slug={slug}
      codigo={numero}
      nomeLoja={
        catalogo.status === "ok" || catalogo.status === "inativo"
          ? catalogo.loja.nome_exibido
          : "Loja"
      }
      whatsapp={
        catalogo.status === "ok" ? catalogo.loja.whatsapp_numero : null
      }
    />
  );
}
