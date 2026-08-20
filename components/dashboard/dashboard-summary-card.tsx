export function DashboardSummaryCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "alert" | "ok";
}) {
  const valorClasse =
    tone === "alert"
      ? "text-rose-500"
      : tone === "ok"
        ? "text-emerald-600"
        : "text-zinc-950";

  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <p className="text-[13px] text-zinc-400">{label}</p>
      <p
        className={`mt-4 text-[26px] font-bold leading-none tracking-tight ${valorClasse}`}
      >
        {value}
      </p>
      {hint && <p className="mt-4 text-[12px] text-zinc-400">{hint}</p>}
    </div>
  );
}
