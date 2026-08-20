import { masterSalvarPlano } from "@/lib/master/acoes";
import { listarPlanosMaster } from "@/lib/master/empresas";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planos",
};

export default async function MasterPlanosPage() {
  const planos = await listarPlanosMaster();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Planos</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cadastro comercial. Recursos por plano virão em uma etapa posterior.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Valor mensal</th>
              <th className="px-4 py-3 font-medium">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {planos.map((plano) => (
              <tr key={plano.id} className="border-t border-zinc-100">
                <td className="px-4 py-3 font-medium">{plano.nome}</td>
                <td className="px-4 py-3 text-zinc-600">{plano.descricao || "—"}</td>
                <td className="px-4 py-3">
                  {plano.valorMensal == null ? "—" : formatarMoeda(plano.valorMensal)}
                </td>
                <td className="px-4 py-3">{plano.ativo ? "Sim" : "Não"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Novo plano ou edição</h2>
        <form action={masterSalvarPlano} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-zinc-500">ID (preencha para editar)</span>
            <select name="id" className="updv-input" defaultValue="">
              <option value="">Criar novo</option>
              {planos.map((plano) => (
                <option key={plano.id} value={plano.id}>
                  {plano.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Nome</span>
            <input name="nome" required className="updv-input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Valor mensal</span>
            <input name="valor_mensal" className="updv-input" placeholder="197,00" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-zinc-500">Descrição</span>
            <input name="descricao" className="updv-input" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ativo" defaultChecked />
            Ativo
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Ordem</span>
            <input name="ordem" type="number" defaultValue={planos.length + 1} className="updv-input" />
          </label>
          <div>
            <button type="submit" className="updv-btn updv-btn-primary">
              Salvar plano
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
