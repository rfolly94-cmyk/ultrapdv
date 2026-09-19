import Link from "next/link";

export const metadata = {
  title: "Acesso desativado",
};

export default function AcessoDesativadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Acesso</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">
          Acesso desativado
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Seu acesso à empresa foi desativado. Entre em contato com o
          administrador.
        </p>
        <Link
          href="/logout"
          className="mt-6 inline-flex rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Sair
        </Link>
      </div>
    </main>
  );
}
