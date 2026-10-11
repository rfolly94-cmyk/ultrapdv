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

import {
  autorizarPareamentoEmpresa,
  concluirPareamentoEmpresa,
  revogarTerminalEmpresa,
  verificarComputadorTef,
} from "@/app/configuracoes/financeiro/tef/actions";

export function TefPareamentoForm(props: {
  empresaId: string;
  terminais: TerminalTefAtivo[];
  podeRevogar: boolean;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRevogacao, setConfirmarRevogacao] = useState(false);
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
            <dt className="text-zinc-500">Ponto de captura</dt>
            <dd className="font-medium">{terminal.pontoCaptura || terminal.codigo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Status</dt>
            <dd className="font-medium">
              {terminal.temPendencia ? "Ativo, com transação pendente" : "Ativo"}
            </dd>
          </div>
        </dl>
        {props.podeRevogar && terminal.temPendencia ? (
          <p className="text-sm text-zinc-600">
            Há transação pendente neste terminal. Resolva antes de revogar a chave.
          </p>
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
