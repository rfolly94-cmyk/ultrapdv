"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import { PageAlert } from "@/components/ui/page-alert";
import {
  abrirCaixa,
  fecharCaixa,
  movimentarCaixa,
} from "@/app/caixa/actions";
import { parseValorCaixa } from "@/lib/caixa/valor";
import { formatarMoeda } from "@/lib/relatorios/formatacao";
import { CaixaResumoValores } from "@/components/caixa/caixa-resumo-valores";

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
          <input
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
  saldoAtual: number;
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
    if (tipo === "sangria" && numero > saldoAtual) {
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
        <p className="text-[13px] text-zinc-500">
          Saldo atual em dinheiro: {formatarMoeda(saldoAtual)}
        </p>
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">Valor</span>
          <input
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

export function ModalFecharCaixa({
  open,
  caixaId,
  saldoInicial,
  suprimentos,
  sangrias,
  saldoEsperado,
  onClose,
}: {
  open: boolean;
  caixaId: string;
  saldoInicial: number;
  suprimentos: number;
  sangrias: number;
  saldoEsperado: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [contado, setContado] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valorContado = parseValorCaixa(contado);
  const diferenca =
    valorContado === null
      ? null
      : Math.round((valorContado - saldoEsperado) * 100) / 100;

  function confirmar() {
    if (valorContado === null) {
      setErro("Informe o dinheiro contado.");
      return;
    }
    if (valorContado < 0) {
      setErro("O dinheiro contado não pode ser negativo.");
      return;
    }
    startTransition(async () => {
      const resultado = await fecharCaixa({
        caixaId,
        dinheiroContado: contado,
        observacao,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setContado("");
      setObservacao("");
      setErro(null);
      onClose();
      router.refresh();
    });
  }

  return (
    <AppModal
      open={open}
      title="Fechar Caixa"
      onClose={onClose}
      size="md"
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
            {pending ? "Fechando..." : "Confirmar fechamento"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {erro ? (
          <PageAlert type="erro" className="mx-0 mt-0">
            {erro}
          </PageAlert>
        ) : null}
        <CaixaResumoValores
          saldoInicial={saldoInicial}
          suprimentos={suprimentos}
          sangrias={sangrias}
          saldoAtual={saldoEsperado}
        />
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">
            Dinheiro contado
          </span>
          <input
            value={contado}
            onChange={(event) => {
              setContado(event.target.value);
              setErro(null);
            }}
            placeholder="0,00"
            inputMode="decimal"
            className="updv-input mt-1 w-full"
          />
        </label>
        <p className="text-[13px] text-zinc-600">
          Diferença:{" "}
          <span
            className={
              diferenca == null
                ? "text-zinc-400"
                : diferenca === 0
                  ? "font-semibold text-zinc-950"
                  : diferenca > 0
                    ? "font-semibold text-emerald-700"
                    : "font-semibold text-rose-700"
            }
          >
            {diferenca == null ? "—" : formatarMoeda(diferenca)}
          </span>
        </p>
        <label className="block text-[13px]">
          <span className="text-xs font-medium text-zinc-600">Observação</span>
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
