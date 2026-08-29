"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import { usePermissoesUi } from "@/lib/permissoes/contexto-ui";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export function VendasModuleTabs({
  pedidosNovos = 0,
  rascunhosNfe = 0,
}: {
  pedidosNovos?: number;
  rascunhosNfe?: number;
}) {
  const permissoes = usePermissoesUi();
  const catalogoNoPlano = useRecursoLiberado("catalogo");
  const nfeNoPlano = useRecursoLiberado("nfe");
  const pedidosPermitidos =
    catalogoNoPlano && temPermissao(permissoes, "catalogo", "pedidos");

  const tabs = [
    { label: "Vendas", href: "/vendas", exact: true },
    ...(pedidosPermitidos
      ? [
          {
            label:
              pedidosNovos > 0
                ? `Pedidos Online · ${pedidosNovos}`
                : "Pedidos Online",
            href: "/vendas/pedidos",
          },
        ]
      : []),
    ...(nfeNoPlano
      ? [
          {
            label:
              rascunhosNfe > 0
                ? `Rascunhos NF-e · ${rascunhosNfe}`
                : "Rascunhos NF-e",
            href: "/vendas/rascunhos-nfe",
          },
        ]
      : []),
  ];

  return <ModuleTabs tabs={tabs} />;
}
