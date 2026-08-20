"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";

export function ProdutosModuleTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Produtos", href: "/produtos", exact: true },
        { label: "Categorias", href: "/produtos/categorias" },
        { label: "Marcas", href: "/produtos/marcas" },
        { label: "Grupos Fiscais", href: "/produtos/grupos-fiscais" },
      ]}
    />
  );
}
