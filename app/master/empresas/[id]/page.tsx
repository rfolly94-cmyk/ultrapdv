import { notFound } from "next/navigation";

import { EmpresaMasterDetalhe } from "@/components/master/empresa-master-detalhe";
import { detalheEmpresaMaster } from "@/lib/master/empresas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresa",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MasterEmpresaDetalhePage({ params }: PageProps) {
  const { id } = await params;
  const detalhe = await detalheEmpresaMaster(id);
  if (!detalhe) {
    notFound();
  }

  return <EmpresaMasterDetalhe detalhe={detalhe} />;
}
