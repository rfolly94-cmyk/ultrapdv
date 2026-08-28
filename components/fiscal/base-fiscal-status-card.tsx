import { statusBaseFiscalUltrapdv } from "@/lib/fiscal/base-oficial/status";
import { createClient } from "@/lib/supabase/server";

export async function BaseFiscalStatusCard() {
  const supabase = await createClient();
  let status;
  try {
    status = await statusBaseFiscalUltrapdv(supabase);
  } catch {
    return null;
  }

  return (
    <section className="mt-6 rounded-md border border-zinc-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Avançado
      </p>
      <h2 className="mt-1 text-[15px] font-semibold text-zinc-950">
        Base Fiscal UltraPDV
      </h2>
      <p className="mt-1 text-[13px] text-zinc-500">
        Atualização automática no servidor. O cliente não importa tabelas.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {status.tabelas.map((tabela) => (
          <div
            key={tabela.codigo}
            className="rounded-xl border border-zinc-200 px-4 py-3"
          >
            <p className="text-sm font-semibold">{tabela.nome}</p>
            <p className="text-sm text-zinc-600">{tabela.status}</p>
            <p className="text-xs text-zinc-400">
              {tabela.quantidade ?? 0} registros · {tabela.versao}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-zinc-500">
        Última verificação: {formatar(status.ultimaVerificacao)}
      </p>
      <p className="text-[12px] text-zinc-500">
        Última atualização: {formatar(status.ultimaAtualizacao)}
      </p>
      <p className="mt-1 text-[12px] font-medium text-zinc-700">
        Status: {status.statusGeral}
      </p>
    </section>
  );
}

function formatar(valor: string | null) {
  if (!valor) {
    return "ainda não executada";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return valor;
  }
  return data.toLocaleString("pt-BR");
}
