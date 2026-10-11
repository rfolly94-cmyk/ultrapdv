import Link from "next/link";
import { CreditCard, QrCode, type LucideIcon } from "lucide-react";

export function FinanceiroAtalho({
  href,
  titulo,
  descricao,
  icone,
}: {
  href: string;
  titulo: string;
  descricao: string;
  icone: "pix" | "tef";
}) {
  const Icone: LucideIcon = icone === "tef" ? CreditCard : QrCode;

  return (
    <Link
      href={href}
      className="flex min-w-0 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-800">
        <Icone className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-950">{titulo}</span>
        <span className="mt-1 block text-sm leading-5 text-zinc-500">{descricao}</span>
      </span>
    </Link>
  );
}
