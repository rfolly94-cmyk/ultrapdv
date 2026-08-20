import type { ReactNode } from "react";
import Link from "next/link";

const iconeFundo: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-600",
  orange: "bg-orange-100 text-orange-500",
  green: "bg-emerald-100 text-emerald-600",
  pink: "bg-pink-100 text-pink-500",
  blue: "bg-sky-100 text-sky-600",
  amber: "bg-amber-100 text-amber-600",
};

export function DashboardMetricCard({
  label,
  value,
  hint,
  href,
  icon,
  accent = "indigo",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  icon?: ReactNode;
  accent?: keyof typeof iconeFundo;
}) {
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-zinc-400">{label}</p>
        {icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconeFundo[accent]}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-[28px] font-bold leading-none tracking-tight text-zinc-950">
        {value}
      </p>
      {hint && <p className="mt-2 text-[12px] text-zinc-400">{hint}</p>}
    </>
  );

  const classe =
    "block rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]";

  if (href) {
    return (
      <Link href={href} className={classe}>
        {conteudo}
      </Link>
    );
  }

  return <div className={classe}>{conteudo}</div>;
}
