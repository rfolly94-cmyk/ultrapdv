import { PageAlert } from "@/components/ui/page-alert";
import { carregarDiagnosticoApiKeyGeranet } from "@/lib/fiscal/geranet/credencial-plataforma";
import { exigirMaster } from "@/lib/master/exigir-master";

import {
  masterSalvarApiKeyGeranet,
  masterTestarConexaoGeranet,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Geranet",
};

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function MasterGeranetPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { admin } = await exigirMaster();
  const diagnostico = await carregarDiagnosticoApiKeyGeranet(admin);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Integrações
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950">
          Geranet
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          API Key global da plataforma. Empresas configuram apenas certificado
          e CSC nas próprias credenciais fiscais.
        </p>
      </div>

      {params.erro ? (
        <PageAlert type="erro">{params.erro}</PageAlert>
      ) : null}
      {params.sucesso ? (
        <PageAlert type="sucesso">{params.sucesso}</PageAlert>
      ) : null}

      {diagnostico.migracao === "divergente" ? (
        <PageAlert type="erro">
          Há mais de uma API Key Geranet distinta entre empresas. A cópia
          automática foi interrompida. Informe a chave global abaixo. As
          chaves antigas por empresa foram preservadas e não foram apagadas.
        </PageAlert>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-sm font-medium text-zinc-500">Status</p>
        <p className="mt-2 text-lg font-semibold text-zinc-900">
          {diagnostico.configurada ? "Configurada" : "Não configurada"}
        </p>
        {diagnostico.mascara ? (
          <p className="mt-1 text-sm text-zinc-500">
            Chave atual: {diagnostico.mascara}
          </p>
        ) : null}
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">API Key</h2>
        <p className="mt-1 text-sm text-zinc-500">
          A chave é validada na Geranet antes de ser armazenada no cofre da
          plataforma.
        </p>

        <form action={masterSalvarApiKeyGeranet} className="mt-5">
          <label className="block text-sm font-medium text-zinc-700">
            API Key
          </label>
          <input
            name="api_key"
            type="password"
            required
            autoComplete="off"
            placeholder="gn_..."
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
          />
          <button type="submit" className="updv-btn updv-btn-primary mt-5">
            Validar e salvar API Key
          </button>
        </form>

        {diagnostico.configurada ? (
          <form action={masterTestarConexaoGeranet} className="mt-4">
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Testar conexão com Geranet
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
