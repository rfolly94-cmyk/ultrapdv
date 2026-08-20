import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  OnboardingEmpresaForm,
} from "@/components/onboarding/onboarding-empresa-form";

export const metadata = {
  title:
    "Cadastrar empresa",
};

export default async function
OnboardingPage() {
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !usuarioId
  ) {
    redirect(
      "/login"
    );
  }

  const {
    data: userData,
  } =
    await supabase.auth.getUser();

  if (
    !userData.user?.email_confirmed_at
  ) {
    redirect(
      "/confirmar-email"
    );
  }

  const {
    data: vinculo,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id"
      )
      .eq(
        "usuario_id",
        String(usuarioId)
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  if (
    vinculo
  ) {
    redirect(
      "/painel"
    );
  }

  const email =
    userData.user
      ?.email ??
    "";

  const metadata =
    (
      userData.user
        ?.user_metadata ??
      {}
    ) as Record<
      string,
      unknown
    >;

  const nome =
    String(
      metadata.nome ??
      ""
    ).trim();

  return (
    <OnboardingEmpresaForm
      nomeInicial={
        nome
      }
      email={
        email
      }
    />
  );
}
