"use client";

import { useEffect, useRef, useState } from "react";
import { TefCapturaBiblioteca } from "@/components/pdv/tef-captura-biblioteca";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { imprimirComprovanteInstalacao } from "@/app/configuracoes/financeiro/tef/imprimir-comprovante-instalacao";
import { campoDigitadoAdministrativo } from "@/lib/pdv/tef/menu-administrativo";
import { cobrarPeloMotorCsharp, instalacaoAceita, pontoInstaladoNaSituacao, type RespostaMotorCsharp } from "@/lib/pdv/tef/motor-csharp";

export function TefMotorCsharpPainel() {
  const [etapa, setEtapa] = useState<RespostaMotorCsharp | null>(null);
  const [origem, setOrigem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const chaveInstalacao = useRef("");
  const [ponto, setPonto] = useState("Consultando o ponto neste computador.");
  const [conciliacao, setConciliacao] = useState("");

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok || !ativo) {
        if (ativo) setPonto("O Connector local não respondeu. A instalação não foi repetida.");
        return;
      }
      const resposta = await cobrarPeloMotorCsharp({ origem: descoberta.origem, comando: "situacao" });
      if (!ativo) return;
      setPonto(pontoInstaladoNaSituacao(resposta.codigo) ? "Ponto de homologação instalado." : "Ponto não instalado.");
      setConciliacao(resposta.erro.includes("sem venda no PDV") ? resposta.erro : "");
    })();
    function aoMudarPonto(event: Event) {
      const detalhe = (event as CustomEvent<string>).detail;
      if (detalhe === "ausente") setPonto("Ponto não instalado. Uma nova instalação é necessária.");
      if (detalhe === "instalado") setPonto("Ponto de homologação instalado.");
    }
    window.addEventListener("ultrapdv-tef-ponto", aoMudarPonto);
    return () => {
      ativo = false;
      window.removeEventListener("ultrapdv-tef-ponto", aoMudarPonto);
    };
  }, []);

  async function continuar(comando: "instalar" | "recuperar" | "responder", valor = "") {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      let endereco = origem;
      if (!endereco) {
        const descoberta = await descobrirUltraPdvConector();
        if (!descoberta.ok) {
          setErro("O Connector local não está disponível. Nenhuma instalação foi iniciada.");
          return;
        }
        endereco = descoberta.origem;
        setOrigem(endereco);
      }
      if (comando === "instalar") {
        chaveInstalacao.current = crypto.randomUUID();
      }
      const resposta = await cobrarPeloMotorCsharp({
        origem: endereco,
        comando,
        chave: chaveInstalacao.current || crypto.randomUUID(),
        sessao: etapa?.sessao,
        valor,
      });
      setEtapa(resposta);
      if (instalacaoAceita(resposta)) {
        setPonto("Ponto de homologação instalado.");
        window.dispatchEvent(new CustomEvent("ultrapdv-tef-ponto", { detail: "instalado" }));
        if (resposta.comprovanteInstalacao) {
          const impresso = await imprimirComprovanteInstalacao(resposta.comprovanteInstalacao);
          setAviso(impresso.ok
            ? "Ponto de homologação instalado. O comprovante da instalação foi enviado para a impressora."
            : `Ponto de homologação instalado. ${impresso.erro}`);
        } else {
          setAviso(resposta.erro.includes("já está instalado") ? resposta.erro : "Ponto de homologação instalado com sucesso");
        }
        return;
      }
      if (
        resposta.fase !== "captura" &&
        !resposta.ok &&
        resposta.codigo !== "sem_pendencia" &&
        resposta.codigo !== "pendencia_preservada"
      ) {
        setErro(resposta.erro);
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-zinc-200 pt-4">
      <p className="text-sm text-zinc-600">
        A instalação usa homologação e pode ser repetida quando o ponto não está instalado. O ponto e o servidor já cadastrados entram se forem válidos. A senha técnica só é enviada se a biblioteca pedir. Produção continua fechada.
      </p>
      <p className="text-sm font-semibold text-zinc-950">{ponto}</p>
      {conciliacao ? <p className="text-sm text-zinc-700">{conciliacao}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupado}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          onClick={() => void continuar("instalar")}
        >
          Instalar ponto de homologação
        </button>
        <button
          type="button"
          disabled={ocupado}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40"
          onClick={() => void continuar("recuperar")}
        >
          Ver pendências
        </button>
      </div>
      {etapa?.fase === "captura" && etapa.opcoes.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-zinc-950">{etapa.prompt}</p>
          {etapa.opcoes.map((opcao) => (
            <button
              key={`${opcao.valor}-${opcao.texto}`}
              type="button"
              className="block rounded border border-zinc-300 px-3 py-2 text-sm"
              onClick={() => void continuar("responder", opcao.valor)}
            >
              {opcao.texto || opcao.valor}
            </button>
          ))}
        </div>
      ) : null}
      {etapa?.fase === "captura" && etapa.opcoes.length === 0 && campoDigitadoAdministrativo(etapa.tipoDado) ? (
        <TefCapturaBiblioteca
          operacao="Instalação do ponto"
          tipoDado={etapa.tipoDado}
          identificador={etapa.identificador}
          prompt={etapa.captura?.promptBiblioteca || etapa.prompt || etapa.erro}
          oculto={etapa.oculto}
          captura={etapa.captura}
          ocupado={ocupado}
          homologacao
          onEnviar={(valor) => void continuar("responder", valor)}
        />
      ) : null}
      {etapa?.fase === "captura" && etapa.opcoes.length === 0 && !campoDigitadoAdministrativo(etapa.tipoDado) ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-zinc-950">{etapa.prompt || etapa.erro || "Aguardando o pinpad."}</p>
          <button type="button" className="rounded bg-zinc-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => void continuar("responder", "")}>
            Continuar
          </button>
        </div>
      ) : null}
      {etapa?.comprovanteInstalacao ? (
        <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-800">{etapa.comprovanteInstalacao}</pre>
      ) : null}
      {aviso ? <p className="text-sm text-zinc-700">{aviso}</p> : null}
      {!aviso && !erro && etapa && etapa.fase !== "captura" ? <p className="text-sm text-zinc-700">{etapa.erro}</p> : null}
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
    </div>
  );
}
