"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function NfeCampo({
  label,
  children,
  className = "",
  ajuda,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  ajuda?: string;
}) {
  return (
    <label className={`nfe-campo ${className}`.trim()}>
      <span className="nfe-label">{label}</span>
      {children}
      {ajuda ? <span className="nfe-campo-ajuda">{ajuda}</span> : null}
    </label>
  );
}

export function NfeSecao({
  titulo,
  extra,
  children,
  className = "",
}: {
  titulo: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`nfe-secao ${className}`.trim()}>
      <div className="nfe-secao-cab">
        <h2 className="nfe-secao-titulo">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function NfeRecolhivel({
  titulo,
  abertoInicial = false,
  extra,
  children,
  manterMontado = false,
  className = "",
}: {
  titulo: string;
  abertoInicial?: boolean;
  extra?: ReactNode;
  children: ReactNode;
  manterMontado?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  return (
    <section className={`nfe-secao ${className}`.trim()}>
      <div className="nfe-secao-cab">
        <button
          type="button"
          className="nfe-secao-titulo nfe-recolher"
          onClick={() => setAberto((valor) => !valor)}
        >
          {titulo}
          <span className="nfe-recolher-seta">{aberto ? "▾" : "▸"}</span>
        </button>
        {extra}
      </div>
      {aberto || manterMontado ? (
        <div className={aberto ? undefined : "hidden"}>{children}</div>
      ) : null}
    </section>
  );
}

export const nfeInput = "updv-input nfe-input w-full";
export const nfeSelect = "updv-select nfe-input w-full";
export const nfeSomenteLeitura = `${nfeInput} nfe-somente-leitura`;
