"use client";

import { useState, useTransition } from "react";

import { definirControleCaixa } from "@/app/configuracoes/caixa/actions";
import { AppModal } from "@/components/ui/app-modal";
import { PageAlert } from "@/components/ui/page-alert";
import {
  MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR,
} from "@/lib/caixa/mensagens";

const DESCRICAO_ATIVADO =
  "Exige abertura de Caixa e registra vendas, recebimentos e movimentações para conferência e fechamento.";

const DESCRICAO_DESATIVADO =
  "Permite operar vendas e recebimentos sem sessão de Caixa. O histórico anterior permanece disponível.";

export function CaixaControleForm({
  controleAtivo,
  caixaAberto,
  podeEditar,
}: {
  controleAtivo: boolean;
  caixaAberto: boolean;
  podeEditar: boolean;
}) {
  const [pending, start] = useTransition();
  const [ativo, setAtivo] = useState(controleAtivo);
  const [confirmarDesativar, setConfirmarDesativar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  function aplicar(proximo: boolean) {
    start(async () => {
      const saida = await definirControleCaixa({ ativo: proximo });
      if (!saida.ok) {
        setErro(saida.erro);
        setSucesso(null);
        return;
      }
      setAtivo(proximo);
      setErro(null);
      setSucesso(saida.mensagem ?? null);
      setConfirmarDesativar(false);
    });
  }

  function aoAlternar(proximo: boolean) {
    setErro(null);
    setSucesso(null);
    if (proximo === ativo) {
      return;
    }
    if (!proximo && caixaAberto) {
      setErro(MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR);
      return;
    }
    if (!proximo) {
      setConfirmarDesativar(true);
      return;
    }
    aplicar(true);
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-[15px] font-semibold text-zinc-950">
        Usar controle de Caixa
      </h2>
      <p className="mt-1 text-[13px] text-zinc-500">
        {ativo ? DESCRICAO_ATIVADO : DESCRICAO_DESATIVADO}
      </p>

      {erro ? (
        <PageAlert type="erro" className="mx-0 mt-4">
          {erro}
        </PageAlert>
      ) : null}
      {sucesso ? (
        <PageAlert type="sucesso" className="mx-0 mt-4">
          {sucesso}
        </PageAlert>
      ) : null}

      <label className="mt-4 flex items-center gap-3 text-[13px] text-zinc-700">
        <input
          type="checkbox"
          role="switch"
          aria-label="Usar controle de Caixa"
          checked={ativo}
          disabled={!podeEditar || pending}
          onChange={(event) => aoAlternar(event.target.checked)}
        />
        <span>{ativo ? "Ativado" : "Desativado"}</span>
      </label>

      {!podeEditar ? (
        <p className="mt-2 text-[13px] text-zinc-500">
          Você pode visualizar o status, mas não tem permissão para alterar esta
          configuração.
        </p>
      ) : null}

      {podeEditar && caixaAberto && ativo ? (
        <p className="mt-2 text-[13px] text-zinc-500">
          {MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR}
        </p>
      ) : null}

      <AppModal
        open={confirmarDesativar}
        title="Desativar controle de Caixa?"
        onClose={() => {
          if (!pending) {
            setConfirmarDesativar(false);
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={pending}
              onClick={() => setConfirmarDesativar(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              disabled={pending}
              onClick={() => aplicar(false)}
            >
              {pending ? "Desativando..." : "Desativar"}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-zinc-600">
          Novas vendas e recebimentos deixarão de fazer parte do fechamento de
          Caixa. O histórico existente será preservado.
        </p>
      </AppModal>
    </div>
  );
}
