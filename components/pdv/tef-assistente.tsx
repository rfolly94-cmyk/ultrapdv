"use client";

import { useEffect, useState } from "react";

import {
  ativarAssistente,
  salvarRascunhoAssistente,
  validarAssistente,
  validarProvaBiblioteca,
} from "@/app/configuracoes/financeiro/tef/actions";
import { TefPareamentoForm } from "@/components/pdv/tef-pareamento-form";
import { TefInicializacaoBiblioteca } from "@/components/pdv/tef-inicializacao-biblioteca";
import { TefPinpadDiagnostico } from "@/components/pdv/tef-pinpad-diagnostico";
import { TefProducaoIsolada } from "@/components/pdv/tef-producao-isolada";
import { PageAlert } from "@/components/ui/page-alert";
import {
  descobrirUltraPdvConector,
  fetchLocalConector,
  origemConectorNaPorta,
  portasDescobertaConector,
} from "@/lib/impressao/descobrir";
import {
  ETAPAS_ASSISTENTE,
  adquirentesInformadas,
  ambienteInformado,
  avancarEtapa,
  formatarCnpj,
  classificarFalhaFetchConnector,
  decidirMotivoConsultaConnector,
  diagnosticarConsultaConnector,
  painelSituacaoTef,
  rotuloEstado,
  rotuloEtapa,
  validarCredenciamento,
  voltarEtapa,
  type AmbienteTefAssistente,
  type EtapaAssistente,
  type ItemPainelTef,
  type LeituraConnector,
  type LeituraPinpad,
  type ObservacaoBibliotecaAssistente,
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
  servidorHomologacao: string;
  servidorProducao: string;
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
    props.servidorHomologacao || props.rascunho?.servidorHomologacao || ""
  );
  const [servidorProducao, setServidorProducao] = useState(
    props.servidorProducao || props.rascunho?.servidorProducao || ""
  );
  const [servidorConfirmado, setServidorConfirmado] = useState(props.rascunho?.servidorConfirmado === true);
  const [servidorOficial, setServidorOficial] = useState(
    props.ambienteAtual === "producao" ? props.servidorProducao : props.servidorHomologacao
  );
  const [connector, setConnector] = useState<LeituraConnector | null>(null);
  const [agenteCompativel, setAgenteCompativel] = useState<boolean | null>(null);
  const [agenteNome, setAgenteNome] = useState<string | null>(null);
  const [evidenciaInstalacao, setEvidenciaInstalacao] = useState(false);
  const [ambienteEfetivo, setAmbienteEfetivo] = useState<AmbienteTefAssistente | null>(null);
  const [falhaConsulta, setFalhaConsulta] = useState<string | null>(null);
  const [biblioteca, setBiblioteca] = useState<ObservacaoBibliotecaAssistente | null>(null);
  const [pinpad, setPinpad] = useState<LeituraPinpad | null>(null);
  const [requisitos, setRequisitos] = useState<RequisitoInstalacao[] | null>(null);
  const [podeAtivar, setPodeAtivar] = useState(false);
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [ativacao, setAtivacao] = useState<string | null>(null);
  const [provaBiblioteca, setProvaBiblioteca] = useState<{
    instalacaoTecnica: string;
    ambienteBiblioteca: string;
    adquirente: string;
    motivo: string;
  } | null>(null);

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
  };

  const credenciamento = validarCredenciamento({
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
  });
  const painel = painelSituacaoTef({
    credenciamentoOk: Boolean(servidorOficial.trim()) && (props.empresaJaHabilitada || credenciamento.ok),
    connector,
    pinpad,
    pinpadExigido,
    bibliotecaValidada: false,
    provaTecnica:
      provaBiblioteca?.instalacaoTecnica === "comprovada" &&
      provaBiblioteca.ambienteBiblioteca === "configurado",
    ambienteComprovado: ambienteEfetivo,
    agenteCompativel,
    evidenciaInstalacao,
    falhaConsulta,
  });
  const servidorAtualBloqueado =
    props.empresaJaHabilitada &&
    (ambiente === "producao" ? Boolean(props.servidorProducao.trim()) : Boolean(props.servidorHomologacao.trim()));

  async function persistir(destino: EtapaAssistente) {
    if (!credenciamento.ok && destino !== "credenciamento") {
      setMensagens(credenciamento.pendencias);
      setEtapa("credenciamento");
      return false;
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
      if ("servidorProducao" in retorno) {
        setServidorProducao(retorno.servidorProducao);
        setServidorHomologacao(retorno.servidorHomologacao);
        setServidorOficial(ambiente === "producao" ? retorno.servidorProducao : retorno.servidorHomologacao);
      }
      setEtapa(retorno.etapa);
      return true;
    } finally {
      setOcupado(false);
    }
  }

  function observacao(
    leitura: LeituraConnector | null = connector,
    bibliotecaInformada: ObservacaoBibliotecaAssistente | null = biblioteca
  ) {
    return {
      connector: leitura ?? undefined,
      biblioteca: bibliotecaInformada,
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
      },
    };
  }

  function aplicarConsulta(consulta: ReturnType<typeof diagnosticarConsultaConnector>) {
    setConnector(consulta.leitura);
    setAgenteCompativel(consulta.agente.compativel);
    setAgenteNome(consulta.agente.nome);
    setEvidenciaInstalacao(consulta.agente.evidenciaInstalacao);
    setAmbienteEfetivo(consulta.agente.ambienteEfetivo);
    setFalhaConsulta(consulta.mensagem || null);
    setBiblioteca(consulta.biblioteca);
    return consulta;
  }

  async function servidorRespondeSemCors() {
    for (const porta of portasDescobertaConector()) {
      try {
        await fetch(`${origemConectorNaPorta(porta)}/health`, { mode: "no-cors", cache: "no-store" });
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async function consultarConnector() {
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) {
      const motivo = decidirMotivoConsultaConnector({
        falha: descoberta.motivo,
        noCorsRespondeu:
          descoberta.motivo === "ausente" || descoberta.motivo === "sem_porta"
            ? await servidorRespondeSemCors()
            : false,
      });
      return {
        ...aplicarConsulta(
          diagnosticarConsultaConnector({
            descobertaOk: false,
            motivoDescoberta: motivo,
          })
        ),
        origem: "",
      };
    }
    let status: unknown = null;
    let statusHttp: number | null = null;
    let falhaStatus: "timeout" | "cors" | "indisponivel" | "json" | null = null;
    try {
      const resposta = await fetchLocalConector(`${descoberta.origem}/tef/status`);
      statusHttp = resposta.status;
      const texto = await resposta.text();
      try {
        status = JSON.parse(texto) as unknown;
      } catch {
        falhaStatus = "json";
      }
    } catch (erro) {
      const classe = classificarFalhaFetchConnector(erro);
      falhaStatus =
        classe === "indisponivel" && (await servidorRespondeSemCors()) ? "cors" : classe;
    }
    return {
      ...aplicarConsulta(
        diagnosticarConsultaConnector({
          descobertaOk: true,
          origem: descoberta.origem,
          versao: descoberta.saude.versao ?? descoberta.saude.version ?? null,
          dispositivoId: descoberta.saude.dispositivoId ?? "",
          statusHttp,
          status,
          falhaStatus,
        })
      ),
      origem: descoberta.origem,
    };
  }

  async function verificarConnector() {
    setOcupado(true);
    setMensagens([]);
    try {
      const consulta = await consultarConnector();
      if (consulta.mensagem) {
        setMensagens([consulta.mensagem]);
        return;
      }
      if (consulta.agente.compativel === false) {
        setMensagens([
          "Atualize o Connector pelo instalador desta máquina. A versão carregada não é compatível com o TEF.",
        ]);
      }
    } finally {
      setOcupado(false);
    }
  }

  useEffect(() => {
    if ((etapa !== "connector" && etapa !== "ativacao") || connector) {
      return;
    }
    void verificarConnector();
  }, [etapa, connector]);

  async function validar() {
    setOcupado(true);
    setMensagens([]);
    try {
      const consulta = await consultarConnector();
      if (!consulta.statusLido) {
        setMensagens([consulta.mensagem || "Não foi possível ler /tef/status."]);
        setRequisitos(null);
        setPodeAtivar(false);
        return;
      }
      if (!consulta.origem) {
        setProvaBiblioteca({
          instalacaoTecnica: "pendente",
          ambienteBiblioteca: "ausente",
          adquirente: "desconhecida",
          motivo: "O Connector respondeu ao status, mas a origem da prova não foi identificada.",
        });
      } else {
        let prova: { versao: number | null; campos: unknown; assinatura: string } | null = null;
        let erroProva = "";
        try {
          const resposta = await fetchLocalConector(`${consulta.origem}/tef/biblioteca/evidencia`);
          const corpo = (await resposta.json()) as {
            ok?: boolean;
            erro?: string;
            versao?: number;
            campos?: unknown;
            assinatura?: string;
          };
          if (!resposta.ok || corpo.ok === false) {
            erroProva =
              corpo.erro === "Não encontrado."
                ? "O Connector em execução não possui a consulta da prova assinada. Atualize o Connector para validar a instalação já feita. A instalação do PayGoWeb não será repetida."
                : corpo.erro || "A prova assinada não pôde ser lida.";
          } else {
            prova = {
              versao: typeof corpo.versao === "number" ? corpo.versao : null,
              campos: corpo.campos,
              assinatura: String(corpo.assinatura ?? ""),
            };
          }
        } catch {
          erroProva = "Não foi possível ler a prova assinada no Connector.";
        }
        if (!prova) {
          setProvaBiblioteca({
            instalacaoTecnica: "pendente",
            ambienteBiblioteca: "ausente",
            adquirente: "desconhecida",
            motivo: erroProva,
          });
        } else {
          setProvaBiblioteca(
            await validarProvaBiblioteca({
              dispositivoId: consulta.dispositivoId,
              versao: prova.versao,
              campos: prova.campos,
              assinatura: prova.assinatura,
            })
          );
        }
      }
      const retorno = await validarAssistente({
        ...observacao(consulta.leitura, consulta.biblioteca),
        dispositivoId: consulta.dispositivoId,
      });
      if (!retorno.ok) {
        setMensagens([retorno.erro]);
        setPodeAtivar(false);
        return;
      }
      setRequisitos(retorno.avaliacao.requisitos);
      setPodeAtivar(retorno.avaliacao.podeAtivar);
      setMensagens(retorno.avaliacao.mensagens.filter((item) => item.trim()));
    } finally {
      setOcupado(false);
    }
  }

  async function ativar() {
    if (!podeAtivar) {
      setMensagens(["A ativação só fica disponível depois da validação real da instalação."]);
      return;
    }
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
      setMensagens([]);
      setAtivacao(
        retorno.efeito === "preservar"
          ? "A configuração desta empresa foi mantida. Nenhuma chave, ambiente ou ponto de captura foi alterado."
          : "TEF ativado para esta empresa."
      );
    } finally {
      setOcupado(false);
    }
  }

  function resolver(item: ItemPainelTef) {
    if (item.id === "credenciamento") {
      setEtapa("credenciamento");
      return;
    }
    if (item.id === "connector") {
      void verificarConnector();
      return;
    }
    if (item.id === "paygo" || item.id === "ambiente") {
      setEtapa(servidorOficial.trim() ? "ativacao" : "credenciamento");
    }
  }

  const servidorExibido = servidorOficial.trim() || "não informado";

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Configurar TEF</h2>
        <p className="mt-1 text-sm text-zinc-500">
          PayGoWeb. A instalação só começa nesta tela, com confirmação, e não ao avançar de etapa.
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
      {mensagens.length > 0 ? (
        <PageAlert type="erro" className="mx-0 mt-0">
          {mensagens[0]}
        </PageAlert>
      ) : null}

      {etapa === "credenciamento" ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-zinc-800">
            CNPJ da empresa autenticada
            <input
              value={props.cnpj ? formatarCnpj(props.cnpj) : "não cadastrado"}
              disabled
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={credenciamentoConfirmado}
              disabled={props.empresaJaHabilitada}
              onChange={(evento) => {
                setCredenciamentoConfirmado(evento.target.checked);
                setCnpjConfirmado(evento.target.checked ? props.cnpj : "");
              }}
            />
            Confirmo o credenciamento PayGoWeb deste CNPJ.
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Ambiente
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
          {ambiente === "homologacao" ? (
            <label className="block text-sm font-medium text-zinc-800">
              Servidor PayGoWeb de homologação
              <input
                value={servidorHomologacao}
                disabled={props.empresaJaHabilitada && Boolean(props.servidorHomologacao.trim())}
                onChange={(evento) => {
                  setServidorHomologacao(evento.target.value);
                  setServidorConfirmado(false);
                }}
                placeholder="host:porta"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          ) : (
            <label className="block text-sm font-medium text-zinc-800">
              Servidor PayGoWeb de produção
              <input
                value={servidorProducao}
                disabled={servidorAtualBloqueado}
                onChange={(evento) => {
                  setServidorProducao(evento.target.value);
                  setServidorConfirmado(false);
                }}
                placeholder="host:porta"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          )}
          <p className="text-sm text-zinc-600">
            Informe o host:porta deste estabelecimento. O servidor só é aceito depois de gravado e
            relido. O campo de avaliação de migração não substitui este valor.
          </p>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={servidorConfirmado}
              disabled={!props.administrador}
              onChange={(evento) => setServidorConfirmado(evento.target.checked)}
            />
            Confirmo o servidor PayGoWeb atribuído a este estabelecimento.
          </label>
          {!props.administrador ? (
            <PageAlert type="erro" className="mx-0 mt-0">
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
        </div>
      ) : null}

      {etapa === "connector" ? (
        <div className="space-y-4">
          <Painel itens={painel} onResolver={resolver} />
          {connector?.respondeu ? (
            <p className="text-sm text-zinc-600">
              Connector {connector.versao || "sem versão"}
              {agenteNome ? `, agente ${agenteNome}` : ""}.
              {connector.processo === "parado"
                ? " O processo TEF está parado e o Connector permanece conectado."
                : ""}
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={pinpadExigido}
              onChange={(evento) => setPinpadExigido(evento.target.checked)}
            />
            Esta instalação exige pinpad.
          </label>
          <TefInicializacaoBiblioteca />
          <TefPinpadDiagnostico
            somenteQuandoDisponivel
            onResultado={(resultado) => setPinpad(leituraPinpad(resultado))}
          />
          <TefPareamentoForm
            empresaId={props.empresaId}
            terminais={props.terminais}
            podeRevogar={props.podeRevogar}
            administrador={props.administrador}
          />
        </div>
      ) : null}

      {etapa === "ativacao" ? (
        <div className="space-y-4">
          <Painel itens={painel} onResolver={resolver} />
          <p className="text-sm text-zinc-600">
            Chegar nesta etapa não ativa a empresa. A evidência assinada só nasce na instalação feita
            pelo Connector.
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Item rotulo="Ponto oficial" valor={ponto || "não informado"} />
            <Item rotulo="Ambiente do cadastro" valor={ambiente === "producao" ? "produção" : ambiente === "homologacao" ? "homologação" : "não informado"} />
            <Item rotulo="Servidor oficial" valor={servidorExibido} />
            <Item rotulo="CNPJ" valor={props.cnpj ? formatarCnpj(props.cnpj) : "não informado"} />
          </dl>
          <TefProducaoIsolada
            administrador={props.administrador}
            cnpj={props.cnpj}
            ponto={ponto}
            servidor={servidorOficial}
            estabelecimento={estabelecimento}
            ambiente={ambiente === "producao" ? "producao" : "homologacao"}
          />
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={ocupado}
            onClick={() => void validar()}
          >
            Validar instalação
          </button>
          {provaBiblioteca ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <Item
                rotulo="Instalação técnica"
                valor={`${rotuloProva(provaBiblioteca.instalacaoTecnica)}. ${provaBiblioteca.motivo}`}
              />
              <Item
                rotulo="Ambiente da biblioteca"
                valor={rotuloProva(provaBiblioteca.ambienteBiblioteca)}
              />
              <Item
                rotulo="Adquirente"
                valor={`${rotuloProva(provaBiblioteca.adquirente)}. A prova técnica não habilita transação real.`}
              />
            </dl>
          ) : null}
          <TefInicializacaoBiblioteca />
          <TefPinpadDiagnostico
            somenteQuandoDisponivel
            onResultado={(resultado) => setPinpad(leituraPinpad(resultado))}
          />
          {requisitos ? (
            <ul className="space-y-2">
              {requisitos
                .filter((item) => item.estado !== "aprovado")
                .map((item) => (
                  <li key={item.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                    <span className="font-semibold text-zinc-900">
                      {item.rotulo}: {rotuloEstado(item.estado)}
                    </span>
                    <span className="mt-1 block text-zinc-600">{item.mensagem}</span>
                  </li>
                ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={ocupado || !podeAtivar}
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

function Painel({
  itens,
  onResolver,
}: {
  itens: ItemPainelTef[];
  onResolver: (item: ItemPainelTef) => void;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {itens.map((item) => (
        <li key={item.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
          <span className="font-semibold text-zinc-900">
            {item.rotulo}: {item.situacao}
          </span>
          {item.pendente ? <span className="mt-1 block text-zinc-600">{item.explicacao}</span> : null}
          {item.pendente && item.id !== "pinpad" ? (
            <button
              type="button"
              className="mt-2 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium"
              onClick={() => onResolver(item)}
            >
              Resolver
            </button>
          ) : null}
        </li>
      ))}
    </ul>
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

function rotuloProva(valor: string) {
  const rotulos: Record<string, string> = {
    comprovada: "Comprovada",
    pendente: "Pendente",
    configurado: "Configurado",
    divergente: "Divergente",
    ausente: "Ausente",
    desconhecida: "Desconhecida",
  };
  return rotulos[valor] ?? valor;
}

function Item({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-zinc-500">{rotulo}</dt>
      <dd className="font-medium text-zinc-900">{valor}</dd>
    </div>
  );
}
