import { redirect } from "next/navigation";

import { ABAS_CONFIGURACOES_PERMISSAO } from "@/lib/permissoes/menu";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export const metadata = {
  title: "Configurações",
};

export default async function ConfiguracoesHomePage() {
  const sessao = await obterPermissoesSessao();
  const primeira = ABAS_CONFIGURACOES_PERMISSAO.find((aba) =>
    temPermissao(sessao?.permissoes, aba.modulo, aba.acao)
  );

  redirect(primeira?.href ?? "/acesso-negado");
}
