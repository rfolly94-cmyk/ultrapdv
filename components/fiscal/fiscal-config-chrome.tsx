"use client";

import { usePathname } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { FISCAL_CONFIG_ABAS, FiscalConfigTabs } from "@/components/fiscal/fiscal-config-tabs";
import { PageHeader } from "@/components/ui/page-header";

function paginaFiscalAtiva(pathname: string) {
  const ordenadas = [...FISCAL_CONFIG_ABAS].sort(
    (a, b) => b.href.length - a.href.length
  );

  return (
    ordenadas.find((aba) =>
      "exact" in aba && aba.exact
        ? pathname === aba.href
        : pathname === aba.href || pathname.startsWith(`${aba.href}/`)
    ) ?? FISCAL_CONFIG_ABAS[0]
  );
}

export function FiscalConfigChrome() {
  const pathname = usePathname();
  const pagina = paginaFiscalAtiva(pathname);
  const ehGeral = pagina.href === "/configuracoes/fiscal";

  return (
    <>
      <PageHeader
        title="Configurações"
        description={pagina.description}
        breadcrumb={
          ehGeral
            ? [
                { label: "Configurações", href: "/configuracoes" },
                { label: "Fiscal" },
              ]
            : [
                { label: "Configurações", href: "/configuracoes" },
                { label: "Fiscal", href: "/configuracoes/fiscal" },
                { label: pagina.label },
              ]
        }
      />
      <ConfiguracoesModuleTabs />
      <FiscalConfigTabs />
    </>
  );
}
