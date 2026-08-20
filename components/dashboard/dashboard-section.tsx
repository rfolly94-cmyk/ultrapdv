import type { ReactNode } from "react";
import Link from "next/link";

export function DashboardSection({
  title,
  href,
  actionLabel = "Abrir",
  children,
  className = "",
}: {
  title: string;
  href?: string;
  actionLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
        {href && (
          <Link
            href={href}
            className="rounded-lg bg-[#4A3AFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#3b2fe0]"
          >
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
