import Link from "next/link";

import { ModuleTabs } from "@/components/ui/module-tabs";
import {
  hrefCadastroCliente,
  hrefCarteiraCliente,
} from "@/lib/clientes/navegacao";

export function ClienteNavegacao({
  clienteId,
  clienteNome,
  description = "Cliente",
}: {
  clienteId: string;
  clienteNome: string;
  description?: string;
}) {
  return (
    <div className="shrink-0 border-b border-zinc-200 bg-white">
      <div className="px-4 pt-2.5">
        <Link
          href="/clientes"
          className="text-[13px] font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← Voltar para clientes
        </Link>
      </div>
      <div className="px-4 pb-2 pt-1">
        <h1 className="text-[17px] font-semibold tracking-tight text-zinc-950">
          {clienteNome}
        </h1>
        <p className="updv-page-desc">{description}</p>
      </div>
      <ModuleTabs
        ariaLabel="Cadastro e Carteira"
        tabs={[
          {
            label: "Cadastro",
            href: hrefCadastroCliente(clienteId),
            exact: true,
          },
          {
            label: "Carteira",
            href: hrefCarteiraCliente(clienteId),
          },
        ]}
      />
    </div>
  );
}
