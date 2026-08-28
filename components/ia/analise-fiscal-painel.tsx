"use client";

import type { ReactNode } from "react";
import type { ResultadoClassificacaoFiscal } from "@/lib/fiscal/motor/tipos";

function texto(valor: unknown) {
  const t = String(valor ?? "").trim();
  return t || "—";
}

function cestRotulo(cest: ResultadoClassificacaoFiscal["cest"]) {
  if (!cest) {
    return "—";
  }
  if (Array.isArray(cest)) {
    return cest.map((item) => item.codigo).join(", ") || "—";
  }
  return cest.codigo;
}

export function AnaliseFiscalPainel({
  resultado,
  onConversar,
}: {
  resultado: ResultadoClassificacaoFiscal;
  onConversar: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Análise fiscal
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            Confiança {resultado.confianca}: {resultado.motivoConfianca}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
            {resultado.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Bloco titulo="Empresa">
          <Linha
            label="Regime/CRT"
            valor={
              resultado.empresa.regime
                ? `${resultado.empresa.regime}${resultado.empresa.uf ? ` / ${resultado.empresa.uf}` : ""}`
                : "Contexto incompleto"
            }
          />
        </Bloco>
        <Bloco titulo="Produto">
          <Linha
            label="Origem"
            valor={resultado.origem.descricao ?? resultado.origem.motivo}
          />
        </Bloco>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Bloco titulo="Fiscal atual × sugestão">
          {resultado.diferencas.length === 0 ? (
            <p className="text-sm text-zinc-600">
              Sem diferença sugerida com evidência suficiente.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-zinc-700">
              {resultado.diferencas.map((item) => (
                <li key={item.campo}>
                  {item.rotulo}: {texto(item.atual)} → {texto(item.sugerido)}
                </li>
              ))}
            </ul>
          )}
        </Bloco>
        <Bloco titulo="Sugestão">
          <Linha label="NCM" valor={texto(resultado.ncmSugerido?.codigo)} />
          <Linha label="CEST" valor={cestRotulo(resultado.cest)} />
          <Linha label="Origem" valor={texto(resultado.origem.codigo)} />
          <Linha
            label="CST IBS/CBS"
            valor={texto(resultado.classificacaoIbsCbs.cst)}
          />
          <Linha
            label="cClassTrib"
            valor={texto(resultado.classificacaoIbsCbs.cClassTrib)}
          />
          <Linha
            label="Grupo fiscal"
            valor={
              resultado.grupoFiscalRecomendado?.nome ??
              "Nenhum grupo fiscal existente possui compatibilidade suficiente com esta classificação."
            }
          />
        </Bloco>
      </div>

      {resultado.informacoesFaltantes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Informações faltantes</p>
          <ul className="mt-1 list-disc pl-5">
            {resultado.informacoesFaltantes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-sm text-zinc-600">{resultado.justificativa}</p>
      <p className="mt-2 text-xs text-zinc-500">
        Fontes:{" "}
        {resultado.fontes
          .map((item) => `${item.codigo} ${item.versao}`)
          .join(" · ") || "—"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Nada foi aplicado ao cadastro nesta fase.
      </p>

      <button
        type="button"
        className="updv-btn updv-btn-secondary mt-4"
        onClick={onConversar}
      >
        Conversar sobre esta análise
      </button>
    </div>
  );
}

function Bloco({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {titulo}
      </p>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <p className="text-sm text-zinc-700">
      <span className="font-medium">{label}:</span> {valor}
    </p>
  );
}
