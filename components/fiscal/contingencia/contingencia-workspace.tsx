"use client";

import Link from "next/link";

import {
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Emissao = {
  id: string;
  origem_tipo:
    | string
    | null;
  origem_id:
    | string
    | null;
  modelo: string;
  serie: number;
  numero: string;
  ambiente: number;
  status: string;
  tipo_emissao: string;
  contingencia_justificativa:
    | string
    | null;
  contingencia_gerada_at:
    | string
    | null;
  contingencia_transmitida_at:
    | string
    | null;
  contingencia_tentativas: number;
  contingencia_erro:
    | string
    | null;
  chave_acesso:
    | string
    | null;
  protocolo:
    | string
    | null;
  cstat:
    | string
    | null;
  motivo:
    | string
    | null;
  created_at: string;
  autorizada_at:
    | string
    | null;
  tem_xml: boolean;
  tem_pdf: boolean;
};

type Props = {
  empresaNome: string;
  ambiente:
    | "1"
    | "2";
  uf: string;
  perfil: string;
  config: {
    habilitada: boolean;
    justificativa: string;
  };
  emissoes:
    Emissao[];
};

function dataHora(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle:
        "short",
      timeStyle:
        "short",
      timeZone:
        "America/Cuiaba",
    }
  ).format(data);
}

function statusLabel(
  status: string
) {
  const mapa:
    Record<
      string,
      string
    > = {
    aguardando_transmissao_contingencia:
      "Aguardando transmissão",
    transmitindo_contingencia:
      "Transmitindo",
    aguardando_reconciliacao:
      "Situação ambígua",
    autorizada:
      "Autorizada",
    rejeitada:
      "Rejeitada",
  };

  return (
    mapa[status] ??
    status
      .replace(
        /_/g,
        " "
      )
  );
}

function statusClass(
  status: string
) {
  if (
    status ===
    "autorizada"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    status ===
    "aguardando_transmissao_contingencia"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (
    status ===
      "aguardando_reconciliacao" ||
    status ===
      "transmitindo_contingencia"
  ) {
    return "border-orange-200 bg-orange-50 text-orange-800";
  }

  return "border-red-200 bg-red-50 text-red-800";
}

function horasDesde(
  valor:
    | string
    | null
) {
  if (!valor) {
    return null;
  }

  const ms =
    Date.now() -
    new Date(
      valor
    ).getTime();

  if (
    !Number.isFinite(
      ms
    ) ||
    ms < 0
  ) {
    return null;
  }

  return (
    ms /
    3_600_000
  );
}

export function ContingenciaWorkspace({
  empresaNome,
  ambiente,
  uf,
  perfil,
  config,
  emissoes,
}: Props) {
  const router =
    useRouter();

  const podeConfigurar =
    [
      "administrador",
      "admin",
      "gerente",
    ].includes(
      perfil
        .trim()
        .toLowerCase()
    );

  const [
    habilitada,
    setHabilitada,
  ] =
    useState(
      config.habilitada
    );

  const [
    justificativa,
    setJustificativa,
  ] =
    useState(
      config.justificativa
    );

  const [
    salvando,
    setSalvando,
  ] =
    useState(false);

  const [
    processando,
    setProcessando,
  ] =
    useState<
      string | null
    >(null);

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

  const pendentes =
    useMemo(
      () =>
        emissoes.filter(
          (item) =>
            item.status ===
            "aguardando_transmissao_contingencia"
        ),
      [emissoes]
    );

  const ambiguas =
    emissoes.filter(
      (item) =>
        [
          "aguardando_reconciliacao",
          "transmitindo_contingencia",
        ].includes(
          item.status
        )
    );

  const rejeitadas =
    emissoes.filter(
      (item) =>
        item.status ===
        "rejeitada"
    );

  const autorizadas =
    emissoes.filter(
      (item) =>
        item.status ===
        "autorizada"
    );

  async function salvarConfig() {
    setSalvando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          "/api/fiscal/configuracao/contingencia",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                habilitada,
                justificativa_padrao:
                  justificativa,
              }),
          }
        );

      const payload =
        (await response.json()) as {
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
            "Não foi possível salvar a configuração."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        payload.mensagem ??
          "Configuração salva."
      );
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao salvar a configuração."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function transmitir(
    emissaoId: string
  ) {
    setProcessando(
      emissaoId
    );
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          `/api/fiscal/contingencia/${emissaoId}/transmitir`,
          {
            method:
              "POST",
          }
        );

      const payload =
        (await response.json()) as {
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
            payload.mensagem ??
            "Não foi possível transmitir a contingência."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        payload.mensagem ??
          "Contingência transmitida."
      );
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao transmitir a contingência."
      );
    } finally {
      setProcessando(
        null
      );
    }
  }

  async function transmitirLote() {
    setProcessando(
      "lote"
    );
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          "/api/fiscal/contingencia/processar",
          {
            method:
              "POST",
          }
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          erro?: string;
          processadas?: number;
          autorizadas?: number;
          rejeitadas?: number;
          ambiguas?: number;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        setMensagem(
          payload.erro ??
            "Não foi possível processar a fila."
        );
        return;
      }

      setSucesso(
        !payload.ambiguas &&
        !payload.rejeitadas
      );

      setMensagem(
        `Processadas: ${
          payload.processadas ??
          0
        }. Autorizadas: ${
          payload.autorizadas ??
          0
        }. Rejeitadas: ${
          payload.rejeitadas ??
          0
        }. Ambíguas: ${
          payload.ambiguas ??
          0
        }.`
      );

      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao processar a fila."
      );
    } finally {
      setProcessando(
        null
      );
    }
  }

  return (
    <div className="updv-config space-y-4">
      <div className="flex justify-end">
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]">
          <p className="font-semibold text-zinc-900">
            {empresaNome}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            {ambiente ===
            "1"
              ? "Produção"
              : "Homologação"}
            {uf
              ? ` · ${uf}`
              : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResumoCard
          titulo="Aguardando transmissão"
          valor={
            pendentes.length
          }
          detalhe="XML já gerado"
        />
        <ResumoCard
          titulo="Situação ambígua"
          valor={
            ambiguas.length
          }
          detalhe="Não retransmitir"
        />
        <ResumoCard
          titulo="Rejeitadas"
          valor={
            rejeitadas.length
          }
          detalhe="Exigem análise"
        />
        <ResumoCard
          titulo="Autorizadas"
          valor={
            autorizadas.length
          }
          detalhe="Regularizadas"
        />
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-3">
              <span
                className={[
                  "h-3 w-3 rounded-full",
                  habilitada
                    ? "bg-emerald-500"
                    : "bg-zinc-300",
                ].join(" ")}
              />

              <div>
                <h2 className="font-semibold text-zinc-950">
                  NFC-e 65 — contingência offline
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Suportada pela integração Geranet.
                </p>
              </div>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-zinc-200 p-4">
              <input
                type="checkbox"
                checked={
                  habilitada
                }
                disabled={
                  !podeConfigurar
                }
                onChange={(event) =>
                  setHabilitada(
                    event.target
                      .checked
                  )
                }
                className="mt-1 h-4 w-4"
              />

              <span>
                <span className="block text-sm font-semibold text-zinc-900">
                  Habilitar emissão de NFC-e em contingência
                </span>
                <span className="mt-1 block text-sm leading-6 text-zinc-600">
                  Use somente quando houver indisponibilidade de comunicação/autorização. Rejeição tributária não é motivo para contingência.
                </span>
              </span>
            </label>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-zinc-800">
                Justificativa padrão
              </span>

              <textarea
                value={
                  justificativa
                }
                disabled={
                  !podeConfigurar
                }
                maxLength={256}
                onChange={(event) =>
                  setJustificativa(
                    event.target
                      .value
                  )
                }
                rows={3}
                className="mt-2 w-full rounded-xl border border-zinc-300 p-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-100"
              />

              <span className="mt-1 block text-xs text-zinc-500">
                {justificativa.length}/256 caracteres
              </span>
            </label>

            {podeConfigurar && (
              <button
                type="button"
                disabled={
                  salvando
                }
                onClick={
                  salvarConfig
                }
                className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {salvando
                  ? "Salvando..."
                  : "Salvar configuração"}
              </button>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
            <h2 className="font-semibold text-zinc-950">
              NF-e 55
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-600">
              O contrato público atual da Geranet não expõe SVC/EPEC para o modelo 55. O UltraPDV não inventa parâmetros de contingência para NF-e.
            </p>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Status: contingência automática NF-e 55 não habilitada neste provedor.
            </div>

            <p className="mt-4 text-xs leading-5 text-zinc-500">
              A contingência desta tela não torna o sistema hospedado utilizável quando a internet física da loja cai. Ela cobre o fluxo em que o UltraPDV/Geranet continuam acessíveis, mas a autorização SEFAZ está indisponível.
            </p>
          </div>
        </div>
      </section>

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

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-zinc-950">
              Fila de contingência
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              O sistema retransmite o XML originalmente gerado; não cria uma nova nota.
            </p>
          </div>

          <button
            type="button"
            disabled={
              pendentes.length ===
                0 ||
              processando !==
                null
            }
            onClick={
              transmitirLote
            }
            className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processando ===
            "lote"
              ? "Transmitindo..."
              : `Transmitir pendentes (${pendentes.length})`}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3">
                  Emissão
                </th>
                <th className="px-5 py-3">
                  Gerada
                </th>
                <th className="px-5 py-3">
                  Status
                </th>
                <th className="px-5 py-3">
                  Tentativas
                </th>
                <th className="px-5 py-3">
                  Venda
                </th>
                <th className="px-5 py-3">
                  Arquivos
                </th>
                <th className="px-5 py-3">
                  Ação
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-100">
              {emissoes.map(
                (emissao) => {
                  const horas =
                    horasDesde(
                      emissao
                        .contingencia_gerada_at
                    );

                  return (
                    <tr
                      key={
                        emissao.id
                      }
                      className="align-top"
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-zinc-900">
                          NFC-e série{" "}
                          {
                            emissao.serie
                          } nº{" "}
                          {
                            emissao.numero
                          }
                        </p>

                        <p className="mt-1 max-w-[300px] text-xs text-zinc-500">
                          {emissao
                            .contingencia_justificativa ||
                            "—"}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-zinc-600">
                        {dataHora(
                          emissao
                            .contingencia_gerada_at ||
                            emissao.created_at
                        )}

                        {horas !==
                          null &&
                          horas >=
                            20 &&
                          [
                            "aguardando_transmissao_contingencia",
                            "transmitindo_contingencia",
                            "aguardando_reconciliacao",
                          ].includes(
                            emissao.status
                          ) && (
                            <p className="mt-1 text-xs font-semibold text-red-700">
                              {horas >=
                              24
                                ? "Mais de 24h — prioridade crítica"
                                : "Próxima de 24h — transmitir com prioridade"}
                            </p>
                          )}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(
                            emissao.status
                          )}`}
                        >
                          {statusLabel(
                            emissao.status
                          )}
                        </span>

                        {(emissao
                          .contingencia_erro ||
                          emissao
                            .motivo) && (
                          <p className="mt-2 max-w-[300px] text-xs text-zinc-500">
                            {emissao
                              .contingencia_erro ||
                              emissao
                                .motivo}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {
                          emissao
                            .contingencia_tentativas
                        }
                      </td>

                      <td className="px-5 py-4">
                        {emissao.origem_tipo ===
                          "venda" &&
                        emissao.origem_id ? (
                          <Link
                            href={`/vendas/${emissao.origem_id}`}
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            Abrir venda
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          {emissao.tem_pdf && (
                            <a
                              href={`/api/fiscal/contingencia/${emissao.id}/arquivo?tipo=pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-zinc-700 hover:underline"
                            >
                              DANFE
                            </a>
                          )}

                          {emissao.tem_xml && (
                            <a
                              href={`/api/fiscal/contingencia/${emissao.id}/arquivo?tipo=xml&download=1`}
                              className="font-semibold text-zinc-700 hover:underline"
                            >
                              XML
                            </a>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        {emissao.status ===
                        "aguardando_transmissao_contingencia" ? (
                          <button
                            type="button"
                            disabled={
                              processando !==
                              null
                            }
                            onClick={() =>
                              transmitir(
                                emissao.id
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                          >
                            {processando ===
                            emissao.id
                              ? "Transmitindo..."
                              : "Transmitir agora"}
                          </button>
                        ) : emissao.status ===
                          "aguardando_reconciliacao" ? (
                          <span className="text-xs font-semibold text-orange-700">
                            Requer reconciliação
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                }
              )}

              {emissoes.length ===
                0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-sm text-zinc-500"
                  >
                    Nenhuma NFC-e em contingência registrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>
          Regra operacional:
        </strong>{" "}
        uma resposta ambígua nunca é tratada como rejeição automática. Se houver timeout ou dúvida após iniciar a transmissão, o documento vai para “Situação ambígua” e exige reconciliação antes de qualquer novo envio.
      </div>
    </div>
  );
}

function ResumoCard({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: number;
  detalhe: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {titulo}
      </p>
      <p className="mt-2 text-3xl font-bold text-zinc-950">
        {valor}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {detalhe}
      </p>
    </div>
  );
}
