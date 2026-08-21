"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Props = {
  vendaId: string;
  numero:
    | number
    | string
    | null;
  iniciarAberto?: boolean;
  onFechar?: () => void;
};

type DestinoRecebido =
  | "DEVOLUCAO"
  | "CREDITO";

type Preflight = {
  cliente_identificado?:
    boolean;
  possui_titulo_fiado?:
    boolean;

  valor_fiado_original?:
    number;
  valor_fiado_aberto?:
    number;

  pagamento_imediato_liquido?:
    number;
  fiado_recebido?:
    number;
  valor_pago_cliente?:
    number;

  exige_destino_recebido?:
    boolean;
  permite_credito?:
    boolean;

  possui_documento_fiscal?:
    boolean;
  fiscal_modelo?:
    string | null;
  fiscal_numero?:
    number | string | null;
  fiscal_status?:
    string | null;
};

type RespostaPreflight = {
  ok?: boolean;
  erro?: string;
  preflight?: Preflight;
};

type Resposta = {
  ok?: boolean;
  erro?: string;
  resultado?: {
    status?: string;

    estoque_quantidade_estornada?:
      number;

    pagamento_imediato_liquido?:
      number;
    fiado_recebido?:
      number;
    fiado_saldo_aberto_cancelado?:
      number;
    valor_pago_cliente_tratado?:
      number;

    credito_gerado?:
      number;
    credito_cliente_disponivel?:
      number;

    devolucao_registrada?:
      number;
    devolucao_status?:
      string | null;
  };
};

function dinheiro(
  valor:
    | number
    | null
    | undefined
) {
  return Number(
    valor ?? 0
  ).toLocaleString(
    "pt-BR",
    {
      style:
        "currency",
      currency:
        "BRL",
    }
  );
}

export function CancelarVendaComercial({
  vendaId,
  numero,
  iniciarAberto = false,
  onFechar,
}: Props) {
  const router =
    useRouter();

  const [
    aberto,
    setAberto,
  ] =
    useState(false);

  const [
    motivo,
    setMotivo,
  ] =
    useState("");

  const [
    preflight,
    setPreflight,
  ] =
    useState<
      Preflight | null
    >(null);

  const [
    carregandoAnalise,
    setCarregandoAnalise,
  ] =
    useState(false);

  const [
    destinoRecebido,
    setDestinoRecebido,
  ] =
    useState<
      DestinoRecebido | null
    >(null);

  const [
    enviando,
    setEnviando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const [
    sucesso,
    setSucesso,
  ] =
    useState(false);

  const [
    avisoFiscalOk,
    setAvisoFiscalOk,
  ] =
    useState(false);

  function fechar() {
    setAberto(false);
    setMensagem(null);
    setDestinoRecebido(null);
    setAvisoFiscalOk(false);
    onFechar?.();
  }

  useEffect(() => {
    if (!iniciarAberto) {
      return;
    }

    void abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abre ao montar a partir da lista
  }, [iniciarAberto, vendaId]);

  async function abrir() {
    setAberto(true);
    setMensagem(null);
    setSucesso(false);
    setDestinoRecebido(
      null
    );
    setAvisoFiscalOk(false);
    setPreflight(null);
    setCarregandoAnalise(
      true
    );

    try {
      const response =
        await fetch(
          `/api/vendas/${vendaId}/cancelar`,
          {
            method:
              "GET",
            cache:
              "no-store",
          }
        );

      const data =
        (
          await response.json()
        ) as RespostaPreflight;

      if (
        !response.ok ||
        !data.ok
      ) {
        setMensagem(
          data.erro ??
          "Não foi possível analisar a venda."
        );
        return;
      }

      const analise =
        data.preflight ??
        {};

      setPreflight(
        analise
      );

      if (
        Number(
          analise
            .valor_pago_cliente ??
          0
        ) >
          0 &&
        !analise
          .permite_credito
      ) {
        setDestinoRecebido(
          "DEVOLUCAO"
        );
      }
    } catch (
      error
    ) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao analisar a venda."
      );
    } finally {
      setCarregandoAnalise(
        false
      );
    }
  }

  async function cancelar() {
    const motivoLimpo =
      motivo.trim();

    if (
      motivoLimpo.length <
      5
    ) {
      setMensagem(
        "Informe o motivo com pelo menos 5 caracteres."
      );
      setSucesso(false);
      return;
    }

    const valorPago =
      Number(
        preflight
          ?.valor_pago_cliente ??
        0
      );

    if (
      valorPago > 0 &&
      !destinoRecebido
    ) {
      setMensagem(
        "Escolha o que fazer com o valor já pago pelo cliente."
      );
      setSucesso(false);
      return;
    }

    const tratamento =
      valorPago > 0
        ? destinoRecebido ===
          "CREDITO"
          ? `\n\n${dinheiro(
              valorPago
            )} será convertido em crédito para o cliente.`
          : `\n\n${dinheiro(
              valorPago
            )} será registrado para devolução ao cliente.`
        : "";

    const confirmou =
      window.confirm(
        `Cancelar comercialmente a venda #${numero ?? "—"}?${tratamento}\n\nO estoque, pagamentos e carteira serão ajustados na mesma transação.`
      );

    if (!confirmou) {
      return;
    }

    setEnviando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          `/api/vendas/${vendaId}/cancelar`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                confirmar:
                  "CANCELAR_VENDA_COMERCIAL",
                motivo:
                  motivoLimpo,
                destino_valor_recebido:
                  destinoRecebido,
                confirmar_fiscal_comercial:
                  Boolean(
                    preflight?.possui_documento_fiscal
                  ) && avisoFiscalOk,
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as Resposta;

      if (
        !response.ok ||
        !data.ok
      ) {
        setMensagem(
          data.erro ??
          "Não foi possível cancelar a venda."
        );

        router.refresh();
        return;
      }

      const resultado =
        data.resultado ??
        {};

      const partes = [
        "Venda cancelada.",
        `Estoque devolvido: ${Number(
          resultado
            .estoque_quantidade_estornada ??
          0
        )}.`,
      ];

      const credito =
        Number(
          resultado
            .credito_gerado ??
          0
        );

      const devolucao =
        Number(
          resultado
            .devolucao_registrada ??
          0
        );

      if (
        credito >
        0
      ) {
        partes.push(
          `${dinheiro(
            credito
          )} convertido em crédito do cliente.`
        );

        partes.push(
          `Crédito disponível: ${dinheiro(
            resultado
              .credito_cliente_disponivel
          )}.`
        );
      }

      if (
        devolucao >
        0
      ) {
        partes.push(
          `Devolução de ${dinheiro(
            devolucao
          )} registrada como PENDENTE.`
        );
      }

      setSucesso(true);
      setMensagem(
        partes.join(" ")
      );

      setAberto(false);
      setMotivo("");
      setDestinoRecebido(
        null
      );

      router.refresh();
      onFechar?.();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada no cancelamento."
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    if (iniciarAberto) {
      return null;
    }

    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={abrir}
          className="updv-btn updv-btn-ghost text-red-700"
        >
          Cancelar venda
        </button>

        {mensagem && (
          <p
            className={[
              "max-w-xl text-sm",
              sucesso
                ? "text-emerald-700"
                : "text-red-700",
            ].join(" ")}
          >
            {mensagem}
          </p>
        )}
      </div>
    );
  }

  const valorPago =
    Number(
      preflight
        ?.valor_pago_cliente ??
      0
    );

  const exigeDestino =
    valorPago >
    0;

  return (
    <div className="w-full max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 className="font-semibold text-red-950">
        Cancelamento comercial
      </h3>

      {preflight?.possui_documento_fiscal &&
        !avisoFiscalOk &&
        !carregandoAnalise && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              Esta venda possui documento fiscal.
            </p>
            <p className="mt-2 text-sm text-amber-900">
              A operação irá alterar somente as movimentações comerciais
              relacionadas à venda.
            </p>
            <p className="mt-2 text-sm text-amber-900">
              O documento fiscal permanecerá com a situação fiscal atual.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={fechar}
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

      {!(
        preflight?.possui_documento_fiscal &&
        !avisoFiscalOk &&
        !carregandoAnalise
      ) && (
        <>
      <p className="mt-1 text-sm text-red-800">
        Venda #{numero ?? "—"}. O documento fiscal, se existir, não será
        cancelado nem alterado.
      </p>

      {carregandoAnalise && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-zinc-700">
          Analisando pagamentos e carteira da venda...
        </div>
      )}

      {!carregandoAnalise &&
        preflight && (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-zinc-500">
                  Pago na venda
                </p>
                <p className="mt-1 font-semibold text-zinc-950">
                  {dinheiro(
                    preflight
                      .pagamento_imediato_liquido
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs text-zinc-500">
                  Fiado já recebido
                </p>
                <p className="mt-1 font-semibold text-zinc-950">
                  {dinheiro(
                    preflight
                      .fiado_recebido
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs text-zinc-500">
                  Fiado em aberto
                </p>
                <p className="mt-1 font-semibold text-zinc-950">
                  {dinheiro(
                    preflight
                      .valor_fiado_aberto
                  )}
                </p>
              </div>
            </div>

            {preflight
              .cliente_identificado && (
              <p className="mt-3 text-sm font-semibold text-zinc-900">
                Total já pago pelo cliente:{" "}
                {dinheiro(
                  valorPago
                )}
              </p>
            )}
          </div>
        )}

      {exigeDestino && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-red-950">
            O cliente já pagou {dinheiro(
              valorPago
            )} desta venda. O que deseja fazer?
          </p>

          <div
            className={[
              "mt-3 grid gap-3",
              preflight
                ?.permite_credito
                ? "sm:grid-cols-2"
                : "",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() =>
                setDestinoRecebido(
                  "DEVOLUCAO"
                )
              }
              className={[
                "rounded-xl border p-4 text-left transition",
                destinoRecebido ===
                  "DEVOLUCAO"
                  ? "border-red-500 bg-red-100"
                  : "border-zinc-200 bg-white hover:border-red-300",
              ].join(" ")}
            >
              <span className="block font-semibold text-zinc-950">
                Devolver valor pago
              </span>

              <span className="mt-1 block text-sm text-zinc-600">
                Registra {dinheiro(
                  valorPago
                )} como devolução pendente ao cliente.
              </span>
            </button>

            {preflight
              ?.permite_credito && (
              <button
                type="button"
                onClick={() =>
                  setDestinoRecebido(
                    "CREDITO"
                  )
                }
                className={[
                  "rounded-xl border p-4 text-left transition",
                  destinoRecebido ===
                    "CREDITO"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-zinc-200 bg-white hover:border-emerald-300",
                ].join(" ")}
              >
                <span className="block font-semibold text-zinc-950">
                  Gerar crédito para o cliente
                </span>

                <span className="mt-1 block text-sm text-zinc-600">
                  Cria {dinheiro(
                    valorPago
                  )} de crédito disponível para uma compra futura.
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      <label className="mt-4 block">
        <span className="text-sm font-medium text-red-950">
          Motivo
        </span>

        <textarea
          rows={3}
          maxLength={255}
          value={motivo}
          onChange={(event) =>
            setMotivo(
              event.target.value
            )
          }
          placeholder="Ex.: Cliente devolveu a mercadoria."
          className="mt-2 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-red-400"
        />
      </label>

      {mensagem && (
        <p className="mt-3 text-sm text-red-700">
          {mensagem}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={cancelar}
          disabled={
            enviando ||
            carregandoAnalise ||
            motivo.trim().length <
              5 ||
            (
              exigeDestino &&
              !destinoRecebido
            )
          }
          className="inline-flex h-10 items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando
            ? "Cancelando venda..."
            : "Confirmar cancelamento"}
        </button>

        <button
          type="button"
          onClick={fechar}
          disabled={enviando}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60"
        >
          Voltar
        </button>
      </div>
        </>
      )}
    </div>
  );
}
