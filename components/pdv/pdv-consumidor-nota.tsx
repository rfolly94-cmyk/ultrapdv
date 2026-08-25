"use client";

import {
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
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={cpfNaNotaAtivo}
              onChange={(event) => onCpfNaNotaAtivo(event.target.checked)}
            />
            CPF na nota
          </label>
          {cpfNaNotaAtivo ? (
            <label className="mt-2 block text-xs font-medium text-zinc-600">
              CPF
              <input
                value={cpfNaNota}
                onChange={(event) =>
                  onCpfNaNota(mascararCpfDigitando(event.target.value))
                }
                placeholder="000.000.000-00"
                inputMode="numeric"
                autoComplete="off"
                className="updv-input mt-1 w-full"
              />
            </label>
          ) : null}
        </>
      )}
    </div>
  );
}
