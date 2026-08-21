"use client";

import { CancelarDocumentoFiscal } from "@/components/vendas/cancelar-documento-fiscal";
import { CartaCorrecaoNfe } from "@/components/vendas/carta-correcao-nfe";
import { DocumentoFiscalBotoes } from "@/components/vendas/documento-fiscal-botoes";
import { ReconciliarEmissaoFiscal } from "@/components/vendas/reconciliar-emissao-fiscal";
import { DocumentoFiscalCard } from "@/components/fiscal/documento-fiscal-card";
import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import {
  resolverAcoesEmissaoFiscal,
  rotuloModeloFiscal,
} from "@/lib/fiscal/acoes-emissao";
import { resolverApresentacaoEmissaoFiscal } from "@/lib/fiscal/apresentacao-emissao";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  cancelamentoDaEmissao,
  cartasCorrecaoDaEmissao,
  proximaSequenciaCce,
  type EventoEmissaoFiscal,
} from "@/lib/fiscal/eventos-emissao";
import type { PoliticaCancelamentoPublica } from "@/lib/fiscal/politica-cancelamento";
import { tomVisualDocumentoFiscal } from "@/lib/fiscal/tom-visual-emissao";

export type EmissaoFiscalAcoesEmissao = {
  id: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  status: string;
  chaveAcesso?: string | null;
  protocolo?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  geranetHttpStatus?: number | null;
  geranetSituacao?: string | null;
  erroComunicacao?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  autorizadaAt?: string | null;
  enviadaAt?: string | null;
  createdAt?: string | null;
};

function textoStatus(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return valor.replace(/_/g, " ");
}

function formatarData(valor: string | null | undefined) {
  if (!valor) {
    return null;
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

export function EmissaoFiscalAcoes({
  titulo,
  emissao,
  eventos,
  politicaCancelamento,
  bloqueioCancelamentoOperacional = null,
  retryVenda = null,
  cartaoDestaque = false,
  ocultarConsulta = false,
}: {
  titulo?: string;
  emissao: EmissaoFiscalAcoesEmissao;
  eventos: EventoEmissaoFiscal[];
  politicaCancelamento: PoliticaCancelamentoPublica;
  bloqueioCancelamentoOperacional?: string | null;
  retryVenda?: {
    vendaId: string;
    ambiente: 1 | 2;
    serie?: number;
  } | null;
  cartaoDestaque?: boolean;
  ocultarConsulta?: boolean;
}) {
  const cancelamento = cancelamentoDaEmissao(eventos, emissao.id);
  const cartas = cartasCorrecaoDaEmissao(eventos, emissao.id);
  const ultimaCce = cartas.find((evento) => evento.status === "sucesso") ?? null;
  const entradaEstado = {
    modelo: emissao.modelo,
    status: emissao.status,
    cstat: emissao.cstat,
    motivo: emissao.motivo,
    protocolo: emissao.protocolo,
    chaveAcesso: emissao.chaveAcesso,
    geranetHttpStatus: emissao.geranetHttpStatus,
    geranetSituacao: emissao.geranetSituacao,
    erroComunicacao: emissao.erroComunicacao,
    classificacao: emissao.classificacao,
    resposta_resumo: emissao.resposta_resumo,
  };
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: entradaEstado,
    statusEventoCancelamento: cancelamento?.status,
    politicaCancelamentoPermitido: politicaCancelamento.permitido,
    bloqueioCancelamentoOperacional,
  });

  const documento = rotuloModeloFiscal(emissao.modelo);
  const apresentacao = resolverApresentacaoEmissaoFiscal(entradaEstado);
  const estado = resolverEstadoOperacionalDeEmissaoPersistida(entradaEstado);
  const tom = tomVisualDocumentoFiscal(estado.estado);
  const dataIso =
    emissao.autorizadaAt ||
    cancelamento?.concluido_at ||
    emissao.enviadaAt ||
    emissao.createdAt ||
    null;
  const rotuloData =
    emissao.status === "autorizada" && emissao.autorizadaAt
      ? "Data de autorização"
      : emissao.status === "cancelada"
        ? "Data do cancelamento"
        : dataIso
          ? "Data"
          : null;

  const tituloCard =
    apresentacao.caso !== "outro" ? apresentacao.titulo : (titulo ?? documento);

  return (
    <DocumentoFiscalCard
      documento={documento}
      serie={emissao.serie}
      numero={emissao.numero}
      status={emissao.status}
      titulo={tituloCard}
      descricao={tom === "autorizada" ? null : apresentacao.texto || null}
      cstat={emissao.cstat}
      protocolo={emissao.protocolo}
      chaveAcesso={emissao.chaveAcesso}
      motivo={emissao.motivo}
      dataRelevante={formatarData(dataIso)}
      rotuloData={rotuloData}
      tom={tom}
      acoes={
        <>
          {(acoes.podeBaixarPdf || acoes.podeBaixarXml) && (
            <DocumentoFiscalBotoes
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              empilhado
              somente={
                acoes.podeBaixarPdf && acoes.podeBaixarXml
                  ? "ambos"
                  : acoes.podeBaixarPdf
                    ? "pdf"
                    : "xml"
              }
            />
          )}
          {cancelamento?.status === "sucesso" && cancelamento.xml_hex ? (
            <a
              href={`/api/fiscal/eventos/${cancelamento.id}/arquivo?tipo=xml`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            >
              XML cancelamento
            </a>
          ) : null}

          {acoes.podeConsultar && !ocultarConsulta ? (
            <ReconciliarEmissaoFiscal
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              serie={emissao.serie}
              numero={emissao.numero}
              status={emissao.status}
              motivo={emissao.motivo}
              cstat={emissao.cstat}
              geranetHttpStatus={emissao.geranetHttpStatus}
              geranetSituacao={emissao.geranetSituacao}
              erroComunicacao={emissao.erroComunicacao}
              protocolo={emissao.protocolo}
              chaveAcesso={emissao.chaveAcesso}
              classificacao={emissao.classificacao}
              destaque={cartaoDestaque}
              retryVenda={retryVenda}
            />
          ) : null}

          {acoes.podeCartaCorrecao ? (
            <CartaCorrecaoNfe
              emissaoId={emissao.id}
              serie={emissao.serie}
              numero={emissao.numero}
              proximaSequencia={proximaSequenciaCce(cartas)}
              ultimoTexto={ultimaCce?.texto_correcao ?? null}
            />
          ) : null}

          {acoes.podeCancelar ? (
            <CancelarDocumentoFiscal
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              serie={emissao.serie}
              numero={emissao.numero}
              politica={politicaCancelamento}
              statusEventoCancelamento={cancelamento?.status ?? null}
            />
          ) : bloqueioCancelamentoOperacional &&
            emissao.status === "autorizada" ? (
            <p className="max-w-sm text-xs text-red-800">
              {bloqueioCancelamentoOperacional}
            </p>
          ) : null}
        </>
      }
      extras={
        cancelamento?.status === "sucesso" || cartas.length > 0 ? (
        <>
          {cancelamento?.status === "sucesso" ? (
            <div className="rounded-xl border border-red-200 bg-white/70 p-3 text-sm text-red-900">
              <p>
                <strong>Cancelamento autorizado</strong>
                {cancelamento.cstat ? ` · cStat ${cancelamento.cstat}` : ""}
              </p>
              <p className="mt-1">
                Protocolo do evento:{" "}
                <strong>{cancelamento.protocolo ?? "—"}</strong>
              </p>
              <p className="mt-1">
                Justificativa: {cancelamento.justificativa ?? "—"}
              </p>
              {cancelamento.motivo ? (
                <p className="mt-1">Retorno: {cancelamento.motivo}</p>
              ) : null}
            </div>
          ) : null}

          {cartas.length > 0 ? (
            <div className="rounded-xl border border-blue-200 bg-white/80 p-4 text-sm text-blue-950">
              <p className="font-semibold">Cartas de Correção</p>
              <div className="mt-3 space-y-3">
                {cartas.map((evento) => (
                  <div
                    key={evento.id}
                    className="rounded-lg border border-blue-100 bg-blue-50/60 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        CC-e nº {evento.sequencia ?? "—"}
                      </p>
                      <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-xs font-semibold uppercase text-blue-700">
                        {textoStatus(evento.status)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-blue-900">
                      {evento.texto_correcao ?? "Texto não armazenado."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700">
                      <span>
                        {formatarData(evento.concluido_at ?? evento.created_at) ??
                          "—"}
                      </span>
                      {evento.cstat ? <span>cStat {evento.cstat}</span> : null}
                      {evento.protocolo ? (
                        <span>Protocolo {evento.protocolo}</span>
                      ) : null}
                      {evento.xml_hex ? (
                        <a
                          href={`/api/fiscal/eventos/${evento.id}/arquivo?tipo=xml`}
                          className="font-semibold underline"
                        >
                          XML do evento
                        </a>
                      ) : null}
                      {evento.status === "sucesso" ? (
                        <>
                          <a
                            href={`/pdv/imprimir/carta-correcao/${evento.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold underline"
                          >
                            Visualizar CC-e
                          </a>
                          <BotaoImprimirConector
                            pdfUrl={`/api/impressao/carta-correcao/${evento.id}`}
                            tipoDocumento="danfe_nfe"
                            papel="a4"
                            label="Imprimir CC-e"
                            className="font-semibold underline"
                          />
                        </>
                      ) : null}
                    </div>
                    {evento.motivo ? (
                      <p className="mt-2 text-xs text-blue-700">
                        Retorno: {evento.motivo}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
        ) : null
      }
    />
  );
}
