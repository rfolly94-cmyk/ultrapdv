"use client";

import { useEffect, useRef, useState } from "react";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
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
    return () => {
      ativo = false;
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
        setAviso("Ponto de homologação instalado com sucesso");
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
        A instalação usa homologação. O ponto e a senha técnica são pedidos pela biblioteca e não ficam gravados nesta página. Produção continua fechada.
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
      {etapa?.fase === "captura" && etapa.opcoes.length === 0 ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const valor = String(new FormData(event.currentTarget).get("captura") ?? "");
            void continuar("responder", valor);
          }}
        >
          <p className="text-sm font-semibold text-zinc-950">{etapa.prompt || etapa.erro}</p>
          <input name="captura" type={etapa.oculto ? "password" : "text"} autoComplete="off" className="h-10 w-full rounded border border-zinc-300 px-3" />
          <button type="submit" className="rounded bg-zinc-900 px-3 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </form>
      ) : null}
      {aviso ? <p className="text-sm text-zinc-700">{aviso}</p> : null}
      {!aviso && !erro && etapa && etapa.fase !== "captura" ? <p className="text-sm text-zinc-700">{etapa.erro}</p> : null}
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
    </div>
  );
}
