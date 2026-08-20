import { redirect } from "next/navigation";

import { hrefEdicaoOperacaoFiscal } from "@/lib/fiscal/acoes-emissao";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function OperacaoFiscalPage({ params }: PageProps) {
  const { id } = await params;
  redirect(hrefEdicaoOperacaoFiscal(id));
}
