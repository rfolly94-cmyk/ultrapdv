"use client";

import Link from "next/link";

import { ModuleTabs } from "@/components/ui/module-tabs";
import {
  hrefCadastroCliente,
  hrefCarteiraCliente,
} from "@/lib/clientes/navegacao";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";

export function ClienteNavegacao({
  clienteId,
  clienteNome,
  description = "Cliente",
}: {
  clienteId: string;
  clienteNome: string;
  description?: string;
}) {
  const clientesNoPlano = useRecursoLiberado("clientes");
  const carteiraNoPlano = useRecursoLiberado("carteira");
  const podeAcessarCadastro = useTemPermissao("clientes", "acessar");
  const podeAcessarCarteira = useTemPermissao("clientes", "acessar_carteira");
  const mostrarCadastro = clientesNoPlano && podeAcessarCadastro;
  const mostrarCarteira = carteiraNoPlano && podeAcessarCarteira;
  const tabs = [
    ...(mostrarCadastro
      ? [
          {
            label: "Cadastro",
            href: hrefCadastroCliente(clienteId),
            exact: true as const,
          },
        ]
      : []),
    ...(mostrarCarteira
      ? [
          {
            label: "Carteira",
            href: hrefCarteiraCliente(clienteId),
          },
        ]
      : []),
  ];
  const voltarHref = mostrarCadastro ? "/clientes" : "/painel";
  const voltarLabel = mostrarCadastro
    ? "← Voltar para clientes"
    : "← Voltar ao início";

  return (
    <div className="shrink-0 border-b border-zinc-200 bg-white">
      <div className="px-4 pt-2.5">
        <Link
          href={voltarHref}
          className="text-[13px] font-medium text-zinc-500 hover:text-zinc-800"
        >
          {voltarLabel}
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
        tabs={tabs}
      />
    </div>
  );
}
