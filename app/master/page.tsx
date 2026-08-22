import { DashboardMasterPainel } from "@/components/master/dashboard-master-painel";
import { carregarDashboardMaster } from "@/lib/master/dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MasterDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const meses = Array.isArray(params.meses) ? params.meses[0] : params.meses;
  const dados = await carregarDashboardMaster(meses);

  return <DashboardMasterPainel dados={dados} />;
}
