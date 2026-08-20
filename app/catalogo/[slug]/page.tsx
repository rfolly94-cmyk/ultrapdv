import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { carregarCatalogoPublico } from "@/lib/catalogo/publico";

import { CatalogoPublicoClient } from "./catalogo-publico-client";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const catalogo = await carregarCatalogoPublico(slug);

  if (catalogo.status === "nao_encontrado") {
    return { title: "Catálogo não encontrado" };
  }

  if (catalogo.status === "inativo") {
    return { title: catalogo.loja.nome_exibido };
  }

  return {
    title: catalogo.loja.nome_exibido,
    description: catalogo.loja.descricao ?? undefined,
  };
}

export default async function CatalogoPublicoPage({ params }: Props) {
  const { slug } = await params;
  const catalogo = await carregarCatalogoPublico(slug);

  if (catalogo.status === "nao_encontrado") {
    notFound();
  }

  if (catalogo.status === "inativo") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-950">
            {catalogo.loja.nome_exibido}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Catálogo temporariamente indisponível.
          </p>
        </div>
      </main>
    );
  }

  return <CatalogoPublicoClient catalogo={catalogo} />;
}
