"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Modelo =
  | "55"
  | "65";

type Ambiente =
  | "1"
  | "2";

type Numeracao = {
  id: string;
  modelo: Modelo;
  ambiente: number;
  serie: number;
  proximo_numero:
    | number
    | string;
  ativo: boolean;
};

type UltimaEmissao = {
  modelo: Modelo;
  ambiente: number;
  serie: number;
  maior_numero: number;
};

type Props = {
  ambienteAtual: Ambiente;
  numeracoes:
    Numeracao[];
  ultimasEmissoes:
    UltimaEmissao[];
};

function nomeModelo(
  modelo: Modelo
) {
  return modelo === "55"
    ? "NF-e"
    : "NFC-e";
}

function nomeAmbiente(
  ambiente: Ambiente
) {
  return ambiente === "1"
    ? "Produção"
    : "Homologação";
}

function serieValida(
  serie: number
) {
  return (
    (
      serie >= 1 &&
      serie <= 889
    ) ||
    (
      serie >= 920 &&
      serie <= 969
    )
  );
}

function CardModelo({
  modelo,
  ambiente,
  ambienteAtual,
  numeracoes,
  ultimasEmissoes,
}: {
  modelo: Modelo;
  ambiente: Ambiente;
  ambienteAtual: Ambiente;
  numeracoes:
    Numeracao[];
  ultimasEmissoes:
    UltimaEmissao[];
}) {
  const router =
    useRouter();

  const ambienteNumero =
    Number(
      ambiente
    );

  const ativas =
    numeracoes.filter(
      (item) =>
        item.modelo ===
          modelo &&
        Number(
          item.ambiente
        ) ===
          ambienteNumero &&
        item.ativo
    );

  const ativa =
    ativas.length === 1
      ? ativas[0]
      : null;


  const [
    serie,
    setSerie,
  ] =
    useState(
      ativa
        ? String(
            ativa.serie
          )
        : ""
    );

  const serieSelecionada =
    Number(
      serie
    );

  const maiorInterno =
    Number.isInteger(
      serieSelecionada
    )
      ? (
          ultimasEmissoes.find(
            (item) =>
              item.modelo ===
                modelo &&
              Number(
                item.ambiente
              ) ===
                ambienteNumero &&
              Number(
                item.serie
              ) ===
                serieSelecionada
          ) ??
          null
        )
      : null;

  const [
    ultimaNota,
    setUltimaNota,
  ] =
    useState(
      ativa
        ? String(
            Math.max(
              0,
              Number(
                ativa
                  .proximo_numero
              ) - 1
            )
          )
        : ""
    );

  const [
    novaSerie,
    setNovaSerie,
  ] =
    useState(false);

  const [
    salvando,
    setSalvando,
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

  const serieNumero =
    Number(serie);

  const ultimaNumero =
    Number(
      ultimaNota
    );

  const proximoNumero =
    Number.isInteger(
      ultimaNumero
    ) &&
    ultimaNumero >= 0
      ? ultimaNumero +
        1
      : null;

  const erroLocal =
    useMemo(() => {
      if (
        !Number.isInteger(
          serieNumero
        ) ||
        !serieValida(
          serieNumero
        )
      ) {
        return "Informe uma série válida: 1–889 ou 920–969.";
      }

      if (
        !Number.isInteger(
          ultimaNumero
        ) ||
        ultimaNumero < 0
      ) {
        return "Informe o último número utilizado. Para uma série nova, use 0.";
      }

      if (
        proximoNumero ===
          null ||
        proximoNumero <=
          0 ||
        proximoNumero >
          999_999_999
      ) {
        return "Próximo número fiscal inválido.";
      }

      return null;
    }, [
      serieNumero,
      ultimaNumero,
      proximoNumero,
    ]);

  async function salvar() {
    setMensagem(
      null
    );
    setSucesso(
      false
    );

    if (
      erroLocal
    ) {
      setMensagem(
        erroLocal
      );
      return;
    }

    setSalvando(
      true
    );

    try {
      const response =
        await fetch(
          "/api/fiscal/configuracao/numeracao",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                modelo,
                ambiente:
                  ambienteNumero,
                serie:
                  serieNumero,
                ultima_nota:
                  ultimaNumero,
                nova_serie:
                  novaSerie,
              }),
          }
        );

      const payload =
        (await response
          .json()) as {
          ok?: boolean;
          erro?: string;
          mensagem?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        setMensagem(
          payload.erro ??
            "Não foi possível salvar a numeração."
        );
        return;
      }

      setSucesso(
        true
      );
      setMensagem(
        payload.mensagem ??
          "Numeração salva com sucesso."
      );

      router.refresh();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof
          Error
          ? error.message
          : "Falha ao salvar a numeração fiscal."
      );
    } finally {
      setSalvando(
        false
      );
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white">
                {nomeModelo(
                  modelo
                )} · modelo{" "}
                {modelo}
              </span>

              {ambiente ===
                ambienteAtual && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  Ambiente atual
                </span>
              )}
            </div>

            <h2 className="mt-3 text-lg font-semibold text-zinc-950">
              {nomeModelo(
                modelo
              )} —{" "}
              {nomeAmbiente(
                ambiente
              )}
            </h2>

            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Esta sequência é exclusiva de{" "}
              {nomeAmbiente(
                ambiente
              ).toLowerCase()}
              .
            </p>
          </div>

          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Situação
            </p>

            <p className="mt-1 font-semibold text-zinc-900">
              {ativa
                ? `Série ${ativa.serie} · próximo nº ${ativa.proximo_numero}`
                : ativas.length >
                    1
                  ? `${ativas.length} séries ativas — revisar`
                  : "Nenhuma série ativa"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {maiorInterno && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Maior número encontrado no histórico desta série e ambiente:{" "}
            <strong>
              série{" "}
              {
                maiorInterno.serie
              }
              , nº{" "}
              {
                maiorInterno.maior_numero
              }
            </strong>
            .
          </div>
        )}

        {ambiente !==
          ambienteAtual && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-900">
            Você está pré-configurando{" "}
            <strong>
              {nomeAmbiente(
                ambiente
              )}
            </strong>
            . Isso não altera o ambiente atual da empresa e não libera emissão nesse ambiente automaticamente.
          </div>
        )}

        <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4">
          <input
            type="checkbox"
            checked={
              novaSerie
            }
            onChange={(
              event
            ) => {
              const checked =
                event
                  .target
                  .checked;

              setNovaSerie(
                checked
              );
              setMensagem(
                null
              );
              setSucesso(
                false
              );

              if (
                checked
              ) {
                setSerie("");
                setUltimaNota(
                  "0"
                );
              } else if (
                ativa
              ) {
                setSerie(
                  String(
                    ativa.serie
                  )
                );
                setUltimaNota(
                  String(
                    Math.max(
                      0,
                      Number(
                        ativa
                          .proximo_numero
                      ) -
                        1
                    )
                  )
                );
              }
            }}
            className="mt-1 h-4 w-4"
          />

          <span>
            <span className="block text-sm font-semibold text-zinc-900">
              Usar uma série nova/exclusiva
            </span>

            <span className="mt-1 block text-sm leading-6 text-zinc-600">
              A nova série começa no número 1. Útil quando outro emissor ainda utiliza a série antiga.
            </span>
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-zinc-800">
              Série
            </span>

            <input
              type="number"
              value={
                serie
              }
              onChange={(
                event
              ) =>
                setSerie(
                  event
                    .target
                    .value
                )
              }
              placeholder="Ex.: 100"
              className="mt-2 h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
            />

            <p className="mt-1.5 text-xs text-zinc-500">
              Faixas aceitas pelo UltraPDV: 1–889 ou 920–969.
            </p>
          </label>

          <label>
            <span className="text-sm font-medium text-zinc-800">
              Último número já utilizado
            </span>

            <input
              type="number"
              value={
                ultimaNota
              }
              disabled={
                novaSerie
              }
              onChange={(
                event
              ) =>
                setUltimaNota(
                  event
                    .target
                    .value
                )
              }
              placeholder="Ex.: 157"
              className="mt-2 h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-100"
            />
          </label>
        </div>

        <div className="rounded-xl bg-zinc-950 p-4 text-white">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Próxima emissão neste ambiente
          </p>

          <p className="mt-1 text-2xl font-bold">
            {proximoNumero ??
              "—"}
          </p>

          <p className="mt-1 text-sm text-zinc-300">
            {nomeModelo(
              modelo
            )} ·{" "}
            {nomeAmbiente(
              ambiente
            )} · série{" "}
            {Number.isInteger(
              serieNumero
            )
              ? serieNumero
              : "—"}
          </p>
        </div>

        {mensagem && (
          <div
            className={[
              "rounded-xl border p-4 text-sm",
              sucesso
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            ].join(" ")}
          >
            {mensagem}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={
              salvando ||
              Boolean(
                erroLocal
              )
            }
            onClick={
              salvar
            }
            className="h-11 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando
              ? "Salvando..."
              : "Salvar numeração"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function NumeracaoFiscalForm({
  ambienteAtual,
  numeracoes,
  ultimasEmissoes,
}: Props) {
  const [
    ambienteSelecionado,
    setAmbienteSelecionado,
  ] =
    useState<Ambiente>(
      ambienteAtual
    );

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
        {(
          [
            "2",
            "1",
          ] as Ambiente[]
        ).map(
          (
            ambiente
          ) => (
            <button
              key={
                ambiente
              }
              type="button"
              onClick={() =>
                setAmbienteSelecionado(
                  ambiente
                )
              }
              className={[
                "rounded-lg px-4 py-2 text-sm font-semibold transition",
                ambienteSelecionado ===
                ambiente
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-600 hover:bg-zinc-100",
              ].join(" ")}
            >
              {nomeAmbiente(
                ambiente
              )}
            </button>
          )
        )}
      </div>

      <CardModelo
        modelo="55"
        ambiente={
          ambienteSelecionado
        }
        ambienteAtual={
          ambienteAtual
        }
        numeracoes={
          numeracoes
        }
        ultimasEmissoes={
          ultimasEmissoes
        }
      />

      <CardModelo
        modelo="65"
        ambiente={
          ambienteSelecionado
        }
        ambienteAtual={
          ambienteAtual
        }
        numeracoes={
          numeracoes
        }
        ultimasEmissoes={
          ultimasEmissoes
        }
      />
    </div>
  );
}
