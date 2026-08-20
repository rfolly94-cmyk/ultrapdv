import { formatarData } from "@/lib/relatorios/formatacao";

export function AvisoCarencia({ ate }: { ate: string | null | undefined }) {
  if (!ate) {
    return null;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[13px] text-amber-950">
      Sua assinatura está pendente. Regularize até {formatarData(ate)} para
      evitar a suspensão.
    </div>
  );
}
