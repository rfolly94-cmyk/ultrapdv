"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";

export function FiscalModuleTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Documentos fiscais", href: "/fiscal" },
        { label: "Notas de entrada", href: "/fiscal/entradas" },
      ]}
    />
  );
}
