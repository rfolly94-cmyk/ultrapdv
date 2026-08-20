"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { ModuleTabs } from "@/components/ui/module-tabs";

export const CONTABILIDADE_ABAS = [
  {
    label: "Visão geral",
    href: "/contabilidade",
    exact: true,
    description: "Resumo fiscal da competência.",
  },
  {
    label: "Documentos fiscais",
    href: "/contabilidade/documentos",
    description: "Documentos da competência.",
  },
  {
    label: "XMLs",
    href: "/contabilidade/xmls",
    description: "Arquivos XML da competência.",
  },
  {
    label: "Inventário",
    href: "/contabilidade/inventario",
    description: "Snapshots fiscais de estoque.",
  },
  {
    label: "Auditoria",
    href: "/contabilidade/auditoria",
    description: "Inconsistências da competência.",
  },
  {
    label: "Competências",
    href: "/contabilidade/competencias",
    description: "Abertura e liberação de competências.",
  },
] as const;

function paginaContabilidadeAtiva(pathname: string) {
  return (
    CONTABILIDADE_ABAS.find((aba) =>
      "exact" in aba && aba.exact
        ? pathname === aba.href
        : pathname === aba.href || pathname.startsWith(`${aba.href}/`)
    ) ?? CONTABILIDADE_ABAS[0]
  );
}

export function ContabilidadeModuleTabs() {
  const params = useSearchParams();
  const competencia = params.get("competencia");
  const query = competencia ? `?competencia=${competencia}` : "";

  return (
    <ModuleTabs
      ariaLabel="Contabilidade"
      tabs={CONTABILIDADE_ABAS.map((tab) => ({
        label: tab.label,
        href: `${tab.href}${query}`,
        exact: "exact" in tab ? tab.exact : undefined,
      }))}
    />
  );
}

export function ContabilidadeChrome() {
  const pathname = usePathname();
  const params = useSearchParams();
  const competencia = params.get("competencia");
  const query = competencia ? `?competencia=${competencia}` : "";
  const pagina = paginaContabilidadeAtiva(pathname);
  const ehRaiz = pagina.href === "/contabilidade";

  return (
    <PageHeader
      title={ehRaiz ? "Contabilidade" : pagina.label}
      description={pagina.description}
      breadcrumb={
        ehRaiz
          ? undefined
          : [
              { label: "Contabilidade", href: `/contabilidade${query}` },
              { label: pagina.label },
            ]
      }
    />
  );
}
