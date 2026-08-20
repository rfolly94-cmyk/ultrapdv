import { redirect } from "next/navigation";

import { NfeEmissaoPagina } from "@/app/fiscal/nfe/nfe-emissao-pagina";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function NovaNfePage({ searchParams }: PageProps) {
  const { id } = await searchParams;
  const operacaoId = String(id ?? "").trim();
  if (operacaoId) {
    redirect(`/fiscal/nfe/${encodeURIComponent(operacaoId)}/editar`);
  }

  return <NfeEmissaoPagina operacaoId={null} />;
}
