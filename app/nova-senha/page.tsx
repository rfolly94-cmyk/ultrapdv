import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { definirNovaSenha } from "@/app/auth/actions";
import { COOKIE_RECUPERACAO_SENHA } from "@/lib/auth/recuperacao";

export const metadata = {
  title: "Nova senha",
};

type PageProps = {
  searchParams: Promise<{
    erro?: string;
  }>;
};

export default async function NovaSenhaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const jar = await cookies();

  if (jar.get(COOKIE_RECUPERACAO_SENHA)?.value !== "1") {
    redirect(
      "/recuperar-senha?erro=" +
        encodeURIComponent("O link de recuperação é inválido ou expirou.")
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          Nova senha
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Defina uma senha nova para a conta.
        </p>

        {params.erro && (
          <div className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {params.erro}
          </div>
        )}

        <form action={definirNovaSenha} className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Nova senha
            </span>
            <input
              name="senha"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Confirmar nova senha
            </span>
            <input
              name="confirmar_senha"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white hover:bg-zinc-800"
          >
            Salvar senha
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/login" className="font-medium text-zinc-900 underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </main>
  );
}
