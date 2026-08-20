import type { IndicadorRelatorio } from "@/lib/relatorios/tipos";

export function RelatorioResumo({
  indicadores,
}: {
  indicadores: IndicadorRelatorio[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {indicadores.map((item) => (
        <article
          key={item.label}
          className="rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
        >
          <p className="text-[13px] text-zinc-400">{item.label}</p>
          <p className="mt-3 text-[26px] font-bold leading-none tracking-tight text-zinc-950">
            {item.valor}
          </p>
          {item.hint ? (
            <p className="mt-2 text-[12px] text-zinc-400">{item.hint}</p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
