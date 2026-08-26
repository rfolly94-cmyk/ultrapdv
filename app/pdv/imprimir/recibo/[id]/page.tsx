import { notFound, redirect } from "next/navigation";

import { ControlesImpressao } from "@/components/impressao/controles-impressao";
import { ReciboTermico } from "@/components/impressao/recibo-termico";
import { carregarReciboVendaDaEmpresaAtiva } from "@/lib/impressao/carregar-recibo";
import { montarReciboVenda, urlLogoReciboEfetiva } from "@/lib/impressao/recibo-layout";
import { carregarLayoutReciboDaEmpresaAtiva } from "@/lib/impressao/recibo-layout-servidor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
};

export default async function ReciboVendaPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { auto } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const recibo = await carregarReciboVendaDaEmpresaAtiva({
    supabase,
    empresaId: vinculo.empresa_id,
    vendaId: id,
  });

  if (!recibo) {
    notFound();
  }

  const layout = await carregarLayoutReciboDaEmpresaAtiva({
    empresaId: vinculo.empresa_id,
  });
  const montado = montarReciboVenda(recibo, layout);

  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-4">
      <div className="mx-auto w-full" style={{ maxWidth: montado.papel === "58mm" ? "58mm" : "80mm" }}>
        <ControlesImpressao
          autoPrint={auto === "1"}
          voltarHref={`/vendas/${recibo.vendaId}`}
          pdfUrl={`/api/impressao/recibo/${recibo.vendaId}?papel=${montado.papel}`}
          tipoDocumento="recibo"
          papel={montado.papel}
        />
        <div className="mt-3">
          <ReciboTermico
            blocos={montado.blocos}
            papel={montado.papel}
            logoUrl={urlLogoReciboEfetiva(layout, recibo.empresa)}
          />
        </div>
      </div>
    </main>
  );
}
