"use client";

import { useRef, useState } from "react";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { chaveDaOperacao } from "@/lib/pdv/tef/encaminhamento-configuracao";
import { instalacaoAceita, type RespostaMotorCsharp } from "@/lib/pdv/tef/motor-csharp";
import { decidirConfiguracaoProducao, decidirInstalacaoProducao } from "@/lib/pdv/tef/politica-empresa";

async function chamarProducao(corpo: Record<string, unknown>) {
  const resposta = await fetch("/api/pdv/tef/motor/producao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return (await resposta.json().catch(() => null)) as RespostaMotorCsharp | null;
}

export function TefInstalacaoProducao(props: {
  administrador: boolean;
  credenciamentoComprovado: boolean;
  pontoProducaoInstalado: boolean;
  pendenciaFinanceira: boolean;
  servidorDeclarado: boolean;
  servidorValidado: boolean;
  onServidorConfirmado?: () => void;
  onInstalacaoConcluida?: () => Promise<boolean> | boolean;
}) {
  const [etapa, setEtapa] = useState<RespostaMotorCsharp | null>(null);
  const [origem, setOrigem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const chave = useRef("");
  const operacao = useRef<"instalar" | "configurar" | null>(null);
  const emCurso = useRef(false);
  const servidorConfirmado = useRef(false);
  const configuracao = decidirConfiguracaoProducao({
    administrador: props.administrador,
    credenciamentoProducao: props.credenciamentoComprovado,
    pendenciaFinanceira: props.pendenciaFinanceira,
    servidorDeclarado: props.servidorDeclarado,
  });
  const instalacao = decidirInstalacaoProducao({
    administrador: props.administrador,
    credenciamentoProducao: props.credenciamentoComprovado,
    pendenciaFinanceira: props.pendenciaFinanceira,
    servidorComercialValidado: props.servidorValidado,
  });

  async function enderecoLocal() {
    if (origem) return origem;
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) return null;
    setOrigem(descoberta.origem);
    return descoberta.origem;
  }

  async function aplicar(resposta: RespostaMotorCsharp | null) {
    setEtapa(resposta?.fase === "captura" ? resposta : null);
    if (resposta && instalacaoAceita(resposta)) {
      const comprovado = await props.onInstalacaoConcluida?.();
      if (comprovado === true) {
        setErro("");
        setAviso("Ponto de produção instalado. Os pagamentos reais continuam bloqueados.");
      } else {
        setAviso("");
        setErro("A consulta do ponto de produção não confirmou o journal desta empresa e deste terminal. Nenhum pagamento foi iniciado.");
      }
      return;
    }
    if (resposta?.codigo === "configurada" && resposta.servidorValidado) {
      servidorConfirmado.current = true;
      setErro("");
      setAviso("A biblioteca confirmou o servidor comercial declarado. A instalação ainda não foi executada e os pagamentos continuam bloqueados.");
      props.onServidorConfirmado?.();
      return;
    }
    if (resposta?.codigo === "configurada") {
      setAviso("");
      setErro(resposta.erro || "A biblioteca gravou um endereço, mas isso não comprova o servidor comercial de produção. Nenhum pagamento foi iniciado.");
      return;
    }
    if (resposta?.codigo === "SESSAO_AUSENTE") {
      if (!servidorConfirmado.current) {
        setErro("A captura desta configuração já foi encerrada. Nenhuma instalação foi iniciada.");
      }
      return;
    }
    if (resposta && resposta.fase !== "captura") setErro(resposta.erro);
  }

  async function iniciar(comando: "instalar" | "configurar") {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const endereco = await enderecoLocal();
      if (!endereco) {
        setErro("O Connector local não está disponível. Nenhuma instalação foi iniciada.");
        return;
      }
      chave.current = chaveDaOperacao(comando);
      operacao.current = comando;
      const resposta = await chamarProducao({ origem: endereco, comando, chave: chave.current });
      await aplicar(resposta);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  }

  async function responder(valor: string) {
    if (emCurso.current || etapa?.fase !== "captura" || !etapa.sessao) return;
    emCurso.current = true;
    setOcupado(true);
    setErro("");
    try {
      const endereco = await enderecoLocal();
      if (!endereco) return;
      const resposta = await chamarProducao({
        origem: endereco,
        comando: "responder",
        operacao: operacao.current,
        chave: chave.current,
        sessao: etapa?.sessao,
        valor,
      });
      await aplicar(resposta);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        A instalação de produção usa um diretório isolado e não altera o ponto de homologação. O ponto de captura e a senha técnica só são digitados quando a biblioteca pede. Na configuração, digite o servidor comercial informado à PayGo, em host:porta. Um endereço de homologação não é enviado, e um endereço apenas bem formado não comprova a produção. Nenhuma destas ações cobra um pagamento.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!instalacao.pode || ocupado}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          onClick={() => void iniciar("instalar")}
        >
          Instalar ponto de produção
        </button>
        <button
          type="button"
          disabled={!configuracao.pode || ocupado}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40"
          onClick={() => void iniciar("configurar")}
        >
          Configurar ponto de produção
        </button>
      </div>
      {!configuracao.pode ? <p className="text-sm text-zinc-600">{configuracao.mensagem}</p> : null}
      {!instalacao.pode ? <p className="text-sm text-zinc-600">{instalacao.mensagem}</p> : null}
      {etapa?.fase === "captura" && etapa.opcoes.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-zinc-950">{etapa.prompt}</p>
          {etapa.opcoes.map((opcao) => (
            <button
              key={`${opcao.valor}-${opcao.texto}`}
              type="button"
              disabled={ocupado}
              className="block rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40"
              onClick={() => void responder(opcao.valor)}
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
            void responder(valor);
          }}
        >
          <p className="text-sm font-semibold text-zinc-950">{etapa.prompt || etapa.erro}</p>
          <input
            name="captura"
            type={etapa.oculto ? "password" : "text"}
            autoComplete="off"
            placeholder={etapa.prompt.includes("host:porta") ? "host:porta" : undefined}
            className="h-10 w-full rounded border border-zinc-300 px-3"
          />
          <button type="submit" disabled={ocupado} className="rounded bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Continuar</button>
        </form>
      ) : null}
      {aviso ? <p className="text-sm text-zinc-800">{aviso}</p> : null}
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
    </div>
  );
}
