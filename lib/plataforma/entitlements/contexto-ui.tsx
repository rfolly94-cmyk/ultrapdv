"use client";

import { createContext, useContext } from "react";

import { recursoTemEnforcement } from "@/lib/plataforma/entitlements/rollout";

const EntitlementsUiContext = createContext<Record<string, boolean> | null>(
  null
);

export function EntitlementsUiProvider({
  value,
  children,
}: {
  value: Record<string, boolean> | null;
  children: React.ReactNode;
}) {
  return (
    <EntitlementsUiContext.Provider value={value}>
      {children}
    </EntitlementsUiContext.Provider>
  );
}

export function recursoLiberadoNoMapa(
  mapa: Record<string, boolean> | null | undefined,
  chave: string
) {
  if (!recursoTemEnforcement(chave)) {
    return true;
  }
  if (!mapa || mapa[chave] === undefined) {
    return true;
  }
  return mapa[chave] === true;
}

export function useRecursosLiberados() {
  return useContext(EntitlementsUiContext);
}

export function useRecursoLiberado(chave: string) {
  return recursoLiberadoNoMapa(useRecursosLiberados(), chave);
}
