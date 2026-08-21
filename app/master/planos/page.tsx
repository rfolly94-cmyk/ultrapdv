import { PlanosMasterPainel } from "@/components/master/planos-master-painel";
import { carregarPainelPlanosMaster } from "@/lib/master/planos";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planos",
};

export default async function MasterPlanosPage() {
  const { planos, metricas } = await carregarPainelPlanosMaster();

  return <PlanosMasterPainel planos={planos} metricas={metricas} />;
}
