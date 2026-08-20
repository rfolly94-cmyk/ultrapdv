"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createBrowserClient } from "@supabase/ssr";

import { mascararEmail } from "@/lib/auth/email";

function criarSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !chave) {
    throw new Error("Configuração pública do Supabase não encontrada.");
  }

  return createBrowserClient(url, chave);
}

export default function ConfirmarEmailPage() {
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [processando, setProcessando] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const salvo =
      window.sessionStorage.getItem("ultrapdv.email-confirmacao") ?? "";
    const supabase = criarSupabase();

    void supabase.auth.getUser().then(({ data }) => {
      const daSessao = data.user?.email ?? "";
      setEmail((daSessao || salvo).trim().toLowerCase());
    });
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown((atual) => atual - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function reenviar() {
    setErro("");
    setAviso("");

    const destino = email.trim().toLowerCase();
    if (!destino) {
      setErro("Informe o e-mail para reenviar a confirmação.");
      return;
    }

    setProcessando(true);
    try {
      const supabase = criarSupabase();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: destino,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });

      if (error) {
        throw error;
      }

      window.sessionStorage.setItem("ultrapdv.email-confirmacao", destino);
      setAviso("Se a conta existir e ainda não estiver confirmada, enviaremos um novo e-mail.");
      setCooldown(60);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível reenviar a confirmação agora."
      );
      setCooldown(60);
    } finally {
      setProcessando(false);
    }
  }

  const mascarado = mascararEmail(email);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
        <p className="text-sm font-semibold text-zinc-500">UltraPDV</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">
          Confirme seu e-mail
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Enviamos uma mensagem para{" "}
          <span className="font-medium text-zinc-800">
            {mascarado || "o endereço informado"}
          </span>
          . Confirme a conta para cadastrar a empresa.
        </p>

        {!mascarado && (
          <label className="mt-6 block">
            <span className="text-sm font-medium text-zinc-700">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-700"
            />
          </label>
        )}

        {erro && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {erro}
          </div>
        )}

        {aviso && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {aviso}
          </div>
        )}

        <button
          type="button"
          disabled={processando || cooldown > 0}
          onClick={() => void reenviar()}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {cooldown > 0
            ? `Reenviar em ${cooldown}s`
            : processando
              ? "Enviando..."
              : "Reenviar confirmação"}
        </button>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/login" className="font-semibold text-zinc-900 underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </main>
  );
}
