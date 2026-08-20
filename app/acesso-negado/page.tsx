import Link from "next/link";

export const metadata = {
  title: "Acesso não liberado",
};

export default function AcessoNegadoPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <p className="text-sm font-semibold text-amber-700">Permissão</p>
      <h1 className="mt-2 text-2xl font-bold text-zinc-950">
        Acesso não liberado
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600">
        Você não tem permissão para acessar esta página na empresa ativa.
      </p>
      <Link
        href="/painel"
        className="mt-6 inline-flex rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white"
      >
        Voltar
      </Link>
    </main>
  );
}
