"use client";

import { useRef, useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  combinarDiagnosticoHomologacao,
  type MemoriaComunicacaoPinpad,
} from "@/lib/pdv/tef/diagnostico-homologacao";
import type { AmbientePayGo } from "@/lib/pdv/tef/configuracao-paygo";
import { portaPinpad, type DiagnosticoPinpad } from "@/lib/pdv/tef/pinpad-diagnostico";

type Acesso = {
  ok: true;
  empresaId: string;
  terminalCodigo: string;
  estabelecimento: string;
  desafio: string;
};

type Exibicao = {
  mensagem: string;
  identificacao: string;
  observacao: string;
  resultado: DiagnosticoPinpad | null;
  erro: boolean;
  pontoInstalado: boolean | null;
  dllInicializada: boolean | null;
  pinpadConectado: boolean | null;
};

function rotuloComunicacao(valor: string | undefined) {
  if (valor === "confirmada") return "comunicação confirmada";
  if (valor === "nao_executada") return "não testada nesta consulta";
  return valor || "não informada";
}

async function autorizar(caminho: string, init?: RequestInit) {
  const resposta = await fetch(caminho, init);
  const corpo = (await resposta.json()) as Acesso & { erro?: string };
  if (!resposta.ok || !corpo.ok) {
    throw new Error(corpo.erro || "Diagnóstico do pinpad recusado.");
  }
  return corpo;
}

export function TefPinpadDiagnostico(props: {
  ambiente?: AmbientePayGo;
  somenteQuandoDisponivel?: boolean;
  onResultado?: (resultado: DiagnosticoPinpad | null) => void;
} = {}) {
  const [ocupado, setOcupado] = useState(false);
  const [exibicao, setExibicao] = useState<Exibicao | null>(null);
  const comunicacaoConfirmada = useRef<MemoriaComunicacaoPinpad | null>(null);

  async function executar(testar: boolean) {
    setOcupado(true);
    if (props.ambiente !== "homologacao") {
      setExibicao(null);
    }
    try {
      if (props.ambiente === "homologacao" || props.ambiente === "producao") {
        const producao = props.ambiente === "producao";
        const descoberta = await descobrirUltraPdvConector();
        if (!descoberta.ok) {
          throw new Error("UltraPDV Connector não encontrado neste computador.");
        }
        let dispositivoId = descoberta.saude.dispositivoId ?? "";
        if (!dispositivoId) {
          const identidade = await fetch(`${descoberta.origem}/tef/identidade`, { cache: "no-store" });
          const corpo = (await identidade.json()) as { dispositivoId?: string };
          dispositivoId = corpo.dispositivoId ?? "";
        }
        if (!dispositivoId) {
          throw new Error("Não foi possível identificar este computador.");
        }
        await autorizar(producao ? "/api/pdv/tef/pinpad/comunicacao" : "/api/pdv/tef/pinpad/homologacao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dispositivoId }),
        });
        const resposta = await fetch(
          producao ? `${descoberta.origem}/tef/pinpad/comunicacao` : `${descoberta.origem}/tef/homologacao/pinpad`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              producao ? { acao: testar ? "testar" : "identificar", ambiente: "producao" } : { acao: testar ? "testar" : "identificar" }
            ),
          }
        );
        if (resposta.status === 404) {
          throw new Error(
            producao
              ? "O Connector instalado ainda não testa a comunicação de produção. Atualize para 1.3.34. Nenhum teste foi enviado."
              : "O Connector instalado ainda não tem o diagnóstico de homologação. Atualize o UltraPDV Connector. Nenhuma rota de produção foi chamada."
          );
        }
        const corpo = (await resposta.json()) as {
          ok?: boolean;
          codigo?: string;
          mensagem?: string;
          erro?: string;
          porta?: number | null;
          portaNome?: string;
          comunicacao?: string;
          codigoBiblioteca?: number | null;
          fase?: string;
          identificacao?: string;
          pontoInstalado?: boolean;
          dllInicializada?: boolean;
          pinpadConectado?: boolean;
        };
        const codigoNumerico =
          typeof corpo.codigoBiblioteca === "number" &&
          !String(corpo.mensagem ?? "").includes(String(corpo.codigoBiblioteca))
            ? ` Código ${corpo.codigoBiblioteca}.`
            : "";
        const combinado = combinarDiagnosticoHomologacao({
          acao: testar ? "testar" : "identificar",
          anterior: comunicacaoConfirmada.current,
          retorno: {
            ...corpo,
            mensagem: corpo.mensagem
              ? `${corpo.mensagem}${codigoNumerico}`
              : corpo.mensagem,
          },
        });
        comunicacaoConfirmada.current = combinado.memoria;
        const resultado =
          combinado.exibicao.comunicacao === "confirmada" || combinado.exibicao.comunicacao === "nao_executada"
            ? {
                comunicacao: combinado.exibicao.comunicacao,
                portaUtilizada: combinado.exibicao.portaUtilizada,
              }
            : null;
        setExibicao({
          mensagem: combinado.exibicao.mensagem,
          identificacao: corpo.identificacao || combinado.exibicao.identificacao,
          observacao:
            corpo.fase === "inicializacao"
              ? "A falha ocorreu na inicialização da biblioteca."
              : corpo.fase === "descoberta"
                ? "A falha ocorreu na descoberta do PinPad. A porta configurada não foi trocada."
                : corpo.fase === "comunicacao"
                  ? "A falha ocorreu na comunicação com o PinPad."
                  : corpo.fase === "biblioteca"
                    ? "A biblioteca não está inicializada. Isso é diferente de PinPad desconectado."
                    : corpo.fase === "transacao"
                      ? "Há transação ativa. O diagnóstico não interferiu na sessão."
                      : "",
          resultado,
          erro: combinado.exibicao.erro,
          pontoInstalado: corpo.pontoInstalado === true,
          dllInicializada: corpo.dllInicializada === true,
          pinpadConectado: corpo.pinpadConectado === true,
        });
        props.onResultado?.(resultado);
        return;
      }
      setExibicao({
        mensagem: "Escolha Homologação ou Produção em Configurações, Financeiro, TEF. Nenhum teste foi enviado.",
        identificacao: "",
        observacao: "",
        resultado: null,
        erro: true,
        pontoInstalado: null,
        dllInicializada: null,
        pinpadConectado: null,
      });
      props.onResultado?.(null);
    } catch (error) {
      const preservada = props.ambiente === "homologacao" || props.ambiente === "producao" ? comunicacaoConfirmada.current : null;
      setExibicao({
        mensagem: error instanceof Error ? error.message : "Não foi possível concluir o diagnóstico.",
        identificacao: "",
        observacao: "",
        resultado: preservada
          ? { comunicacao: "confirmada", portaUtilizada: preservada.portaUtilizada }
          : null,
        erro: true,
        pontoInstalado: null,
        dllInicializada: null,
        pinpadConectado: preservada ? true : null,
      });
      if (preservada) {
        props.onResultado?.({
          comunicacao: "confirmada",
          portaUtilizada: preservada.portaUtilizada,
        });
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mt-8 space-y-4 rounded-xl border border-zinc-200 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">Diagnóstico do Pinpad</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Consulta os dados disponíveis e testa a comunicação com o equipamento. A porta
          exibida é a que a PGWebLib devolveu. Não inicia pagamento, instalação nem manutenção.
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
          {exibicao.pontoInstalado !== null || exibicao.dllInicializada !== null || exibicao.pinpadConectado !== null ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {exibicao.pontoInstalado === null ? null : (
                <Item rotulo="Ponto instalado" valor={exibicao.pontoInstalado ? "sim" : "não"} />
              )}
              {exibicao.dllInicializada === null ? null : (
                <Item rotulo="DLL inicializada" valor={exibicao.dllInicializada ? "sim" : "não"} />
              )}
              {exibicao.pinpadConectado === null ? null : (
                <Item rotulo="PinPad conectado" valor={exibicao.pinpadConectado ? "sim" : "não"} />
              )}
            </dl>
          ) : null}
          {exibicao.resultado ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {exibicao.identificacao ? (
                <Item rotulo="Identificação" valor={exibicao.identificacao} />
              ) : null}
              {campo(
                props.ambiente === "homologacao" ? "Comunicação" : "Estado",
                props.ambiente === "homologacao"
                  ? rotuloComunicacao(exibicao.resultado.comunicacao)
                  : exibicao.resultado.comunicacao,
                props.somenteQuandoDisponivel
              )}
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
              {typeof exibicao.resultado.codigoBiblioteca === "number" ? (
                <Item
                  rotulo="Código da biblioteca"
                  valor={String(exibicao.resultado.codigoBiblioteca)}
                />
              ) : null}
              {exibicao.resultado.avisoBiblioteca ? (
                <Item rotulo="Aviso da biblioteca" valor={exibicao.resultado.avisoBiblioteca} />
              ) : null}
              {typeof exibicao.resultado.duracaoMs === "number" ? (
                <Item rotulo="Duração" valor={`${exibicao.resultado.duracaoMs} ms`} />
              ) : null}
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
