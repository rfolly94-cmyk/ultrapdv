"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";

export function EstoqueModuleTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Estoque", href: "/estoque", exact: true },
        { label: "Nota de Entrada", href: "/fiscal/entradas" },
      ]}
    />
  );
}
