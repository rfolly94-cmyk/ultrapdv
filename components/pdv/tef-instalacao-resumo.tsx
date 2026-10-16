"use client";

import { useEffect, useState } from "react";

import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { etapasInstalacaoComercial } from "@/lib/pdv/tef/assistente-instalacao";

type TerminalResumo = {
  codigo: string;
  dispositivoId: string;
};

export function TefInstalacaoResumo(props: {
  terminais: TerminalResumo[];
  credenciamentoOk: boolean;
  credenciamentoNecessario: boolean;
}) {
  const [connectorEncontrado, setConnectorEncontrado] = useState(false);
  const [dispositivoId, setDispositivoId] = useState("");

  useEffect(() => {
    let ativo = true;
    void descobrirUltraPdvConector().then((descoberta) => {
      if (!ativo) {
        return;
      }
      setConnectorEncontrado(descoberta.ok === true);
      setDispositivoId(descoberta.ok ? descoberta.saude.dispositivoId ?? "" : "");
    });
    return () => {
      ativo = false;
    };
  }, []);

  const terminalVinculado = props.terminais.some(
    (terminal) => terminal.dispositivoId && terminal.dispositivoId === dispositivoId
  );
  const etapas = etapasInstalacaoComercial({
    connectorEncontrado,
    terminalVinculado,
    credenciamentoNecessario: props.credenciamentoNecessario,
    credenciamentoOk: props.credenciamentoOk,
    pinpadVerificado: false,
    ambienteEfetivoConfirmado: false,
    pontoConfirmado: props.credenciamentoOk,
    servidorConfirmado: props.credenciamentoOk,
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-base font-semibold text-zinc-900">Instalação do TEF</h2>
      <p className="mt-1 text-sm text-zinc-500">
        A pasta de dados fica em ProgramData, separada dos executáveis. Não é preciso
        escolher diretório nem ajustar permissão manualmente.
      </p>
      <ol className="mt-4 space-y-3">
        {etapas.map((etapa) => (
          <li key={etapa.id} className="rounded-xl border border-zinc-200 px-3 py-2">
            <p className="text-sm font-semibold text-zinc-900">
              {etapa.concluida ? "Concluída" : "Pendente"} — {etapa.rotulo}
            </p>
            <p className="mt-1 text-sm text-zinc-600">{etapa.explicacao}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
