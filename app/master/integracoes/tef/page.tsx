import { PageAlert } from "@/components/ui/page-alert";
import { ErroTef, lerDisponibilidadeTefPlataforma } from "@/lib/pdv/tef/servico";

import { masterDefinirTef } from "./actions";

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
          Liga ou desliga a integração para a plataforma. Esta tela não mostra
          transações, NSU nem credenciais das empresas.
        </p>
      </div>
      {params.erro ? <PageAlert type="erro">{params.erro}</PageAlert> : null}
      {params.sucesso ? (
        <PageAlert type="sucesso">Disponibilidade atualizada.</PageAlert>
      ) : null}
      {erroLeitura ? <PageAlert type="erro">{erroLeitura}</PageAlert> : null}
      <form action={masterDefinirTef} className="rounded-2xl border border-zinc-200 bg-white p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
          <input type="checkbox" name="habilitada" defaultChecked={habilitada} />
          TEF disponível na plataforma
        </label>
        <button
          type="submit"
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Salvar
        </button>
      </form>
    </div>
  );
}
