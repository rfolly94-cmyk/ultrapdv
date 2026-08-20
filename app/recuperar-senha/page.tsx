import Link from "next/link";

import { solicitarRecuperacaoSenha } from "@/app/auth/actions";
import { MENSAGEM_RECUPERACAO_NEUTRA } from "@/lib/auth/recuperacao";

export const metadata = {
  title: "Recuperar senha",
};

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    mensagem?: string;
  }>;
};

export default async function RecuperarSenhaPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          Recuperar senha
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Informe o e-mail da conta. Se existir, enviaremos as instruções.
        </p>

        {(params.erro || params.mensagem) && (
          <div
            className={`mt-5 rounded-lg px-4 py-3 text-sm ${
              params.erro
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {params.erro || params.mensagem || MENSAGEM_RECUPERACAO_NEUTRA}
          </div>
        )}

        <form action={solicitarRecuperacaoSenha} className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              E-mail
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white hover:bg-zinc-800"
          >
            Enviar instruções
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
