"use client";

import { useState } from "react";

import { AppModal } from "@/components/ui/app-modal";
import {
  MENSAGEM_CPF_INVALIDO,
  cpfValido,
  formatarDocumentoDestinatario,
  mascararCpfDigitando,
} from "@/lib/fiscal/destinatario/documento";

export function PdvConsumidorNota({
  clienteDocumento,
  usarDocumentoCliente,
  onUsarDocumentoCliente,
  cpfNaNotaAtivo,
  onCpfNaNotaAtivo,
  cpfNaNota,
  onCpfNaNota,
}: {
  clienteDocumento: string | null;
  usarDocumentoCliente: boolean;
  onUsarDocumentoCliente: (valor: boolean) => void;
  cpfNaNotaAtivo: boolean;
  onCpfNaNotaAtivo: (valor: boolean) => void;
  cpfNaNota: string;
  onCpfNaNota: (valor: string) => void;
}) {
  const documentoCliente = formatarDocumentoDestinatario(clienteDocumento);
  const temDocumentoCliente = Boolean(
    String(clienteDocumento ?? "").replace(/\D/g, "")
  );
  const cpfSalvo = cpfValido(cpfNaNota)
    ? formatarDocumentoDestinatario(cpfNaNota)
    : "";

  const [modalAberto, setModalAberto] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function abrirModal() {
    setRascunho(cpfSalvo || mascararCpfDigitando(cpfNaNota));
    setErro(null);
    setModalAberto(true);
  }

  function cancelarModal() {
    setModalAberto(false);
    setErro(null);
    if (!cpfSalvo) {
      onCpfNaNotaAtivo(false);
      onCpfNaNota("");
    }
  }

  function confirmarCpf() {
    if (!cpfValido(rascunho)) {
      setErro(MENSAGEM_CPF_INVALIDO);
      return;
    }
    onCpfNaNota(mascararCpfDigitando(rascunho));
    onCpfNaNotaAtivo(true);
    setModalAberto(false);
    setErro(null);
  }

  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Consumidor
      </p>

      {temDocumentoCliente ? (
        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={usarDocumentoCliente}
            onChange={(event) => onUsarDocumentoCliente(event.target.checked)}
          />
          <span>
            Usar CPF/CNPJ do cliente na nota
            <span className="mt-0.5 block text-xs text-zinc-500">
              {documentoCliente}
            </span>
          </span>
        </label>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={cpfNaNotaAtivo}
              onChange={(event) => {
                if (event.target.checked) {
                  onCpfNaNotaAtivo(true);
                  abrirModal();
                  return;
                }
                onCpfNaNotaAtivo(false);
                onCpfNaNota("");
              }}
            />
            <button
              type="button"
              className="flex min-w-0 items-baseline gap-2 text-left"
              onClick={() => {
                if (cpfNaNotaAtivo) {
                  abrirModal();
                  return;
                }
                onCpfNaNotaAtivo(true);
                abrirModal();
              }}
            >
              <span>CPF na nota</span>
              {cpfSalvo ? (
                <span className="truncate text-xs font-normal text-zinc-500">
                  {cpfSalvo}
                </span>
              ) : null}
            </button>
          </div>

          <AppModal
            open={modalAberto}
            title="CPF na nota"
            onClose={cancelarModal}
            overlayClassName="z-[90]"
            footer={
              <>
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  onClick={cancelarModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="updv-btn updv-btn-primary"
                  onClick={confirmarCpf}
                >
                  Confirmar
                </button>
              </>
            }
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmarCpf();
              }}
            >
              <label className="block text-xs font-medium text-zinc-600">
                CPF
                <input
                  value={rascunho}
                  onChange={(event) => {
                    setRascunho(mascararCpfDigitando(event.target.value));
                    setErro(null);
                  }}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  className="updv-input mt-1 w-full"
                />
              </label>
              {erro ? (
                <p className="mt-2 text-xs font-medium text-red-700">{erro}</p>
              ) : null}
            </form>
          </AppModal>
        </>
      )}
    </div>
  );
}
