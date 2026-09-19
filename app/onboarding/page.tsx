import { redirect } from "next/navigation";

import { OnboardingEmpresaForm } from "@/components/onboarding/onboarding-empresa-form";
import { carregarEstadoAcessoSessao } from "@/lib/auth/contexto-autorizado";
import { podeUsarOnboarding } from "@/lib/auth/estado-acesso";
import { emailConfirmado } from "@/lib/auth/email";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Cadastrar empresa",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    redirect("/login");
  }

  const { data: userData } = await supabase.auth.getUser();

  if (!emailConfirmado(userData.user)) {
    redirect("/confirmar-email");
  }

  const estado = await carregarEstadoAcessoSessao(supabase, String(usuarioId));

  if (estado.temVinculoOperacional) {
    redirect("/painel");
  }

  if (!podeUsarOnboarding(estado)) {
    redirect("/acesso-desativado");
  }

  const email = userData.user?.email ?? "";
  const metadata = (userData.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome = String(metadata.nome ?? "").trim();

  return <OnboardingEmpresaForm nomeInicial={nome} email={email} />;
}
