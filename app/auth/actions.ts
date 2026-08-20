"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { emailConfirmado } from "@/lib/auth/email";
import {
  COOKIE_RECUPERACAO_SENHA,
  MENSAGEM_RECUPERACAO_NEUTRA,
} from "@/lib/auth/recuperacao";
import { urlAbsolutaApp } from "@/lib/auth/url-app";
import { createClient } from "@/lib/supabase/server";

function mensagemUrl(
  caminho: string,
  tipo: "erro" | "mensagem",
  mensagem: string
) {
  return `${caminho}?${tipo}=${encodeURIComponent(mensagem)}`;
}

export async function entrar(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(mensagemUrl("/login", "erro", "Informe o e-mail e a senha."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const codigo = String(error.code ?? "");
    const texto = error.message.toLowerCase();
    if (
      codigo === "email_not_confirmed" ||
      texto.includes("email not confirmed")
    ) {
      redirect("/confirmar-email");
    }

    redirect(
      mensagemUrl("/login", "erro", "E-mail ou senha inválidos.")
    );
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!emailConfirmado(userData.user)) {
    redirect("/confirmar-email");
  }

  revalidatePath("/", "layout");

  const { data: claimsData } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  const { data: vinculo } = usuarioId
    ? await supabase
        .from("usuarios_empresas")
        .select("perfil")
        .eq("usuario_id", String(usuarioId))
        .eq("principal", true)
        .eq("ativo", true)
        .maybeSingle()
    : { data: null };

  if (!vinculo) {
    redirect("/onboarding");
  }

  if (String(vinculo.perfil ?? "").toLowerCase() === "contador") {
    redirect("/contabilidade");
  }

  redirect("/painel");
}

export async function solicitarRecuperacaoSenha(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const supabase = await createClient();
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: urlAbsolutaApp("/auth/confirm?type=recovery"),
      });
    } catch (error) {
      console.error(
        "[auth] falha ao solicitar recuperação",
        error instanceof Error ? error.message : "erro"
      );
    }
  }

  redirect(
    mensagemUrl("/recuperar-senha", "mensagem", MENSAGEM_RECUPERACAO_NEUTRA)
  );
}

export async function definirNovaSenha(formData: FormData) {
  const senha = String(formData.get("senha") ?? "");
  const confirmar = String(formData.get("confirmar_senha") ?? "");
  const jar = await cookies();
  const recovery = jar.get(COOKIE_RECUPERACAO_SENHA)?.value === "1";

  if (!recovery) {
    redirect(
      mensagemUrl(
        "/recuperar-senha",
        "erro",
        "O link de recuperação é inválido ou expirou."
      )
    );
  }

  if (senha.length < 8) {
    redirect(
      mensagemUrl(
        "/nova-senha",
        "erro",
        "A nova senha deve ter pelo menos 8 caracteres."
      )
    );
  }

  if (senha !== confirmar) {
    redirect(
      mensagemUrl("/nova-senha", "erro", "As senhas não coincidem.")
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect(
      mensagemUrl(
        "/recuperar-senha",
        "erro",
        "O link de recuperação é inválido ou expirou."
      )
    );
  }

  const { error } = await supabase.auth.updateUser({ password: senha });

  if (error) {
    redirect(
      mensagemUrl(
        "/nova-senha",
        "erro",
        "Não foi possível atualizar a senha. Solicite um novo link."
      )
    );
  }

  jar.delete(COOKIE_RECUPERACAO_SENHA);
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(
    mensagemUrl(
      "/login",
      "mensagem",
      "Senha atualizada. Entre com a nova senha."
    )
  );
}
