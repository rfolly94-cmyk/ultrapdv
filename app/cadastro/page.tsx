import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  CadastroProprietarioForm,
} from "@/components/cadastro/cadastro-proprietario-form";

export const metadata = {
  title:
    "Criar conta",
};

export default async function
CadastroPage() {
  const supabase =
    await createClient();

  const {
    data: claimsData,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    usuarioId
  ) {
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

    redirect(
      "/onboarding"
    );
  }

  return (
    <CadastroProprietarioForm />
  );
}
