import Link from "next/link";

export function RecursoNaoContratado({
  titulo,
  descricao,
  planoNome,
  voltarHref,
  voltarLabel = "Voltar",
}: {
  titulo: string;
  descricao: string;
  planoNome?: string | null;
  voltarHref: string;
  voltarLabel?: string;
}) {
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-zinc-200 bg-white p-6">
      <p className="text-sm font-semibold text-amber-700">Recurso do plano</p>
      <h2 className="mt-2 text-xl font-bold text-zinc-950">{titulo}</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{descricao}</p>
      {planoNome ? (
        <p className="mt-4 text-sm text-zinc-700">
          Plano atual: <span className="font-semibold">{planoNome}</span>
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={voltarHref} className="updv-btn updv-btn-primary">
          {voltarLabel}
        </Link>
        <Link href="/assinatura" className="updv-btn updv-btn-ghost">
          Ver assinatura
        </Link>
      </div>
    </section>
  );
}
