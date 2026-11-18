"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TefCapturaBiblioteca } from "@/components/pdv/tef-captura-biblioteca";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  campoDigitadoAdministrativo,
  capturaDeValor,
  decidirTeclaMenuAdministrativo,
  estadoDoPontoAposOperacao,
  mensagemMenuAdministrativo,
  pedidoCancelamentoMenu,
  promptTemMascaraDeValor,
  promptValorVisivel,
  valorEnviadoPeloMenu,
} from "@/lib/pdv/tef/menu-administrativo";
import { cobrarPeloMotorCsharp, type RespostaMotorCsharp } from "@/lib/pdv/tef/motor-csharp";

export function TefMenuAdministrativo({ homologacao = false }: { homologacao?: boolean }) {
  const [origem, setOrigem] = useState<string | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [consulta, setConsulta] = useState("Consultando o ponto neste computador.");
  const [ocupado, setOcupado] = useState(false);
  const [etapa, setEtapa] = useState<RespostaMotorCsharp | null>(null);
  const [operacao, setOperacao] = useState("Menu administrativo");
  const [resultadoVisivel, setResultadoVisivel] = useState(false);
  const [vendaChave, setVendaChave] = useState("");
  const chaveRef = useRef("");
  const ocupadoRef = useRef(false);
  const menuAbertoRef = useRef(false);
  const resultadoAbertoRef = useRef(false);
  const etapaRef = useRef(etapa);
  const responderRef = useRef<(valor: string) => void>(() => {});
  etapaRef.current = etapa;
  responderRef.current = (valor) => {
    void executar("responder", valor);
  };
  const cancelarRef = useRef<() => void>(() => {});
  const sairRef = useRef<() => void>(() => {});

  const menuAberto = etapa?.fase === "captura";
  const campoDigitado = Boolean(menuAberto && etapa && etapa.opcoes.length === 0 && campoDigitadoAdministrativo(etapa.tipoDado));
  const promptBruto = etapa?.prompt ?? "";
  const campoValor = capturaDeValor(etapa?.identificador) || promptTemMascaraDeValor(promptBruto);
  const promptVisivel = campoValor ? promptValorVisivel(promptBruto) : promptBruto;
  const textoCancelamento = mensagemMenuAdministrativo(etapa);
  const textoResultado = textoCancelamento || (resultadoVisivel && etapa?.fase === "resultado" ? etapa.erro : "");
  const resultadoAberto = textoResultado.length > 0;
  ocupadoRef.current = ocupado;
  menuAbertoRef.current = menuAberto;
  resultadoAbertoRef.current = resultadoAberto;

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok || !ativo) {
        if (ativo) setConsulta("O Connector local não respondeu. O menu administrativo não foi iniciado.");
        return;
      }
      setOrigem(descoberta.origem);
      const resposta = await cobrarPeloMotorCsharp({ origem: descoberta.origem, comando: "situacao" });
      if (!ativo) return;
      const pronto = resposta.codigo === "ponto_instalado";
      setInstalado(pronto);
      setConsulta(pronto ? "Ponto instalado. O menu administrativo pode ser aberto." : "O ponto não está instalado. O menu administrativo permanece fechado.");
    })();
    return () => {
      ativo = false;
    };
  }, []);

  async function executar(comando: "administrar" | "responder", valor = "", cancelar = false) {
    if (ocupadoRef.current) return;
    setOcupado(true);
    ocupadoRef.current = true;
    try {
      let endereco = origem;
      if (!endereco) {
        const descoberta = await descobrirUltraPdvConector();
        if (!descoberta.ok) {
          setConsulta("O Connector local não está disponível. Nenhuma transação foi iniciada.");
          return;
        }
        endereco = descoberta.origem;
        setOrigem(endereco);
      }
      if (comando === "administrar") {
        chaveRef.current = `adm:${crypto.randomUUID()}`;
        setVendaChave("");
        setResultadoVisivel(false);
      }
      const resposta = await cobrarPeloMotorCsharp({
        origem: endereco,
        comando,
        chave: chaveRef.current,
        sessao: etapa?.sessao,
        valor: cancelar ? "" : valorEnviadoPeloMenu(etapa?.identificador, valor),
        ...(cancelar ? { cancelar: true } : {}),
      });
      setEtapa(resposta);
      if (resposta.fase !== "captura") {
        setResultadoVisivel(true);
        if (resposta.erro) setConsulta(resposta.erro);
      }
      if (resposta.codigo === "administrativa") {
        setConsulta(resposta.erro || "A biblioteca concluiu o menu administrativo. Nenhuma cobrança foi iniciada.");
        setResultadoVisivel(true);
      }
      const estadoPonto = estadoDoPontoAposOperacao(resposta.codigo);
      if (estadoPonto === "ausente") {
        setInstalado(false);
        setConsulta(resposta.erro || "O ponto de captura não está instalado. Uma nova instalação é necessária.");
        window.dispatchEvent(new CustomEvent("ultrapdv-tef-ponto", { detail: "ausente" }));
      } else if (estadoPonto === "instalado") {
        setInstalado(true);
        window.dispatchEvent(new CustomEvent("ultrapdv-tef-ponto", { detail: "instalado" }));
      }
      if (resposta.codigo === "interrompida") {
        setResultadoVisivel(true);
        const reconhecida = mensagemMenuAdministrativo(resposta);
        if (reconhecida) setConsulta(reconhecida);
      }
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }

  function cancelarMenu() {
    const pedido = pedidoCancelamentoMenu();
    void executar(pedido.comando, pedido.valor, pedido.cancelar);
  }

  function sair() {
    if (menuAbertoRef.current) {
      cancelarMenu();
      return;
    }
    setResultadoVisivel(false);
    setEtapa(null);
  }

  cancelarRef.current = cancelarMenu;
  sairRef.current = sair;

  useEffect(() => {
    if (!menuAberto && !resultadoAberto) return;
    function noTeclado(event: KeyboardEvent) {
      const decisao = decidirTeclaMenuAdministrativo({
        tecla: event.key,
        menuAberto: menuAbertoRef.current,
        resultadoAberto: resultadoAbertoRef.current,
        aguardando: ocupadoRef.current,
      });
      if (decisao.acao === "ignorar") {
        const atual = etapaRef.current;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        const indice = Number(event.key) - 1;
        if (atual?.captura?.teclasAtalho && indice >= 0 && indice < atual.opcoes.length) {
          event.preventDefault();
          responderRef.current(atual.opcoes[indice].valor);
          return;
        }
        if (event.key === "Enter" && atual?.captura && atual.opcoes.length > 0 && atual.captura.itemInicial < atual.opcoes.length) {
          event.preventDefault();
          responderRef.current(atual.opcoes[atual.captura.itemInicial].valor);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (decisao.acao === "cancelar-menu") {
        cancelarRef.current();
        return;
      }
      sairRef.current();
    }
    document.addEventListener("keydown", noTeclado);
    return () => document.removeEventListener("keydown", noTeclado);
  }, [menuAberto, resultadoAberto]);

  const modal = menuAberto || resultadoAberto ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tef-menu-admin-titulo"
        data-tef-modal="administrativo"
        className="flex max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 id="tef-menu-admin-titulo" className="text-base font-semibold text-zinc-950">Menu administrativo</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {menuAberto ? promptVisivel || "Selecione a opção devolvida pela biblioteca." : "Resultado da biblioteca"}
          </p>
        </div>
        <div className="space-y-2 overflow-y-auto px-5 py-4">
          {menuAberto ? etapa?.opcoes.map((opcao, indice) => (
            <button
              key={`${opcao.valor}-${opcao.texto}`}
              type="button"
              disabled={ocupado}
              className={`block w-full rounded-lg border px-4 py-3 text-left text-sm disabled:opacity-40 ${etapa.captura && etapa.captura.itemInicial < etapa.opcoes.length && indice === etapa.captura.itemInicial ? "border-zinc-900" : "border-zinc-300"}`}
              onClick={() => {
                setOperacao(opcao.texto || "Menu administrativo");
                void executar("responder", opcao.valor);
              }}
            >
              {etapa.captura?.teclasAtalho ? `${indice + 1}. ` : ""}{opcao.texto || opcao.valor}
            </button>
          )) : null}
          {campoDigitado ? (
            <TefCapturaBiblioteca
              operacao={operacao}
              tipoDado={etapa?.tipoDado ?? null}
              identificador={etapa?.identificador ?? null}
              prompt={etapa?.captura?.promptBiblioteca || promptVisivel}
              oculto={etapa?.oculto === true}
              captura={etapa?.captura ?? null}
              ocupado={ocupado}
              homologacao={homologacao}
              vendaChave={vendaChave}
              onVenda={setVendaChave}
              onEnviar={(valor) => void executar("responder", valor)}
            />
          ) : null}
          {menuAberto && etapa && etapa.opcoes.length === 0 && !campoDigitado ? (
            <p className="text-sm text-zinc-700">{promptVisivel || "Aguardando o pinpad."}</p>
          ) : null}
          {resultadoAberto ? <p className="whitespace-pre-wrap text-sm font-semibold text-zinc-950">{textoResultado}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
          {menuAberto ? (
            <button
              type="button"
              disabled={ocupado}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40"
              onClick={cancelarMenu}
            >
              Cancelar menu
            </button>
          ) : null}
          <button
            type="button"
            disabled={ocupado}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={sair}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="mt-5 space-y-3 border-t border-zinc-200 pt-4">
      <p className="text-sm text-zinc-600">{consulta}</p>
      <button
        type="button"
        disabled={ocupado || !instalado}
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        onClick={() => void executar("administrar")}
      >
        Menu administrativo
      </button>
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </div>
  );
}
