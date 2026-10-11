import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PageAlert } from "@/components/ui/page-alert";
import { TefAssistente } from "@/components/pdv/tef-assistente";
import { TefPareamentoForm } from "@/components/pdv/tef-pareamento-form";
import { TefPinpadDiagnostico } from "@/components/pdv/tef-pinpad-diagnostico";
import { etapaInicial } from "@/lib/pdv/tef/assistente-instalacao";
import { lerPaginaAssistenteTef } from "@/lib/pdv/tef/assistente-sessao";
import { ErroTef, lerConfigTefAdministrativa } from "@/lib/pdv/tef/servico";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

import { salvarTefEmpresa } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TEF",
};

type PageProps = {
  searchParams: Promise<{ erro?: string; sucesso?: string; assistente?: string }>;
};

export default async function ConfiguracaoTefPage({ searchParams }: PageProps) {
  const params = await searchParams;
  let config: Awaited<ReturnType<typeof lerConfigTefAdministrativa>> | null = null;
  let assistente: Awaited<ReturnType<typeof lerPaginaAssistenteTef>> | null = null;
  let erroLeitura: string | null = null;
  try {
    config = await lerConfigTefAdministrativa();
  } catch (error) {
    erroLeitura =
      error instanceof ErroTef
        ? error.message
        : "Não foi possível carregar a configuração TEF.";
  }
  try {
    assistente = config ? await lerPaginaAssistenteTef() : null;
  } catch (error) {
    erroLeitura =
      error instanceof ErroTef
        ? error.message
        : "Não foi possível carregar o assistente TEF.";
  }
  const abrirAssistente = params.assistente === "1";
  let planoPdv = true;
  let planoNome: string | null = null;
  if (config?.empresaId) {
    const [plano, entitlements] = await Promise.all([
      planoPermiteRecursoEmpresa(config.empresaId, "pdv"),
      carregarEntitlementsEmpresa(config.empresaId),
    ]);
    planoPdv = plano.permitido;
    planoNome = entitlements.planoNome;
  }

  return (
    <PageShell
      title="TEF — PayGoWeb"
      description="Instalação, pinpad e terminais."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Financeiro", href: "/configuracoes/financeiro" },
        { label: "TEF" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
    <div className="updv-config space-y-6">
      {planoPdv ? null : (
        <RecursoNaoContratado
          titulo="TEF — PayGoWeb"
          descricao="O TEF acompanha o PDV. O plano atual da empresa não inclui o PDV, então a instalação, o pinpad e os terminais ficam indisponíveis."
          planoNome={planoNome}
          voltarHref="/configuracoes/financeiro"
          voltarLabel="Voltar ao financeiro"
        />
      )}
      {planoPdv ? (
      <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Configuração desta empresa. O terminal físico é vinculado ao Connector
          da máquina e não pode ser compartilhado com outra empresa.
        </p>
        {abrirAssistente ? (
          <a
            href="/configuracoes/financeiro/tef"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800"
          >
            Voltar à configuração
          </a>
        ) : (
          <a
            href="/configuracoes/financeiro/tef?assistente=1"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Configurar TEF
          </a>
        )}
      </div>
      {params.erro ? <PageAlert type="erro">{params.erro}</PageAlert> : null}
      {params.sucesso ? (
        <PageAlert type="sucesso">Configuração TEF salva.</PageAlert>
      ) : null}
      {erroLeitura ? <PageAlert type="erro">{erroLeitura}</PageAlert> : null}
      {config?.migracaoPendente ? (
        <PageAlert type="erro">
          A estrutura de TEF ainda não foi aplicada no banco. A migration
          20261010120000_tef_multiempresa.sql precisa ser aplicada antes do uso.
        </PageAlert>
      ) : null}
      {abrirAssistente && config && assistente ? (
        <TefAssistente
          cnpj={assistente.cnpj}
          rascunho={assistente.rascunho}
          empresaJaHabilitada={assistente.empresaJaHabilitada}
          administrador={assistente.administrador}
          ambienteAtual={assistente.ambienteAtual === "producao" ? "producao" : "homologacao"}
          pontoAtual={assistente.pontoAtual}
          estabelecimentoAtual={assistente.estabelecimentoAtual}
          migracaoInstalacaoPendente={assistente.migracaoInstalacaoPendente}
          empresaId={config.empresaId}
          terminais={config.terminais}
          podeRevogar={config.podeRevogar}
          etapaInicial={etapaInicial({
            etapaSalva: assistente.rascunho?.etapa ?? null,
            credenciamentoCompleto: assistente.rascunho?.credenciamentoConfirmado === true,
            empresaJaHabilitada: assistente.empresaJaHabilitada,
          })}
        />
      ) : null}
      {abrirAssistente ? null : (
      <>
      <form action={salvarTefEmpresa} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
          <input
            type="checkbox"
            name="habilitado"
            defaultChecked={config?.habilitado === true}
          />
          Habilitar TEF nesta empresa
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          Ambiente
          <select
            name="ambiente"
            defaultValue={config?.ambiente === "producao" ? "producao" : "homologacao"}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          >
            <option value="homologacao">Homologação</option>
            <option value="producao">Produção</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          Estabelecimento
          <input
            name="estabelecimento"
            defaultValue={config?.estabelecimento ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex items-start gap-2 text-sm font-medium text-zinc-800">
          <input
            type="checkbox"
            name="permitir_operacao_manual"
            defaultChecked={config?.permitirOperacaoManual === true}
            disabled={config?.operacaoManualDisponivel !== true}
            className="mt-1"
          />
          <span>
            Autorizar operação manual de cartão
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              Sem esta autorização, o PDV não conclui cartão quando a plataforma
              estiver desligada. Com ela, cada venda manual precisa ser confirmada
              no caixa. A NFC-e continua exigindo os dados reais da transação.
            </span>
          </span>
        </label>
        {config?.operacaoManualDisponivel ? (
          <input type="hidden" name="permitir_operacao_manual_informada" value="1" />
        ) : (
          <p className="text-xs text-zinc-500">
            A autorização de cartão manual ainda não está disponível neste ambiente.
            Enquanto isso, cartão fica bloqueado se o TEF da empresa estiver ligado
            e a plataforma desligada.
          </p>
        )}
        <label className="block text-sm font-medium text-zinc-800">
          Ponto de captura
          <input
            name="pontoCaptura"
            defaultValue={config?.pontoCaptura ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Salvar
        </button>
      </form>
      {config ? (
        <>
          <TefPareamentoForm
            empresaId={config.empresaId}
            terminais={config.terminais}
            podeRevogar={config.podeRevogar}
          />
          <TefPinpadDiagnostico />
        </>
      ) : null}
      </>
      )}
      </>
      ) : null}
    </div>
    </PageShell>
  );
}
