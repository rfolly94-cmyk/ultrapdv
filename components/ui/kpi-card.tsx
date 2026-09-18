import type { ReactNode } from "react";

const TOM = {
  neutro: {
    wrap: "border-[var(--line)] bg-white",
    value: "text-zinc-950",
    icon: "bg-zinc-100 text-zinc-600",
  },
  positivo: {
    wrap: "border-emerald-100 bg-emerald-50/80",
    value: "text-emerald-800",
    icon: "bg-emerald-100 text-emerald-700",
  },
  negativo: {
    wrap: "border-rose-100 bg-rose-50/80",
    value: "text-rose-800",
    icon: "bg-rose-100 text-rose-700",
  },
  info: {
    wrap: "border-sky-100 bg-sky-50/80",
    value: "text-sky-950",
    icon: "bg-sky-100 text-sky-700",
  },
  destaque: {
    wrap: "border-blue-100 bg-[var(--primary-soft)]",
    value: "text-zinc-950",
    icon: "bg-white text-[var(--primary)]",
  },
} as const;

export type KpiCardTom = keyof typeof TOM;

export function KpiCard({
  label,
  value,
  tom = "neutro",
  icon,
}: {
  label: string;
  value: ReactNode;
  tom?: KpiCardTom;
  icon?: ReactNode;
}) {
  const estilo = TOM[tom];

  return (
    <div
      className={`rounded-[var(--radius-md)] border px-4 py-3 shadow-[var(--shadow-card)] ${estilo.wrap}`}
    >
      <div className="flex items-start justify-between gap-3">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </dt>
        {icon ? (
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${estilo.icon}`}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <dd
        className={`mt-1.5 text-[18px] font-semibold tabular-nums tracking-tight ${estilo.value}`}
      >
        {value}
      </dd>
    </div>
  );
}
