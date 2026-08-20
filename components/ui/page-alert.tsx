import type { ReactNode } from "react";

export function PageAlert({
  type,
  children,
  className,
}: {
  type: "erro" | "sucesso" | "aviso";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 text-[13px] ${
        type === "erro"
          ? "border-red-200 bg-red-50 text-red-700"
          : type === "aviso"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
      } ${className ?? "mx-4 mt-3"}`}
    >
      {children}
    </div>
  );
}
