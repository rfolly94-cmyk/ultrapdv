"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";

export const FISCAL_CONFIG_ABAS = [
  {
    label: "Empresa",
    href: "/configuracoes/fiscal/empresa",
    description: "Identidade visual e logomarca da empresa.",
  },
  {
    label: "Geral",
    href: "/configuracoes/fiscal",
    exact: true,
    description: "CRT, IE, endereço e parâmetros de emissão.",
  },
  {
    label: "Prontidão",
    href: "/configuracoes/fiscal/prontidao",
    description: "Verificações para produção.",
  },
  {
    label: "Numeração",
    href: "/configuracoes/fiscal/numeracao",
    description: "Séries e próximos números da empresa.",
  },
  {
    label: "Naturezas",
    href: "/configuracoes/fiscal/naturezas",
    description: "Naturezas usadas na emissão.",
  },
  {
    label: "Credenciais Fiscais",
    href: "/configuracoes/fiscal/integracao",
    description: "Certificado digital A1 e CSC da NFC-e.",
  },
  {
    label: "Contingência",
    href: "/configuracoes/fiscal/contingencia",
    description: "Modo de contingência da empresa.",
  },
] as const;

export function FiscalConfigTabs() {
  return (
    <ModuleTabs
      ariaLabel="Configurações fiscais"
      tabs={FISCAL_CONFIG_ABAS.map((aba) => ({
        label: aba.label,
        href: aba.href,
        exact: "exact" in aba ? aba.exact : undefined,
      }))}
    />
  );
}
