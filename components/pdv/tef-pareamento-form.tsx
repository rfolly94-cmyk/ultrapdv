"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";
import {
  decidirSituacaoTerminalComputador,
  type SituacaoTerminalComputador,
  type TerminalTefAtivo,
} from "@/lib/pdv/tef/estado-terminal";
import { resultadoAposAutorizacao } from "@/lib/pdv/tef/recuperar-autorizacao";
import {
  avaliarProcessoAntesDeGravar,
  concluirSincronizacaoLocal,
  exigirIdentidadeFiscalDoStatus,
  lerRecusaVincular,
  lerVinculoDoStatus,
  mensagemVinculoConfirmado,
  montarCorpoVincular,
  rotuloCampoVinculo,
  type CampoVinculo,
  type VinculoAutorizado,
  type VinculoConfirmado,
} from "@/lib/pdv/tef/sincronizar-vinculo";

import {
  autorizarPareamentoEmpresa,
  concluirPareamentoEmpresa,
  diagnosticarRecuperacaoConnector,
  prepararSincronizacaoConnector,
  recuperarAutorizacaoConnector,
  revogarTerminalEmpresa,
  verificarComputadorTef,
} from "@/app/configuracoes/financeiro/tef/actions";

type DiagnosticoRecuperacao = {
  codigo: string;
  terminalId: string;
  pontoCaptura: string;
  chaveIdAutorizada: string;
  fingerprintAutorizada: string;
  chaveIdConnector: string;
  fingerprintConnector: string;
  conferem: boolean;
  pendencia: boolean;
  outraEmpresa: boolean;
  administrador: boolean;
};

export function TefPareamentoForm(props: {
  empresaId: string;
  terminais: TerminalTefAtivo[];
  podeRevogar: boolean;
  administrador?: boolean;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRevogacao, setConfirmarRevogacao] = useState(false);
  const [pedindoSincronizacao, setPedindoSincronizacao] = useState(false);
  const [codigoSincronizacao, setCodigoSincronizacao] = useState("");
  const [sincronizado, setSincronizado] = useState<VinculoConfirmado | null>(null);
  const [divergencias, setDivergencias] = useState<CampoVinculo[]>([]);
  const [pedindoRecuperacao, setPedindoRecuperacao] = useState(false);
  const [codigoRecuperacao, setCodigoRecuperacao] = useState("");
  const [perdaConfirmada, setPerdaConfirmada] = useState(false);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoRecuperacao | null>(null);
  const [situacao, setSituacao] = useState<SituacaoTerminalComputador | "consultando">(
    "consultando"
  );
  const [terminal, setTerminal] = useState<TerminalTefAtivo | null>(null);

  useEffect(() => {
    let ativo = true;
    setSituacao("consultando");
    setConfirmarRevogacao(false);
    void (async () => {
      const descoberta = await descobrirUltraPdvConector();
      if (!ativo) {
        return;
      }
      if (!descoberta.ok) {
        setSituacao("parear");
        setTerminal(null);
        setErro("O Connector não respondeu neste computador. Abra-o para confirmar o vínculo.");
        return;
      }
      let dispositivoId = descoberta.saude.dispositivoId ?? "";
      let vinculoEmpresaId: string | null = null;
      try {
        if (!dispositivoId) {
          const identidade = await fetch(`${descoberta.origem}/tef/identidade`, {
            cache: "no-store",
          });
          const corpo = (await identidade.json()) as { dispositivoId?: string };
          dispositivoId = corpo.dispositivoId ?? "";
        }
        const status = await fetch(`${descoberta.origem}/tef/status`, { cache: "no-store" });
        const corpo = (await status.json()) as {
          vinculo?: { vinculado?: boolean; empresaId?: string };
        };
        if (corpo.vinculo?.vinculado && corpo.vinculo.empresaId) {
          vinculoEmpresaId = corpo.vinculo.empresaId;
        }
      } catch {
        if (!ativo) {
          return;
        }
        setSituacao("parear");
        setTerminal(null);
        setErro("Não foi possível ler o vínculo deste computador.");
        return;
      }
      const destaEmpresa =
        props.terminais.find((item) => item.dispositivoId === dispositivoId) ?? null;
      let outraEmpresa = false;
      if (!destaEmpresa && dispositivoId) {
        try {
          const verificacao = await verificarComputadorTef(dispositivoId);
          outraEmpresa = verificacao.outraEmpresa === true;
        } catch (error) {
          if (!ativo) {
            return;
          }
          setErro(
            error instanceof Error ? error.message : "Não foi possível consultar o terminal."
          );
          setSituacao("parear");
          setTerminal(null);
          return;
        }
      }
      if (!ativo) {
        return;
      }
      const decisao = decidirSituacaoTerminalComputador({
        dispositivoId,
        empresaSessaoId: props.empresaId,
        vinculoLocalEmpresaId: vinculoEmpresaId,
        terminalDestaEmpresa: destaEmpresa,
        dispositivoDeOutraEmpresa: outraEmpresa,
      });
      setTerminal(decisao === "vinculado" ? destaEmpresa : null);
      setSituacao(decisao);
      setErro(null);
    })();
    return () => {
      ativo = false;
    };
  }, [props.empresaId, props.terminais]);

  async function autorizar() {
    setErro(null);
    setMensagem(null);
    setOcupado(true);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setErro(descoberta.erro);
        return;
      }
      await autorizarPareamentoEmpresa(codigo);
      const apresentacao = await fetch(`${descoberta.origem}/tef/pareamento/apresentar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim().toUpperCase() }),
      });
      const prova = (await apresentacao.json()) as {
        ok?: boolean;
        erro?: string;
        dispositivoId?: string;
        chavePublica?: string;
        chaveId?: string;
        assinaturaPareamento?: string;
      };
      if (!apresentacao.ok || prova.ok !== true) {
        setErro(prova.erro || "O Connector não reconheceu o código.");
        return;
      }
      const concluido = await concluirPareamentoEmpresa({
        codigo,
        dispositivoId: prova.dispositivoId ?? "",
        chavePublica: prova.chavePublica ?? "",
        chaveId: prova.chaveId ?? "",
        assinaturaPareamento: prova.assinaturaPareamento ?? "",
      });
      const servidorVinculo = validarServidorPayGo(concluido.servidor);
      const vinculo = await fetch(`${descoberta.origem}/tef/vincular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: codigo.trim().toUpperCase(),
          empresaId: concluido.empresaId,
          terminalCodigo: concluido.terminalCodigo,
          dispositivoId: concluido.dispositivoId,
          estabelecimento: concluido.estabelecimento,
          pontoCaptura: concluido.pontoCaptura,
          ...(concluido.terminalId ? { terminalId: concluido.terminalId } : {}),
          ...(concluido.ambiente === "homologacao" || concluido.ambiente === "producao"
            ? { ambiente: concluido.ambiente }
            : {}),
          ...(typeof concluido.cnpj === "string" && /^\d{14}$/.test(concluido.cnpj)
            ? { cnpj: concluido.cnpj }
            : {}),
          ...(servidorVinculo.ok ? { servidor: servidorVinculo.servidor } : {}),
        }),
      });
      const gravado = (await vinculo.json()) as { ok?: boolean; erro?: string };
      if (!vinculo.ok || gravado.ok !== true) {
        setErro(gravado.erro || "O terminal foi autorizado, mas o Connector local não gravou o vínculo.");
        return;
      }
      setMensagem(
        `Terminal ${concluido.terminalCodigo} autorizado para o estabelecimento ${concluido.estabelecimento}. O TEF continua desligado até você marcar a opção acima e a plataforma liberar.`
      );
      setCodigo("");
      router.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível autorizar o terminal.");
    } finally {
      setOcupado(false);
    }
  }

  async function lerStatusConnector(origem: string) {
    const resposta = await fetch(`${origem}/tef/status`, { cache: "no-store" });
    return (await resposta.json()) as {
      tef?: {
        processo?: string;
        inicializado?: boolean;
        transacaoPendenteConfirmacao?: boolean;
        reconciliacaoNecessaria?: boolean;
        agente?: { versao?: string };
      };
      vinculo?: {
        vinculado?: boolean;
        empresaId?: string;
        terminalCodigo?: string;
        pontoCaptura?: string;
        estabelecimento?: string;
        ambiente?: string;
        servidor?: string;
        cnpjInformado?: boolean;
      };
    };
  }

  async function lerGravacaoVincular(resposta: Response) {
    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      corpo = null;
    }
    return lerRecusaVincular(resposta.status, corpo);
  }

  async function sincronizar() {
    if (!terminal || terminal.temPendencia) {
      return;
    }
    setErro(null);
    setMensagem(null);
    setSincronizado(null);
    setDivergencias([]);
    setOcupado(true);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setErro(descoberta.erro);
        return;
      }
      const statusAtual = await lerStatusConnector(descoberta.origem);
      const transacaoPendenteConfirmacao = statusAtual.tef?.transacaoPendenteConfirmacao === true;
      const reconciliacaoNecessaria = statusAtual.tef?.reconciliacaoNecessaria === true;
      if (transacaoPendenteConfirmacao) {
        setErro("O Connector informa transação pendente. Resolva antes de sincronizar.");
        return;
      }
      if (reconciliacaoNecessaria) {
        setErro("O Connector informa reconciliação pendente. Resolva antes de sincronizar.");
        return;
      }
      const apresentacao = await fetch(`${descoberta.origem}/tef/pareamento/apresentar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigoSincronizacao.trim().toUpperCase() }),
      });
      const prova = (await apresentacao.json()) as {
        ok?: boolean;
        erro?: string;
        dispositivoId?: string;
        chavePublica?: string;
        assinaturaPareamento?: string;
      };
      if (!apresentacao.ok || prova.ok !== true) {
        setErro(prova.erro || "O Connector não reconheceu o código.");
        return;
      }
      const preparado = await prepararSincronizacaoConnector({
        codigo: codigoSincronizacao,
        dispositivoId: prova.dispositivoId ?? "",
        chavePublica: prova.chavePublica ?? "",
        assinaturaPareamento: prova.assinaturaPareamento ?? "",
      });
      if (preparado.efeito !== "sincronizar" || !preparado.vinculo) {
        setErro(preparado.motivo || "A sincronização foi recusada.");
        return;
      }
      const exigeFiscal = exigirIdentidadeFiscalDoStatus(statusAtual);
      const processo = avaliarProcessoAntesDeGravar({
        processo: {
          processo: statusAtual.tef?.processo ?? "",
          inicializado: statusAtual.tef?.inicializado === true,
          transacaoPendenteConfirmacao,
          reconciliacaoNecessaria,
        },
        vinculoLocal: lerVinculoDoStatus(statusAtual.vinculo),
        vinculoAutorizado: preparado.vinculo,
      });
      if (processo.efeito === "recusar") {
        setDivergencias(processo.divergencias);
        setErro(processo.motivo);
        return;
      }
      if (processo.efeito === "ja_sincronizado") {
        const confirmado = concluirSincronizacaoLocal({
          gravacaoOk: true,
          status: statusAtual,
          esperado: preparado.vinculo,
          exigirIdentidadeFiscal: exigeFiscal,
        });
        if (confirmado.efeito === "falhou") {
          setDivergencias(confirmado.divergencias);
          setErro(confirmado.motivo);
          return;
        }
        setDivergencias([]);
        setSincronizado(confirmado.gravado);
        setMensagem(mensagemVinculoConfirmado("ja_sincronizado", confirmado.gravado.identidadeFiscal));
        setPedindoSincronizacao(false);
        setCodigoSincronizacao("");
        return;
      }
      const gravacao = await fetch(`${descoberta.origem}/tef/vincular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          montarCorpoVincular(codigoSincronizacao, preparado.vinculo, {
            identidadeFiscal: exigeFiscal,
          })
        ),
      });
      const recusa = await lerGravacaoVincular(gravacao);
      let statusFinal: Awaited<ReturnType<typeof lerStatusConnector>> | null = null;
      try {
        statusFinal = await lerStatusConnector(descoberta.origem);
      } catch {
        statusFinal = null;
      }
      const confirmado = concluirSincronizacaoLocal({
        gravacaoOk: recusa.ok,
        recusa,
        status: statusFinal,
        esperado: preparado.vinculo,
        exigirIdentidadeFiscal: exigeFiscal || exigirIdentidadeFiscalDoStatus(statusFinal),
      });
      if (confirmado.efeito === "falhou") {
        setDivergencias(confirmado.divergencias);
        setErro(confirmado.motivo);
        return;
      }
      setDivergencias([]);
      setSincronizado(confirmado.gravado);
      setMensagem(mensagemVinculoConfirmado(confirmado.efeito, confirmado.gravado.identidadeFiscal));
      setPedindoSincronizacao(false);
      setCodigoSincronizacao("");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível sincronizar o Connector.");
    } finally {
      setOcupado(false);
    }
  }

  async function revogar() {
    if (!terminal || !props.podeRevogar || terminal.temPendencia) {
      return;
    }
    setErro(null);
    setMensagem(null);
    setOcupado(true);
    try {
      await revogarTerminalEmpresa(terminal.id);
      setMensagem(
        "Chave revogada. No Connector deste computador, gere uma nova chave e autorize o terminal outra vez."
      );
      setConfirmarRevogacao(false);
      router.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível revogar o terminal.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrirRecuperacao() {
    setErro(null);
    setMensagem(null);
    setDiagnostico(null);
    setPerdaConfirmada(false);
    setCodigoRecuperacao("");
    setPedindoRecuperacao(true);
    setOcupado(true);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setErro(descoberta.erro);
        setPedindoRecuperacao(false);
        return;
      }
      const identidade = await fetch(`${descoberta.origem}/tef/identidade`, { cache: "no-store" });
      const corpo = (await identidade.json()) as {
        dispositivoId?: string;
        chavePublica?: string;
        chaveId?: string;
        assinatura?: string;
      };
      if (!identidade.ok || !corpo.chavePublica || !corpo.assinatura) {
        setErro("O Connector não apresentou a identidade deste computador.");
        setPedindoRecuperacao(false);
        return;
      }
      const comparado = await diagnosticarRecuperacaoConnector({
        dispositivoId: corpo.dispositivoId ?? "",
        chavePublica: corpo.chavePublica,
        chaveId: corpo.chaveId ?? "",
        assinaturaIdentidade: corpo.assinatura,
      });
      setDiagnostico(comparado);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível comparar as chaves.");
      setPedindoRecuperacao(false);
    } finally {
      setOcupado(false);
    }
  }

  async function gravarVinculoLocal(
    origem: string,
    codigoPareamento: string,
    vinculo: VinculoAutorizado,
    statusAtual: Awaited<ReturnType<typeof lerStatusConnector>>
  ) {
    const exigeFiscal = exigirIdentidadeFiscalDoStatus(statusAtual);
    const processo = avaliarProcessoAntesDeGravar({
      processo: {
        processo: statusAtual.tef?.processo ?? "",
        inicializado: statusAtual.tef?.inicializado === true,
        transacaoPendenteConfirmacao: statusAtual.tef?.transacaoPendenteConfirmacao === true,
        reconciliacaoNecessaria: statusAtual.tef?.reconciliacaoNecessaria === true,
      },
      vinculoLocal: lerVinculoDoStatus(statusAtual.vinculo),
      vinculoAutorizado: vinculo,
    });
    if (processo.efeito === "recusar") {
      return { ok: false as const, motivo: processo.motivo, status: statusAtual };
    }
    if (processo.efeito === "ja_sincronizado") {
      const confirmado = concluirSincronizacaoLocal({
        gravacaoOk: true,
        status: statusAtual,
        esperado: vinculo,
        exigirIdentidadeFiscal: exigeFiscal,
      });
      return confirmado.efeito === "falhou"
        ? { ok: false as const, motivo: confirmado.motivo, status: statusAtual }
        : { ok: true as const, gravado: confirmado.gravado };
    }
    const gravacao = await fetch(`${origem}/tef/vincular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        montarCorpoVincular(codigoPareamento, vinculo, { identidadeFiscal: exigeFiscal })
      ),
    });
    const recusa = await lerGravacaoVincular(gravacao);
    let statusFinal: Awaited<ReturnType<typeof lerStatusConnector>> | null = null;
    try {
      statusFinal = await lerStatusConnector(origem);
    } catch {
      statusFinal = null;
    }
    const confirmado = concluirSincronizacaoLocal({
      gravacaoOk: recusa.ok,
      recusa,
      status: statusFinal,
      esperado: vinculo,
      exigirIdentidadeFiscal: exigeFiscal || exigirIdentidadeFiscalDoStatus(statusFinal),
    });
    if (confirmado.efeito === "falhou") {
      return { ok: false as const, motivo: confirmado.motivo, status: statusFinal };
    }
    return { ok: true as const, gravado: confirmado.gravado };
  }

  async function recuperar() {
    if (!props.administrador || !terminal || terminal.temPendencia || !diagnostico) {
      return;
    }
    setErro(null);
    setMensagem(null);
    setSincronizado(null);
    setOcupado(true);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        setErro(descoberta.erro);
        return;
      }
      const statusAtual = await lerStatusConnector(descoberta.origem);
      if (statusAtual.tef?.transacaoPendenteConfirmacao === true) {
        setErro("O Connector informa transação pendente. Resolva antes de recuperar a autorização.");
        return;
      }
      if (statusAtual.tef?.reconciliacaoNecessaria === true) {
        setErro("O Connector informa reconciliação pendente. Resolva antes de recuperar a autorização.");
        return;
      }
      const apresentacao = await fetch(`${descoberta.origem}/tef/pareamento/apresentar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigoRecuperacao.trim().toUpperCase() }),
      });
      const prova = (await apresentacao.json()) as {
        ok?: boolean;
        erro?: string;
        dispositivoId?: string;
        chavePublica?: string;
        chaveId?: string;
        assinaturaPareamento?: string;
      };
      if (!apresentacao.ok || prova.ok !== true) {
        setErro(prova.erro || "O Connector não reconheceu o código.");
        return;
      }
      const preparado = await recuperarAutorizacaoConnector({
        codigo: codigoRecuperacao,
        dispositivoId: prova.dispositivoId ?? "",
        chavePublica: prova.chavePublica ?? "",
        chaveId: prova.chaveId ?? "",
        assinaturaPareamento: prova.assinaturaPareamento ?? "",
        perdaConfirmada,
      });
      if (preparado.efeito === "recusar" || preparado.gerarChave || preparado.executaInstalacao) {
        setErro(preparado.motivo || "A recuperação foi recusada. Nenhuma chave nova foi gerada.");
        return;
      }
      const bancoAutorizado = preparado.efeito === "autorizada" || preparado.efeito === "ja_autorizada";
      if (!preparado.vinculo) {
        const pendencia = resultadoAposAutorizacao({
          bancoAutorizado,
          gravacaoLocalOk: false,
          statusConfere: false,
        });
        setErro(
          pendencia.efeito === "autorizada_sem_vinculo"
            ? `${preparado.motivo || "A autorização foi atualizada no banco."} O vínculo local ainda não foi gravado. Use Sincronizar Connector para repetir só essa gravação. Não gere outra chave.`
            : preparado.motivo || "A recuperação foi recusada. Nenhuma chave nova foi gerada."
        );
        if (pendencia.podeRepetirSincronizacao) {
          setPedindoRecuperacao(false);
          router.refresh();
        }
        return;
      }
      const local = await gravarVinculoLocal(
        descoberta.origem,
        codigoRecuperacao,
        preparado.vinculo,
        statusAtual
      );
      if (!local.ok) {
        const pendencia = resultadoAposAutorizacao({
          bancoAutorizado: true,
          gravacaoLocalOk: false,
          statusConfere: false,
        });
        setErro(
          pendencia.podeRepetirSincronizacao
            ? `A autorização deste computador foi atualizada, mas o vínculo local não foi confirmado. ${local.motivo} Use Sincronizar Connector para repetir só a sincronização. Não gere outra chave.`
            : local.motivo
        );
        setPedindoRecuperacao(false);
        router.refresh();
        return;
      }
      const concluida = resultadoAposAutorizacao({
        bancoAutorizado: true,
        gravacaoLocalOk: true,
        statusConfere: true,
      });
      if (concluida.gerarChave) {
        setErro("A recuperação não pode gerar outra chave.");
        return;
      }
      setSincronizado(local.gravado);
      setMensagem(
        preparado.efeito === "ja_autorizada"
          ? "A chave atual já estava autorizada. O status do Connector confirma o vínculo oficial. Nenhuma venda foi ativada."
          : "Autorização deste computador recuperada no mesmo terminal. O status do Connector confirma o vínculo oficial. Nenhuma venda foi ativada."
      );
      setPedindoRecuperacao(false);
      setCodigoRecuperacao("");
      setPerdaConfirmada(false);
      router.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível recuperar a autorização.");
    } finally {
      setOcupado(false);
    }
  }

  if (situacao === "consultando") {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-sm text-zinc-500">Consultando o terminal deste computador...</p>
      </section>
    );
  }

  if (situacao === "outra_empresa") {
    return (
      <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-zinc-950">Terminal de outra empresa</h2>
        <p className="text-sm text-zinc-700">
          Este computador já está vinculado a outra empresa. Ele não pode ser pareado,
          consultado nem revogado por aqui.
        </p>
        {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
      </section>
    );
  }

  if (situacao === "vinculado" && terminal) {
    return (
      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-950">Terminal vinculado</h2>
        <dl className="space-y-2 text-sm text-zinc-800">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Estabelecimento</dt>
            <dd className="font-medium">{terminal.estabelecimento || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Código lógico</dt>
            <dd className="font-medium">{terminal.codigo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Ponto de captura</dt>
            <dd className="font-medium">{terminal.pontoCaptura || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Status</dt>
            <dd className="font-medium">
              {terminal.temPendencia ? "Ativo, com transação pendente" : "Ativo"}
            </dd>
          </div>
        </dl>
        {terminal.temPendencia ? (
          <p className="text-sm text-zinc-600">
            Há transação pendente neste terminal. Resolva antes de revogar a chave,
            sincronizar o Connector ou recuperar a autorização.
          </p>
        ) : null}
        {!terminal.temPendencia && !pedindoSincronizacao && !pedindoRecuperacao ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setErro(null);
                setPedindoSincronizacao(true);
              }}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-50"
            >
              Sincronizar Connector
            </button>
            {props.administrador ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void abrirRecuperacao()}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-50"
              >
                Recuperar autorização deste computador
              </button>
            ) : null}
          </div>
        ) : null}
        {!terminal.temPendencia && pedindoSincronizacao ? (
          <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm text-zinc-700">
              Cole o código exibido no Connector deste computador. A sincronização regrava
              só o vínculo local, com o código lógico, o ponto, o ambiente, o servidor e o
              CNPJ oficiais desta empresa. Não reinstala o PayGoWeb, não revoga a chave e
              não ativa vendas.
            </p>
            <label className="block text-sm font-medium text-zinc-800">
              Código do Connector
              <input
                value={codigoSincronizacao}
                onChange={(event) => setCodigoSincronizacao(event.target.value.toUpperCase())}
                maxLength={10}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 tracking-[0.3em]"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={ocupado || codigoSincronizacao.trim().length !== 10}
                onClick={() => void sincronizar()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmar sincronização
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => {
                  setPedindoSincronizacao(false);
                  setCodigoSincronizacao("");
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        {props.administrador && !terminal.temPendencia && pedindoRecuperacao ? (
          <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm text-zinc-700">
              Use esta ação quando a chave privada autorizada foi perdida e o Connector
              ainda tem a chave atual. Ela autoriza essa chave no mesmo terminal e depois
              sincroniza só o arquivo local. Não gera outra chave, não reinstala o PayGoWeb
              e não ativa vendas.
            </p>
            {diagnostico ? (
              <dl className="space-y-2 text-sm text-zinc-800">
                <div>
                  <dt className="text-zinc-500">Terminal</dt>
                  <dd className="break-all font-medium">
                    {diagnostico.codigo || "—"} · ponto {diagnostico.pontoCaptura || "—"}
                    <span className="mt-1 block font-mono text-xs">{diagnostico.terminalId || "—"}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Chave autorizada</dt>
                  <dd className="break-all font-mono text-xs">
                    {diagnostico.chaveIdAutorizada || "—"}
                    <span className="mt-1 block">{diagnostico.fingerprintAutorizada || "—"}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Chave atual do Connector</dt>
                  <dd className="break-all font-mono text-xs">
                    {diagnostico.chaveIdConnector || "—"}
                    <span className="mt-1 block">{diagnostico.fingerprintConnector || "—"}</span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">Comparando as chaves públicas...</p>
            )}
            {diagnostico?.conferem ? (
              <p className="text-sm text-zinc-700">
                A chave atual já é a autorizada. Confirmar só repete a sincronização local.
              </p>
            ) : null}
            {diagnostico && !diagnostico.conferem ? (
              <label className="flex items-start gap-2 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={perdaConfirmada}
                  onChange={(evento) => setPerdaConfirmada(evento.target.checked)}
                />
                Confirmo que a chave privada anterior foi perdida e que a chave atual do
                Connector deve passar a autorizar este terminal.
              </label>
            ) : null}
            <label className="block text-sm font-medium text-zinc-800">
              Código do Connector
              <input
                value={codigoRecuperacao}
                onChange={(event) => setCodigoRecuperacao(event.target.value.toUpperCase())}
                maxLength={10}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 tracking-[0.3em]"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  ocupado ||
                  !diagnostico ||
                  diagnostico.pendencia ||
                  diagnostico.outraEmpresa ||
                  !diagnostico.fingerprintConnector ||
                  codigoRecuperacao.trim().length !== 10 ||
                  (!diagnostico.conferem && !perdaConfirmada)
                }
                onClick={() => void recuperar()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmar recuperação
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => {
                  setPedindoRecuperacao(false);
                  setCodigoRecuperacao("");
                  setPerdaConfirmada(false);
                  setDiagnostico(null);
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        {sincronizado ? (
          <dl className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Código no Connector</dt>
              <dd className="font-medium">{sincronizado.terminalCodigo}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Ponto no Connector</dt>
              <dd className="font-medium">{sincronizado.pontoCaptura}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Processo TEF</dt>
              <dd className="font-medium">{sincronizado.processo || "—"}</dd>
            </div>
            {sincronizado.identidadeFiscal ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Ambiente no Connector</dt>
                  <dd className="font-medium">{sincronizado.ambiente === "producao" ? "Produção" : "Homologação"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Servidor no Connector</dt>
                  <dd className="font-medium">{sincronizado.servidor}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">CNPJ no Connector</dt>
                  <dd className="font-medium">{sincronizado.cnpjInformado ? "informado" : "ausente"}</dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}
        {divergencias.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
            {divergencias.map((campo) => (
              <li key={campo}>{rotuloCampoVinculo(campo)} ainda diverge do cadastro oficial.</li>
            ))}
          </ul>
        ) : null}
        {props.podeRevogar && !terminal.temPendencia && !confirmarRevogacao ? (
          <button
            type="button"
            onClick={() => setConfirmarRevogacao(true)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800"
          >
            Revogar terminal
          </button>
        ) : null}
        {props.podeRevogar && !terminal.temPendencia && confirmarRevogacao ? (
          <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm text-zinc-800">
              Revogar este terminal? A chave deste computador deixa de autorizar a empresa
              e será preciso parear de novo.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void revogar()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmar revogação
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => setConfirmarRevogacao(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        {mensagem ? <p className="text-sm text-emerald-700">{mensagem}</p> : null}
        {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-950">Autorizar este computador</h2>
      <p className="text-sm text-zinc-500">
        Abra o UltraPDV Connector neste computador e copie o código exibido só na tela local.
        Outra página não consegue ler esse código. A autorização vale para o estabelecimento
        salvo acima e não liga o TEF.
      </p>
      <label className="block text-sm font-medium text-zinc-800">
        Código do Connector
        <input
          value={codigo}
          onChange={(event) => setCodigo(event.target.value.toUpperCase())}
          maxLength={10}
          autoComplete="off"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 tracking-[0.3em]"
        />
      </label>
      <button
        type="button"
        disabled={ocupado || codigo.trim().length !== 10}
        onClick={() => void autorizar()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Autorizar terminal
      </button>
      {mensagem ? <p className="text-sm text-emerald-700">{mensagem}</p> : null}
      {erro ? <p className="text-sm text-red-700">{erro}</p> : null}
    </section>
  );
}
