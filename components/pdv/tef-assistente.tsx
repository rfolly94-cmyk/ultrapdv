"use client";

import { useState } from "react";

import {
  ativarAssistente,
  prepararInstalacaoAssistente,
  salvarRascunhoAssistente,
  validarAssistente,
} from "@/app/configuracoes/financeiro/tef/actions";
import { TefPareamentoForm } from "@/components/pdv/tef-pareamento-form";
import { TefPinpadDiagnostico } from "@/components/pdv/tef-pinpad-diagnostico";
import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  ETAPAS_ASSISTENTE,
  adquirentesInformadas,
  ambienteInformado,
  avancarEtapa,
  formatarCnpj,
  interpretarStatusConnector,
  rotuloEstado,
  rotuloEtapa,
  validarCredenciamento,
  voltarEtapa,
  type EtapaAssistente,
  type LeituraConnector,
  type LeituraPinpad,
  type RequisitoInstalacao,
} from "@/lib/pdv/tef/assistente-instalacao";
import { portaPinpad, type DiagnosticoPinpad } from "@/lib/pdv/tef/pinpad-diagnostico";
import type { TerminalTefAtivo } from "@/lib/pdv/tef/estado-terminal";

type Rascunho = {
  etapa: EtapaAssistente;
  credenciamentoConfirmado: boolean;
  ambienteAutorizado: "homologacao" | "producao";
  pontoCaptura: string;
  estabelecimento: string;
  parametrosOficiais: string;
  adquirentes: string[];
  pinpadExigido: boolean;
  servidorHomologacao: string;
  servidorProducao: string;
  servidorConfirmado: boolean;
};

export function TefAssistente(props: {
  cnpj: string;
  rascunho: Rascunho | null;
  empresaJaHabilitada: boolean;
  administrador: boolean;
  ambienteAtual: "homologacao" | "producao";
  pontoAtual: string;
  estabelecimentoAtual: string;
  migracaoInstalacaoPendente: boolean;
  empresaId: string;
  terminais: TerminalTefAtivo[];
  podeRevogar: boolean;
  etapaInicial: EtapaAssistente;
}) {
  const inicial = props.empresaJaHabilitada
    ? {
        ambiente: props.ambienteAtual,
        ponto: props.pontoAtual,
        estabelecimento: props.estabelecimentoAtual,
        confirmado: true,
      }
    : {
        ambiente: props.rascunho?.ambienteAutorizado ?? "",
        ponto: props.rascunho?.pontoCaptura ?? "",
        estabelecimento: props.rascunho?.estabelecimento ?? "",
        confirmado: props.rascunho?.credenciamentoConfirmado === true,
      };
  const [etapa, setEtapa] = useState<EtapaAssistente>(props.etapaInicial);
  const [cnpjConfirmado, setCnpjConfirmado] = useState(inicial.confirmado ? props.cnpj : "");
  const [credenciamentoConfirmado, setCredenciamentoConfirmado] = useState(inicial.confirmado);
  const [ambiente, setAmbiente] = useState<string>(inicial.ambiente);
  const [ponto, setPonto] = useState(inicial.ponto);
  const [estabelecimento, setEstabelecimento] = useState(inicial.estabelecimento);
  const [parametros, setParametros] = useState(props.rascunho?.parametrosOficiais ?? "");
  const [adquirentesTexto, setAdquirentesTexto] = useState(
    (props.rascunho?.adquirentes ?? []).join("\n")
  );
  const [pinpadExigido, setPinpadExigido] = useState(props.rascunho?.pinpadExigido !== false);
  const [servidorHomologacao, setServidorHomologacao] = useState(
    props.rascunho?.servidorHomologacao ?? ""
  );
  const [servidorProducao, setServidorProducao] = useState(props.rascunho?.servidorProducao ?? "");
  const [servidorConfirmado, setServidorConfirmado] = useState(
    props.rascunho?.servidorConfirmado === true
  );
  const [connector, setConnector] = useState<LeituraConnector | null>(null);
  const [pinpad, setPinpad] = useState<LeituraPinpad | null>(null);
  const [requisitos, setRequisitos] = useState<RequisitoInstalacao[] | null>(null);
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [ativacao, setAtivacao] = useState<string | null>(null);
  const [propostaPonto, setPropostaPonto] = useState("");
  const [propostaAmbiente, setPropostaAmbiente] = useState("");
  const [propostaServidor, setPropostaServidor] = useState("");
  const [autorizacaoReset, setAutorizacaoReset] = useState(false);
  const [confirmacaoInstalacao, setConfirmacaoInstalacao] = useState(false);
  const [credencialTecnica, setCredencialTecnica] = useState("");

  const campos = {
    cnpjConfirmado,
    credenciamentoConfirmado,
    ambienteAutorizado: ambiente,
    pontoCaptura: ponto,
    estabelecimento,
    parametrosOficiais: parametros,
    adquirentes: adquirentesInformadas(adquirentesTexto),
    pinpadExigido,
    servidorHomologacao,
    servidorProducao,
    servidorConfirmado,
    exigirServidor: !props.empresaJaHabilitada,
  };

  async function persistir(destino: EtapaAssistente) {
    const checagem = validarCredenciamento({
      cnpjEmpresa: props.cnpj,
      cnpjConfirmado,
      credenciamentoConfirmado,
      ambienteAutorizado: ambienteInformado(ambiente),
      pontoCaptura: ponto,
      estabelecimento,
      parametrosOficiais: parametros,
      adquirentes: adquirentesInformadas(adquirentesTexto),
      servidorHomologacao,
      servidorProducao,
      servidorConfirmado,
      exigirServidor: !props.empresaJaHabilitada,
    });
    if (!props.empresaJaHabilitada && !checagem.ok && destino !== "credenciamento") {
      setMensagens(checagem.pendencias);
      setEtapa("credenciamento");
      return false;
    }
    if (props.empresaJaHabilitada || props.migracaoInstalacaoPendente) {
      setEtapa(destino);
      return true;
    }
    setOcupado(true);
    setMensagens([]);
    try {
      const retorno = await salvarRascunhoAssistente({ ...campos, etapa: destino });
      if (!retorno.ok) {
        setMensagens(retorno.pendencias);
        setEtapa("credenciamento");
        return false;
      }
      setEtapa(retorno.etapa);
      return true;
    } finally {
      setOcupado(false);
    }
  }

  function observacao() {
    return {
      connector: connector ?? undefined,
      pinpad: pinpad ?? undefined,
      pinpadExigido,
      credenciamento: {
        cnpjEmpresa: props.cnpj,
        cnpjConfirmado,
        credenciamentoConfirmado,
        ambienteAutorizado: ambienteInformado(ambiente),
        pontoCaptura: ponto,
        estabelecimento,
        parametrosOficiais: parametros,
        adquirentes: adquirentesInformadas(adquirentesTexto),
        servidorHomologacao,
        servidorProducao,
        servidorConfirmado,
        exigirServidor: !props.empresaJaHabilitada,
      },
    };
  }

  async function verificarConnector() {
    setOcupado(true);
    setMensagens([]);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setConnector(interpretarStatusConnector({ descobertaOk: false }));
        setMensagens([
          "O UltraPDV Connector não respondeu neste computador. Instale o Connector nesta máquina e abra-o. Este assistente não instala, atualiza nem reinicia o programa.",
        ]);
        return;
      }
      let status: unknown = null;
      try {
        const resposta = await fetch(`${descoberta.origem}/tef/status`, { cache: "no-store" });
        status = await resposta.json();
      } catch {
        status = null;
      }
      const leitura = interpretarStatusConnector({
        descobertaOk: true,
        versao: descoberta.saude.versao ?? descoberta.saude.version ?? null,
        status,
      });
      setConnector(leitura);
    } finally {
      setOcupado(false);
    }
  }

  async function validar() {
    const salvo = await persistir(etapa);
    if (!salvo && !props.empresaJaHabilitada) {
      return;
    }
    setOcupado(true);
    try {
      const descoberta = await descobrirUltraPdvConector();
      const dispositivoId = descoberta.ok ? descoberta.saude.dispositivoId ?? "" : "";
      const retorno = await validarAssistente({
        ...observacao(),
        dispositivoId,
      });
      if (!retorno.ok) {
        setMensagens([retorno.erro]);
        return;
      }
      setRequisitos(retorno.avaliacao.requisitos);
      setMensagens(retorno.avaliacao.mensagens);
    } finally {
      setOcupado(false);
    }
  }

  function ocultarCredencial(texto: string, credencial: string) {
    if (credencial.length < 4) {
      return texto;
    }
    return texto.split(credencial).join("[redigido]");
  }

  async function avaliarMigracao() {
    setOcupado(true);
    setMensagens([]);
    try {
      const retorno = await prepararInstalacaoAssistente({
        confirmacaoExplicita: false,
        dispositivoId: "",
        credencialInformada: false,
        autorizacaoExplicitaReset: autorizacaoReset,
        proposta: {
          pontoCaptura: propostaPonto,
          ambiente: propostaAmbiente,
          servidor: propostaServidor,
        },
      });
      setMensagens([retorno.motivo]);
    } finally {
      setOcupado(false);
    }
  }

  async function instalarPonto() {
    if (props.empresaJaHabilitada || !confirmacaoInstalacao || credencialTecnica.length < 4) {
      setMensagens([
        "A instalação nova exige confirmação explícita e a credencial técnica neste momento.",
      ]);
      return;
    }
    const senha = credencialTecnica;
    setCredencialTecnica("");
    setOcupado(true);
    setMensagens([]);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok || !descoberta.saude.dispositivoId) {
        setMensagens([
          "O UltraPDV Connector não respondeu neste computador. A instalação não foi iniciada.",
        ]);
        return;
      }
      const preparado = await prepararInstalacaoAssistente({
        confirmacaoExplicita: true,
        dispositivoId: descoberta.saude.dispositivoId,
        credencialInformada: true,
        autorizacaoExplicitaReset: false,
        proposta: null,
      });
      if (!preparado.ok || preparado.efeito !== "instalar") {
        setMensagens([preparado.motivo]);
        return;
      }
      const resposta = await fetch(`${descoberta.origem}/tef/instalar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "instalar",
          confirmacao: true,
          credencial: senha,
        }),
      });
      const corpo = (await resposta.json()) as {
        erro?: string;
        resultado?: { mensagem?: string };
      };
      const texto = corpo.erro || corpo.resultado?.mensagem || "O Connector devolveu o resultado da instalação.";
      setMensagens([ocultarCredencial(texto, senha)]);
    } catch {
      setMensagens(["Não foi possível falar com o Connector. A empresa não foi ativada."]);
    } finally {
      setCredencialTecnica("");
      setOcupado(false);
    }
  }

  async function ativar() {
    setOcupado(true);
    setAtivacao(null);
    try {
      const descoberta = await descobrirUltraPdvConector();
      const retorno = await ativarAssistente({
        ...observacao(),
        dispositivoId: descoberta.ok ? descoberta.saude.dispositivoId ?? "" : "",
      });
      if (!retorno.ok) {
        setMensagens(retorno.mensagens);
        return;
      }
      setMensagens(retorno.mensagens);
      setAtivacao(
        retorno.efeito === "preservar"
          ? "A configuração desta empresa foi mantida. Nenhuma chave, ambiente ou ponto de captura foi alterado."
          : "TEF ativado para esta empresa. A plataforma master não foi alterada."
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Configurar TEF</h2>
        <p className="mt-1 text-sm text-zinc-500">
          PayGoWeb pelo ACBrTEFAPI. A ativação só ocorre no último passo, com os requisitos
          comprovados.
        </p>
      </div>
      <ol className="flex flex-wrap gap-2">
        {ETAPAS_ASSISTENTE.map((item, indice) => (
          <li
            key={item}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              item === etapa ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {indice + 1}. {rotuloEtapa(item)}
          </li>
        ))}
      </ol>
      {props.migracaoInstalacaoPendente ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          O andamento ainda não pode ser retomado neste banco. A migration
          20261011140000_tef_assistente_instalacao.sql está preparada e não foi aplicada.
        </PageAlert>
      ) : null}
      {mensagens.map((mensagem) => (
        <PageAlert key={mensagem} type="aviso" className="mx-0 mt-0">
          {mensagem}
        </PageAlert>
      ))}

      {etapa === "credenciamento" ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            CNPJ da empresa autenticada:{" "}
            <strong>{props.cnpj ? formatarCnpj(props.cnpj) : "não cadastrado"}</strong>
          </p>
          <label className="block text-sm font-medium text-zinc-800">
            Digite o CNPJ para confirmar
            <input
              value={cnpjConfirmado}
              onChange={(evento) => setCnpjConfirmado(evento.target.value)}
              disabled={props.empresaJaHabilitada}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={credenciamentoConfirmado}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setCredenciamentoConfirmado(evento.target.checked)}
            />
            Confirmo o credenciamento PayGoWeb deste CNPJ.
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Ambiente autorizado
            <select
              value={ambiente}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setAmbiente(evento.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            >
              <option value="">Selecione</option>
              <option value="homologacao">Homologação</option>
              <option value="producao">Produção</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Ponto de captura
            <input
              value={ponto}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setPonto(evento.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Estabelecimento
            <input
              value={estabelecimento}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setEstabelecimento(evento.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Servidor PayGoWeb de homologação
            <input
              value={servidorHomologacao}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setServidorHomologacao(evento.target.value)}
              placeholder="host:porta"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Servidor PayGoWeb de produção
            <input
              value={servidorProducao}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setServidorProducao(evento.target.value)}
              placeholder="host:porta"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <p className="text-sm text-zinc-600">
            Informe o host:porta atribuído a este estabelecimento. Homologação e produção são
            servidores distintos. O endereço não é usado como destino de requisição do navegador.
          </p>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={servidorConfirmado}
              disabled={props.empresaJaHabilitada || !props.administrador}
              onChange={(evento) => setServidorConfirmado(evento.target.checked)}
            />
            Confirmo o servidor PayGoWeb atribuído a este estabelecimento.
          </label>
          {!props.administrador && !props.empresaJaHabilitada ? (
            <PageAlert type="aviso" className="mx-0 mt-0">
              Somente um administrador pode confirmar o servidor PayGoWeb.
            </PageAlert>
          ) : null}
          <label className="block text-sm font-medium text-zinc-800">
            Parâmetros oficiais de instalação
            <textarea
              value={parametros}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setParametros(evento.target.value)}
              placeholder="Somente dados públicos informados pelo PayGo. Não informe senha."
              className="mt-1 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Adquirentes habilitadas
            <textarea
              value={adquirentesTexto}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => setAdquirentesTexto(evento.target.value)}
              placeholder="Uma por linha, somente as comprovadas pelo PayGoWeb."
              className="mt-1 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          {props.empresaJaHabilitada ? (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-3">
              <PageAlert type="aviso" className="mx-0 mt-0">
                Instalação atual: ponto {props.pontoAtual || "não informado"}, ambiente{" "}
                {props.ambienteAtual === "producao" ? "produção" : "homologação"}. Os dados
                vigentes não serão trocados por este assistente.
              </PageAlert>
              <p className="text-sm text-zinc-700">
                A migração para outro ponto, ambiente ou servidor depende de reset da instalação
                local. Esta etapa permanece bloqueada até a PayGo confirmar o procedimento oficial.
                A autorização abaixo não executa o reset.
              </p>
              <label className="block text-sm font-medium text-zinc-800">
                Ponto novo informado pela PayGo
                <input
                  value={propostaPonto}
                  onChange={(evento) => setPropostaPonto(evento.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium text-zinc-800">
                Ambiente novo
                <select
                  value={propostaAmbiente}
                  onChange={(evento) => setPropostaAmbiente(evento.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <option value="">Selecione</option>
                  <option value="homologacao">Homologação</option>
                  <option value="producao">Produção</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-zinc-800">
                Servidor novo
                <input
                  value={propostaServidor}
                  onChange={(evento) => setPropostaServidor(evento.target.value)}
                  placeholder="host:porta"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={autorizacaoReset}
                  onChange={(evento) => setAutorizacaoReset(evento.target.checked)}
                />
                Autorizo explicitamente o reset quando existir procedimento oficial confirmado.
              </label>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void avaliarMigracao()}
              >
                Avaliar migração
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {etapa === "connector" ? (
        <div className="space-y-3 text-sm text-zinc-700">
          <p>
            A verificação apenas lê o Connector desta máquina. Ela não substitui, atualiza nem
            reinicia a instalação.
          </p>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-2 font-medium disabled:opacity-50"
            disabled={ocupado}
            onClick={() => void verificarConnector()}
          >
            Verificar Connector
          </button>
          {connector ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              <Item rotulo="Versão" valor={connector.versao} />
              <Item rotulo="Disponível" valor={connector.disponivel ? "sim" : "não"} />
              <Item
                rotulo="Executável TEF"
                valor={
                  connector.respondeu
                    ? connector.executavelEncontrado
                      ? connector.processo || "encontrado"
                      : "ausente"
                    : null
                }
              />
              <Item
                rotulo="PayGoWeb"
                valor={connector.respondeu ? (connector.paygoInicializado ? "inicializado" : "não inicializado") : null}
              />
              <Item
                rotulo="Ambiente efetivo"
                valor={
                  connector.situacaoAmbiente === "comprovado" && connector.ambienteEfetivo
                    ? connector.ambienteEfetivo
                    : "desconhecido"
                }
              />
            </dl>
          ) : null}
          <p className="text-sm text-zinc-600">
            Este status deixa o ambiente desconhecido. A evidência assinada só nasce no
            instalar() do Connector, depois que a biblioteca observa o ponto ausente,
            PW_iSetEnvironment com sucesso e PWOPER_INSTALL no mesmo ponto. O ponto novo só
            recebe os parâmetros autorizados do vínculo. Sem ponto, ambiente, CNPJ, servidor
            ou estabelecimento, a instalação permanece bloqueada. Uma instalação já concluída
            sem essa evidência permanece desconhecida. Este assistente não reinstala o ponto.
            A ativação continua sendo uma ação separada.
          </p>
        </div>
      ) : null}

      {etapa === "pinpad" ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={pinpadExigido}
              onChange={(evento) => setPinpadExigido(evento.target.checked)}
            />
            Esta instalação exige pinpad.
          </label>
          <p className="text-sm text-zinc-600">
            A consulta de identificação pode ficar indisponível fora de uma transação. Essa é uma
            limitação da PGWebLib. Um modelo lido pela biblioteca não é uma homologação.
          </p>
          <TefPinpadDiagnostico
            somenteQuandoDisponivel
            onResultado={(resultado) => setPinpad(leituraPinpad(resultado))}
          />
        </div>
      ) : null}

      {etapa === "vinculacao" ? (
        <TefPareamentoForm
          empresaId={props.empresaId}
          terminais={props.terminais}
          podeRevogar={props.podeRevogar}
          administrador={props.administrador}
        />
      ) : null}

      {etapa === "validacao" ? (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={ocupado}
            onClick={() => void validar()}
          >
            Verificar requisitos
          </button>
          {requisitos ? (
            <ul className="space-y-2">
              {requisitos.map((item) => (
                <li key={item.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                  <span className="font-semibold text-zinc-900">
                    {item.rotulo}: {rotuloEstado(item.estado)}
                  </span>
                  <span className="mt-1 block text-zinc-600">{item.mensagem}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {etapa === "ativacao" ? (
        <div className="space-y-3">
          <PageAlert type="aviso" className="mx-0 mt-0">
            Chegar nesta etapa não ativa a empresa. TEF de homologação continua impedido de
            financiar NFC-e de produção. A instalação também não ativa a empresa.
          </PageAlert>
          {props.empresaJaHabilitada ? null : (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={confirmacaoInstalacao}
                  onChange={(evento) => setConfirmacaoInstalacao(evento.target.checked)}
                />
                Confirmo a instalação deste ponto com os dados oficiais já salvos.
              </label>
              <label className="block text-sm font-medium text-zinc-800">
                Credencial técnica
                <input
                  type="password"
                  value={credencialTecnica}
                  onChange={(evento) => setCredencialTecnica(evento.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <p className="text-sm text-zinc-600">
                A credencial segue somente até o Connector deste computador e é descartada em
                seguida. Ela não é enviada ao servidor nem gravada no banco.
              </p>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void instalarPonto()}
              >
                Instalar ponto PayGoWeb
              </button>
            </div>
          )}
          <button
            type="button"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={ocupado || (!props.empresaJaHabilitada && !requisitos?.every((item) => item.estado === "aprovado"))}
            onClick={() => void ativar()}
          >
            {props.empresaJaHabilitada ? "Manter a configuração atual" : "Ativar TEF nesta empresa"}
          </button>
          {ativacao ? (
            <PageAlert type="sucesso" className="mx-0 mt-0">
              {ativacao}
            </PageAlert>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={ocupado || etapa === "credenciamento"}
          onClick={() => setEtapa(voltarEtapa(etapa))}
        >
          Voltar
        </button>
        {etapa !== "ativacao" ? (
          <button
            type="button"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={ocupado}
            onClick={() => void persistir(avancarEtapa(etapa))}
          >
            Continuar
          </button>
        ) : null}
      </div>
    </section>
  );
}

function leituraPinpad(resultado: DiagnosticoPinpad | null): LeituraPinpad {
  if (!resultado) {
    return {
      consultado: true,
      comunicacao: "indisponivel",
      fabricante: null,
      modelo: null,
      firmware: null,
      porta: null,
      paygoInicializado: null,
      ppinfoDisponivel: null,
      limitacaoModelo: null,
    };
  }
  return {
    consultado: true,
    comunicacao: resultado.comunicacao ?? null,
    fabricante: resultado.fabricante ?? null,
    modelo: resultado.modelo ?? null,
    firmware: resultado.firmware ?? null,
    porta: portaPinpad(resultado) || null,
    paygoInicializado:
      typeof resultado.paygoInicializado === "boolean" ? resultado.paygoInicializado : null,
    ppinfoDisponivel:
      typeof resultado.ppinfoDisponivel === "boolean" ? resultado.ppinfoDisponivel : null,
    limitacaoModelo: resultado.limitacaoModelo ?? null,
  };
}

function Item({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) {
    return null;
  }
  return (
    <div>
      <dt className="text-zinc-500">{rotulo}</dt>
      <dd className="font-medium text-zinc-900">{valor}</dd>
    </div>
  );
}
