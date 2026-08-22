"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";

type Props = {
  emissaoId: string;
  serie:
    | number
    | string;
  numero:
    | number
    | string;
  proximaSequencia: number;
  ultimoTexto?:
    | string
    | null;
};

type Resposta = {
  ok?: boolean;
  erro?: string;
  carta_correcao?:
    boolean;
  evento_id?: string;
  sequencia?: number;
  cstat?:
    string
    | null;
  protocolo?:
    string
    | null;
  mensagem?: string;
};

export function CartaCorrecaoNfe({
  emissaoId,
  serie,
  numero,
  proximaSequencia,
  ultimoTexto,
}: Props) {
  const router =
    useRouter();
  const cceLiberada = useRecursoLiberado("cce");

  const [
    aberto,
    setAberto,
  ] =
    useState(false);

  const [
    textoCorrecao,
    setTextoCorrecao,
  ] =
    useState(
      ultimoTexto ??
      ""
    );

  const [
    enviando,
    setEnviando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const [
    sucesso,
    setSucesso,
  ] =
    useState(false);

  const limiteAtingido =
    proximaSequencia >
    20;

  async function registrar() {
    const texto =
      textoCorrecao
        .trim();

    if (
      texto.length <
      15
    ) {
      setSucesso(false);
      setMensagem(
        "A correção deve possuir pelo menos 15 caracteres."
      );
      return;
    }

    if (
      texto.length >
      1000
    ) {
      setSucesso(false);
      setMensagem(
        "A correção deve possuir no máximo 1000 caracteres."
      );
      return;
    }

    if (
      limiteAtingido
    ) {
      setSucesso(false);
      setMensagem(
        "A NF-e já atingiu o limite de 20 Cartas de Correção."
      );
      return;
    }

    const confirmou =
      window.confirm(
        `Registrar a Carta de Correção nº ${proximaSequencia} para a NF-e ${serie}/${numero}?\n\nUma nova CC-e substitui a anterior. O texto enviado deve conter TODAS as correções que devem permanecer válidas.`
      );

    if (!confirmou) {
      return;
    }

    setEnviando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          `/api/fiscal/emissoes/${emissaoId}/carta-correcao`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                confirmar:
                  "REGISTRAR_CARTA_CORRECAO",
                texto_correcao:
                  texto,
              }),
          }
        );

      const payload =
        (
          await response.json()
        ) as Resposta;

      if (
        !response.ok ||
        !payload.ok
      ) {
        setSucesso(false);
        setMensagem(
          payload.erro ??
          "Não foi possível registrar a Carta de Correção."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        `CC-e nº ${payload.sequencia ?? proximaSequencia} registrada com sucesso.${payload.protocolo ? ` Protocolo: ${payload.protocolo}.` : ""}`
      );

      setAberto(false);
      router.refresh();
    } catch (
      error
    ) {
      setSucesso(false);
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada ao registrar a Carta de Correção."
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!cceLiberada) {
    return null;
  }

  if (!aberto) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            setMensagem(null);
            setSucesso(false);
            setTextoCorrecao(
              ultimoTexto ??
              ""
            );
          }}
          disabled={
            limiteAtingido
          }
          className="inline-flex h-10 items-center justify-center rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Carta de Correção
        </button>

        {limiteAtingido && (
          <p className="max-w-md text-xs text-red-700">
            Limite de 20 CC-e atingido.
          </p>
        )}

        {mensagem && (
          <p
            className={[
              "max-w-xl text-sm",
              sucesso
                ? "text-emerald-700"
                : "text-red-700",
            ].join(" ")}
          >
            {mensagem}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-xl border border-blue-200 bg-blue-50 p-4 text-left">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Carta de Correção eletrônica
        </p>

        <h3 className="font-semibold text-blue-950">
          NF-e série {serie} · nº {numero}
        </h3>

        <p className="text-sm text-blue-800">
          Próxima sequência:{" "}
          <strong>
            {proximaSequencia}
          </strong>
          {" "}de 20.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <strong>
          Importante:
        </strong>{" "}
        uma nova CC-e substitui a anterior. Se já existe uma CC-e, o campo abaixo foi preenchido com o último texto autorizado. Mantenha no novo texto todas as correções que ainda devem valer.
      </div>

      <div className="mt-3 rounded-xl border border-red-200 bg-white p-3 text-xs leading-5 text-red-800">
        A CC-e não deve ser usada para corrigir valores que alterem imposto, trocar remetente/destinatário ou alterar data de emissão/saída. Nesses casos, revise o procedimento fiscal adequado.
      </div>

      <label className="mt-4 block">
        <span className="text-sm font-semibold text-blue-950">
          Texto consolidado da correção
        </span>

        <textarea
          value={
            textoCorrecao
          }
          onChange={(
            event
          ) =>
            setTextoCorrecao(
              event
                .target
                .value
            )
          }
          rows={8}
          minLength={15}
          maxLength={1000}
          placeholder="Descreva objetivamente a correção..."
          className="mt-2 w-full rounded-xl border border-blue-200 bg-white px-3 py-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
        />

        <div className="mt-1 flex justify-between gap-3 text-xs text-zinc-500">
          <span>
            Mínimo 15 caracteres.
          </span>
          <span>
            {textoCorrecao.trim().length}/1000
          </span>
        </div>
      </label>

      {mensagem && (
        <p
          className={[
            "mt-3 text-sm",
            sucesso
              ? "text-emerald-700"
              : "text-red-700",
          ].join(" ")}
        >
          {mensagem}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            enviando ||
            textoCorrecao
              .trim()
              .length <
              15 ||
            textoCorrecao
              .trim()
              .length >
              1000
          }
          onClick={
            registrar
          }
          className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando
            ? "Enviando CC-e..."
            : `Registrar CC-e nº ${proximaSequencia}`}
        </button>

        <button
          type="button"
          disabled={
            enviando
          }
          onClick={() => {
            setAberto(false);
            setMensagem(null);
          }}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
