"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { cobrarPeloMotorCsharp } from "@/lib/pdv/tef/motor-csharp";
import { ACAO_REGISTRAR_COMPROVACAO, rotuloSituacaoCredenciamento, type SituacaoCredenciamento } from "@/lib/pdv/tef/credenciamento-comercial";
import { decidirTestePinPadProducao, podeConcluirAvaliacaoProducao, ROTULOS_ESTADO_TEF, type AmbienteTefEmpresa, type EstadoTefEmpresa } from "@/lib/pdv/tef/politica-empresa";
import { autorizarProducaoTefEmpresa, declararServidorComercialEmpresa, registrarComprovacaoCredenciamentoEmpresa, salvarIdentificacaoCredenciamentoEmpresa, salvarMotorTefEmpresa } from "@/app/configuracoes/financeiro/tef/motor-actions";
import { TefInstalacaoProducao } from "@/components/pdv/tef-instalacao-producao";

type RespostaConfig = {
  rotulo?: string;
  estado?: EstadoTefEmpresa;
  conciliacao?: string;
  pontoInstalado?: boolean;
  podeCobrar?: boolean;
  requisitosProducao?: Array<{ id: string; ok: boolean; texto: string }>;
  credenciamentoProducao?: boolean;
  referenciaCredenciamento?: string;
  situacaoCredenciamento?: SituacaoCredenciamento;
  comprovadoEm?: string | null;
  pontoProducaoInstalado?: boolean;
  servidorComercial?: string;
  servidorComercialValidado?: boolean;
};

export function TefConfiguracaoEmpresa(props: {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  empresaId: string;
  administrador: boolean;
  habilitado: boolean;
  ambiente: AmbienteTefEmpresa;
  configurado: boolean;
  referenciaInicial?: string;
  situacaoInicial?: SituacaoCredenciamento;
  comprovadoEmInicial?: string | null;
  credenciamentoInicial?: boolean;
}) {
  const [habilitado, setHabilitado] = useState(props.habilitado);
  const roteador = useRouter();
  const [ambiente, setAmbiente] = useState<AmbienteTefEmpresa>(props.ambiente);
  const [ambienteAtivo, setAmbienteAtivo] = useState<AmbienteTefEmpresa>(props.ambiente);
  const [dispositivo, setDispositivo] = useState("Consultando o Connector.");
  const [pinpad, setPinpad] = useState("Não testado");
  const [consulta, setConsulta] = useState<RespostaConfig | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [referencia, setReferencia] = useState(props.referenciaInicial ?? "");
  const [situacao, setSituacao] = useState<SituacaoCredenciamento>(props.situacaoInicial ?? "nao_informado");
  const [comprovadoEm, setComprovadoEm] = useState<string | null>(props.comprovadoEmInicial ?? null);
  const [credenciamentoComprovado, setCredenciamentoComprovado] = useState(props.credenciamentoInicial === true);
  const [servidor, setServidor] = useState("");
  const [servidorDeclarado, setServidorDeclarado] = useState(false);
  const [servidorValidado, setServidorValidado] = useState(false);
  const [autorizaPinPadProducao, setAutorizaPinPadProducao] = useState(false);

  useEffect(() => {
    setAmbiente(props.ambiente);
    setAmbienteAtivo(props.ambiente);
  }, [props.ambiente]);

  async function consultarSinais(opcoes?: { preencherServidor?: boolean }) {
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) {
      setDispositivo("Connector indisponível");
    } else {
      setDispositivo(descoberta.saude.dispositivoId || "Connector sem dispositivo");
    }
    const resposta = await fetch("/api/pdv/tef/motor/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origem: descoberta.ok ? descoberta.origem : "" }),
    }).then(async (item) => (item.ok ? item.json() : null)).catch(() => null) as RespostaConfig | null;
    if (!resposta) return null;
    setConsulta(resposta);
    if (typeof resposta.referenciaCredenciamento === "string") setReferencia(resposta.referenciaCredenciamento);
    if (resposta.situacaoCredenciamento === "comprovado" || resposta.situacaoCredenciamento === "informado") {
      setSituacao(resposta.situacaoCredenciamento);
    }
    setCredenciamentoComprovado(resposta.credenciamentoProducao === true);
    setComprovadoEm(typeof resposta.comprovadoEm === "string" ? resposta.comprovadoEm : null);
    setServidorDeclarado(typeof resposta.servidorComercial === "string" && resposta.servidorComercial.length > 0);
    setServidorValidado(resposta.servidorComercialValidado === true);
    if (opcoes?.preencherServidor) {
      setServidor(typeof resposta.servidorComercial === "string" ? resposta.servidorComercial : "");
    }
    return resposta;
  }

  useEffect(() => {
    let ativo = true;
    void consultarSinais({ preencherServidor: true }).then(() => {
      if (!ativo) return;
    });
    return () => {
      ativo = false;
    };
  }, []);

  const estado = consulta?.estado;
  const rotulo = estado ? ROTULOS_ESTADO_TEF[estado] : consulta?.rotulo || "Consultando o Connector";
  const testePinPadProducao = decidirTestePinPadProducao({
    administrador: props.administrador,
    autorizacaoExplicita: autorizaPinPadProducao,
    pontoProducaoInstalado: consulta?.pontoProducaoInstalado === true,
    pendenciaFinanceira: consulta?.estado === "pendencia_financeira",
  });
  const avaliacaoLiberada = podeConcluirAvaliacaoProducao(consulta?.requisitosProducao ?? [], props.administrador);

  async function salvar() {
    setOcupado(true);
    setErro("");
    setAviso("");
    const descoberta = await descobrirUltraPdvConector();
    const resultado = await salvarMotorTefEmpresa({
      habilitado,
      ambiente,
      origem: descoberta.ok ? descoberta.origem : "",
    });
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setAmbienteAtivo(ambiente);
    roteador.refresh();
    setAviso(
      ambiente === "producao"
        ? "Ambiente ativo: Produção. As credenciais e os journals de homologação não foram alterados."
        : "Ambiente ativo: Homologação. As credenciais e os journals de produção não foram alterados."
    );
  }

  async function testarPinPadProducao() {
    if (!testePinPadProducao.pode) return;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setErro("O Connector local não está disponível. O teste não foi iniciado.");
        return;
      }
      const resposta = await fetch("/api/pdv/tef/motor/producao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origem: descoberta.origem, comando: "pinpad", autorizarPinPad: true }),
      }).then(async (item) => item.json().catch(() => null)).catch(() => null) as { codigo?: string; codigoNativo?: number; erro?: string } | null;
      const sinais = await consultarSinais();
      const nativoZero = resposta?.codigo === "pinpad_ok" && resposta.codigoNativo === 0;
      const registrado = sinais?.requisitosProducao?.some((item: { id: string; ok: boolean }) => item.id === "pinpad" && item.ok) === true;
      if (nativoZero && registrado) {
        setAviso("O PinPad de produção foi aprovado. Retorno nativo 0. Nenhuma cobrança foi iniciada.");
        return;
      }
      setErro(
        nativoZero
          ? "O retorno nativo foi 0, mas a aprovação não ficou vinculada à empresa, ao terminal e ao dispositivo. Nenhuma cobrança foi iniciada."
          : resposta?.erro || "O PinPad de produção não foi aprovado."
      );
    } finally {
      setOcupado(false);
    }
  }

  async function testarPinPad() {
    setOcupado(true);
    setErro("");
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) {
      setPinpad("Connector indisponível");
      setOcupado(false);
      return;
    }
    const resposta = await cobrarPeloMotorCsharp({ origem: descoberta.origem, comando: "pinpad" });
    setPinpad(resposta.codigo === "pinpad_ok" ? "Comunicação respondida" : resposta.erro || "O PinPad não foi aprovado.");
    setOcupado(false);
  }

  async function salvarIdentificacao() {
    setOcupado(true);
    setErro("");
    setAviso("");
    const resultado = await salvarIdentificacaoCredenciamentoEmpresa({ referencia });
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setSituacao(resultado.situacao);
    setCredenciamentoComprovado(resultado.comprovado);
    setComprovadoEm(resultado.comprovadoEm);
    setAviso(resultado.comprovado ? "A referência já estava comprovada." : "A identificação foi gravada. O credenciamento ainda não está comprovado.");
  }

  async function registrarComprovacao() {
    setOcupado(true);
    setErro("");
    setAviso("");
    const resultado = await registrarComprovacaoCredenciamentoEmpresa({
      referencia,
      acao: ACAO_REGISTRAR_COMPROVACAO,
    });
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setSituacao("comprovado");
    setCredenciamentoComprovado(true);
    setComprovadoEm(resultado.comprovadoEm);
    setAviso("A comprovação comercial foi registrada. Os pagamentos de produção continuam bloqueados.");
  }

  async function declararServidor() {
    setOcupado(true);
    setErro("");
    setAviso("");
    const resultado = await declararServidorComercialEmpresa({ servidor });
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setServidorDeclarado(true);
    setServidorValidado(resultado.validado === true);
    setAviso(resultado.validado
      ? "O servidor comercial declarado já estava confirmado pela biblioteca. Nenhum pagamento foi autorizado."
      : "O servidor comercial foi declarado. Ele ainda não está confirmado pela biblioteca e não autoriza pagamentos.");
    await consultarSinais();
  }

  async function pedirProducao() {
    setOcupado(true);
    setErro("");
    setAviso("");
    const descoberta = await descobrirUltraPdvConector();
    const resultado = await autorizarProducaoTefEmpresa({ origem: descoberta.ok ? descoberta.origem : "" });
    setOcupado(false);
    if (!resultado.ok) {
      setErro([resultado.erro, ...(resultado.pendentes ?? [])].join(" "));
      return;
    }
    setAviso("A produção foi autorizada para esta empresa e este terminal. Débito e crédito usam o motor de produção. A NFC-e segue o ambiente fiscal configurado.");
    await consultarSinais();
  }

  return (
    <div className="mt-5 space-y-4 border-t border-zinc-200 pt-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500">Razão social</dt>
          <dd className="font-medium text-zinc-950">{props.razaoSocial || "Não informada"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Nome fantasia</dt>
          <dd className="font-medium text-zinc-950">{props.nomeFantasia || "Não informado"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">CNPJ</dt>
          <dd className="font-medium text-zinc-950">{props.cnpj}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Empresa</dt>
          <dd className="font-medium break-all text-zinc-950">{props.empresaId}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Ambiente selecionado</dt>
          <dd className="font-medium text-zinc-950">{ambiente === "producao" ? "Produção" : "Homologação"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Dispositivo</dt>
          <dd className="font-medium break-all text-zinc-950">{dispositivo}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Terminal</dt>
          <dd className="font-medium text-zinc-950">O terminal local desta empresa no Connector</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Ponto de captura</dt>
          <dd className="font-medium text-zinc-950">Pedido pela biblioteca na instalação. Não fica gravado aqui.</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Adquirente</dt>
          <dd className="font-medium text-zinc-950">Escolhida pela biblioteca durante a operação.</dd>
        </div>
        <div>
          <dt className="text-zinc-500">PinPad</dt>
          <dd className="font-medium text-zinc-950">{pinpad}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Instalação e comunicação</dt>
          <dd className="font-medium text-zinc-950">{rotulo}</dd>
        </div>
      </dl>
      {consulta?.conciliacao ? <p className="text-sm text-zinc-700">{consulta.conciliacao}</p> : null}
      <p className="text-sm text-zinc-600">
        A senha técnica e o ponto só são digitados quando a biblioteca pede, e não são armazenados. Trocar o ambiente não converte um ponto já instalado.
      </p>
      <label className="flex items-center gap-2 text-sm text-zinc-900">
        <input type="checkbox" checked={habilitado} disabled={!props.administrador || ocupado} onChange={(event) => setHabilitado(event.target.checked)} />
        Habilitar TEF desta empresa
      </label>
      <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${ambienteAtivo === "producao" ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}>
        Ambiente ativo: {ambienteAtivo === "producao" ? "Produção" : "Homologação"}
      </p>
      <label className="block text-sm text-zinc-900">
        Ambiente TEF
        <select
          className="mt-1 h-10 w-full rounded border border-zinc-300 px-3"
          value={ambiente}
          disabled={!props.administrador || ocupado}
          onChange={(event) => setAmbiente(event.target.value === "producao" ? "producao" : "homologacao")}
        >
          <option value="homologacao">Homologação</option>
          <option value="producao">Produção</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!props.administrador || ocupado} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void salvar()}>
          Salvar configuração
        </button>
        {ambiente === "homologacao" ? (
          <button type="button" disabled={ocupado} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40" onClick={() => void testarPinPad()}>
            Testar PinPad de homologação
          </button>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-900">
              <input type="checkbox" checked={autorizaPinPadProducao} disabled={!props.administrador || ocupado} onChange={(event) => setAutorizaPinPadProducao(event.target.checked)} />
              Autorizo o teste de comunicação do PinPad no ponto de produção
            </label>
            <button type="button" disabled={!testePinPadProducao.pode || ocupado} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40" onClick={() => void testarPinPadProducao()}>
              Testar PinPad de produção
            </button>
          </>
        )}
        <button type="button" disabled={!avaliacaoLiberada || ocupado} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40" onClick={() => void pedirProducao()}>
          Avaliar produção
        </button>
      </div>
      {ambiente === "producao" && !testePinPadProducao.pode ? <p className="text-sm text-zinc-600">{testePinPadProducao.mensagem}</p> : null}
      <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
        <h3 className="text-sm font-semibold text-zinc-950">Servidor comercial de produção</h3>
        <p className="text-sm text-zinc-600">
          Informe o endereço host:porta fornecido pela PayGo para a produção. Declarar o endereço não configura a biblioteca e não autoriza pagamento. Um endereço de homologação é recusado.
        </p>
        <label className="block text-sm text-zinc-900">
          Servidor comercial
          <input
            value={servidor}
            disabled={!props.administrador || ocupado}
            autoComplete="off"
            placeholder="host:porta"
            className="mt-1 h-10 w-full rounded border border-zinc-300 px-3"
            onChange={(event) => {
              setServidor(event.target.value);
              setServidorDeclarado(false);
              setServidorValidado(false);
            }}
          />
        </label>
        <p className="text-sm text-zinc-700">
          {servidorValidado
            ? "Confirmado pela biblioteca. A instalação ainda depende da ação do administrador e os pagamentos dependem da avaliação."
            : "Ainda não confirmado pela biblioteca."}
        </p>
        <button type="button" disabled={!props.administrador || ocupado} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40" onClick={() => void declararServidor()}>
          Declarar servidor comercial
        </button>
      </section>
      <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
        <h3 className="text-sm font-semibold text-zinc-950">Credenciamento comercial</h3>
        <p className="text-sm text-zinc-600">
          O provedor deste motor é PayGo. A referência identifica o credenciamento do CNPJ desta empresa. Salvar a identificação não comprova o credenciamento.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Provedor</dt>
            <dd className="font-medium text-zinc-950">PayGo</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Situação da validação</dt>
            <dd className="font-medium text-zinc-950">{rotuloSituacaoCredenciamento(situacao)}</dd>
          </div>
        </dl>
        <label className="block text-sm text-zinc-900">
          Referência do credenciamento
          <input
            value={referencia}
            disabled={!props.administrador || ocupado}
            autoComplete="off"
            className="mt-1 h-10 w-full rounded border border-zinc-300 px-3"
            onChange={(event) => setReferencia(event.target.value)}
          />
        </label>
        {comprovadoEm ? (
          <p className="text-sm text-zinc-700">
            Comprovado por um administrador desta empresa em {new Date(comprovadoEm).toLocaleString("pt-BR")}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!props.administrador || ocupado} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40" onClick={() => void salvarIdentificacao()}>
            Salvar identificação
          </button>
          <button type="button" disabled={!props.administrador || ocupado} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void registrarComprovacao()}>
            Registrar comprovação
          </button>
        </div>
      </section>
      <TefInstalacaoProducao
        administrador={props.administrador}
        credenciamentoComprovado={credenciamentoComprovado}
        pontoProducaoInstalado={consulta?.pontoProducaoInstalado === true}
        pendenciaFinanceira={consulta?.estado === "pendencia_financeira"}
        servidorDeclarado={servidorDeclarado}
        servidorValidado={servidorValidado}
        onServidorConfirmado={() => {
          setServidorDeclarado(true);
          setServidorValidado(true);
          void consultarSinais();
        }}
        onInstalacaoConcluida={async () => (await consultarSinais())?.pontoProducaoInstalado === true}
      />
      {consulta?.requisitosProducao ? (
        <ul className="space-y-1 text-sm text-zinc-700">
          {consulta.requisitosProducao.map((item) => (
            <li key={item.id}>{item.ok ? "Atendido" : "Pendente"}: {item.texto}</li>
          ))}
        </ul>
      ) : null}
      {!props.configurado ? <p className="text-sm text-zinc-600">Ainda não há configuração gravada para esta empresa. A produção permanece bloqueada.</p> : null}
      {!props.administrador ? <p className="text-sm text-zinc-600">Somente o administrador da empresa grava esta configuração.</p> : null}
      {aviso ? <p className="text-sm text-zinc-800">{aviso}</p> : null}
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
    </div>
  );
}
