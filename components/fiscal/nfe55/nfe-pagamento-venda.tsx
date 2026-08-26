"use client";

import { useMemo, useRef } from "react";

import {
  PixGeranetCheckout,
  type PixGeranetCheckoutState,
} from "@/components/pdv/pix-geranet-checkout";
import {
  PixLocalCheckout,
  type PixLocalCheckoutState,
} from "@/components/pdv/pix-local-checkout";
import { nfeInput } from "@/components/fiscal/nfe55/nfe-form-primitives";
import { CampoValor } from "@/components/ui/campo-valor";
import { nomeProvedorPix } from "@/lib/pagamentos/pix/provedores-geranet";
import { ehFormaPix } from "@/lib/pagamentos/pix/local-regras";
import {
  MENSAGEM_CONFIGURE_PIX,
  rotuloFormaCheckout,
  type FormaPagamentoCheckout,
} from "@/lib/pdv/formas-pagamento-checkout";
import {
  avaliarPagamentosPdv,
  formatarCentavosBr,
  saldoRestanteParaParcela,
} from "@/lib/pdv/pagamentos-teto";
import type { PixConfigPdv } from "@/lib/pagamentos/pix/modo-ativo";

export type PagamentoDigitadoNfe = {
  formaPagamentoId: string;
  valorTexto: string;
};

function textoParaCentavos(valor: string) {
  let texto = valor.trim();
  if (!texto) return 0;
  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) return 0;
  return Math.round(numero * 100);
}

export function NfePagamentoVenda({
  formasPagamento,
  pixConfig,
  pagamentos,
  onPagamentos,
  pixLocal,
  onPixLocal,
  pixGeranet,
  onPixGeranet,
  totalCatalogoCentavos,
  clienteId,
  podeEditar,
  ocupado,
  onErro,
}: {
  formasPagamento: FormaPagamentoCheckout[];
  pixConfig: PixConfigPdv | null;
  pagamentos: PagamentoDigitadoNfe[];
  onPagamentos: (pagamentos: PagamentoDigitadoNfe[]) => void;
  pixLocal: PixLocalCheckoutState | null;
  onPixLocal: (state: PixLocalCheckoutState | null) => void;
  pixGeranet: PixGeranetCheckoutState | null;
  onPixGeranet: (state: PixGeranetCheckoutState | null) => void;
  totalCatalogoCentavos: number;
  clienteId: string | null;
  podeEditar: boolean;
  ocupado: boolean;
  onErro: (mensagem: string | null) => void;
}) {
  const pixCheckoutKeyRef = useRef<string | null>(null);
  const pixLocalAtivo = pixConfig?.modo === "local_manual";
  const pixGeranetAtivo = pixConfig?.modo === "geranet";
  const pixHabilitado = pixLocalAtivo || pixGeranetAtivo;
  const formasPagas = formasPagamento.filter((forma) => !forma.permite_fiado);
  const formaFiado = formasPagamento.find((forma) => forma.permite_fiado) ?? null;
  const formaPix = formasPagamento.find((forma) => ehFormaPix(forma) && !forma.permite_fiado) ?? null;

  const pagamentosCentavos = pagamentos
    .map((pagamento) => {
      const forma = formasPagamento.find((item) => item.id === pagamento.formaPagamentoId);
      const valorCentavos = textoParaCentavos(pagamento.valorTexto);
      if (!forma || valorCentavos <= 0) return null;
      return { formaPagamentoId: forma.id, valorCentavos, forma };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: totalCatalogoCentavos,
    pagamentos: pagamentosCentavos.map((pagamento) => ({
      valorCentavos: pagamento.valorCentavos,
      permiteTroco: pagamento.forma.permite_troco === true,
    })),
  });

  const pixValor =
    pagamentosCentavos.find((pagamento) => ehFormaPix(pagamento.forma))?.valorCentavos ?? 0;
  const outrosSemPix = pagamentosCentavos
    .filter((pagamento) => !ehFormaPix(pagamento.forma))
    .reduce((acc, pagamento) => acc + pagamento.valorCentavos, 0);
  const saldoPix = saldoRestanteParaParcela({
    totalVendaCentavos: totalCatalogoCentavos,
    outrosPagamentosCentavos: outrosSemPix,
  });
  const usarFiado = Boolean(
    formaFiado && pagamentos.some((pagamento) => pagamento.formaPagamentoId === formaFiado.id)
  );

  const provedorNome = useMemo(
    () =>
      pixGeranetAtivo && pixConfig && "provedor" in pixConfig
        ? nomeProvedorPix(pixConfig.provedor ?? "")
        : "",
    [pixConfig, pixGeranetAtivo]
  );

  function atualizar(formaPagamentoId: string, valorTexto: string) {
    if (!podeEditar) return;
    if (formaPix && formaPagamentoId === formaPix.id) {
      onPixLocal(null);
      onPixGeranet(null);
    }
    const demais = pagamentos.filter((item) => item.formaPagamentoId !== formaPagamentoId);
    if (!valorTexto.trim()) {
      onPagamentos(demais);
      return;
    }
    onPagamentos([...demais, { formaPagamentoId, valorTexto }]);
  }

  function preencherRestante(formaPagamentoId: string) {
    const outros = pagamentos
      .filter((item) => item.formaPagamentoId !== formaPagamentoId)
      .reduce((acc, item) => acc + textoParaCentavos(item.valorTexto), 0);
    const restante = Math.max(0, totalCatalogoCentavos - outros);
    atualizar(formaPagamentoId, (restante / 100).toFixed(2).replace(".", ","));
  }

  function checkoutKeyPixGeranet() {
    if (!pixCheckoutKeyRef.current) {
      pixCheckoutKeyRef.current = crypto.randomUUID();
    }
    return pixCheckoutKeyRef.current;
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-zinc-500">
        O total comercial usa o preço de venda do catálogo. O valor fiscal editado no item não
        altera caixa, PIX nem carteira.
      </p>
      <p className="text-[13px] font-medium text-zinc-800">
        Total comercial: {formatarCentavosBr(totalCatalogoCentavos)}
      </p>
      <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200">
        {formasPagas.map((forma) => {
          const atual = pagamentos.find((item) => item.formaPagamentoId === forma.id);
          const pixDesabilitado = ehFormaPix(forma) && !pixHabilitado;
          return (
            <div key={forma.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 text-[13px] text-zinc-800">
                {rotuloFormaCheckout(forma)}
              </span>
              <CampoValor
                className={`${nfeInput} w-28 text-right`}
                inputMode="decimal"
                placeholder="0,00"
                disabled={!podeEditar || pixDesabilitado}
                value={atual?.valorTexto ?? ""}
                onChange={(event) => atualizar(forma.id, event.target.value)}
                onFocus={() => {
                  if (!podeEditar || pixDesabilitado) return;
                  if (!atual?.valorTexto && avaliacao.restanteCentavos > 0) {
                    preencherRestante(forma.id);
                  }
                }}
              />
            </div>
          );
        })}
      </div>
      {formaFiado ? (
        <label className="flex items-center gap-2 text-[13px] text-zinc-700">
          <input
            type="checkbox"
            disabled={!podeEditar || !clienteId}
            checked={usarFiado}
            onChange={(event) => {
              if (event.target.checked) {
                if (!clienteId) {
                  onErro("Fiado exige um cliente da empresa ativa.");
                  return;
                }
                preencherRestante(formaFiado.id);
                return;
              }
              atualizar(formaFiado.id, "");
            }}
          />
          Fiado (pagar depois){!clienteId ? " — selecione o cliente" : ""}
        </label>
      ) : null}
      {formaPix && !pixHabilitado ? (
        <p className="text-[12.5px] text-amber-800">{MENSAGEM_CONFIGURE_PIX}</p>
      ) : null}
      {pixLocalAtivo && formaPix && pixValor > 0 ? (
        <PixLocalCheckout
          formaPagamentoId={formaPix.id}
          valorCentavos={pixValor}
          saldoRestanteCentavos={saldoPix}
          state={pixLocal?.formaPagamentoId === formaPix.id ? pixLocal : null}
          ocupado={ocupado || !podeEditar}
          onState={onPixLocal}
          onErro={onErro}
        />
      ) : null}
      {pixGeranetAtivo && formaPix && pixValor > 0 ? (
        <PixGeranetCheckout
          formaPagamentoId={formaPix.id}
          valorCentavos={pixValor}
          saldoRestanteCentavos={saldoPix}
          checkoutKey={checkoutKeyPixGeranet()}
          clienteId={clienteId}
          provedorNome={provedorNome}
          state={pixGeranet?.formaPagamentoId === formaPix.id ? pixGeranet : null}
          ocupado={ocupado || !podeEditar}
          onState={onPixGeranet}
          onErro={onErro}
        />
      ) : null}
      <div
        className={`rounded-md border p-3 text-[12.5px] ${
          avaliacao.bloqueado
            ? "border-red-300 bg-red-50 text-red-800"
            : "border-zinc-200 bg-zinc-50 text-zinc-700"
        }`}
      >
        <p>Pagamentos: {formatarCentavosBr(avaliacao.totalInformadoCentavos)}</p>
        <p>
          {avaliacao.restanteCentavos > 0
            ? `Faltam ${formatarCentavosBr(avaliacao.restanteCentavos)}`
            : avaliacao.trocoCentavos > 0
              ? `Troco ${formatarCentavosBr(avaliacao.trocoCentavos)}`
              : "Pagamento fecha o total comercial."}
        </p>
        {avaliacao.mensagem ? <p className="mt-1 whitespace-pre-line">{avaliacao.mensagem}</p> : null}
      </div>
    </div>
  );
}

export function pagamentosNfeParaRascunho(
  pagamentos: PagamentoDigitadoNfe[],
  pixLocal: PixLocalCheckoutState | null,
  pixGeranet: PixGeranetCheckoutState | null,
  pixConfig: PixConfigPdv | null,
  formas: FormaPagamentoCheckout[]
) {
  return pagamentos.flatMap((pagamento) => {
    const forma = formas.find((item) => item.id === pagamento.formaPagamentoId);
    const valorCentavos = textoParaCentavos(pagamento.valorTexto);
    if (!forma || valorCentavos <= 0) return [];
    const pixId =
      ehFormaPix(forma) && pixConfig?.modo === "local_manual" && pixLocal?.status === "confirmado_manual"
        ? pixLocal.recebimentoId
        : ehFormaPix(forma) && pixConfig?.modo === "geranet" && pixGeranet?.status === "paga"
          ? pixGeranet.cobrancaId
          : null;
    return [
      {
        formaPagamentoId: forma.id,
        valorCentavos,
        pixLocalRecebimentoId: pixId,
      },
    ];
  });
}
