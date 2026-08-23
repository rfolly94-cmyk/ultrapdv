"use client";

import { useEffect, useState } from "react";

import { buscarConfiguracoesImpressaoAction } from "@/app/configuracoes/impressao/actions";
import { AppModal } from "@/components/ui/app-modal";
import { consultarSaudeAgente } from "@/lib/impressao/agente";
import { aplicarDispositivoIdDoConector, obterDispositivoId } from "@/lib/impressao/dispositivo";
import { imprimirUrlPdfNoUltraPdvConector } from "@/lib/impressao/imprimir-pdf";
import {
  MENSAGEM_CONECTOR_AUSENTE,
  MENSAGEM_CONECTOR_NAO_CONTRATADO,
  normalizarErroImpressaoConector,
} from "@/lib/impressao/mensagens";
import {
  nomeArquivoReciboRecebimento,
  urlPdfReciboRecebimento,
} from "@/lib/impressao/recibo-carteira";
import { configDoTipo, ehUuid } from "@/lib/impressao/regras";
import type { PapelImpressao } from "@/lib/impressao/tipos";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";

export type ReciboRecebimentoResumo = {
  id: string;
  valor: number | string;
  formaPagamento: string | null;
  dataIso: string | null;
};

function dinheiro(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dataHora(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(valor));
}

async function baixarPdf(url: string, filename: string) {
  const resposta = await fetch(url, { credentials: "same-origin" });
  if (!resposta.ok) {
    const data = (await resposta.json().catch(() => ({}))) as { erro?: string };
    throw new Error(data.erro || "Não foi possível gerar o PDF.");
  }
  const blob = await resposta.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function ModalReciboRecebimento({
  open,
  clienteId,
  clienteNome,
  recebimento,
  onClose,
}: {
  open: boolean;
  clienteId: string;
  clienteNome: string;
  recebimento: ReciboRecebimentoResumo | null;
  onClose: () => void;
}) {
  const conectorLiberado = useRecursoLiberado("impressao_automatica");
  const [impressoraNome, setImpressoraNome] = useState<string>("");
  const [papel, setPapel] = useState<PapelImpressao>("80mm");
  const [copias, setCopias] = useState(1);
  const [conectorOk, setConectorOk] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState<"idle" | "imprimindo" | "pdf">("idle");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let ativo = true;
    setMensagem(null);
    setErro(null);
    setOcupado("idle");

    void (async () => {
      const saude = await consultarSaudeAgente();
      let dispositivoId = obterDispositivoId();
      if (saude.ok && ehUuid(saude.dispositivoId)) {
        aplicarDispositivoIdDoConector(saude.dispositivoId);
        dispositivoId = saude.dispositivoId;
      }

      const configs = dispositivoId
        ? await buscarConfiguracoesImpressaoAction(dispositivoId)
        : { ok: false as const };

      if (!ativo) {
        return;
      }

      const recibo = configs.ok
        ? configDoTipo(configs.configs, "recibo")
        : null;
      setPapel(recibo?.papel ?? "80mm");
      setCopias(recibo?.copias ?? 1);
      setImpressoraNome(
        String(recibo?.impressoraNome ?? "").trim() ||
          String(saude.lastPrinter ?? "").trim()
      );
      setConectorOk(saude.ok);
      if (!saude.ok) {
        setErro(MENSAGEM_CONECTOR_AUSENTE);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [open]);

  if (!recebimento) {
    return null;
  }

  const pdfUrl = urlPdfReciboRecebimento({
    recebimentoId: recebimento.id,
    clienteId,
    papel,
  });
  const filename = nomeArquivoReciboRecebimento({
    clienteNome,
    dataIso: recebimento.dataIso,
    recebimentoId: recebimento.id,
  });

  async function imprimir() {
    if (!conectorLiberado) {
      setErro(MENSAGEM_CONECTOR_NAO_CONTRATADO);
      setMensagem(null);
      return;
    }

    setOcupado("imprimindo");
    setErro(null);
    setMensagem(null);
    const resultado = await imprimirUrlPdfNoUltraPdvConector({
      url: pdfUrl,
      tipoDocumento: "recibo",
      papel,
      copias,
      impressora: impressoraNome || null,
    });
    setOcupado("idle");
    if (resultado.ok) {
      setConectorOk(true);
      setErro(null);
      setMensagem(resultado.mensagem);
      if (resultado.impressora) {
        setImpressoraNome(resultado.impressora);
      }
      return;
    }
    setErro(normalizarErroImpressaoConector(resultado.erro));
  }

  async function salvarPdf() {
    setOcupado("pdf");
    setErro(null);
    setMensagem(null);
    try {
      await baixarPdf(pdfUrl, filename);
      setMensagem("PDF salvo.");
    } catch (error) {
      setErro(
        error instanceof Error ? error.message : "Não foi possível salvar o PDF."
      );
    } finally {
      setOcupado("idle");
    }
  }

  const ocupadoAgora = ocupado !== "idle";

  return (
    <AppModal
      open={open}
      title="Recibo de recebimento"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={onClose}
            disabled={ocupadoAgora}
          >
            Fechar
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => void salvarPdf()}
            disabled={ocupadoAgora}
          >
            {ocupado === "pdf" ? "Gerando PDF..." : "Salvar PDF"}
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            onClick={() => void imprimir()}
            disabled={ocupadoAgora}
          >
            {ocupado === "imprimindo"
              ? "Enviando..."
              : "Imprimir na impressora"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <p className="text-base font-semibold text-zinc-950">{clienteNome}</p>
          <p className="mt-1 text-lg font-semibold text-zinc-950">
            {dinheiro(recebimento.valor)}
          </p>
          <p className="text-xs text-zinc-500">
            {recebimento.formaPagamento || "—"}
            {" • "}
            {dataHora(recebimento.dataIso)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Recebimento {recebimento.id}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs font-medium text-zinc-500">
            Impressora selecionada
          </p>
          <p className="mt-0.5 font-semibold text-zinc-900">
            {impressoraNome ||
              (conectorOk === false
                ? "Conector indisponível"
                : "Impressora do UltraPDV Conector")}
          </p>
        </div>

        {mensagem ? (
          <p className="text-xs text-emerald-700">{mensagem}</p>
        ) : null}
        {erro ? (
          <p className="whitespace-pre-line rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {erro}
          </p>
        ) : null}
      </div>
    </AppModal>
  );
}
