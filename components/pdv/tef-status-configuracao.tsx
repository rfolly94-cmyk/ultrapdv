"use client";

import { useEffect, useState } from "react";

import { TefInstalacaoHomologacao } from "@/components/pdv/tef-instalacao-homologacao";
import { TefPinpadDiagnostico } from "@/components/pdv/tef-pinpad-diagnostico";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { motivoBloqueioTef } from "@/lib/pdv/tef/cartao-checkout";
import { nomeAmbientePayGo, type AmbientePayGo } from "@/lib/pdv/tef/configuracao-paygo";
import {
  classificarDisponibilidadePdv,
  VERSAO_DLL_PGWEB,
} from "@/lib/pdv/tef/disponibilidade-pdv";
import { cobrancaRealBloqueada } from "@/lib/pdv/tef/motor";
import type { DiagnosticoPinpad } from "@/lib/pdv/tef/pinpad-diagnostico";

export function TefStatusConfiguracao(props: {
  configuracaoSalva: boolean;
  habilitado: boolean;
  ambiente: AmbientePayGo | "";
  instalacaoConfirmada: boolean;
  pinpadConfirmado: boolean | null;
  terminalVinculado: boolean;
  pendencias: number;
}) {
  const [connector, setConnector] = useState<"conectado" | "desconectado" | null>(null);
  const [versaoConnector, setVersaoConnector] = useState("");

  useEffect(() => {
    let ativo = true;
    void descobrirUltraPdvConector().then((descoberta) => {
      if (!ativo) return;
      setConnector(descoberta.ok ? "conectado" : "desconectado");
      setVersaoConnector(descoberta.ok ? String(descoberta.saude.versao ?? "") : "");
    });
    return () => {
      ativo = false;
    };
  }, []);

  const ambienteNome =
    props.ambiente === "producao"
      ? `Produção (${nomeAmbientePayGo(props.ambiente)})`
      : props.ambiente === "homologacao"
        ? `Homologação (${nomeAmbientePayGo(props.ambiente)})`
        : "não definido";
  const motivo = motivoBloqueioTef({
    habilitado: props.habilitado,
    ambiente: props.ambiente,
    cobrancaRealBloqueada: cobrancaRealBloqueada(),
  });
  const disponibilidade = classificarDisponibilidadePdv({
    habilitado: props.habilitado,
    ambiente: props.ambiente === "producao" || props.ambiente === "homologacao" ? props.ambiente : "",
    credenciaisCompletas: props.configuracaoSalva,
    pontoInstalado: props.instalacaoConfirmada,
    terminalVinculado: props.terminalVinculado,
    connectorPresente: connector === null ? null : connector === "conectado",
    connectorCompativel: connector === "conectado" ? true : null,
    bibliotecaPresente: null,
    pinpadDisponivel: props.pinpadConfirmado,
    ambienteCompativel: true,
    cobrancaRealBloqueada: cobrancaRealBloqueada(),
    ativacaoExplicita: false,
    transacaoEmAndamento: false,
    recuperacaoNecessaria: props.pendencias > 0,
  });
  const linhas = [
    props.habilitado ? "TEF habilitado nesta empresa." : "TEF desabilitado nesta empresa.",
    `Ambiente: ${ambienteNome}.`,
    `Situação: ${disponibilidade.rotulo}. ${disponibilidade.motivo}`,
    motivo ? `Motivo do bloqueio: ${motivo}` : "Não há bloqueio de recebimento para esta configuração.",
    props.configuracaoSalva ? "Configuração salva." : "Configuração não salva.",
    connector === "conectado" ? "Connector conectado." : connector === "desconectado" ? "Connector desconectado." : "Connector ainda não consultado.",
    versaoConnector ? `Connector ${versaoConnector}.` : "Versão do Connector ainda não consultada.",
    `DLL esperada: PGWebLib ${VERSAO_DLL_PGWEB}.`,
    props.pinpadConfirmado === true ? "PinPad disponível." : props.pinpadConfirmado === false ? "PinPad indisponível." : "PinPad ainda não consultado.",
    props.instalacaoConfirmada ? "Instalação PayGo concluída." : "Instalação PayGo pendente.",
    props.pendencias > 0
      ? `${props.pendencias} pendência(s) financeira(s) desta empresa.`
      : "Nenhuma pendência financeira desta empresa.",
  ];

  return (
    <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-base font-semibold text-zinc-900">Situação da configuração</h2>
      <ul className="space-y-1 text-sm text-zinc-800">
        {linhas.map((linha) => (
          <li key={linha}>{linha}</li>
        ))}
      </ul>
    </section>
  );
}

export function pinpadFoiConfirmado(resultado: DiagnosticoPinpad | null) {
  return resultado?.comunicacao === "confirmada";
}

export function TefPainelStatus(props: {
  configuracaoSalva: boolean;
  habilitado: boolean;
  ambiente: AmbientePayGo | "";
  instalacaoConfirmada: boolean;
  empresaAutorizada: boolean;
  terminalAutorizado: boolean;
  pendencias: number;
  servidorHomologacao: string;
  pontoHomologacao: string;
  cnpjMascarado: string;
  dispositivoId: string;
}) {
  const [pinpadConfirmado, setPinpadConfirmado] = useState<boolean | null>(null);
  return (
    <>
      <TefStatusConfiguracao
        configuracaoSalva={props.configuracaoSalva}
        habilitado={props.habilitado}
        ambiente={props.ambiente}
        instalacaoConfirmada={props.instalacaoConfirmada}
        pinpadConfirmado={pinpadConfirmado}
        terminalVinculado={props.terminalAutorizado}
        pendencias={props.pendencias}
      />
      <TefPinpadDiagnostico
        ambiente={props.ambiente === "producao" || props.ambiente === "homologacao" ? props.ambiente : undefined}
        onResultado={(resultado) => setPinpadConfirmado(pinpadFoiConfirmado(resultado))}
      />
      {props.ambiente === "producao" || props.ambiente === "homologacao" ? (
        <TefInstalacaoHomologacao
          ambiente={props.ambiente}
          empresaAutorizada={props.empresaAutorizada}
          terminalAutorizado={props.terminalAutorizado}
          configuracaoCompleta={props.configuracaoSalva}
          comunicacaoPinpad={pinpadConfirmado === true}
          evidenciaBiblioteca={props.instalacaoConfirmada}
          servidor={props.servidorHomologacao}
          ponto={props.pontoHomologacao}
          cnpjMascarado={props.cnpjMascarado}
          portaPinpad={pinpadConfirmado === true ? "COM confirmada nesta sessão" : ""}
          dispositivoId={props.dispositivoId}
        />
      ) : null}
    </>
  );
}
