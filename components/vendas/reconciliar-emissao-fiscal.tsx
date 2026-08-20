"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { resolverApresentacaoEmissaoFiscal } from "@/lib/fiscal/apresentacao-emissao";
import { resumoErroTecnicoConsulta } from "@/lib/fiscal/geranet/classificar-emissao";
import { EmitirNfeVendaButton } from "@/components/vendas/emitir-nfe-venda-button";
import { EmitirNfceVendaButton } from "@/components/vendas/emitir-nfce-venda-button";

type Props = {
  emissaoId: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  status: string;
  motivo?: string | null;
  cstat?: string | null;
  geranetHttpStatus?: number | null;
  geranetSituacao?: string | null;
  erroComunicacao?: string | null;
  protocolo?: string | null;
  chaveAcesso?: string | null;
  classificacao?: string | null;
  destaque?: boolean;
  retryVenda?: {
    vendaId: string;
    ambiente: 1 | 2;
    serie?: number;
  } | null;
};

type Resposta = {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
  situacao?: string;
  status?: string;
  cstat?: string | null;
  podeConsultarNovamente?: boolean;
  podeRetransmitir?: boolean;
};

export function ReconciliarEmissaoFiscal({
  emissaoId,
  modelo,
  serie,
  numero,
  status,
  motivo,
  cstat,
  geranetHttpStatus,
  geranetSituacao,
  erroComunicacao,
  protocolo,
  chaveAcesso,
  classificacao,
  destaque = false,
  retryVenda = null,
}: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [diagnosticoAberto, setDiagnosticoAberto] = useState(false);
  const [statusConsultado, setStatusConsultado] = useState<string | null>(null);
  const [classificacaoConsultada, setClassificacaoConsultada] = useState<
    string | null
  >(null);
  const [situacaoConsultada, setSituacaoConsultada] = useState<string | null>(
    null
  );

  useEffect(() => {
    setStatusConsultado(null);
    setClassificacaoConsultada(null);
    setSituacaoConsultada(null);
  }, [status, classificacao]);

  const statusEfetivo = statusConsultado ?? status;
  const classificacaoEfetiva = classificacaoConsultada ?? classificacao;
  const resumoConsultado =
    statusConsultado === "aguardando_reconciliacao"
      ? situacaoConsultada === "processando"
        ? {
            classificacao: classificacaoEfetiva ?? "ambigua",
            situacao_remota: "processando",
            origem_classificacao: "consulta_geranet",
            mensagem: toast,
          }
        : {
            classificacao: classificacaoEfetiva ?? "ambigua",
          }
      : undefined;

  const apresentacao = resolverApresentacaoEmissaoFiscal({
    modelo,
    status: statusEfetivo,
    classificacao: classificacaoEfetiva,
    resposta_resumo: resumoConsultado,
    cstat,
    motivo,
    protocolo,
    chaveAcesso,
    geranetHttpStatus,
    geranetSituacao,
    erroComunicacao,
  });
  const erroTecnico = resumoErroTecnicoConsulta(
    motivo ?? erroComunicacao ?? null
  );
  const diagnostico = [
    geranetHttpStatus != null ? `HTTP ${geranetHttpStatus}` : null,
    geranetSituacao ? `situação Geranet: ${geranetSituacao}` : null,
    classificacao ? `classificação: ${classificacao}` : null,
    cstat ? `cStat ${cstat}` : null,
    motivo || erroComunicacao || erroTecnico,
  ]
    .filter(Boolean)
    .join("\n");

  async function consultar() {
    setEnviando(true);
    setToast(null);
    setSucesso(false);

    try {
      const response = await fetch(
        `/api/fiscal/emissoes/${emissaoId}/reconciliar`,
        {
          method: "POST",
        }
      );

      const data = (await response.json()) as Resposta;
      const mensagem =
        data.mensagem ??
        data.erro ??
        "Não foi possível consultar a situação fiscal.";

      setSucesso(Boolean(data.ok) && data.situacao !== "falha_consulta");
      setToast(mensagem);
      if (data.situacao) {
        setSituacaoConsultada(data.situacao);
      }
      if (data.status) {
        setStatusConsultado(data.status);
      }
      if (data.status === "aguardando_reconciliacao") {
        setClassificacaoConsultada("ambigua");
      } else if (data.status === "autorizada") {
        setClassificacaoConsultada("autorizada");
      } else if (data.status === "rejeitada") {
        setClassificacaoConsultada("rejeitada");
      } else if (data.situacao === "processando") {
        setStatusConsultado("aguardando_reconciliacao");
        setClassificacaoConsultada("ambigua");
      }
      router.refresh();
    } catch (error) {
      setSucesso(false);
      setToast(
        error instanceof Error
          ? error.message
          : "Falha ao consultar a situação fiscal."
      );
    } finally {
      setEnviando(false);
    }
  }

  const retry =
    retryVenda && apresentacao.acaoPrincipal === "tentar_novamente" ? (
      modelo === "65" ? (
        <EmitirNfceVendaButton
          vendaId={retryVenda.vendaId}
          ambiente={retryVenda.ambiente}
          serie={retryVenda.serie}
          rotulo="Tentar novamente"
          confirmacao={`Tentar novamente a NFC-e série ${serie} nº ${numero} desta venda?\n\nA numeração atual será reutilizada. Nenhum número novo será gerado.`}
        />
      ) : (
        <EmitirNfeVendaButton
          vendaId={retryVenda.vendaId}
          ambiente={retryVenda.ambiente}
          serie={retryVenda.serie}
          rotulo="Tentar novamente"
          confirmacao={`Tentar novamente a NF-e série ${serie} nº ${numero} desta venda?\n\nA numeração atual será reutilizada. Nenhum número novo será gerado.`}
        />
      )
    ) : null;

  if (destaque && apresentacao.caso === "nao_transmitida") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              {apresentacao.titulo}
            </p>
            <h2 className="mt-1 text-[15px] font-semibold text-amber-950">
              {modelo === "65" ? "NFC-e" : "NF-e"} série {serie} · nº {numero}
            </h2>
            <p className="mt-2 max-w-3xl text-[13px] text-amber-900">
              {apresentacao.texto}
            </p>
            {diagnosticoAberto ? (
              <pre className="mt-2 max-w-3xl whitespace-pre-wrap text-[12px] text-amber-900">
                {diagnostico || "Sem detalhe adicional persistido."}
              </pre>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
              className="updv-btn updv-btn-ghost"
            >
              {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
            </button>
            {retry}
            {apresentacao.consultaGeranetSecundaria ? (
              <button
                type="button"
                disabled={enviando}
                onClick={consultar}
                className="updv-btn updv-btn-ghost"
              >
                {enviando ? "Consultando..." : "Consultar Geranet"}
              </button>
            ) : null}
          </div>
        </div>
        {toast ? (
          <div
            className={[
              "mt-4 rounded-xl border p-3 text-sm whitespace-pre-line",
              sucesso
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-white text-amber-950",
            ].join(" ")}
          >
            {toast}
          </div>
        ) : null}
      </div>
    );
  }

  if (destaque && apresentacao.caso === "nao_classificada") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              {apresentacao.titulo}
            </p>
            <h2 className="mt-1 text-[15px] font-semibold text-amber-950">
              {modelo === "65" ? "NFC-e" : "NF-e"} série {serie} · nº {numero}
            </h2>
            <p className="mt-2 max-w-3xl text-[13px] text-amber-900">
              {apresentacao.texto}
            </p>
            {diagnosticoAberto ? (
              <pre className="mt-2 max-w-3xl whitespace-pre-wrap text-[12px] text-amber-900">
                {diagnostico || "Sem detalhe adicional persistido."}
              </pre>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
              className="updv-btn updv-btn-ghost"
            >
              {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
            </button>
            {apresentacao.consultaGeranetSecundaria ? (
              <button
                type="button"
                disabled={enviando}
                onClick={consultar}
                className="updv-btn updv-btn-ghost"
              >
                {enviando ? "Consultando..." : "Consultar Geranet"}
              </button>
            ) : null}
          </div>
        </div>
        {toast ? (
          <div
            className={[
              "mt-4 rounded-xl border p-3 text-sm whitespace-pre-line",
              sucesso
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-white text-amber-950",
            ].join(" ")}
          >
            {toast}
          </div>
        ) : null}
      </div>
    );
  }

  if (destaque && apresentacao.acaoPrincipal === "reconciliar") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              {apresentacao.titulo}
            </p>
            <h2 className="mt-1 text-[15px] font-semibold text-amber-950">
              {modelo === "65" ? "NFC-e" : "NF-e"} série {serie} · nº {numero}
            </h2>
            <p className="mt-2 max-w-3xl text-[13px] text-amber-900">
              {apresentacao.texto}
            </p>
            {diagnosticoAberto ? (
              <pre className="mt-2 max-w-3xl whitespace-pre-wrap text-[12px] text-amber-900">
                {[
                  geranetHttpStatus != null
                    ? `Geranet:\nHTTP ${geranetHttpStatus}`
                    : null,
                  motivo || erroComunicacao
                    ? `Mensagem:\n${motivo || erroComunicacao}`
                    : null,
                  `Status UltraPDV:\nAguardando reconciliação`,
                ]
                  .filter(Boolean)
                  .join("\n\n") || diagnostico}
              </pre>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
              className="updv-btn updv-btn-ghost"
            >
              {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={consultar}
              className="updv-btn updv-btn-primary shrink-0 bg-amber-800 hover:bg-amber-900"
            >
              {enviando ? "Consultando..." : "Acompanhar reconciliação"}
            </button>
          </div>
        </div>
        {toast ? (
          <div
            className={[
              "mt-4 rounded-xl border p-3 text-sm whitespace-pre-line",
              sucesso
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-white text-amber-950",
            ].join(" ")}
          >
            {toast}
          </div>
        ) : null}
      </div>
    );
  }

  const diagnosticoDetalhe =
    apresentacao.acaoPrincipal === "reconciliar"
      ? [
          geranetHttpStatus != null
            ? `Geranet:\nHTTP ${geranetHttpStatus}`
            : null,
          motivo || erroComunicacao
            ? `Mensagem:\n${motivo || erroComunicacao}`
            : null,
          `Status UltraPDV:\nAguardando reconciliação`,
        ]
          .filter(Boolean)
          .join("\n\n") || diagnostico
      : diagnostico || "Sem detalhe adicional persistido.";

  if (apresentacao.acaoPrincipal === "tentar_novamente" && retry) {
    return (
      <div className="flex w-full flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
          className="updv-btn updv-btn-ghost"
        >
          {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
        </button>
        {retry}
        <button
          type="button"
          disabled={enviando}
          onClick={consultar}
          className="updv-btn updv-btn-ghost disabled:opacity-50"
        >
          {enviando ? "Consultando..." : "Consultar Geranet"}
        </button>
        {diagnosticoAberto ? (
          <pre className="max-w-sm whitespace-pre-wrap text-[12px] text-zinc-600">
            {diagnosticoDetalhe}
          </pre>
        ) : null}
        {toast ? (
          <p className="max-w-sm text-xs whitespace-pre-line text-zinc-600">
            {toast}
          </p>
        ) : null}
      </div>
    );
  }

  if (apresentacao.acaoPrincipal === "reconciliar") {
    return (
      <div className="flex w-full flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
          className="updv-btn updv-btn-ghost"
        >
          {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={consultar}
          className="updv-btn updv-btn-primary shrink-0 bg-amber-800 hover:bg-amber-900 disabled:opacity-50"
        >
          {enviando ? "Consultando..." : "Acompanhar reconciliação"}
        </button>
        {diagnosticoAberto ? (
          <pre className="max-w-sm whitespace-pre-wrap text-[12px] text-zinc-600">
            {diagnosticoDetalhe}
          </pre>
        ) : null}
        {toast ? (
          <p className="max-w-sm text-xs whitespace-pre-line text-zinc-600">
            {toast}
          </p>
        ) : null}
      </div>
    );
  }

  if (apresentacao.acaoPrincipal === "consultar_diagnostico") {
    return (
      <div className="flex w-full flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={() => setDiagnosticoAberto((aberto) => !aberto)}
          className="updv-btn updv-btn-ghost"
        >
          {diagnosticoAberto ? "Ocultar diagnóstico" : "Ver diagnóstico"}
        </button>
        {apresentacao.consultaGeranetSecundaria ? (
          <button
            type="button"
            disabled={enviando}
            onClick={consultar}
            className="updv-btn updv-btn-ghost disabled:opacity-50"
          >
            {enviando ? "Consultando..." : "Consultar Geranet"}
          </button>
        ) : null}
        {diagnosticoAberto ? (
          <pre className="max-w-sm whitespace-pre-wrap text-[12px] text-zinc-600">
            {diagnosticoDetalhe}
          </pre>
        ) : null}
        {toast ? (
          <p className="max-w-sm text-xs whitespace-pre-line text-zinc-600">
            {toast}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
