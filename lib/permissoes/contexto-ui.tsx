"use client";

import { createContext, useContext } from "react";

import type { PermissoesEfetivas } from "@/lib/permissoes/tipos";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import type { AcaoDoModulo, ModuloPermissao } from "@/lib/permissoes/tipos";

const PermissoesUiContext = createContext<PermissoesEfetivas | null>(null);

export function PermissoesUiProvider({
  value,
  children,
}: {
  value: PermissoesEfetivas | null;
  children: React.ReactNode;
}) {
  return (
    <PermissoesUiContext.Provider value={value}>
      {children}
    </PermissoesUiContext.Provider>
  );
}

export function usePermissoesUi() {
  return useContext(PermissoesUiContext);
}

export function useTemPermissao<M extends ModuloPermissao>(
  modulo: M,
  acao: AcaoDoModulo<M>
) {
  return temPermissao(usePermissoesUi(), modulo, acao);
}
