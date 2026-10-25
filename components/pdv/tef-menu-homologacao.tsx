"use client";

import { useEffect, useRef, useState } from "react";

import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { formatarCentavosBr } from "@/lib/pdv/pagamentos-teto";
import { FRASE_TESTE_FINANCEIRO_HOMOLOGACAO } from "@/lib/pdv/tef/menu-homologacao-contrato";
import {
  CLASSE_BACKDROP,
  CLASSE_JANELA,
  CLASSE_OPCAO_SELECIONADA,
  CLASSE_ROLAGEM,
  criarTravaEnvio,
  decidirFechamentoTeste,
  proximoFocoCircular,
  sessaoTesteAtiva,
  textoErroMenuHomologacao,
  tratarTeclaModal,
} from "@/lib/pdv/tef/menu-homologacao-interface";

type OpcaoMenu = { texto: string; valor: string };

type RespostaMenu = {
  ok?: boolean;
  fase?: string;
  codigo?: string;
  mensagem?: string;
  motivo?: string;
  erro?: string;
  pagamentoRecebido?: boolean;
  podeFinalizar?: boolean;
  menu?: {
    capturaId: number;
    wIdentificador: number;
    prompt: string;
    opcoes: OpcaoMenu[];
  } | null;
  pinpad?: { prompt: string; wIdentificador?: number } | null;
  resultado?: { mensagem?: string } | null;
  sessaoMantida?: boolean;
  simulado?: boolean;
  nativo?: boolean;
  motivoFisico?: string;
};

export function TefMenuHomologacaoModal({
  aberto,
  valorCentavos,
  fase,
  codigo,
  prompt,
  opcoes,
  indiceSelecionado,
  pinpad,
  simulado = false,
  nativo = false,
  motivoFisico = "",
  erro,
  avisoFechamento,
  enviando,
  onFechar,
  onIniciar,
  onExecutar,
  onConfirmar,
  onDesfazer,
  onEscolher,
}: {
  aberto: boolean;
  valorCentavos: number;
  fase: string;
  codigo: string;
  prompt: string;
  opcoes: OpcaoMenu[];
  indiceSelecionado: number;
  pinpad: string;
  simulado?: boolean;
  nativo?: boolean;
  motivoFisico?: string;
  erro: string;
  avisoFechamento: string;
  enviando: boolean;
  onFechar: () => void;
  onIniciar: () => void;
  onExecutar: () => void;
  onConfirmar: () => void;
  onDesfazer: () => void;
  onEscolher: (valor: string) => void;
}) {
  if (!aberto) return null;
  return (
    <div className={CLASSE_BACKDROP} data-backdrop="tef-homologacao">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tef-homologacao-titulo"
        data-tef-modal="homologacao"
        className={CLASSE_JANELA}
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div>
            <h2 id="tef-homologacao-titulo" className="text-lg font-bold text-zinc-950">
              TEF — Homologação
            </h2>
            <p className="mt-1 text-sm text-zinc-600">Teste financeiro de homologação. Pagamento não recebido. Esta janela não finaliza a venda nem emite NFC-e.</p>
            {simulado && (
              <p className="mt-1 text-sm text-amber-900">Menu simulado no Connector. Nenhum comando foi enviado à DLL.</p>
            )}
            {nativo && (
              <p className="mt-1 text-sm text-zinc-800">Sessão nativa de homologação. O retorno da biblioteca não recebe o pagamento nem finaliza a venda.</p>
            )}
            {motivoFisico && <p className="mt-1 text-sm text-amber-900">{motivoFisico}</p>}
            <p className="mt-2 text-sm font-semibold text-zinc-900">Valor da operação: {formatarCentavosBr(valorCentavos)}</p>
          </div>
          <button type="button" className="rounded border border-zinc-300 px-3 py-2 text-sm" onClick={onFechar}>
            Fechar
          </button>
        </header>
        <div className={CLASSE_ROLAGEM}>
          {fase !== "menu" && fase !== "pinpad" && fase !== "preparada" && fase !== "resultado" && (
            <button type="button" className="rounded bg-sky-700 px-4 py-3 font-semibold text-white disabled:opacity-50" data-foco-inicial="true" disabled={enviando} onClick={onIniciar}>
              Iniciar teste financeiro de homologação
            </button>
          )}
          {fase === "preparada" && nativo && !simulado && (
            <button type="button" className="rounded bg-sky-700 px-4 py-3 font-semibold text-white disabled:opacity-50" data-foco-inicial="true" disabled={enviando} onClick={onExecutar}>
              Iniciar transação de homologação
            </button>
          )}
          {fase === "resultado" && codigo === "aprovada" && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded bg-sky-700 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={enviando} onClick={onConfirmar}>
                Confirmar transação de homologação
              </button>
              <button type="button" className="rounded border border-zinc-300 px-4 py-3 font-semibold text-zinc-900 disabled:opacity-50" disabled={enviando} onClick={onDesfazer}>
                Desfazer transação de homologação
              </button>
            </div>
          )}
          {fase === "menu" && (
            <div role="listbox" aria-label={prompt || "Opções da biblioteca"} className="space-y-2">
              <p className="font-medium text-zinc-900">{prompt}</p>
              {opcoes.map((opcao, indice) => {
                const selecionada = indice === indiceSelecionado;
                return (
                  <button
                    key={`${opcao.valor}-${indice}`}
                    type="button"
                    role="option"
                    aria-selected={selecionada}
                    data-valor={opcao.valor}
                    data-indice={indice}
                    data-foco-inicial={indice === 0 ? "true" : undefined}
                    disabled={enviando}
                    className={
                      selecionada
                        ? CLASSE_OPCAO_SELECIONADA
                        : "w-full rounded-lg border border-zinc-300 px-4 py-3 text-left font-semibold text-zinc-900"
                    }
                    onClick={() => onEscolher(opcao.valor)}
                  >
                    {opcao.texto}
                  </button>
                );
              })}
            </div>
          )}
          {fase === "pinpad" && <p className="rounded border border-sky-200 bg-sky-50 p-3 text-zinc-950">PinPad: {pinpad}</p>}
          {erro && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {erro}
            </p>
          )}
          {avisoFechamento && (
            <p role="status" className="mt-3 text-sm text-amber-900">
              {avisoFechamento}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TefMenuHomologacao({ valorCentavos = 0 }: { valorCentavos?: number }) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<RespostaMenu | null>(null);
  const [erro, setErro] = useState("");
  const [avisoFechamento, setAvisoFechamento] = useState("");
  const [indice, setIndice] = useState(0);
  const trava = useRef(criarTravaEnvio());
  const faseRef = useRef("idle");
  const opcoesRef = useRef<OpcaoMenu[]>([]);
  const indiceRef = useRef(0);
  const capturaRef = useRef(0);
  const dispositivoRef = useRef("");
  const origemRef = useRef("");
  const operacaoRef = useRef("");

  const fase = resposta?.fase ?? "idle";
  const opcoes = resposta?.menu?.opcoes ?? [];
  faseRef.current = fase;
  opcoesRef.current = opcoes;
  indiceRef.current = indice;
  capturaRef.current = resposta?.menu?.capturaId ?? 0;

  async function enviar(corpo: Record<string, unknown>) {
    if (!trava.current.tentar()) return;
    setEnviando(true);
    setErro("");
    try {
      if (!origemRef.current || !dispositivoRef.current) {
        const descoberta = await descobrirUltraPdvConector();
        if (!descoberta.ok) {
          throw new Error("UltraPDV Connector não encontrado neste computador.");
        }
        origemRef.current = descoberta.origem;
        dispositivoRef.current = descoberta.saude.dispositivoId ?? dispositivoRef.current;
      }
      const http = await fetch("/api/pdv/tef/homologacao/menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...corpo,
          origem: origemRef.current,
          dispositivoId: dispositivoRef.current,
          frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
          ...((corpo.acao === "iniciar" || corpo.acao === "executar")
            ? {
                valorCentavos,
                idempotencyKey: operacaoRef.current || (operacaoRef.current = crypto.randomUUID()),
              }
            : {}),
        }),
      });
      const json = (await http.json()) as RespostaMenu;
      setResposta(json);
      setIndice(0);
      if (json.ok !== true) setErro(textoErroMenuHomologacao(json));
    } catch {
      setErro("O PDV não alcançou o teste financeiro de homologação.");
    } finally {
      trava.current.liberar();
      setEnviando(false);
    }
  }

  function pedirFechamento() {
    const decisao = decidirFechamentoTeste(fase);
    if (!decisao.permitir) {
      setAvisoFechamento(decisao.mensagem);
      void enviar({ acao: "cancelar" });
      return;
    }
    operacaoRef.current = "";
    setAberto(false);
    setAvisoFechamento("");
  }

  function escolher(valor: string) {
    const menu = resposta?.menu;
    if (!menu || !valor) return;
    void enviar({ acao: "responder", capturaId: menu.capturaId, valor });
  }

  useEffect(() => {
    if (!aberto) return;
    const raiz = document.querySelector<HTMLElement>("[data-tef-modal='homologacao']");
    raiz?.querySelector<HTMLElement>("[data-foco-inicial='true']")?.focus();
    function noTeclado(evento: KeyboardEvent) {
      if (evento.key === "Tab") {
        const itens = [...(raiz?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        if (itens.length === 0) return;
        const atual = itens.indexOf(document.activeElement as HTMLElement);
        evento.preventDefault();
        itens[proximoFocoCircular(atual < 0 ? 0 : atual, itens.length, evento.shiftKey)]?.focus();
        return;
      }
      const tecla = tratarTeclaModal({
        tecla: evento.key,
        indice: indiceRef.current,
        total: opcoesRef.current.length,
        sessaoAtiva: sessaoTesteAtiva(faseRef.current),
      });
      if (tecla.acao === "ignorar") return;
      evento.preventDefault();
      if (tecla.acao === "fechar" || tecla.acao === "impedir") {
        const decisao = decidirFechamentoTeste(faseRef.current);
        if (!decisao.permitir) {
          setAvisoFechamento(decisao.mensagem);
          return;
        }
        operacaoRef.current = "";
        setAberto(false);
        setAvisoFechamento("");
        return;
      }
      if (tecla.acao === "mover") {
        indiceRef.current = tecla.indice;
        setIndice(tecla.indice);
        raiz?.querySelector<HTMLElement>(`[data-indice="${tecla.indice}"]`)?.focus();
        return;
      }
      const valor = opcoesRef.current[tecla.indice]?.valor ?? "";
      if (!valor) return;
      void enviar({ acao: "responder", capturaId: capturaRef.current, valor });
    }
    document.addEventListener("keydown", noTeclado);
    return () => document.removeEventListener("keydown", noTeclado);
  }, [aberto, fase, resposta?.menu?.capturaId]);

  return (
    <>
      <button type="button" className="mt-3 rounded border border-sky-700 px-3 py-2" onClick={() => setAberto(true)}>
        Abrir teste financeiro de homologação
      </button>
      <TefMenuHomologacaoModal
        aberto={aberto}
        valorCentavos={valorCentavos}
        fase={fase}
        codigo={resposta?.codigo ?? ""}
        prompt={resposta?.menu?.prompt ?? ""}
        opcoes={opcoes}
        indiceSelecionado={indice}
        pinpad={resposta?.pinpad?.prompt ?? ""}
        simulado={resposta?.simulado === true}
        nativo={resposta?.nativo === true}
        motivoFisico={typeof resposta?.motivoFisico === "string" ? resposta.motivoFisico : ""}
        erro={erro}
        avisoFechamento={avisoFechamento}
        enviando={enviando}
        onFechar={pedirFechamento}
        onIniciar={() => void enviar({ acao: "iniciar" })}
        onExecutar={() => void enviar({ acao: "executar" })}
        onConfirmar={() => void enviar({ acao: "confirmar" })}
        onDesfazer={() => void enviar({ acao: "desfazer" })}
        onEscolher={escolher}
      />
    </>
  );
}
