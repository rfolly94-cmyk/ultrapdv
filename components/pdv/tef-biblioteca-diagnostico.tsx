"use client";

import { useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";

type Agente = {
  nome?: string;
  caminho?: string;
  versao?: string;
  versaoEsperada?: string;
  compativel?: boolean;
  situacao?: string;
};

type Biblioteca = {
  pontoSolicitado?: string;
  servidorSolicitado?: string;
  ambienteSolicitado?: string;
  bibliotecaInstalada?: boolean | null;
  setEnvironmentExecutado?: boolean;
  cobrancaPermitida?: boolean;
  origemComprovacao?: string;
  motivo?: string;
};

type Vinculo = {
  vinculado?: boolean;
  pontoCaptura?: string;
  terminalCodigo?: string;
};

export function TefBibliotecaDiagnostico(props: {
  pontoCadastro: string;
  ambienteCadastro: string;
  servidorCadastro: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [agente, setAgente] = useState<Agente | null>(null);
  const [biblioteca, setBiblioteca] = useState<Biblioteca | null>(null);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [consultou, setConsultou] = useState(false);

  async function consultar() {
    setOcupado(true);
    setErro("");
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        throw new Error("UltraPDV Connector não encontrado neste computador.");
      }
      const resposta = await fetch(`${descoberta.origem}/tef/status`, { cache: "no-store" });
      const corpo = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        tef?: { agente?: Agente; biblioteca?: Biblioteca };
        vinculo?: Vinculo;
      };
      if (!resposta.ok || corpo.ok === false) {
        throw new Error(corpo.erro || "O Connector não respondeu o diagnóstico da biblioteca.");
      }
      setAgente(corpo.tef?.agente ?? null);
      setBiblioteca(corpo.tef?.biblioteca ?? null);
      setVinculo(corpo.vinculo ?? null);
      setConsultou(true);
    } catch (error) {
      setAgente(null);
      setBiblioteca(null);
      setVinculo(null);
      setConsultou(true);
      setErro(error instanceof Error ? error.message : "Não foi possível consultar a biblioteca.");
    } finally {
      setOcupado(false);
    }
  }

  const agenteCompativel = agente?.compativel === true;
  const permite = agenteCompativel && biblioteca?.cobrancaPermitida === true;
  const motivo = !agenteCompativel
    ? agente?.nome
      ? `O Connector não carregou ${agente.nome}. A cobrança está bloqueada.`
      : "O Connector não informou o agente TEF desta versão. A cobrança está bloqueada."
    : biblioteca?.motivo ||
      "O Connector instalado não informa o ponto e o servidor efetivos da PGWebLib. A cobrança está bloqueada.";

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">Biblioteca PayGoWeb</h2>
        <p className="mt-1 text-sm text-zinc-600">
          O cadastro não autoriza a cobrança. A cobrança só é liberada quando a PGWebLib
          comprova o ponto e o servidor de produção.
        </p>
      </div>
      <dl className="grid gap-2 text-sm text-zinc-800 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-zinc-500">Ponto no cadastro</dt>
          <dd>{props.pontoCadastro || "não informado"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Ambiente no cadastro</dt>
          <dd>{props.ambienteCadastro === "producao" ? "Produção" : "Homologação"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-zinc-500">Servidor de produção no cadastro</dt>
          <dd>{props.servidorCadastro || "não informado"}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={consultar}
        disabled={ocupado}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-900"
      >
        {ocupado ? "Consultando..." : "Consultar ponto efetivo"}
      </button>
      {erro ? <PageAlert type="erro">{erro}</PageAlert> : null}
      {consultou && !erro ? (
        <div className="space-y-2 text-sm text-zinc-800">
          <p>Agente esperado: {agente?.nome || "não informado"}.</p>
          <p>Versão carregada: {agente?.versao || "não informada"}.</p>
          <p>Caminho: {agente?.caminho || "não selecionado"}.</p>
          <p>
            Vínculo do Connector: ponto {vinculo?.pontoCaptura || "não informado"}
            {vinculo?.terminalCodigo ? `, terminal ${vinculo.terminalCodigo}` : ""}.
          </p>
          {biblioteca ? (
            <>
              <p>Ponto que a biblioteca recebeu: {biblioteca.pontoSolicitado || "não informado"}.</p>
              <p>Servidor que a biblioteca recebeu: {biblioteca.servidorSolicitado || "não informado"}.</p>
              <p>
                Ambiente solicitado: {biblioteca.ambienteSolicitado || "não informado"}. Biblioteca já
                instalada: {biblioteca.bibliotecaInstalada === true ? "sim" : "não"}. PW_iSetEnvironment
                nesta inicialização: {biblioteca.setEnvironmentExecutado ? "sim" : "não"}.
              </p>
            </>
          ) : (
            <p>
              O Connector instalado não informa o ponto e o servidor efetivos da PGWebLib.
            </p>
          )}
          <PageAlert type={permite ? "sucesso" : "erro"}>{motivo}</PageAlert>
        </div>
      ) : null}
    </section>
  );
}
