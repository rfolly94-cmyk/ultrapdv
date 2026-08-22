import type { ReactNode } from "react";

import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { planoNfePermitidoNaSessao } from "@/lib/fiscal/acesso-operacao";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export default async function FiscalNfeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const plano = await planoNfePermitidoNaSessao();
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(plano.empresaId);
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="NF-e"
            descricao="A emissão de NF-e não está disponível no plano atual da sua empresa. Vendas, estoque, pagamentos e documentos fiscais já emitidos continuam acessíveis."
            planoNome={entitlements.planoNome}
            voltarHref="/fiscal"
            voltarLabel="Ver documentos fiscais"
          />
        </div>
      </main>
    );
  }

  return children;
}
