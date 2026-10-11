"use client";

import { useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  mensagemDiagnosticoPinpad,
  observacaoModeloPinpad,
  portaPinpad,
  type DiagnosticoPinpad,
} from "@/lib/pdv/tef/pinpad-diagnostico";

type Acesso = {
  ok: true;
  empresaId: string;
  terminalCodigo: string;
  estabelecimento: string;
  desafio: string;
};

type Exibicao = {
  mensagem: string;
  observacao: string;
  resultado: DiagnosticoPinpad | null;
  erro: boolean;
};

async function autorizar(caminho: string, init?: RequestInit) {
  const resposta = await fetch(caminho, init);
  const corpo = (await resposta.json()) as Acesso & { erro?: string };
  if (!resposta.ok || !corpo.ok) {
    throw new Error(corpo.erro || "Diagnóstico do pinpad recusado.");
  }
  return corpo;
}

export function TefPinpadDiagnostico(props: {
  somenteQuandoDisponivel?: boolean;
  onResultado?: (resultado: DiagnosticoPinpad | null) => void;
} = {}) {
  const [ocupado, setOcupado] = useState(false);
  const [exibicao, setExibicao] = useState<Exibicao | null>(null);

  async function executar(testar: boolean) {
    setOcupado(true);
    setExibicao(null);
    try {
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
      const acesso = testar
        ? await autorizar("/api/pdv/tef/pinpad/testar-comunicacao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dispositivoId }),
          })
        : await autorizar(
            `/api/pdv/tef/pinpad/diagnostico?dispositivoId=${encodeURIComponent(dispositivoId)}`
          );
      const resposta = await fetch(
        testar
          ? `${descoberta.origem}/tef/pinpad/testar-comunicacao`
          : `${descoberta.origem}/tef/pinpad/diagnostico`,
        {
          method: testar ? "POST" : "GET",
          headers: {
            ...(testar ? { "Content-Type": "application/json" } : {}),
            "x-ultrapdv-empresa": acesso.empresaId,
            "x-ultrapdv-terminal": acesso.terminalCodigo,
            "x-ultrapdv-estabelecimento": acesso.estabelecimento,
            "x-ultrapdv-desafio": acesso.desafio,
          },
          body: testar ? "{}" : undefined,
        }
      );
      const corpo = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        codigo?: string;
        resultado?: DiagnosticoPinpad;
      };
      const resultado = corpo.resultado ?? null;
      setExibicao({
        mensagem: mensagemDiagnosticoPinpad({
          resultado,
          codigo: corpo.codigo ?? resultado?.codigo,
          erro: corpo.erro,
        }),
        observacao: observacaoModeloPinpad(resultado),
        resultado,
        erro: corpo.ok !== true,
      });
      props.onResultado?.(resultado);
    } catch (error) {
      setExibicao({
        mensagem: error instanceof Error ? error.message : "Comunicação indisponível.",
        observacao: "",
        resultado: null,
        erro: true,
      });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mt-8 space-y-4 rounded-xl border border-zinc-200 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">Diagnóstico do Pinpad</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Consulta os dados disponíveis e testa a comunicação com o equipamento. Não inicia
          pagamento, instalação nem manutenção.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={ocupado}
          onClick={() => void executar(false)}
        >
          Identificar Pinpad
        </button>
        <button
          type="button"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={ocupado}
          onClick={() => void executar(true)}
        >
          Testar Comunicação
        </button>
      </div>
      {exibicao ? (
        <div className="space-y-3">
          <PageAlert type={exibicao.erro ? "erro" : "sucesso"} className="mx-0 mt-0">
            {exibicao.mensagem}
          </PageAlert>
          {exibicao.observacao ? (
            <PageAlert type="aviso" className="mx-0 mt-0">
              {exibicao.observacao}
            </PageAlert>
          ) : null}
          {exibicao.resultado ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {campo("Estado", exibicao.resultado.comunicacao, props.somenteQuandoDisponivel)}
              {typeof exibicao.resultado.paygoInicializado === "boolean" ? (
                <Item
                  rotulo="PayGoWeb"
                  valor={exibicao.resultado.paygoInicializado ? "inicializado" : "não inicializado"}
                />
              ) : null}
              {campo("Fabricante", exibicao.resultado.fabricante, props.somenteQuandoDisponivel)}
              {campo("Modelo", exibicao.resultado.modelo, props.somenteQuandoDisponivel)}
              {campo("Firmware", exibicao.resultado.firmware, props.somenteQuandoDisponivel)}
              {campo("Número de série", exibicao.resultado.serieMascarada, props.somenteQuandoDisponivel)}
              {campo("Porta", portaPinpad(exibicao.resultado), props.somenteQuandoDisponivel)}
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function campo(rotulo: string, valor: string | null | undefined, somenteQuandoDisponivel?: boolean) {
  const texto = String(valor ?? "").trim();
  if (!texto) {
    if (somenteQuandoDisponivel) {
      return null;
    }
    return <Item rotulo={rotulo} valor="não informado" />;
  }
  return <Item rotulo={rotulo} valor={texto} />;
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{rotulo}</dt>
      <dd className="font-medium text-zinc-900">{valor}</dd>
    </div>
  );
}
