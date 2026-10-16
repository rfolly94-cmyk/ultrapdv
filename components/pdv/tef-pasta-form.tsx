"use client";

import { useCallback, useEffect, useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";

type Acesso = {
  ok: true;
  empresaId: string;
  terminalCodigo: string;
  estabelecimento: string;
  desafio: string;
  pendenciaFinanceira: boolean;
  mensagemPendencia: string;
};

type DiagnosticoInit = {
  texto: string;
  detalhe: string;
} | null;

type EstadoPasta = {
  atual: { pai: string; efetivo: string; padrao?: boolean };
  recomendada: { pai: string; efetivo: string };
  preparada: { pai: string; efetivo: string } | null;
  falha: { mensagem: string; retornoPwInit: DiagnosticoInit; diretorioPwInit: string } | null;
  agente: {
    diretorioTrabalho: string;
    diretorioPwInit: string;
    retornoPwInit: DiagnosticoInit;
  };
  bloqueio: { bloqueado: boolean; mensagem: string };
};

type Candidata = {
  selecaoId: string;
  pai: string;
  efetivo: string;
};

function mesmaPasta(esquerda: string, direita: string) {
  const normal = (valor: string) => valor.replace(/[\\/]+$/u, "").toLowerCase();
  return Boolean(esquerda) && normal(esquerda) === normal(direita);
}

async function autorizar(dispositivoId: string) {
  const resposta = await fetch("/api/pdv/tef/pasta/acesso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dispositivoId }),
  });
  const corpo = (await resposta.json()) as Acesso & { erro?: string };
  if (!resposta.ok || !corpo.ok) {
    throw new Error(corpo.erro || "Este computador não está autorizado para o TEF.");
  }
  return corpo;
}

export function TefPastaForm() {
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  const [estado, setEstado] = useState<EstadoPasta | null>(null);
  const [candidata, setCandidata] = useState<Candidata | null>(null);
  const [pendenciaServidor, setPendenciaServidor] = useState("");

  const consultar = useCallback(async () => {
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) {
      throw new Error("UltraPDV Connector não encontrado neste computador.");
    }
    let dispositivoId = descoberta.saude.dispositivoId ?? "";
    if (!dispositivoId) {
      const identidade = await fetch(`${descoberta.origem}/tef/identidade`, {
        cache: "no-store",
      });
      const corpo = (await identidade.json()) as { dispositivoId?: string };
      dispositivoId = corpo.dispositivoId ?? "";
    }
    if (!dispositivoId) {
      throw new Error("Não foi possível identificar este computador.");
    }
    const acesso = await autorizar(dispositivoId);
    setPendenciaServidor(acesso.pendenciaFinanceira ? acesso.mensagemPendencia : "");
    const resposta = await fetch(`${descoberta.origem}/tef/pasta`, {
      cache: "no-store",
      headers: {
        "x-ultrapdv-empresa": acesso.empresaId,
        "x-ultrapdv-terminal": acesso.terminalCodigo,
        "x-ultrapdv-estabelecimento": acesso.estabelecimento,
        "x-ultrapdv-desafio": acesso.desafio,
        "x-ultrapdv-dispositivo": dispositivoId,
      },
    });
    if (resposta.status === 404) {
      throw new Error(
        "O Connector deste computador ainda não tem a escolha de pasta. Atualize o Connector antes de usar esta tela."
      );
    }
    const corpo = (await resposta.json()) as EstadoPasta & {
      ok?: boolean;
      erro?: string;
      mensagem?: string;
    };
    if (!resposta.ok || corpo.ok !== true) {
      throw new Error(corpo.erro || corpo.mensagem || "Não foi possível consultar a pasta.");
    }
    return { descoberta, acesso, dispositivoId, corpo };
  }, []);

  useEffect(() => {
    let ativo = true;
    consultar()
      .then((resultado) => {
        if (ativo) {
          setEstado(resultado.corpo);
        }
      })
      .catch((error: unknown) => {
        if (ativo) {
          setErro(true);
          setMensagem(error instanceof Error ? error.message : "Não foi possível consultar a pasta.");
        }
      });
    return () => {
      ativo = false;
    };
  }, [consultar]);

  async function executar(acao: "escolher" | "recomendada" | "salvar") {
    setOcupado(true);
    setErro(false);
    setMensagem("");
    try {
      if (pendenciaServidor && acao !== "escolher") {
        throw new Error(pendenciaServidor);
      }
      const atual = await consultar();
      if (atual.acesso.pendenciaFinanceira && acao !== "escolher") {
        throw new Error(atual.acesso.mensagemPendencia);
      }
      if (atual.corpo.bloqueio.bloqueado) {
        throw new Error(atual.corpo.bloqueio.mensagem);
      }
      const caminho =
        acao === "escolher"
          ? "/tef/pasta/escolher"
          : acao === "recomendada"
            ? "/tef/pasta/recomendada"
            : "/tef/pasta/salvar";
      const corpo =
        acao === "salvar"
          ? { confirmar: true, selecaoId: candidata?.selecaoId ?? "" }
          : {};
      const resposta = await fetch(`${atual.descoberta.origem}${caminho}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ultrapdv-empresa": atual.acesso.empresaId,
          "x-ultrapdv-terminal": atual.acesso.terminalCodigo,
          "x-ultrapdv-estabelecimento": atual.acesso.estabelecimento,
          "x-ultrapdv-desafio": atual.acesso.desafio,
          "x-ultrapdv-dispositivo": atual.dispositivoId,
        },
        body: JSON.stringify(corpo),
      });
      if (resposta.status === 404) {
        throw new Error(
          "O Connector deste computador ainda não tem a escolha de pasta. Atualize o Connector antes de usar esta tela."
        );
      }
      const resultado = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
        cancelado?: boolean;
        selecaoId?: string;
        pai?: string;
        efetivo?: string;
        pronto?: boolean;
      };
      if (resultado.pronto === true) {
        throw new Error("O teste da pasta não torna o TEF pronto.");
      }
      if (!resposta.ok || resultado.ok !== true) {
        throw new Error(resultado.mensagem || resultado.erro || "A pasta não foi alterada.");
      }
      if (resultado.cancelado) {
        setMensagem(resultado.mensagem || "Nenhuma pasta foi escolhida.");
        return;
      }
      if (acao === "salvar") {
        setCandidata(null);
        const deNovo = await consultar();
        setEstado(deNovo.corpo);
        setMensagem(
          resultado.mensagem ||
            "Pasta salva. O teste de gravação passou. O TEF não foi marcado como pronto."
        );
        return;
      }
      if (resultado.selecaoId && resultado.pai && resultado.efetivo) {
        setCandidata({
          selecaoId: resultado.selecaoId,
          pai: resultado.pai,
          efetivo: resultado.efetivo,
        });
      }
      setEstado(atual.corpo);
      setMensagem(resultado.mensagem || "Pasta escolhida. Nada foi salvo ainda.");
    } catch (error) {
      setErro(true);
      setMensagem(error instanceof Error ? error.message : "A pasta não foi alterada.");
    } finally {
      setOcupado(false);
    }
  }

  const efetivoAgente = estado?.agente.diretorioPwInit || estado?.agente.diretorioTrabalho || "";
  const efetivoSalvo = estado?.atual.efetivo ?? "";
  const agenteConfere = Boolean(efetivoAgente) && mesmaPasta(efetivoAgente, efetivoSalvo);
  const codigoInit = estado?.agente.retornoPwInit ?? estado?.falha?.retornoPwInit ?? null;
  const bloqueado = Boolean(estado?.bloqueio.bloqueado) || Boolean(pendenciaServidor);

  return (
    <section className="mt-8 space-y-4 rounded-xl border border-zinc-200 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">Pasta do PayGoWeb</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Escolha a pasta de trabalho neste computador. A biblioteca usa a subpasta PGWeb
          dentro da pasta escolhida. Esta tela não instala o PayGo, não cobra e não marca o
          TEF como pronto.
        </p>
      </div>
      <dl className="space-y-2 text-sm text-zinc-800">
        <div>
          <dt className="font-medium">Pasta em uso</dt>
          <dd className="break-all">{estado?.atual.pai || "Consultando..."}</dd>
        </div>
        <div>
          <dt className="font-medium">Pasta efetiva da biblioteca</dt>
          <dd className="break-all">{efetivoSalvo || "Consultando..."}</dd>
        </div>
        <div>
          <dt className="font-medium">Caminho usado por PW_iInit</dt>
          <dd className="break-all">{efetivoAgente || "A biblioteca ainda não informou o caminho."}</dd>
        </div>
        {estado?.preparada ? (
          <div>
            <dt className="font-medium">Pasta salva, ainda não ativada</dt>
            <dd className="break-all">
              {estado.preparada.pai}
              <span className="mt-1 block">Efetiva: {estado.preparada.efetivo}</span>
            </dd>
          </div>
        ) : null}
        {candidata ? (
          <div>
            <dt className="font-medium">Pasta escolhida, ainda não salva</dt>
            <dd className="break-all">
              {candidata.pai}
              <span className="mt-1 block">Efetiva: {candidata.efetivo}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {estado && efetivoAgente && !agenteConfere ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          A escolha fica guardada neste computador. O agente em execução ainda usa a pasta
          informada acima. Ela passa a valer na atualização do Connector. A pasta atual não foi
          apagada.
        </PageAlert>
      ) : null}
      {codigoInit ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          {codigoInit.texto}. {codigoInit.detalhe}
        </PageAlert>
      ) : null}
      {estado?.falha?.mensagem ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          {estado.falha.mensagem}
        </PageAlert>
      ) : null}
      {estado?.bloqueio.bloqueado ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          {estado.bloqueio.mensagem}
        </PageAlert>
      ) : null}
      {pendenciaServidor ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          {pendenciaServidor}
        </PageAlert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={ocupado || bloqueado}
          onClick={() => void executar("escolher")}
        >
          Escolher pasta
        </button>
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={ocupado || bloqueado}
          onClick={() => void executar("recomendada")}
        >
          Usar pasta recomendada
        </button>
        <button
          type="button"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={ocupado || bloqueado || !candidata}
          onClick={() => void executar("salvar")}
        >
          Salvar e validar
        </button>
      </div>
      {mensagem ? (
        <PageAlert type={erro ? "erro" : "sucesso"} className="mx-0 mt-0">
          {mensagem}
        </PageAlert>
      ) : null}
    </section>
  );
}
