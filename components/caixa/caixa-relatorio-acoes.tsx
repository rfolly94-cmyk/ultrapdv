"use client";

import { useEffect, useState } from "react";

import { buscarConfiguracoesImpressaoAction } from "@/app/configuracoes/impressao/actions";
import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import { consultarSaudeAgente } from "@/lib/impressao/agente";
import {
  aplicarDispositivoIdDoConector,
  obterDispositivoId,
} from "@/lib/impressao/dispositivo";
import { MENSAGEM_CONECTOR_AUSENTE } from "@/lib/impressao/mensagens";
import { configDoTipo, ehUuid } from "@/lib/impressao/regras";
import { nomeArquivoRelatorioCaixa, urlPdfRelatorioCaixa } from "@/lib/caixa/relatorio";

export function CaixaRelatorioAcoes({
  caixaId,
  numero,
  abertoEm,
}: {
  caixaId: string;
  numero: number;
  abertoEm: string;
}) {
  const [impressora, setImpressora] = useState<string>("");
  const [erroConector, setErroConector] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const pdfUrl = urlPdfRelatorioCaixa(caixaId);
  const filename = nomeArquivoRelatorioCaixa({
    numero,
    aberto_em: abertoEm,
  });

  useEffect(() => {
    let ativo = true;
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
      const a4 = configs.ok ? configDoTipo(configs.configs, "danfe_nfe") : null;
      setImpressora(
        String(a4?.impressoraNome ?? "").trim() ||
          String(saude.lastPrinter ?? "").trim()
      );
      setErroConector(saude.ok ? null : MENSAGEM_CONECTOR_AUSENTE);
    })();
    return () => {
      ativo = false;
    };
  }, []);

  async function baixarPdf() {
    setBaixando(true);
    setErroPdf(null);
    try {
      const resposta = await fetch(urlPdfRelatorioCaixa(caixaId, true), {
        credentials: "same-origin",
      });
      if (!resposta.ok) {
        const data = (await resposta.json().catch(() => ({}))) as {
          erro?: string;
        };
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
    } catch (error) {
      setErroPdf(
        error instanceof Error ? error.message : "Não foi possível gerar o PDF."
      );
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="flex flex-wrap gap-2">
        <BotaoImprimirConector
          pdfUrl={pdfUrl}
          tipoDocumento="danfe_nfe"
          papel="a4"
          impressora={impressora || null}
          label="Imprimir relatório"
          className="updv-btn updv-btn-ghost"
          onResultado={(ok, mensagem) => {
            setErroConector(ok ? null : mensagem);
          }}
        />
        <button
          type="button"
          className="updv-btn updv-btn-ghost"
          disabled={baixando}
          onClick={() => void baixarPdf()}
        >
          {baixando ? "Gerando..." : "Baixar PDF"}
        </button>
      </div>
      {erroConector ? (
        <p className="max-w-md whitespace-pre-line text-xs text-amber-800">
          {erroConector}
        </p>
      ) : null}
      {erroPdf ? (
        <p className="max-w-md text-xs text-rose-700">{erroPdf}</p>
      ) : null}
    </div>
  );
}
