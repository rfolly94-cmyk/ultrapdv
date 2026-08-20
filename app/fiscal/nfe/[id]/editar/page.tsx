import { NfeEmissaoPagina } from "@/app/fiscal/nfe/nfe-emissao-pagina";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditarNfePage({ params }: PageProps) {
  const { id } = await params;
  return <NfeEmissaoPagina operacaoId={id} />;
}
