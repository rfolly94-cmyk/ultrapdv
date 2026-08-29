"use client";

import { useState } from "react";

import { nfeInput } from "@/components/fiscal/nfe55/nfe-form-primitives";
import { CampoValor } from "@/components/ui/campo-valor";
import {
  MENSAGEM_FATURA_TOTAL_ALTERADO,
  adicionarDiasIsoLocal,
  faturaDivergenteDoTotal,
  gerarParcelasFaturaNfe,
  somaDuplicatasCentavos,
  valorLiquidoFaturaCentavos,
  type CondicaoPagamentoNfe,
  type FaturaNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import { hojeIso } from "@/lib/produtos/lotes";
import { formatarCentavosBr } from "@/lib/pdv/pagamentos-teto";

function centavosParaTexto(centavos: number) {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

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

export function NfeFaturaCobranca({
  condicao,
  onCondicao,
  fatura,
  onFatura,
  totalAPrazoCentavos,
  podeEditar,
}: {
  condicao: CondicaoPagamentoNfe;
  onCondicao: (condicao: CondicaoPagamentoNfe) => void;
  fatura: FaturaNfe | null;
  onFatura: (fatura: FaturaNfe | null) => void;
  totalAPrazoCentavos: number;
  podeEditar: boolean;
}) {
  const [quantidade, setQuantidade] = useState(
    Math.max(1, fatura?.duplicatas.length || 1)
  );
  const [primeiroVencimento, setPrimeiroVencimento] = useState(
    fatura?.duplicatas[0]?.dataVencimento || adicionarDiasIsoLocal(hojeIso(), 30)
  );
  const [intervalo, setIntervalo] = useState(30);
  const soma = fatura ? somaDuplicatasCentavos(fatura.duplicatas) : 0;
  const liquido = fatura?.valorLiquidoCentavos ?? 0;
  const divergente =
    condicao === "prazo" &&
    faturaDivergenteDoTotal({ fatura, totalAPrazoCentavos });

  function atualizar(parcial: Partial<FaturaNfe>) {
    if (!fatura) return;
    const proxima: FaturaNfe = { ...fatura, ...parcial, parcelasPersonalizadas: true };
    if (parcial.valorCentavos != null || parcial.descontoCentavos != null) {
      proxima.valorLiquidoCentavos = valorLiquidoFaturaCentavos({
        valorCentavos: proxima.valorCentavos,
        descontoCentavos: proxima.descontoCentavos,
      });
    }
    onFatura(proxima);
  }

  function gerar(qtd: number, vencimento: string, dias: number, origem: FaturaNfe["origem"]) {
    if (!fatura) return;
    const liquidoAtual = valorLiquidoFaturaCentavos(fatura);
    onFatura({
      ...fatura,
      valorLiquidoCentavos: liquidoAtual,
      origem,
      parcelasPersonalizadas: false,
      duplicatas: gerarParcelasFaturaNfe({
        valorLiquidoCentavos: liquidoAtual,
        quantidade: qtd,
        primeiroVencimento: vencimento,
        intervaloDias: dias,
        codigoPagamento: fatura.duplicatas[0]?.codigoPagamento,
      }),
    });
  }

  function recalcular(qtd: number, vencimento: string, dias: number) {
    if (!fatura) return;
    const valorCentavos = totalAPrazoCentavos;
    const liquidoAtual = valorLiquidoFaturaCentavos({
      valorCentavos,
      descontoCentavos: fatura.descontoCentavos,
    });
    onFatura({
      ...fatura,
      valorCentavos,
      valorLiquidoCentavos: liquidoAtual,
      origem: fatura.origem === "carteira" ? "carteira" : "automatica",
      parcelasPersonalizadas: false,
      duplicatas: gerarParcelasFaturaNfe({
        valorLiquidoCentavos: liquidoAtual,
        quantidade: qtd,
        primeiroVencimento: vencimento,
        intervaloDias: dias,
        codigoPagamento: fatura.duplicatas[0]?.codigoPagamento,
      }),
    });
  }

  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-4 text-[13px] text-zinc-800">
        <legend className="mb-1 w-full text-[12.5px] font-medium text-zinc-600">
          Condição
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nfe-condicao-pagamento"
            disabled={!podeEditar}
            checked={condicao === "vista"}
            onChange={() => onCondicao("vista")}
          />
          À vista
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nfe-condicao-pagamento"
            disabled={!podeEditar}
            checked={condicao === "prazo"}
            onChange={() => onCondicao("prazo")}
          />
          A prazo
        </label>
      </fieldset>

      {condicao === "prazo" && fatura ? (
        <div className="space-y-3 rounded-md border border-zinc-200 p-3">
          <p className="text-[13px] font-medium text-zinc-800">Fatura e parcelas</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-[12px] text-zinc-600">
              Número da fatura
              <input
                className={`${nfeInput} mt-1`}
                value={fatura.numero}
                disabled={!podeEditar}
                onChange={(event) => atualizar({ numero: event.target.value })}
              />
            </label>
            <label className="text-[12px] text-zinc-600">
              Valor original
              <CampoValor
                className={`${nfeInput} mt-1 text-right`}
                disabled={!podeEditar}
                value={centavosParaTexto(fatura.valorCentavos)}
                onChange={(event) =>
                  atualizar({ valorCentavos: textoParaCentavos(event.target.value) })
                }
              />
            </label>
            <label className="text-[12px] text-zinc-600">
              Desconto da fatura
              <CampoValor
                className={`${nfeInput} mt-1 text-right`}
                disabled={!podeEditar}
                value={centavosParaTexto(fatura.descontoCentavos)}
                onChange={(event) =>
                  atualizar({ descontoCentavos: textoParaCentavos(event.target.value) })
                }
              />
            </label>
            <label className="text-[12px] text-zinc-600">
              Valor líquido
              <input
                className={`${nfeInput} mt-1 text-right`}
                readOnly
                value={centavosParaTexto(fatura.valorLiquidoCentavos)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-zinc-600">
              Parcelas
              <input
                className={`${nfeInput} mt-1 w-20`}
                type="number"
                min={1}
                max={999}
                disabled={!podeEditar}
                value={quantidade}
                onChange={(event) => setQuantidade(Number(event.target.value) || 1)}
              />
            </label>
            <label className="text-[12px] text-zinc-600">
              Primeiro vencimento
              <input
                className={`${nfeInput} mt-1`}
                type="date"
                disabled={!podeEditar}
                value={primeiroVencimento}
                onChange={(event) => setPrimeiroVencimento(event.target.value)}
              />
            </label>
            <label className="text-[12px] text-zinc-600">
              Intervalo (dias)
              <input
                className={`${nfeInput} mt-1 w-24`}
                type="number"
                min={1}
                disabled={!podeEditar}
                value={intervalo}
                onChange={(event) => setIntervalo(Number(event.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={!podeEditar}
              onClick={() => gerar(quantidade, primeiroVencimento, intervalo, "automatica")}
            >
              Gerar parcelas
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={!podeEditar}
              onClick={() => recalcular(quantidade, primeiroVencimento, intervalo)}
            >
              Recalcular parcelas
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={!podeEditar}
              onClick={() =>
                onFatura({
                  ...fatura,
                  parcelasPersonalizadas: true,
                  duplicatas: [
                    ...fatura.duplicatas,
                    {
                      numero: String(fatura.duplicatas.length + 1).padStart(3, "0"),
                      dataVencimento: adicionarDiasIsoLocal(
                        fatura.duplicatas.at(-1)?.dataVencimento || primeiroVencimento,
                        intervalo
                      ),
                      valorCentavos: 0,
                    },
                  ],
                })
              }
            >
              Adicionar parcela
            </button>
          </div>

          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500">
                <th className="py-1 font-medium">Nº</th>
                <th className="py-1 font-medium">Vencimento</th>
                <th className="py-1 font-medium">Valor</th>
                {podeEditar ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {fatura.duplicatas.map((duplicata, indice) => (
                <tr key={`${duplicata.numero}-${indice}`} className="border-b border-zinc-100">
                  <td className="py-1 pr-2">
                    <input
                      className={`${nfeInput} w-16`}
                      disabled={!podeEditar}
                      value={duplicata.numero}
                      onChange={(event) => {
                        const duplicatas = fatura.duplicatas.map((item, i) =>
                          i === indice ? { ...item, numero: event.target.value } : item
                        );
                        atualizar({ duplicatas });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={nfeInput}
                      type="date"
                      disabled={!podeEditar}
                      value={duplicata.dataVencimento}
                      onChange={(event) => {
                        const duplicatas = fatura.duplicatas.map((item, i) =>
                          i === indice
                            ? { ...item, dataVencimento: event.target.value }
                            : item
                        );
                        atualizar({ duplicatas });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <CampoValor
                      className={`${nfeInput} w-28 text-right`}
                      disabled={!podeEditar}
                      value={centavosParaTexto(duplicata.valorCentavos)}
                      onChange={(event) => {
                        const duplicatas = fatura.duplicatas.map((item, i) =>
                          i === indice
                            ? {
                                ...item,
                                valorCentavos: textoParaCentavos(event.target.value),
                              }
                            : item
                        );
                        atualizar({ duplicatas });
                      }}
                    />
                  </td>
                  {podeEditar ? (
                    <td className="py-1">
                      <button
                        type="button"
                        className="text-[12px] text-red-700"
                        disabled={fatura.duplicatas.length <= 1}
                        onClick={() =>
                          atualizar({
                            duplicatas: fatura.duplicatas.filter((_, i) => i !== indice),
                          })
                        }
                      >
                        Remover
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          <div
            className={`rounded-md border p-2 text-[12.5px] ${
              divergente || soma !== liquido
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            <p>Valor a prazo: {formatarCentavosBr(totalAPrazoCentavos)}</p>
            <p>Total das parcelas: {formatarCentavosBr(soma)}</p>
            {divergente ? <p className="mt-1">{MENSAGEM_FATURA_TOTAL_ALTERADO}</p> : null}
            {soma !== liquido ? (
              <p className="mt-1">A soma das parcelas não fecha o valor líquido da fatura.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
