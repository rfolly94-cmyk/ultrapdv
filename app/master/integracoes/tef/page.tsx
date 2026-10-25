import { PageAlert } from "@/components/ui/page-alert";
import { ErroTef, lerDisponibilidadeTefPlataforma } from "@/lib/pdv/tef/servico";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TEF",
};

type PageProps = {
  searchParams: Promise<{ erro?: string; sucesso?: string }>;
};

export default async function MasterTefPage({ searchParams }: PageProps) {
  const params = await searchParams;
  let habilitada = false;
  let erroLeitura: string | null = null;
  try {
    habilitada = (await lerDisponibilidadeTefPlataforma()).habilitada;
  } catch (error) {
    erroLeitura =
      error instanceof ErroTef
        ? error.message
        : "Não foi possível consultar a disponibilidade do TEF.";
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Integrações
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950">TEF</h1>
        <p className="mt-1 text-sm text-zinc-500">
          A cobrança, a instalação e o PinPad foram retirados da aplicação. O
          registro da plataforma permanece somente para consulta.
        </p>
      </div>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-zinc-500">Situação gravada</p>
        <p className="mt-2 text-lg font-semibold text-zinc-950">
          {habilitada ? "Habilitada no registro" : "Desligada no registro"}
        </p>
        <p className="mt-2 max-w-prose text-sm leading-6 text-zinc-600">
          Esta tela não religa a cobrança e não apaga operações, vendas nem NFC-e.
        </p>
      </section>
      {params.erro ? <PageAlert type="erro">{params.erro}</PageAlert> : null}
      {params.sucesso ? (
        <PageAlert type="sucesso">Disponibilidade atualizada.</PageAlert>
      ) : null}
      {erroLeitura ? <PageAlert type="erro">{erroLeitura}</PageAlert> : null}
    </div>
  );
}
