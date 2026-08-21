import {
  Clock,
  History,
  Shield,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  rotuloTipoEventoFiscal,
  type EventoEmissaoFiscal,
} from "@/lib/fiscal/eventos-emissao";
import { rotuloModeloFiscal } from "@/lib/fiscal/acoes-emissao";
import {
  rotuloClassificacaoTentativa,
  type TentativaFiscalResumo,
} from "@/lib/fiscal/emissao-tentativas";
import { ehDuplicidadeChaveAcesso } from "@/lib/fiscal/geranet/cstat";

type EmissaoResumo = {
  id: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  status: string;
  cstat?: string | null;
  motivo?: string | null;
};

function formatarData(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

function marcaTentativa(
  classificacao: string | null | undefined,
  evidencia?: { cstat?: string | null; motivo?: string | null }
) {
  if (
    evidencia &&
    ehDuplicidadeChaveAcesso({
      cstat: evidencia.cstat,
      mensagem: evidencia.motivo,
    })
  ) {
    return {
      simbolo: "×",
      classe: "text-red-700",
    };
  }

  const chave = String(classificacao ?? "").toLowerCase();
  if (chave === "autorizada") {
    return {
      simbolo: "✓",
      classe: "text-emerald-700",
    };
  }
  if (chave === "rejeitada") {
    return {
      simbolo: "×",
      classe: "text-red-700",
    };
  }
  if (chave === "aguardando_reconciliacao" || chave === "erro_comunicacao") {
    return {
      simbolo: "!",
      classe: "text-amber-800",
    };
  }
  return {
    simbolo: "•",
    classe: "text-zinc-600",
  };
}

export function EmissaoFiscalHistorico({
  emissoes,
  eventos,
  tentativas = [],
  tentativasCabecalho = 0,
}: {
  emissoes: EmissaoResumo[];
  eventos: EventoEmissaoFiscal[];
  tentativas?: TentativaFiscalResumo[];
  tentativasCabecalho?: number;
}) {
  if (
    emissoes.length === 0 &&
    eventos.length === 0 &&
    tentativas.length === 0
  ) {
    return null;
  }

  const consultas = eventos.filter((evento) => evento.tipo === "consulta_status");
  const menorTentativa =
    tentativas.length > 0
      ? Math.min(...tentativas.map((item) => Number(item.tentativa) || 0))
      : 0;
  const transmissaoAnteriorSemHistorico =
    Number(tentativasCabecalho) >= 1 &&
    (tentativas.length === 0 || menorTentativa > 1);

  const painelTentativas =
    emissoes.length > 0 && tentativas.length === 0 ? (
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex h-10 items-center gap-2 border-b border-zinc-200 px-3">
          <Shield className="h-4 w-4 text-zinc-500" />
          <h2 className="text-[13px] font-semibold text-zinc-800">
            Tentativas fiscais
          </h2>
        </div>
        <p className="px-3 py-3 text-[13px] text-zinc-500">
          {transmissaoAnteriorSemHistorico
            ? "Esta emissão possui uma transmissão anterior realizada antes da implantação do histórico detalhado."
            : "Histórico detalhado de tentativas indisponível para esta emissão."}
        </p>
      </div>
    ) : tentativas.length > 0 ? (
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex h-10 items-center gap-2 border-b border-zinc-200 px-3">
          <Shield className="h-4 w-4 text-zinc-500" />
          <h2 className="text-[13px] font-semibold text-zinc-800">
            Tentativas fiscais
          </h2>
        </div>
        {transmissaoAnteriorSemHistorico ? (
          <p className="border-b border-zinc-100 px-3 py-2 text-[13px] text-zinc-500">
            Esta emissão possui uma transmissão anterior realizada antes da
            implantação do histórico detalhado.
          </p>
        ) : null}
        <ol className="divide-y divide-zinc-100">
          {tentativas.map((tentativa) => {
            const marca = marcaTentativa(tentativa.classificacao_inicial, {
              cstat: tentativa.cstat,
              motivo: tentativa.motivo,
            });
            return (
              <li key={tentativa.id} className="px-3 py-3">
                <p className={`text-[13px] font-semibold ${marca.classe}`}>
                  {marca.simbolo} Tentativa {tentativa.tentativa}
                  {" · "}
                  {rotuloClassificacaoTentativa(
                    tentativa.classificacao_inicial,
                    {
                      cstat: tentativa.cstat,
                      motivo: tentativa.motivo,
                    }
                  )}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatarData(
                      tentativa.respondida_at ??
                        tentativa.finalizada_at ??
                        tentativa.iniciada_at
                    )}
                  </span>
                  {tentativa.http_status != null ? (
                    <span>HTTP {tentativa.http_status}</span>
                  ) : null}
                  {tentativa.cstat ? <span>cStat {tentativa.cstat}</span> : null}
                </p>
                {tentativa.motivo ? (
                  <p className="mt-1 max-w-3xl text-[12px] leading-5 text-zinc-700">
                    {tentativa.motivo}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      {emissoes.length > 0 || painelTentativas ? (
        <div
          className={
            emissoes.length > 0 && painelTentativas
              ? "grid gap-3 lg:grid-cols-2"
              : undefined
          }
        >
          {emissoes.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex h-10 items-center gap-2 border-b border-zinc-200 px-3">
                <History className="h-4 w-4 text-zinc-500" />
                <h2 className="text-[13px] font-semibold text-zinc-800">
                  Histórico fiscal
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="updv-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Modelo</th>
                      <th>Série</th>
                      <th>Número</th>
                      <th>Status</th>
                      <th>cStat</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emissoes.map((emissao) => (
                      <tr key={emissao.id}>
                        <td className="font-medium">
                          {rotuloModeloFiscal(emissao.modelo)}
                        </td>
                        <td>{emissao.serie}</td>
                        <td>{emissao.numero}</td>
                        <td>
                          <StatusBadge status={emissao.status} />
                        </td>
                        <td>{emissao.cstat ?? "—"}</td>
                        <td className="max-w-[280px] truncate">
                          {emissao.motivo ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {painelTentativas}
        </div>
      ) : null}

      {eventos.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex h-10 items-center border-b border-zinc-200 px-3">
            <h2 className="text-[13px] font-semibold text-zinc-800">
              Eventos
            </h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {eventos.map((evento) => (
              <div key={evento.id} className="px-3 py-2 text-[13px]">
                <p className="font-medium text-zinc-950">
                  {rotuloTipoEventoFiscal(evento.tipo)}
                  {evento.sequencia ? ` nº ${evento.sequencia}` : ""}
                  {evento.status ? ` · ${evento.status.replace(/_/g, " ")}` : ""}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  {formatarData(evento.concluido_at ?? evento.created_at)}
                  {evento.cstat ? ` · cStat ${evento.cstat}` : ""}
                  {evento.protocolo ? ` · Protocolo ${evento.protocolo}` : ""}
                </p>
                {evento.texto_correcao || evento.justificativa || evento.motivo ? (
                  <p className="mt-1 max-w-3xl whitespace-pre-wrap text-[12px] text-zinc-700">
                    {evento.texto_correcao ||
                      evento.justificativa ||
                      evento.motivo}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {consultas.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex h-10 items-center border-b border-zinc-200 px-3">
            <h2 className="text-[13px] font-semibold text-zinc-800">
              Consultas fiscais
            </h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {consultas.slice(0, 8).map((evento) => (
              <div key={evento.id} className="px-3 py-2 text-[13px]">
                <p className="font-medium text-zinc-950">
                  {evento.motivo ?? "Consulta Geranet"}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  {formatarData(evento.concluido_at ?? evento.created_at)}
                  {evento.cstat ? ` · cStat ${evento.cstat}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
