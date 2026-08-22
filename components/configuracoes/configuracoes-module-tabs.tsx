"use client";

import { ModuleTabs } from "@/components/ui/module-tabs";
import {
  recursoLiberadoNoMapa,
  useRecursosLiberados,
} from "@/lib/plataforma/entitlements/contexto-ui";
import { usePermissoesUi } from "@/lib/permissoes/contexto-ui";
import { ABAS_CONFIGURACOES_PERMISSAO } from "@/lib/permissoes/menu";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export function ConfiguracoesModuleTabs() {
  const permissoes = usePermissoesUi();
  const recursosLiberados = useRecursosLiberados();
  const tabs = ABAS_CONFIGURACOES_PERMISSAO.filter((aba) => {
    if (!temPermissao(permissoes, aba.modulo, aba.acao)) {
      return false;
    }
    const recurso = "recurso" in aba ? aba.recurso : null;
    if (!recurso) {
      return true;
    }
    return recursoLiberadoNoMapa(recursosLiberados, recurso);
  }).map((aba) => ({
    label: aba.label,
    href: aba.href,
    exact: aba.href === "/configuracoes/usuarios",
  }));

  if (tabs.length === 0) {
    return null;
  }

  return <ModuleTabs tabs={tabs} />;
}
