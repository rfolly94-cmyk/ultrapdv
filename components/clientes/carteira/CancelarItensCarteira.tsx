"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ItemPreflight = {
  id: string;
  produto_nome: string;
  quantidade: number;
  unidade_medida?: string | null;
  valor_original: number;
  valor_aberto: number;
  status: string;
  pago: number;
};

type Preflight = {
  bloqueado?: boolean;
  motivo_bloqueio?: string;
  venda_id?: string;
  numero?: number | string | null;
  usa_cancelamento_completo?: boolean;
  itens?: ItemPreflight[];
  valorOriginalVenda?: number;
  valorSelecionadoOriginal?: number;
  valorSelecionadoAberto?: number;
  valorPermaneceraAberto?: number;
  valor_pago_cliente?: number;
  exige_destino_recebido?: boolean;
  permite_credito?: boolean;
  possui_documento_fiscal?: boolean;
  fiscal_modelo?: string | null;
  fiscal_numero?: number | string | null;
  fiscal_status?: string | null;
};

type DestinoRecebido = "DEVOLUCAO" | "CREDITO";

type Props = {
  clienteId: string;
  itemIds: string[];
  onFechar: () => void;
};

function dinheiro(valor: number | null | undefined) {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function CancelarItensCarteira({ clienteId, itemIds, onFechar }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [destino, setDestino] = useState<DestinoRecebido | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [avisoFiscalOk, setAvisoFiscalOk] = useState(false);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setMensagem(null);
      try {
        const response = await fetch(
          `/api/clientes/${clienteId}/carteira/cancelar-itens?item_ids=${itemIds.join(",")}`,
          { method: "GET", cache: "no-store" }
        );
        const data = (await response.json()) as {
          ok?: boolean;
          erro?: string;
          preflight?: Preflight;
        };
        if (!ativo) {
          return;
        }
        if (!response.ok || !data.ok) {
          setMensagem(data.erro ?? "Não foi possível analisar os itens.");
          return;
        }
        setPreflight(data.preflight ?? null);
        if (Number(data.preflight?.valor_pago_cliente ?? 0) > 0) {
          setDestino(null);
        }
      } catch (error) {
        if (ativo) {
          setMensagem(
            error instanceof Error
              ? error.message
              : "Falha ao analisar os itens."
          );
        }
      } finally {
        if (ativo) {
          setCarregando(false);
        }
      }
    }
    void carregar();
    return () => {
      ativo = false;
    };
  }, [clienteId, itemIds]);

  const qtd = preflight?.itens?.length ?? itemIds.length;
  const tituloModal =
    qtd === 1 ? "Cancelar item selecionado" : "Cancelar itens selecionados";
  const valorPago = Number(preflight?.valor_pago_cliente ?? 0);

  async function confirmar() {
    if (preflight?.bloqueado) {
      return;
    }
    const motivoLimpo = motivo.trim();
    if (motivoLimpo.length < 5) {
      setMensagem("Informe o motivo com pelo menos 5 caracteres.");
      return;
    }
    if (valorPago > 0 && !destino) {
      setMensagem("Escolha o que fazer com o valor já pago nos itens selecionados.");
      return;
    }

    setEnviando(true);
    setMensagem(null);
    try {
      const response = await fetch(
        `/api/clientes/${clienteId}/carteira/cancelar-itens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmar: "CANCELAR_ITENS_CARTEIRA",
            item_ids: itemIds,
            motivo: motivoLimpo,
            destino_valor_recebido: destino,
            confirmar_fiscal_comercial:
              Boolean(preflight?.possui_documento_fiscal) && avisoFiscalOk,
          }),
        }
      );
      const data = (await response.json()) as {
        ok?: boolean;
        erro?: string;
        resultado?: {
          estoque_quantidade_estornada?: number;
          credito_gerado?: number;
          credito_cliente_disponivel?: number;
          devolucao_registrada?: number;
          valor_permanecera_aberto?: number;
          status_venda?: string;
        };
      };
      if (!response.ok || !data.ok) {
        setMensagem(data.erro ?? "Não foi possível cancelar os itens.");
        return;
      }
      router.refresh();
      onFechar();
    } catch (error) {
      setMensagem(
        error instanceof Error ? error.message : "Falha inesperada no cancelamento."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 className="font-semibold text-red-950">{tituloModal}</h3>
      <p className="mt-1 text-sm text-red-800">
        Venda #{preflight?.numero ?? "—"}
      </p>

      {carregando && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-zinc-700">
          Analisando os itens selecionados...
        </div>
      )}

      {mensagem && (
        <p className="mt-3 text-sm text-red-700">{mensagem}</p>
      )}

      {preflight?.bloqueado && (
        <p className="mt-4 text-sm text-red-800">{preflight.motivo_bloqueio}</p>
      )}

      {preflight?.possui_documento_fiscal &&
        !avisoFiscalOk &&
        !carregando &&
        !preflight.bloqueado && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              Esta venda possui documento fiscal.
            </p>
            <p className="mt-2 text-sm text-amber-900">
              O cancelamento irá movimentar somente Carteira, estoque e demais
              registros comerciais dos itens selecionados.
            </p>
            <p className="mt-2 text-sm text-amber-900">
              O documento fiscal permanecerá inalterado.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onFechar}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => setAvisoFiscalOk(true)}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

      {!(preflight?.possui_documento_fiscal && !avisoFiscalOk) &&
        !carregando &&
        preflight &&
        !preflight.bloqueado && (
          <>
            <p className="mt-3 text-sm font-medium text-red-950">
              {qtd} {qtd === 1 ? "item selecionado" : "itens selecionados"}
            </p>
            <div className="mt-3 space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
              {(preflight.itens ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-zinc-900">{item.produto_nome}</p>
                    <p className="text-xs text-zinc-500">
                      Qtd. {item.quantidade}
                      {item.unidade_medida ? ` ${item.unidade_medida}` : ""}
                    </p>
                  </div>
                  <p className="font-semibold text-zinc-950">
                    {dinheiro(item.valor_original)}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <p>
                Valor dos itens selecionados:{" "}
                <strong>{dinheiro(preflight.valorSelecionadoOriginal)}</strong>
              </p>
              <p>
                Valor que permanecerá na venda:{" "}
                <strong>{dinheiro(preflight.valorPermaneceraAberto)}</strong>
              </p>
            </div>
            {preflight.usa_cancelamento_completo && (
              <p className="mt-2 text-xs text-zinc-600">
                Todos os itens desta venda serão cancelados. A rotina oficial de
                cancelamento comercial completo será usada.
              </p>
            )}
            {valorPago > 0 && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                <p className="font-medium text-zinc-900">
                  Já pago nos itens selecionados: {dinheiro(valorPago)}
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destino-item"
                      checked={destino === "CREDITO"}
                      onChange={() => setDestino("CREDITO")}
                    />
                    Converter em crédito do cliente
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destino-item"
                      checked={destino === "DEVOLUCAO"}
                      onChange={() => setDestino("DEVOLUCAO")}
                    />
                    Registrar devolução ao cliente
                  </label>
                </div>
              </div>
            )}
            <label className="mt-4 block text-sm">
              <span className="text-xs font-medium text-zinc-600">
                Motivo do cancelamento
              </span>
              <textarea
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onFechar}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => void confirmar()}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {qtd === 1
                  ? "Cancelar item selecionado"
                  : "Cancelar itens selecionados"}
              </button>
            </div>
          </>
        )}

      {preflight?.bloqueado && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700"
          >
            Voltar
          </button>
        </div>
      )}
    </div>
  );
}
