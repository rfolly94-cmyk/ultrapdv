"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import { PageAlert } from "@/components/ui/page-alert";
import { CaixaConferenciaMeios } from "@/components/caixa/caixa-conferencia-meios";
import { CaixaContadorDinheiro } from "@/components/caixa/caixa-contador-dinheiro";
import {
  confirmarFechamentoCaixa,
  iniciarFechamentoCaixa,
} from "@/app/caixa/actions";
import {
  conferenciaRevelaEsperado,
  conferirMeios,
  dinheiroFisicoDaConferencia,
  rotuloStatusDiferencaCaixa,
  statusDiferencaCaixa,
} from "@/lib/caixa/conferencia";
import { parseValorCaixa } from "@/lib/caixa/valor";
import type { ConferenciaCaixa, MeioConferenciaCaixa } from "@/lib/caixa/tipos";
import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

function formatarInformado(valor: number) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ModalFecharCaixa({
  open,
  caixaId,
  operadorNome,
  conferenciaInicial,
  onClose,
}: {
  open: boolean;
  caixaId: string;
  operadorNome: string | null;
  conferenciaInicial: ConferenciaCaixa | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<"conferencia" | "resumo" | "resultado">(
    "conferencia"
  );
  const [conferencia, setConferencia] = useState<ConferenciaCaixa | null>(
    conferenciaInicial
  );
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const meio of conferenciaInicial?.meios ?? []) {
      inicial[meio.chave] = "";
    }
    return inicial;
  });
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [contadorChave, setContadorChave] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    dinheiroContado: number;
    dinheiroEsperado: number;
    diferenca: number;
    meios: MeioConferenciaCaixa[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function limpar() {
    setEtapa("conferencia");
    setConferencia(null);
    setValores({});
    setObservacao("");
    setErro(null);
    setContadorChave(null);
    setResultado(null);
  }

  function carregar() {
    startTransition(async () => {
      const saida = await iniciarFechamentoCaixa({ caixaId });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      if (
        saida.conferencia.fechamento_cego &&
        conferenciaRevelaEsperado(saida.conferencia)
      ) {
        setErro("Não foi possível iniciar a conferência.");
        return;
      }
      setConferencia(saida.conferencia);
      setValores((atual) => {
        const proximo: Record<string, string> = {};
        for (const meio of saida.conferencia.meios) {
          proximo[meio.chave] = atual[meio.chave] ?? "";
        }
        return proximo;
      });
      setErro(null);
      setEtapa("conferencia");
    });
  }

  const cego = conferencia?.fechamento_cego === true;
  const meiosComDiferenca = useMemo(() => {
    if (!conferencia) {
      return [];
    }
    const informados = conferencia.meios.map((meio) => ({
      chave: meio.chave,
      valor_informado: parseValorCaixa(valores[meio.chave]) ?? 0,
    }));
    if (cego) {
      return conferencia.meios;
    }
    return conferirMeios({
      esperados: conferencia.meios,
      informados,
    });
  }, [conferencia, valores, cego]);

  const fisico = useMemo(
    () => dinheiroFisicoDaConferencia(meiosComDiferenca),
    [meiosComDiferenca]
  );

  function irParaResumo() {
    if (!conferencia) {
      return;
    }
    for (const meio of conferencia.meios) {
      const informado = parseValorCaixa(valores[meio.chave]);
      if (informado === null) {
        setErro("Informe o valor conferido de todas as formas.");
        return;
      }
      if (informado < 0) {
        setErro("O valor informado não pode ser negativo.");
        return;
      }
    }
    setErro(null);
    setEtapa("resumo");
  }

  function confirmar() {
    if (!conferencia) {
      return;
    }
    startTransition(async () => {
      const saida = await confirmarFechamentoCaixa({
        caixaId,
        versaoLivro: conferencia.versao_livro,
        meios: conferencia.meios.map((meio) => ({
          chave: meio.chave,
          valorInformado: valores[meio.chave] ?? "",
        })),
        observacao,
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setResultado(saida);
      setEtapa("resultado");
      router.refresh();
    });
  }

  return (
    <>
      <AppModal
        open={open}
        title={
          etapa === "resultado"
            ? "Caixa fechado"
            : etapa === "resumo"
              ? "Confirmar fechamento"
              : "Conferência do caixa"
        }
        onClose={() => {
          if (etapa === "resultado") {
            limpar();
          }
          onClose();
        }}
        size="lg"
        footer={
          etapa === "resultado" ? (
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              onClick={() => {
                limpar();
                onClose();
              }}
            >
              Concluir
            </button>
          ) : (
            <>
              <button
                type="button"
                className="updv-btn updv-btn-ghost"
                onClick={onClose}
              >
                Cancelar
              </button>
              {etapa === "resumo" ? (
                <>
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    onClick={() => setEtapa("conferencia")}
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    className="updv-btn updv-btn-primary"
                    disabled={pending || !conferencia}
                    onClick={confirmar}
                  >
                    {pending ? "Fechando..." : "Confirmar fechamento"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={pending}
                    onClick={carregar}
                  >
                    Atualizar conferência
                  </button>
                  <button
                    type="button"
                    className="updv-btn updv-btn-primary"
                    disabled={pending || !conferencia}
                    onClick={irParaResumo}
                  >
                    Continuar
                  </button>
                </>
              )}
            </>
          )
        }
      >
        <div className="space-y-4">
          {erro ? (
            <PageAlert type="erro" className="mx-0 mt-0">
              {erro}
            </PageAlert>
          ) : null}

          {etapa === "resultado" && resultado ? (
            <div className="space-y-3">
              <p className="text-[13px] text-zinc-600">
                Conferência gravada. O caixa está fechado e não aceita novos
                movimentos.
              </p>
              <CaixaConferenciaMeios meios={resultado.meios} somenteLeitura />
              <p className="text-[13px] text-zinc-700">
                Dinheiro físico esperado:{" "}
                {formatarMoeda(resultado.dinheiroEsperado)} · Contado:{" "}
                {formatarMoeda(resultado.dinheiroContado)} · Diferença:{" "}
                <span
                  className={
                    resultado.diferenca === 0
                      ? "font-semibold"
                      : resultado.diferenca > 0
                        ? "font-semibold text-emerald-700"
                        : "font-semibold text-rose-700"
                  }
                >
                  {formatarMoeda(resultado.diferenca)} (
                  {rotuloStatusDiferencaCaixa(
                    statusDiferencaCaixa(resultado.diferenca)
                  )}
                  )
                </span>
              </p>
            </div>
          ) : conferencia ? (
            <>
              <p className="text-[13px] text-zinc-500">
                Caixa #{conferencia.numero} · Aberto em{" "}
                {formatarDataHora(conferencia.aberto_em)} · Operador{" "}
                {operadorNome || "—"}
                {cego
                  ? " · Fechamento cego: o esperado só aparece depois da confirmação."
                  : ""}
              </p>

              {etapa === "resumo" ? (
                <dl className="grid gap-2 sm:grid-cols-2 text-[13px]">
                  <div>
                    <dt className="text-zinc-500">Saldo inicial</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.saldo_inicial)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Vendas</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.vendas_liquidas)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Recebimentos Carteira</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.recebimentos_carteira)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Suprimentos</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.suprimentos)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Sangrias</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.sangrias)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Estornos</dt>
                    <dd className="font-medium">
                      {formatarMoeda(conferencia.estornos)}
                    </dd>
                  </div>
                  {cego ? null : (
                    <>
                      <div>
                        <dt className="text-zinc-500">Dinheiro físico esperado</dt>
                        <dd className="font-medium">
                          {formatarMoeda(
                            conferencia.dinheiro_fisico_esperado ?? fisico.esperado
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Dinheiro contado</dt>
                        <dd className="font-medium">
                          {formatarMoeda(fisico.informado)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Diferença física</dt>
                        <dd className="font-medium">
                          {formatarMoeda(fisico.diferenca)} (
                          {rotuloStatusDiferencaCaixa(
                            statusDiferencaCaixa(fisico.diferenca)
                          )}
                          )
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              ) : null}

              <CaixaConferenciaMeios
                meios={meiosComDiferenca}
                valores={valores}
                cego={cego && etapa !== "resultado"}
                somenteLeitura={etapa === "resumo"}
                onChange={(chave, valor) => {
                  setValores((atual) => ({ ...atual, [chave]: valor }));
                  setErro(null);
                }}
                onContarDinheiro={
                  etapa === "conferencia" ? setContadorChave : undefined
                }
              />

              {etapa === "resumo" ? (
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
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-zinc-500">
              {pending ? "Carregando conferência..." : "Sem conferência."}
            </p>
          )}
        </div>
      </AppModal>

      <CaixaContadorDinheiro
        open={Boolean(contadorChave)}
        onClose={() => setContadorChave(null)}
        onUsar={(total) => {
          if (!contadorChave) {
            return;
          }
          setValores((atual) => ({
            ...atual,
            [contadorChave]: formatarInformado(total),
          }));
        }}
      />
    </>
  );
}
