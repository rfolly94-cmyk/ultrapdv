import Link from "next/link";

import { entrar } from "@/app/auth/actions";

type LoginPageProps = {
  searchParams: Promise<{
    erro?: string;
    mensagem?: string;
  }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            UltraPDV
          </h1>

          <p className="mt-2 text-sm text-zinc-500">
            Entre para acessar seu sistema.
          </p>
        </div>

        {params.erro && (
          <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {params.erro}
          </div>
        )}

        {params.mensagem && (
          <div className="mb-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            {params.mensagem}
          </div>
        )}

        <form action={entrar} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-zinc-700"
            >
              E-mail
            </label>

            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="seu@email.com"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-zinc-700"
            >
              Senha
            </label>

            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white transition hover:bg-zinc-800"
          >
            Entrar
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          <Link
            href="/recuperar-senha"
            className="font-medium text-zinc-900 hover:underline"
          >
            Esqueci minha senha
          </Link>
        </p>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Ainda não possui uma conta?{" "}
          <Link
            href="/cadastro"
            className="font-medium text-zinc-900 hover:underline"
          >
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}