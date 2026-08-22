import type { ReactNode } from "react";

import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { planoEstoquePermitidoNaSessao } from "@/lib/estoque/acesso-operacao";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export default async function EstoqueLayout({
  children,
}: {
  children: ReactNode;
}) {
  const plano = await planoEstoquePermitidoNaSessao();
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(plano.empresaId);
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Estoque"
            descricao="Este recurso não está disponível no plano atual da sua empresa. Consulta, ajuste e movimentação manual de estoque estão disponíveis em planos que incluem este recurso. PDV, vendas, importação e entrada fiscal continuam movimentando estoque internamente."
            planoNome={entitlements.planoNome}
            voltarHref="/painel"
            voltarLabel="Voltar ao início"
          />
        </div>
      </main>
    );
  }

  return children;
}
