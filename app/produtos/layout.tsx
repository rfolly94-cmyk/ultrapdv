import type { ReactNode } from "react";

import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { planoProdutosPermitidoNaSessao } from "@/lib/produtos/acesso-operacao";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export default async function ProdutosLayout({
  children,
}: {
  children: ReactNode;
}) {
  const plano = await planoProdutosPermitidoNaSessao();
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(plano.empresaId);
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Produtos"
            descricao="Este recurso não está disponível no plano atual da sua empresa. O cadastro de produtos, categorias, marcas e grupos fiscais está disponível em planos que incluem este recurso. PDV, vendas, estoque e fiscal continuam consultando produtos já cadastrados."
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
