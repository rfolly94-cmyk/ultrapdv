"use client";

import { useState } from "react";

import { validarConfiguracaoTef } from "@/app/configuracoes/financeiro/tef/actions";
import { PageAlert } from "@/components/ui/page-alert";
import {
  camposAoSelecionarAmbiente,
  descreverFormularioPayGo,
  type AmbientePayGo,
  type EstadoConfiguracaoPayGo,
} from "@/lib/pdv/tef/configuracao-paygo";
import { comporServidorPayGo, separarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export function TefPaygoIntegradoForm(props: {
  action: (formData: FormData) => void | Promise<void>;
  estado: EstadoConfiguracaoPayGo;
  operacaoManualDisponivel: boolean;
}) {
  const descricao = descreverFormularioPayGo(props.estado);
  const [ambiente, setAmbiente] = useState<AmbientePayGo>(descricao.ambiente);
  const [host, setHost] = useState(descricao.host);
  const [porta, setPorta] = useState(descricao.porta);
  const [cnpjHomologacao, setCnpjHomologacao] = useState(props.estado.cnpjInstalacao);
  const [cnpjProducao, setCnpjProducao] = useState(props.estado.cnpjProducao);
  const cnpj = ambiente === "producao" ? cnpjProducao : cnpjHomologacao;
  const [ponto, setPonto] = useState(descricao.pontoCaptura);
  const [estabelecimento, setEstabelecimento] = useState(descricao.estabelecimento);
  const [validacao, setValidacao] = useState<{ ok: boolean; mensagens: string[] } | null>(null);
  const [validando, setValidando] = useState(false);
  const confirmada =
    ambiente === "producao"
      ? props.estado.instalacaoProducaoConfirmada
      : props.estado.instalacaoHomologacaoConfirmada;
  const travado = confirmada;

  function trocarAmbiente(proximo: AmbientePayGo) {
    const campos = camposAoSelecionarAmbiente(props.estado, proximo);
    setAmbiente(proximo);
    setHost(campos.host);
    setPorta(campos.porta);
    setPonto(proximo === "producao" ? props.estado.pontoCaptura : props.estado.pontoHomologacao);
    setValidacao(null);
  }

  async function validar() {
    setValidando(true);
    const dados = new FormData();
    dados.set("ambiente", ambiente);
    dados.set("habilitado", "on");
    dados.set("estabelecimento", estabelecimento);
    dados.set("cnpjInstalacao", cnpj);
    dados.set("pontoCaptura", ponto);
    dados.set("servidorHost", host);
    dados.set("servidorPorta", porta);
    const resultado = await validarConfiguracaoTef(dados);
    setValidacao(resultado);
    setValidando(false);
  }

  return (
    <form action={props.action} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">PayGo Integrado</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Homologação usa ENVRMNT_TEST. Produção usa ENVRMNT_PROD. O ponto de um ambiente não substitui o do outro. A validação não instala nem transaciona.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
        <input type="checkbox" name="habilitado" defaultChecked={descricao.habilitado} />
        Habilitar TEF
      </label>
      <label className="block text-sm font-medium text-zinc-800">
        Ambiente
        <select
          name="ambiente"
          value={ambiente}
          onChange={(evento) =>
            trocarAmbiente(evento.target.value === "producao" ? "producao" : "homologacao")
          }
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
        >
          <option value="homologacao">Homologação</option>
          <option value="producao">Produção</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-zinc-800">
        Estabelecimento
        <input
          name="estabelecimento"
          value={estabelecimento}
          onChange={(evento) => setEstabelecimento(evento.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm font-medium text-zinc-800">
        CNPJ de instalação
        <input
          name="cnpjInstalacao"
          inputMode="numeric"
          autoComplete="off"
          value={cnpj}
          onChange={(evento) => {
            const valor = evento.target.value;
            if (ambiente === "producao") setCnpjProducao(valor);
            else setCnpjHomologacao(valor);
          }}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex items-start gap-2 text-sm font-medium text-zinc-800">
        <input
          type="checkbox"
          name="permitir_operacao_manual"
          defaultChecked={props.estado.permitirOperacaoManual}
          disabled={!props.operacaoManualDisponivel}
          className="mt-1"
        />
        <span>
          Autorizar operação manual de cartão
          <span className="mt-1 block text-xs font-normal text-zinc-500">
            Sem esta autorização, o PDV não conclui cartão quando a plataforma
            estiver desligada. Com ela, cada venda manual precisa ser confirmada
            no caixa. A NFC-e continua exigindo os dados reais da transação.
          </span>
        </span>
      </label>
      {props.operacaoManualDisponivel ? (
        <input type="hidden" name="permitir_operacao_manual_informada" value="1" />
      ) : (
        <p className="text-xs text-zinc-500">
          A autorização de cartão manual ainda não está disponível neste ambiente.
          Enquanto isso, cartão fica bloqueado se o TEF da empresa estiver ligado
          e a plataforma desligada.
        </p>
      )}
      <label className="block text-sm font-medium text-zinc-800">
        Ponto de captura
        <input
          name="pontoCaptura"
          value={ponto}
          readOnly={travado}
          autoComplete="off"
          onChange={(evento) => setPonto(evento.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 read-only:bg-zinc-50"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="block text-sm font-medium text-zinc-800">
          Servidor PayGo
          <input
            name="servidorHost"
            value={host}
            readOnly={travado}
            autoComplete="off"
            onChange={(evento) => {
              const valor = evento.target.value;
              const composto = comporServidorPayGo(valor, "");
              if (composto.ok && valor.includes(":")) {
                const partes = separarServidorPayGo(composto.servidor);
                setHost(partes.host);
                setPorta(partes.porta);
                return;
              }
              setHost(valor);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 read-only:bg-zinc-50"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          Porta
          <input
            name="servidorPorta"
            inputMode="numeric"
            value={porta}
            readOnly={travado}
            autoComplete="off"
            onChange={(evento) => setPorta(evento.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 read-only:bg-zinc-50"
          />
        </label>
      </div>
      {travado ? <p className="text-sm text-zinc-600">{descricao.avisoAssociacao}</p> : null}
      {validacao ? (
        <PageAlert type={validacao.ok ? "sucesso" : "erro"}>
          {validacao.mensagens.join(" ")}
        </PageAlert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => void validar()}
          disabled={validando}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60"
        >
          Validar configuração
        </button>
      </div>
    </form>
  );
}
