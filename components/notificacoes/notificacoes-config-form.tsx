"use client";

import { useState, useTransition } from "react";

import { salvarConfiguracaoNotificacoesAction } from "@/app/notificacoes/actions";
import { PageAlert } from "@/components/ui/page-alert";
import type { ConfiguracaoNotificacoes } from "@/lib/notificacoes/tipos";

function CampoSwitch({
  nome,
  label,
  checked,
  disabled,
  onChange,
}: {
  nome: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 text-[13px] text-zinc-800">
      <span>{label}</span>
      <input
        type="checkbox"
        name={nome}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-zinc-300"
      />
    </label>
  );
}

export function NotificacoesConfigForm({
  inicial,
  podeEditar,
  aviso,
}: {
  inicial: ConfiguracaoNotificacoes;
  podeEditar: boolean;
  aviso?: string | null;
}) {
  const [pending, start] = useTransition();
  const [config, setConfig] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  function alterar<K extends keyof ConfiguracaoNotificacoes>(
    chave: K,
    valor: ConfiguracaoNotificacoes[K]
  ) {
    setConfig((atual) => ({ ...atual, [chave]: valor }));
  }

  function salvar() {
    start(async () => {
      const saida = await salvarConfiguracaoNotificacoesAction(config);
      if (!saida.ok) {
        setErro(saida.erro);
        setSucesso(null);
        return;
      }
      setErro(null);
      setSucesso(saida.mensagem ?? "Preferências salvas.");
    });
  }

  return (
    <div className="space-y-4">
      {aviso ? (
        <PageAlert type="aviso" className="mx-0">
          {aviso}
        </PageAlert>
      ) : null}
      {erro ? (
        <PageAlert type="erro" className="mx-0">
          {erro}
        </PageAlert>
      ) : null}
      {sucesso ? (
        <PageAlert type="sucesso" className="mx-0">
          {sucesso}
        </PageAlert>
      ) : null}

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Estoque</h2>
        <CampoSwitch
          nome="estoqueBaixo"
          label="Estoque baixo"
          checked={config.estoqueBaixo}
          disabled={!podeEditar}
          onChange={(valor) => alterar("estoqueBaixo", valor)}
        />
        <CampoSwitch
          nome="estoqueZerado"
          label="Estoque zerado"
          checked={config.estoqueZerado}
          disabled={!podeEditar}
          onChange={(valor) => alterar("estoqueZerado", valor)}
        />
        <CampoSwitch
          nome="estoqueNegativo"
          label="Estoque negativo"
          checked={config.estoqueNegativo}
          disabled={!podeEditar}
          onChange={(valor) => alterar("estoqueNegativo", valor)}
        />
        <label className="mt-2 block text-[13px] text-zinc-800">
          Estoque mínimo padrão da empresa
          <input
            type="number"
            min={0}
            value={config.estoqueMinimoPadrao}
            disabled={!podeEditar}
            onChange={(event) =>
              alterar("estoqueMinimoPadrao", Number(event.target.value) || 0)
            }
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <p className="mt-1 text-[12px] text-zinc-500">
          Usado só quando o produto não tem mínimo próprio em Estoque. Zero
          desliga o padrão.
        </p>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Validade</h2>
        <CampoSwitch
          nome="loteVencendo"
          label="Lote próximo do vencimento"
          checked={config.loteVencendo}
          disabled={!podeEditar}
          onChange={(valor) => alterar("loteVencendo", valor)}
        />
        <CampoSwitch
          nome="loteVencido"
          label="Lote vencido"
          checked={config.loteVencido}
          disabled={!podeEditar}
          onChange={(valor) => alterar("loteVencido", valor)}
        />
        <label className="mt-2 block text-[13px] text-zinc-800">
          Antecedência do aviso (dias)
          <input
            type="number"
            min={0}
            max={365}
            value={config.antecedenciaValidadeDias}
            disabled={!podeEditar}
            onChange={(event) =>
              alterar(
                "antecedenciaValidadeDias",
                Number(event.target.value) || 0
              )
            }
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Financeiro</h2>
        <CampoSwitch
          nome="carteiraVencida"
          label="Carteira vencida"
          checked={config.carteiraVencida}
          disabled={!podeEditar}
          onChange={(valor) => alterar("carteiraVencida", valor)}
        />
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Fiscal</h2>
        <CampoSwitch
          nome="fiscalRejeitada"
          label="Nota rejeitada"
          checked={config.fiscalRejeitada}
          disabled={!podeEditar}
          onChange={(valor) => alterar("fiscalRejeitada", valor)}
        />
        <CampoSwitch
          nome="fiscalAguardandoReconciliacao"
          label="Aguardando reconciliação"
          checked={config.fiscalAguardandoReconciliacao}
          disabled={!podeEditar}
          onChange={(valor) =>
            alterar("fiscalAguardandoReconciliacao", valor)
          }
        />
        <CampoSwitch
          nome="fiscalCertificadoVencendo"
          label="Certificado próximo do vencimento"
          checked={config.fiscalCertificadoVencendo}
          disabled={!podeEditar}
          onChange={(valor) => alterar("fiscalCertificadoVencendo", valor)}
        />
        <CampoSwitch
          nome="fiscalRevisaoBase"
          label="Produtos para revisão após nova base fiscal"
          checked={config.fiscalRevisaoBase}
          disabled={!podeEditar}
          onChange={(valor) => alterar("fiscalRevisaoBase", valor)}
        />
        <label className="mt-2 block text-[13px] text-zinc-800">
          Antecedência do certificado (dias)
          <input
            type="number"
            min={0}
            max={365}
            value={config.antecedenciaCertificadoDias}
            disabled={!podeEditar}
            onChange={(event) =>
              alterar(
                "antecedenciaCertificadoDias",
                Number(event.target.value) || 0
              )
            }
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Caixa</h2>
        <CampoSwitch
          nome="caixaAbertoAnterior"
          label="Caixa aberto do dia anterior"
          checked={config.caixaAbertoAnterior}
          disabled={!podeEditar}
          onChange={(valor) => alterar("caixaAbertoAnterior", valor)}
        />
      </section>

      <button
        type="button"
        className="updv-btn updv-btn-primary"
        disabled={!podeEditar || pending}
        onClick={salvar}
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
