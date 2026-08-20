"use client";

import {
  type FormEvent,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  createBrowserClient,
} from "@supabase/ssr";

function criarSupabase() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const chave =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (
    !url ||
    !chave
  ) {
    throw new Error(
      "Configuração pública do Supabase não encontrada."
    );
  }

  return createBrowserClient(
    url,
    chave
  );
}

export function
CadastroProprietarioForm() {
  const router = useRouter();
  const supabase =
    useMemo(
      () =>
        criarSupabase(),
      []
    );

  const [
    processando,
    setProcessando,
  ] =
    useState(false);

  const [
    erro,
    setErro,
  ] =
    useState("");

  const [
    aviso,
    setAviso,
  ] =
    useState("");

  async function
  enviar(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErro("");
    setAviso("");
    setProcessando(true);

    try {
      const form =
        new FormData(
          event.currentTarget
        );

      const nome =
        String(
          form.get(
            "nome"
          ) ?? ""
        ).trim();

      const email =
        String(
          form.get(
            "email"
          ) ?? ""
        )
          .trim()
          .toLowerCase();

      const senha =
        String(
          form.get(
            "senha"
          ) ?? ""
        );

      const confirmarSenha =
        String(
          form.get(
            "confirmar_senha"
          ) ?? ""
        );

      if (
        nome.length < 2
      ) {
        throw new Error(
          "Informe seu nome."
        );
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          email
        )
      ) {
        throw new Error(
          "Informe um e-mail válido."
        );
      }

      if (
        senha.length < 8
      ) {
        throw new Error(
          "A senha deve ter pelo menos 8 caracteres."
        );
      }

      if (
        senha !==
        confirmarSenha
      ) {
        throw new Error(
          "As senhas não coincidem."
        );
      }

      const {
        data,
        error,
      } =
        await supabase
          .auth
          .signUp({
            email,
            password:
              senha,
            options: {
              data: {
                nome,
              },
              emailRedirectTo: `${window.location.origin}/auth/confirm`,
            },
          });

      if (
        error
      ) {
        throw new Error(
          error.message
        );
      }

      window.sessionStorage.setItem(
        "ultrapdv.email-confirmacao",
        email
      );

      if (
        data.session &&
        data.user?.email_confirmed_at
      ) {
        router.push("/onboarding");
        router.refresh();
        return;
      }

      router.push("/confirmar-email");
      router.refresh();
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a conta."
      );
    } finally {
      setProcessando(
        false
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
        <div>
          <p className="text-sm font-semibold text-zinc-500">
            UltraPDV
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">
            Criar conta
          </h1>

          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Este será o login do proprietário e administrador da nova empresa.
          </p>
        </div>

        {erro && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {erro}
          </div>
        )}

        {aviso && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            {aviso}

            <a
              href="/login"
              className="mt-3 inline-flex font-semibold underline"
            >
              Ir para o login
            </a>
          </div>
        )}

        <form
          onSubmit={
            enviar
          }
          className="mt-6 space-y-4"
        >
          <Campo
            label="Nome do responsável"
            name="nome"
            autoComplete="name"
            required
          />

          <Campo
            label="E-mail"
            name="email"
            type="email"
            autoComplete="email"
            required
          />

          <Campo
            label="Senha"
            name="senha"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />

          <Campo
            label="Confirmar senha"
            name="confirmar_senha"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />

          <button
            type="submit"
            disabled={
              processando
            }
            className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {processando
              ? "Criando conta..."
              : "Continuar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Já possui acesso?{" "}
          <a
            href="/login"
            className="font-semibold text-zinc-900 underline"
          >
            Entrar
          </a>
        </p>
      </div>
    </main>
  );
}

function Campo({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?:
    string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">
        {label}
      </span>

      <input
        name={name}
        type={type}
        autoComplete={
          autoComplete
        }
        required={
          required
        }
        minLength={
          minLength
        }
        className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none transition focus:border-zinc-700 focus:ring-2 focus:ring-zinc-100"
      />
    </label>
  );
}
