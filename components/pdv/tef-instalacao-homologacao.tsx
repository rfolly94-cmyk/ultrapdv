"use client";

import { useEffect, useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  classificarInstalacaoHomologacao,
  CONFIRMACAO_INSTALACAO_HOMOLOGACAO,
  CONFIRMACAO_INSTALACAO_PRODUCAO,
  mascararCnpjInstalacao,
  atualizarCapturasInstalacao,
  montarConfirmacaoInstalacaoHomologacao,
  montarPedidoResponderInstalacao,
  ROTULOS_INSTALACAO_HOMOLOGACAO,
  validarEncaminhamentoCapturas,
  type CapturaInstalacaoHomologacao,
  type EstadoInstalacaoHomologacao,
} from "@/lib/pdv/tef/instalacao-homologacao";
import type { AmbientePayGo } from "@/lib/pdv/tef/configuracao-paygo";

const ORDEM: EstadoInstalacaoHomologacao[] = [
  "nao_instalado",
  "preparado",
  "em_andamento",
  "instalado_confirmado",
  "falha_recuperacao",
];

const CHAVE_DISPOSITIVO_INSTALACAO = "ultrapdv-tef-homologacao-dispositivo";

function lerDispositivoMemorizado() {
  try {
    return window.sessionStorage.getItem(CHAVE_DISPOSITIVO_INSTALACAO)?.trim() ?? "";
  } catch {
    return "";
  }
}

function gravarDispositivoMemorizado(dispositivoId: string) {
  try {
    if (dispositivoId) window.sessionStorage.setItem(CHAVE_DISPOSITIVO_INSTALACAO, dispositivoId);
  } catch {
    // a sessão da instalação continua no Connector
  }
}

function rotuloCaptura(item: { identificador?: number; prompt?: string; sensivel?: boolean }) {
  const identificador = Number(item.identificador);
  if (identificador === 0xf6) return "Senha técnica";
  if (identificador === 0xf5) return "Senha do lojista";
  if (item.sensivel) return "Dado sensível solicitado pelo PayGo.";
  return String(item.prompt ?? "") || `Dado ${identificador}`;
}

export function TefInstalacaoHomologacao(props: {
  ambiente: AmbientePayGo;
  empresaAutorizada: boolean;
  terminalAutorizado: boolean;
  configuracaoCompleta: boolean;
  comunicacaoPinpad: boolean;
  evidenciaBiblioteca: boolean;
  pendenciaFinanceira?: boolean;
  servidor?: string;
  ponto?: string;
  cnpjMascarado?: string;
  portaPinpad?: string;
  dispositivoId?: string;
}) {
  const diretorioPainel =
    props.ambiente === "producao" ? "TEF/Producao/PGWeb" : "TEF/Homologacao/PGWeb";
  const rotaInstalacao =
    props.ambiente === "producao" ? "/api/pdv/tef/instalacao/producao" : "/api/pdv/tef/instalacao/homologacao";
  const fraseInstalacao =
    props.ambiente === "producao" ? CONFIRMACAO_INSTALACAO_PRODUCAO : CONFIRMACAO_INSTALACAO_HOMOLOGACAO;
  const plano = classificarInstalacaoHomologacao({
    ambiente: props.ambiente,
    empresaAutorizada: props.empresaAutorizada,
    terminalAutorizado: props.terminalAutorizado,
    configuracaoCompleta: props.configuracaoCompleta,
    comunicacaoPinpad: props.comunicacaoPinpad,
    evidenciaBiblioteca: props.evidenciaBiblioteca,
    emAndamento: false,
    pendenciaFinanceira: props.pendenciaFinanceira === true,
    diretorio: diretorioPainel,
  });
  const [jaInstalado, setJaInstalado] = useState(props.evidenciaBiblioteca);
  const [identidadeVinculada, setIdentidadeVinculada] = useState(false);
  const instalado = jaInstalado || plano.estado === "instalado_confirmado";
  const alerta =
    plano.estado === "instalado_confirmado" || instalado
      ? "sucesso"
      : plano.estado === "falha_recuperacao"
        ? "erro"
        : "aviso";
  const [conferido, setConferido] = useState<{ dllIntegra: boolean; pinpadOcupado: boolean; mensagem: string } | null>(
    null
  );
  const [confirmado, setConfirmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [retorno, setRetorno] = useState("");
  const [capturas, setCapturas] = useState<CapturaInstalacaoHomologacao[]>([]);
  const [respostas, setRespostas] = useState<Record<number, string>>({});
  const [execucaoId, setExecucaoId] = useState("");
  const [aguardandoConfirmacao, setAguardandoConfirmacao] = useState(false);
  const [precondicoesOk, setPrecondicoesOk] = useState(false);
  useEffect(() => {
    if (props.ambiente !== "homologacao" && props.ambiente !== "producao") return;
    let ativo = true;
    async function consultar() {
      try {
        const dispositivoId = props.dispositivoId?.trim() || lerDispositivoMemorizado() || (await descobrirDispositivo());
        const descoberta = await descobrirUltraPdvConector();
        if (!ativo || !descoberta.ok || !dispositivoId) return;
        const resposta = await fetch(rotaInstalacao, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dispositivoId, acao: "consultar", origem: descoberta.origem }),
        });
        const corpo = (await resposta.json()) as {
          ativa?: boolean;
          instalado?: boolean;
          codigo?: string;
          execucaoId?: string;
          mensagem?: string;
          capturas?: CapturaInstalacaoHomologacao[];
        };
        if (!ativo) return;
        if (corpo.instalado === true || corpo.codigo === "JA_INSTALADO") setJaInstalado(true);
        if (corpo.ativa !== true) return;
        if (typeof corpo.execucaoId === "string" && corpo.execucaoId) setExecucaoId(corpo.execucaoId);
        if (!Array.isArray(corpo.capturas) || corpo.capturas.length === 0) return;
        setCapturas(
          corpo.capturas.map((item) => ({
            identificador: Number(item.identificador),
            prompt: rotuloCaptura(item),
            valorSugerido: "",
            sensivel: item.sensivel === true || Number(item.identificador) === 0xf6 || Number(item.identificador) === 0xf5,
          }))
        );
        setRetorno(corpo.mensagem || "A biblioteca pediu um dado. Digite somente o que está na tela.");
      } catch {
        if (ativo) setRetorno("A consulta da instalação em andamento não foi concluída.");
      }
    }
    void consultar();
    const timer = window.setInterval(() => void consultar(), 3000);
    return () => {
      ativo = false;
      window.clearInterval(timer);
    };
  }, [props.ambiente, props.dispositivoId, rotaInstalacao]);
  const confirmacao = montarConfirmacaoInstalacaoHomologacao({
    ambiente: props.ambiente,
    ponto: props.ponto ?? "",
    servidor: props.servidor ?? "",
    cnpjMascarado: props.cnpjMascarado || mascararCnpjInstalacao(""),
    dllIntegra: conferido?.dllIntegra === true,
    pinpadOcupado: conferido?.pinpadOcupado === true,
    portaPinpad: props.portaPinpad ?? "",
  });

  async function descobrirDispositivo() {
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) throw new Error("UltraPDV Connector não encontrado neste computador.");
    let dispositivoId = descoberta.saude.dispositivoId ?? "";
    if (!dispositivoId) {
      const identidade = await fetch(`${descoberta.origem}/tef/identidade`, { cache: "no-store" });
      const corpo = (await identidade.json()) as { dispositivoId?: string };
      dispositivoId = corpo.dispositivoId ?? "";
    }
    return dispositivoId;
  }

  async function enviar(acao: "resumo" | "executar" | "responder" | "confirmar" | "desfazer" | "precondicoes") {
    if (acao === "executar" && instalado) {
      setRetorno("Já instalado");
      return;
    }
    setOcupado(true);
    setRetorno("");
    try {
      const dispositivoConhecido = props.dispositivoId?.trim() || lerDispositivoMemorizado();
      let corpoPedido: Record<string, unknown>;
      if (acao === "responder") {
        const previa = validarEncaminhamentoCapturas({
          execucaoId,
          respostas: capturas.map((item) => ({
            identificador: item.identificador,
            valor: respostas[item.identificador] ?? item.valorSugerido,
          })),
        });
        if (!previa.ok) {
          setRetorno(previa.mensagem);
          return;
        }
        const dispositivoId = dispositivoConhecido || (await descobrirDispositivo());
        const pedido = montarPedidoResponderInstalacao({
          dispositivoId,
          execucaoId: previa.execucaoId,
          capturas,
          digitado: respostas,
        });
        if (!pedido.ok) {
          setRetorno(pedido.mensagem);
          return;
        }
        gravarDispositivoMemorizado(pedido.pedido.dispositivoId);
        corpoPedido = pedido.pedido;
      } else {
        const dispositivoId = dispositivoConhecido || (await descobrirDispositivo());
        gravarDispositivoMemorizado(dispositivoId);
        corpoPedido = {
          dispositivoId,
          acao,
          execucaoId,
          ...((acao === "executar" || acao === "confirmar" || acao === "desfazer" || acao === "precondicoes") && confirmado
            ? { confirmacao: fraseInstalacao, ...(acao === "executar" && instalado ? { reinstalar: true } : {}) }
            : {}),
        };
      }
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        throw new Error("UltraPDV Connector não encontrado neste computador.");
      }
      const resposta = await fetch(rotaInstalacao, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpoPedido, origem: descoberta.origem }),
      });
      if (resposta.status === 404 && props.ambiente === "producao") {
        setRetorno(
          "O Connector instalado ainda não instala o ponto de produção. Atualize para 1.3.36. Nenhum PWOPER_INSTALL foi enviado."
        );
        return;
      }
      const corpo = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
        codigo?: string;
        execucaoId?: string;
        motivoEvidencia?: string;
        falhas?: string[];
        dll?: { integridade?: boolean };
        pinpadOcupado?: boolean;
        capturas?: CapturaInstalacaoHomologacao[];
      };
      if (typeof corpo.execucaoId === "string" && corpo.execucaoId) setExecucaoId(corpo.execucaoId);
      setAguardandoConfirmacao(corpo.codigo === "AGUARDANDO_CONFIRMACAO");
      if (acao === "precondicoes") setPrecondicoesOk(corpo.ok === true && corpo.codigo === "PRECONDICOES_OK");
      setCapturas((atuais) => atualizarCapturasInstalacao(atuais, corpo));
      if (acao === "resumo") {
        setConferido({
          dllIntegra: corpo.dll?.integridade === true,
          pinpadOcupado: corpo.pinpadOcupado === true,
          mensagem: corpo.mensagem || corpo.erro || "Conferência concluída.",
        });
      }
      setRetorno(
        [
          corpo.mensagem || corpo.erro || (corpo.ok ? "Pedido aceito." : "Pedido recusado."),
          Array.isArray(corpo.falhas) && corpo.falhas.length > 0 ? corpo.falhas.join(", ") : "",
          corpo.motivoEvidencia,
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (error) {
      setRetorno(error instanceof Error ? error.message : "A instalação não foi iniciada.");
    } finally {
      setOcupado(false);
    }
  }

  async function vincularIdentidade() {
    setOcupado(true);
    setRetorno("");
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) throw new Error("UltraPDV Connector não encontrado neste computador.");
      let dispositivoId = descoberta.saude.dispositivoId ?? "";
      if (!dispositivoId) {
        const identidade = await fetch(`${descoberta.origem}/tef/identidade`, { cache: "no-store" });
        const corpo = (await identidade.json()) as { dispositivoId?: string };
        dispositivoId = corpo.dispositivoId ?? "";
      }
      const resposta = await fetch("/api/pdv/tef/homologacao/identidade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispositivoId, origem: descoberta.origem }),
      });
      const corpo = (await resposta.json()) as { ok?: boolean; erro?: string; vinculada?: boolean };
      setIdentidadeVinculada(corpo.vinculada === true);
      setRetorno(
        corpo.vinculada
          ? "A identidade de homologação foi vinculada a esta empresa."
          : corpo.erro || "A identidade de homologação não foi vinculada."
      );
    } catch (error) {
      setRetorno(error instanceof Error ? error.message : "A identidade de homologação não foi vinculada.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-base font-semibold text-zinc-900">
        Instalação do ponto de {props.ambiente === "producao" ? "produção" : "homologação"}
      </h2>
      <ol className="space-y-1 text-sm text-zinc-700">
        {ORDEM.map((estado) => (
          <li key={estado} className={estado === plano.estado ? "font-semibold text-zinc-950" : ""}>
            {ROTULOS_INSTALACAO_HOMOLOGACAO[estado]}
            {estado === plano.estado ? " · estado atual" : ""}
          </li>
        ))}
      </ol>
      <PageAlert type={alerta}>{plano.motivo}</PageAlert>
      {props.ambiente === "homologacao" || props.ambiente === "producao" ? (
        <div className="space-y-3 border-t border-zinc-200 pt-3 text-sm text-zinc-800">
          {capturas.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
              <h3 className="font-semibold text-zinc-950">A biblioteca pediu este dado</h3>
              {capturas.map((item) => (
                <label key={item.identificador} className="block">
                  <span className="mb-1 block font-medium">{rotuloCaptura(item)}</span>
                  <input
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                    type={Number(item.identificador) === 0xf6 || Number(item.identificador) === 0xf5 ? "password" : "text"}
                    autoComplete="off"
                    value={respostas[item.identificador] ?? item.valorSugerido}
                    onChange={(evento) =>
                      setRespostas((atual) => ({ ...atual, [item.identificador]: evento.target.value }))
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void enviar("responder")}
              >
                Enviar somente os dados pedidos
              </button>
            </div>
          ) : null}
          <h3 className="font-semibold text-zinc-950">Confirmação antes de PWOPER_INSTALL</h3>
          <ul className="space-y-1">
            <li>Ambiente: {confirmacao.ambiente} ({confirmacao.ambienteBiblioteca})</li>
            <li>Perfil: {confirmacao.perfil}</li>
            <li>Servidor: {confirmacao.servidor || "não informado"}</li>
            <li>Ponto de captura: {confirmacao.ponto || "não informado"}</li>
            <li>CNPJ: {confirmacao.cnpj || "não informado"}</li>
            <li>DLL: {confirmacao.dll}</li>
            <li>PinPad: {confirmacao.pinpad}</li>
          </ul>
          <p>{confirmacao.efeito} ABI_COMPROVADO e LAYOUT_HOMOLOGADO continuam falsos.</p>
          <div className="flex flex-wrap gap-2">
            {props.ambiente === "homologacao" ? (
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={ocupado}
              onClick={() => void vincularIdentidade()}
            >
              {identidadeVinculada ? "Identidade de homologação vinculada" : "Vincular identidade de homologação"}
            </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={ocupado}
              onClick={() => void enviar("resumo")}
            >
              Conferir DLL e PinPad
            </button>
            {props.ambiente === "producao" && instalado ? (
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={ocupado || !confirmado}
                onClick={() => void enviar("precondicoes")}
              >
                Conferir pré-condições
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={ocupado || !confirmado || (!instalado && !confirmacao.pronta) || (props.ambiente === "producao" && instalado && !precondicoesOk)}
              onClick={() => void enviar("executar")}
            >
              {instalado ? "Reinstalar ponto" : "Executar instalação do ponto"}
            </button>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(evento) => {
                setConfirmado(evento.target.checked);
                setPrecondicoesOk(false);
              }}
            />
            <span>
              Confirmo a execução de PW_iExecTransac para PWOPER_INSTALL. Esta operação pode produzir efeitos reais no
              ambiente de homologação. A comunicação do PinPad não comprova o ABI.
            </span>
          </label>
          {conferido ? <PageAlert type={conferido.dllIntegra && !conferido.pinpadOcupado ? "sucesso" : "aviso"}>{conferido.mensagem}</PageAlert> : null}
          {aguardandoConfirmacao ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={ocupado || !confirmado}
                onClick={() => void enviar("confirmar")}
              >
                Confirmar instalação
              </button>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={ocupado || !confirmado}
                onClick={() => void enviar("desfazer")}
              >
                Desfazer instalação
              </button>
            </div>
          ) : null}
          {retorno ? <PageAlert type="aviso">{retorno}</PageAlert> : null}
        </div>
      ) : null}
    </section>
  );
}
