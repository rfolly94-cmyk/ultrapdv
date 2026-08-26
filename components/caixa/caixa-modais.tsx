"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import { CampoValor } from "@/components/ui/campo-valor";
import { PageAlert } from "@/components/ui/page-alert";
import {
  abrirCaixa,
  movimentarCaixa,
} from "@/app/caixa/actions";
import { parseValorCaixa } from "@/lib/caixa/valor";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

export function ModalAbrirCaixa({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saldo, setSaldo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    const valor = parseValorCaixa(saldo);
    if (valor === null) {
      setErro("Informe o saldo inicial em dinheiro.");
      return;
    }
    if (valor < 0) {
      setErro("O saldo inicial não pode ser negativo.");
      return;
    }
    startTransition(async () => {
      const resultado = await abrirCaixa({
        saldoInicial: saldo,
        observacao,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setSaldo("");
      setObservacao("");
      setErro(null);
      onClose();
      router.refresh();
    });
  }

  return (
    <AppModal
      open={open}
      title="Abrir Caixa"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="updv-btn updv-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={confirmar}
          >
            {pending ? "Abrindo..." : "Confirmar abertura"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {erro ? (
          <PageAlert type="erro" className="mx-0 mt-0">
            {erro}
          </PageAlert>
        ) : null}
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">
            Saldo inicial em dinheiro
          </span>
          <CampoValor
            value={saldo}
            onChange={(event) => {
              setSaldo(event.target.value);
              setErro(null);
            }}
            placeholder="0,00"
            inputMode="decimal"
            className="updv-input mt-1 w-full"
          />
        </label>
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">
            Observação (opcional)
          </span>
          <textarea
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
            rows={3}
            className="updv-input mt-1 h-auto w-full py-2"
          />
        </label>
      </div>
    </AppModal>
  );
}

export function ModalMovimentoCaixa({
  open,
  tipo,
  caixaId,
  saldoAtual,
  onClose,
}: {
  open: boolean;
  tipo: "suprimento" | "sangria";
  caixaId: string;
  saldoAtual: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titulo = tipo === "sangria" ? "Sangria" : "Suprimento";

  function confirmar() {
    const numero = parseValorCaixa(valor);
    if (numero === null || numero <= 0) {
      setErro("Informe um valor maior que zero.");
      return;
    }
    if (
      tipo === "sangria" &&
      saldoAtual != null &&
      numero > saldoAtual
    ) {
      setErro(
        `Sangria maior que o saldo atual em dinheiro (${formatarMoeda(saldoAtual)}).`
      );
      return;
    }
    if (motivo.trim().length < 3) {
      setErro("Informe o motivo com pelo menos 3 caracteres.");
      return;
    }
    startTransition(async () => {
      const resultado = await movimentarCaixa({
        caixaId,
        tipo,
        valor,
        motivo,
        observacao,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setValor("");
      setMotivo("");
      setObservacao("");
      setErro(null);
      onClose();
      router.refresh();
    });
  }

  return (
    <AppModal
      open={open}
      title={titulo}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="updv-btn updv-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={confirmar}
          >
            {pending ? "Registrando..." : `Confirmar ${titulo.toLowerCase()}`}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {erro ? (
          <PageAlert type="erro" className="mx-0 mt-0">
            {erro}
          </PageAlert>
        ) : null}
        {saldoAtual != null ? (
          <p className="text-[13px] text-zinc-500">
            Saldo atual em dinheiro: {formatarMoeda(saldoAtual)}
          </p>
        ) : null}
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">Valor</span>
          <CampoValor
            value={valor}
            onChange={(event) => {
              setValor(event.target.value);
              setErro(null);
            }}
            placeholder="0,00"
            inputMode="decimal"
            className="updv-input mt-1 w-full"
          />
        </label>
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">Motivo</span>
          <input
            value={motivo}
            onChange={(event) => {
              setMotivo(event.target.value);
              setErro(null);
            }}
            className="updv-input mt-1 w-full"
          />
        </label>
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">
            Observação (opcional)
          </span>
          <textarea
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
            rows={3}
            className="updv-input mt-1 h-auto w-full py-2"
          />
        </label>
      </div>
    </AppModal>
  );
}

