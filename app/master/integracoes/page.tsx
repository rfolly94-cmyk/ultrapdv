import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrações",
};

export default function MasterIntegracoesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
          Integrações
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Credenciais globais da plataforma. Empresas não alteram estes dados.
        </p>
      </div>

      <Link
        href="/master/integracoes/geranet"
        className="block rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300"
      >
        <p className="text-sm font-semibold text-zinc-900">Geranet</p>
        <p className="mt-1 text-sm text-zinc-500">
          API Key usada na emissão de NF-e, NFC-e e demais consultas fiscais.
        </p>
      </Link>
    </div>
  );
}
