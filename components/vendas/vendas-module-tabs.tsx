"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";

export function VendasModuleTabs({
  pedidosNovos = 0,
}: {
  pedidosNovos?: number;
}) {
  return (
    <ModuleTabs
      tabs={[
        { label: "Vendas", href: "/vendas", exact: true },
        {
          label:
            pedidosNovos > 0
              ? `Pedidos Online · ${pedidosNovos}`
              : "Pedidos Online",
          href: "/vendas/pedidos",
        },
      ]}
    />
  );
}
