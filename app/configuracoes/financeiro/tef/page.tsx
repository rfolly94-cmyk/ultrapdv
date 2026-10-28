import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { TefConfiguracaoEmpresa } from "@/components/pdv/tef-configuracao-empresa";
import { TefMotorCsharpPainel } from "@/components/pdv/tef-motor-csharp";
import { formatarCnpj } from "@/lib/pdv/tef/assistente-instalacao";
import { carregarConfiguracaoMotor, identidadeEmpresaSessao } from "@/lib/pdv/tef/politica-empresa-servidor";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TEF",
};

const PRESERVADO = [
  "Vendas e pagamentos já lançados",
  "NFC-e emitida",
  "Operações TEF já registradas",
];

export default async function ConfiguracaoTefPage() {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    redirect("/login");
  }

  const [plano, entitlements, identidade, motor] = await Promise.all([
    planoPermiteRecursoEmpresa(sessao.empresaId, "pdv"),
    carregarEntitlementsEmpresa(sessao.empresaId),
    identidadeEmpresaSessao(),
    carregarConfiguracaoMotor(sessao.empresaId),
  ]);

  return (
    <PageShell
      title="TEF"
      description="O ambiente TEF é escolhido por empresa. Credenciais e journals de homologação e produção permanecem separados."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Financeiro", href: "/configuracoes/financeiro" },
        { label: "TEF" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config space-y-4">
        {plano.permitido ? null : (
          <RecursoNaoContratado
            titulo="TEF"
            descricao="O histórico do TEF acompanha o PDV. O plano atual da empresa não inclui o PDV."
            planoNome={entitlements.planoNome}
            voltarHref="/configuracoes/financeiro"
            voltarLabel="Voltar ao financeiro"
          />
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Situação
            </p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950">
              Integração operacional desativada em produção
            </h2>
            <p className="mt-3 max-w-prose text-sm leading-6 text-zinc-600">
              O motor novo é o UltraPDV.TEF em C#/.NET 8 x64, chamado pelo Connector
              principal. A empresa ativa vem da sessão. CNPJ, ponto, terminal e
              diretório ficam isolados por empresa. Instalação, crédito, débito,
              confirmação e cancelamento existem no motor e não rodam sem
              autorização explícita de homologação.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Ambiente</dt>
                <dd className="font-medium text-zinc-950">Homologação ou produção, por empresa</dd>
              </div>
              <div>
                <dt className="text-zinc-500">CNPJ</dt>
                <dd className="font-medium text-zinc-950">O cadastro da empresa ativa</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Ponto de captura</dt>
                <dd className="font-medium text-zinc-950">Pedido pela biblioteca na instalação</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Terminal e PinPad</dt>
                <dd className="font-medium text-zinc-950">Um diretório e um journal por terminal</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Instalação</dt>
                <dd className="font-medium text-zinc-950">Lida neste computador, sem repetir a instalação</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Ambiente ativo</dt>
                <dd className="font-medium text-zinc-950">{motor.ambiente === "producao" ? "Produção" : "Homologação"}</dd>
              </div>
            </dl>
            {plano.permitido && identidade ? (
              <TefConfiguracaoEmpresa
                razaoSocial={identidade.razaoSocial}
                nomeFantasia={identidade.nomeFantasia}
                cnpj={formatarCnpj(identidade.cnpj)}
                empresaId={identidade.empresaId}
                administrador={sessao.perfil.trim().toLowerCase() === "administrador"}
                habilitado={motor.habilitado}
                ambiente={motor.ambiente}
                configurado={motor.existe}
                referenciaInicial={motor.referenciaCredenciamento}
                situacaoInicial={motor.situacaoCredenciamento}
                comprovadoEmInicial={motor.comprovadoEm}
                credenciamentoInicial={motor.credenciamentoComprovado}
              />
            ) : null}
            {plano.permitido && motor.ambiente !== "producao" ? <TefMotorCsharpPainel /> : null}
          </section>
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-950">O que permanece</h2>
            <ul className="mt-3 space-y-2 text-sm text-zinc-700">
              {PRESERVADO.map((item) => (
                <li key={item} className="rounded-lg bg-zinc-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p className="max-w-prose text-sm leading-6 text-zinc-500">
          As duas operações locais com retorno -2596 e resultado 151 não foram
          recriadas e não estão conciliadas. A confirmação externa com a SETIS
          continua necessária.
        </p>
      </div>
    </PageShell>
  );
}
