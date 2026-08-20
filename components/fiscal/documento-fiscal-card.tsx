"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  Copy,
  FileCheck,
  FileText,
  FileWarning,
  KeyRound,
  LoaderCircle,
  Shield,
  ShieldAlert,
} from "lucide-react";

import type { TomVisualDocumentoFiscal } from "@/lib/fiscal/tom-visual-emissao";
import { tituloVisualDocumentoFiscal } from "@/lib/fiscal/tom-visual-emissao";

const VISUAL: Record<
  TomVisualDocumentoFiscal,
  {
    card: string;
    iconWrap: string;
    selo: string;
    titulo: string;
    texto: string;
    campo: string;
    badgeStatus: string;
    Icon: typeof FileCheck;
    Marca: typeof Shield;
  }
> = {
  autorizada: {
    card: "border-emerald-200 bg-emerald-50",
    iconWrap: "bg-emerald-600 text-white",
    selo: "text-emerald-700",
    titulo: "text-emerald-800",
    texto: "text-emerald-900",
    campo: "text-emerald-950",
    badgeStatus: "border-emerald-200 bg-emerald-100 text-emerald-800",
    Icon: FileCheck,
    Marca: Shield,
  },
  cancelada: {
    card: "border-rose-200 bg-rose-50",
    iconWrap: "bg-rose-600 text-white",
    selo: "text-rose-700",
    titulo: "text-rose-800",
    texto: "text-rose-900",
    campo: "text-rose-950",
    badgeStatus: "border-rose-200 bg-rose-100 text-rose-800",
    Icon: Ban,
    Marca: Ban,
  },
  ambigua: {
    card: "border-amber-200 bg-amber-50",
    iconWrap: "bg-amber-600 text-white",
    selo: "text-amber-700",
    titulo: "text-amber-900",
    texto: "text-amber-950",
    campo: "text-amber-950",
    badgeStatus: "border-amber-200 bg-amber-100 text-amber-900",
    Icon: AlertTriangle,
    Marca: AlertTriangle,
  },
  processando: {
    card: "border-sky-200 bg-sky-50",
    iconWrap: "bg-sky-600 text-white",
    selo: "text-sky-700",
    titulo: "text-sky-900",
    texto: "text-sky-950",
    campo: "text-sky-950",
    badgeStatus: "border-sky-200 bg-sky-100 text-sky-800",
    Icon: LoaderCircle,
    Marca: LoaderCircle,
  },
  rejeitada: {
    card: "border-red-200 bg-red-50",
    iconWrap: "bg-red-600 text-white",
    selo: "text-red-700",
    titulo: "text-red-800",
    texto: "text-red-900",
    campo: "text-red-950",
    badgeStatus: "border-red-200 bg-red-100 text-red-800",
    Icon: FileWarning,
    Marca: FileWarning,
  },
  alerta: {
    card: "border-orange-200 bg-orange-50",
    iconWrap: "bg-orange-600 text-white",
    selo: "text-orange-800",
    titulo: "text-orange-900",
    texto: "text-orange-950",
    campo: "text-orange-950",
    badgeStatus: "border-orange-200 bg-orange-100 text-orange-900",
    Icon: ShieldAlert,
    Marca: ShieldAlert,
  },
  neutro: {
    card: "border-zinc-200 bg-zinc-50",
    iconWrap: "bg-zinc-700 text-white",
    selo: "text-zinc-600",
    titulo: "text-zinc-900",
    texto: "text-zinc-700",
    campo: "text-zinc-950",
    badgeStatus: "border-zinc-200 bg-white text-zinc-700",
    Icon: FileText,
    Marca: FileText,
  },
};

function textoStatus(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return valor.replace(/_/g, " ");
}

function CopiarChave({ chave, classe }: { chave: string; classe: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      type="button"
      title={copiado ? "Copiada" : "Copiar chave de acesso"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(chave);
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1600);
        } catch {
          setCopiado(false);
        }
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/20 bg-white/70 ${classe}`}
    >
      <Copy className="h-3.5 w-3.5" />
      <span className="sr-only">{copiado ? "Chave copiada" : "Copiar chave"}</span>
    </button>
  );
}

export function DocumentoFiscalCard({
  documento,
  serie,
  numero,
  status,
  titulo,
  descricao,
  cstat,
  protocolo,
  chaveAcesso,
  motivo,
  dataRelevante,
  rotuloData,
  tom,
  acoes,
  extras,
}: {
  documento: string;
  serie: number | string;
  numero: number | string;
  status: string;
  titulo: string;
  descricao?: string | null;
  cstat?: string | null;
  protocolo?: string | null;
  chaveAcesso?: string | null;
  motivo?: string | null;
  dataRelevante?: string | null;
  rotuloData?: string | null;
  tom: TomVisualDocumentoFiscal;
  acoes?: ReactNode;
  extras?: ReactNode;
}) {
  const visual = VISUAL[tom];
  const Icone = visual.Icon;
  const Marca = visual.Marca;
  const tituloExibido = tituloVisualDocumentoFiscal(titulo);
  const mostrarMotivo =
    Boolean(motivo) &&
    (tom === "rejeitada" ||
      tom === "alerta" ||
      tom === "ambigua" ||
      tom === "processando" ||
      tom === "cancelada");

  return (
    <section
      className={`relative overflow-hidden rounded-xl border px-4 py-4 sm:px-5 ${visual.card}`}
    >
      <Marca
        aria-hidden
        className={`pointer-events-none absolute -right-8 -top-6 h-44 w-44 opacity-[0.07] ${visual.titulo}`}
      />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${visual.iconWrap}`}
            >
              <Icone className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p
                className={`text-[11px] font-semibold uppercase tracking-wide ${visual.selo}`}
              >
                Documento fiscal
              </p>
              <h2 className={`mt-0.5 text-xl font-semibold tracking-tight ${visual.titulo}`}>
                {tituloExibido}
              </h2>
              <p className={`mt-1 text-[13px] ${visual.texto}`}>
                {documento} série {serie} • nº {numero}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium ${visual.badgeStatus}`}
                >
                  Status: {textoStatus(status)}
                </span>
                {cstat ? (
                  <span className="text-[11px] font-medium text-zinc-500">
                    cStat {cstat}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {descricao ? (
            <p className={`mt-3 max-w-3xl text-[13px] leading-5 ${visual.texto}`}>
              {descricao}
            </p>
          ) : null}

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {protocolo ? (
              <div>
                <dt className={`flex items-center gap-1.5 text-[11px] ${visual.selo}`}>
                  <Shield className="h-3.5 w-3.5" />
                  Protocolo
                </dt>
                <dd className={`mt-0.5 break-all text-[13px] font-medium ${visual.campo}`}>
                  {protocolo}
                </dd>
              </div>
            ) : null}

            {dataRelevante ? (
              <div>
                <dt className={`flex items-center gap-1.5 text-[11px] ${visual.selo}`}>
                  <Calendar className="h-3.5 w-3.5" />
                  {rotuloData || "Data"}
                </dt>
                <dd className={`mt-0.5 text-[13px] font-medium ${visual.campo}`}>
                  {dataRelevante}
                </dd>
              </div>
            ) : null}

            {chaveAcesso ? (
              <div className="sm:col-span-2 xl:col-span-1">
                <dt className={`flex items-center gap-1.5 text-[11px] ${visual.selo}`}>
                  <KeyRound className="h-3.5 w-3.5" />
                  Chave de acesso
                </dt>
                <dd className="mt-0.5 flex items-start gap-1.5">
                  <span
                    className={`break-all text-[12px] font-medium leading-5 ${visual.campo}`}
                  >
                    {chaveAcesso}
                  </span>
                  <CopiarChave chave={chaveAcesso} classe={visual.selo} />
                </dd>
              </div>
            ) : null}
          </dl>

          {mostrarMotivo ? (
            <p className={`mt-3 max-w-3xl text-[13px] leading-5 ${visual.texto}`}>
              {motivo}
            </p>
          ) : null}
        </div>

        {acoes ? (
          <div className="flex w-full min-w-fit flex-col gap-2 lg:w-[240px] lg:shrink-0 [&_button]:w-full [&_a]:w-full">
            <p
              className={`text-[11px] font-semibold uppercase tracking-wide ${visual.selo}`}
            >
              Ações fiscais
            </p>
            {acoes}
          </div>
        ) : null}
      </div>

      {extras ? <div className="relative mt-4 space-y-3">{extras}</div> : null}
    </section>
  );
}
