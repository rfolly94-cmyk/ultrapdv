import Link from "next/link";
import {
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  Package,
  Printer,
  Receipt,
  ShoppingCart,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LandingHeader } from "@/components/landing/landing-header";

const recursos: Array<{
  titulo: string;
  texto: string;
  icone: LucideIcon;
}> = [
  {
    titulo: "PDV",
    texto:
      "Venda rápida e organizada, com diferentes formas de pagamento e impressão.",
    icone: ShoppingCart,
  },
  {
    titulo: "Estoque",
    texto: "Controle de produtos, movimentações e saldo de estoque.",
    icone: Package,
  },
  {
    titulo: "Clientes",
    texto: "Cadastros completos e histórico do relacionamento com seus clientes.",
    icone: Users,
  },
  {
    titulo: "Carteira",
    texto: "Controle de vendas fiado, recebimentos e saldo por cliente.",
    icone: Wallet,
  },
  {
    titulo: "Vendas",
    texto:
      "Acompanhe vendas, pagamentos, documentos e histórico das operações.",
    icone: Receipt,
  },
  {
    titulo: "NF-e e NFC-e",
    texto: "Emissão fiscal integrada ao fluxo de vendas do UltraPDV.",
    icone: FileText,
  },
  {
    titulo: "Relatórios",
    texto:
      "Visualize informações importantes da operação e acompanhe seus resultados.",
    icone: BarChart3,
  },
  {
    titulo: "Catálogo",
    texto: "Apresente seus produtos em um catálogo online integrado ao sistema.",
    icone: Store,
  },
  {
    titulo: "Multiempresa",
    texto:
      "Gerencie empresas com dados e operações isolados de forma segura.",
    icone: Building2,
  },
];

const fluxo = [
  "Produto",
  "Estoque",
  "Venda",
  "Pagamento",
  "Fiscal",
  "Relatórios",
];

const vendasDemo = [
  { numero: "#1045", descricao: "Venda balcão", valor: "R$ 180,00" },
  { numero: "#1044", descricao: "João Silva", valor: "R$ 350,00" },
  { numero: "#1043", descricao: "Maria Santos", valor: "R$ 99,90" },
];

function DemonstracaoErp() {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <div>
          <p className="text-[13px] font-semibold text-zinc-900">UltraPDV</p>
          <p className="text-[12px] text-zinc-500">Painel · demonstração</p>
        </div>
        <span className="rounded-md bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-700">
          Hoje
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[12px] text-zinc-500">Vendas</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
            R$ 4.850,00
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[12px] text-zinc-500">Vendas realizadas</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
            42
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[12px] text-zinc-500">Clientes</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
            328
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[12px] text-zinc-500">Produtos em estoque</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
            1.247
          </p>
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white px-4 py-3">
        <p className="mb-2 text-[13px] font-semibold text-zinc-900">
          Vendas recentes
        </p>
        <ul className="divide-y divide-zinc-100">
          {vendasDemo.map((venda) => (
            <li
              key={venda.numero}
              className="flex items-center justify-between gap-3 py-2.5 text-[13px]"
            >
              <span className="shrink-0 font-medium text-blue-700">
                {venda.numero}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-600">
                {venda.descricao}
              </span>
              <span className="shrink-0 font-medium text-zinc-900">
                {venda.valor}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-400">
          Valores ilustrativos, apenas para apresentação.
        </p>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-full overflow-x-hidden bg-white">
      <LandingHeader />

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-16">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Gestão simples para sua empresa
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-zinc-600">
              PDV, estoque, clientes, vendas e gestão fiscal conectados em um só
              lugar.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/cadastro"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Começar agora
              </Link>
              <a
                href="#recursos"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Conhecer recursos
              </a>
            </div>
          </div>
          <DemonstracaoErp />
        </section>

        <section
          id="recursos"
          className="scroll-mt-16 border-t border-zinc-200 bg-zinc-50"
        >
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-zinc-900">
              Tudo que você precisa para vender e gerenciar
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recursos.map((recurso) => {
                const Icone = recurso.icone;
                return (
                  <article
                    key={recurso.titulo}
                    className="rounded-xl border border-zinc-200 bg-white p-5"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                      <Icone className="h-4 w-4" />
                    </span>
                    <h3 className="mt-3 text-[15px] font-semibold text-zinc-900">
                      {recurso.titulo}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
                      {recurso.texto}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section
          id="como-funciona"
          className="scroll-mt-16 mx-auto max-w-6xl px-4 py-14 sm:px-6"
        >
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Uma operação conectada do início ao fim
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600">
            Uma venda atualiza os módulos relacionados, sem precisar repetir o
            mesmo trabalho em várias telas.
          </p>
          <div className="mt-8 flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-x-2 md:gap-y-3">
            {fluxo.map((passo, indice) => (
              <div
                key={passo}
                className="flex flex-col items-center md:flex-row md:items-center md:gap-2"
              >
                <div className="flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 md:w-auto">
                  {passo}
                </div>
                {indice < fluxo.length - 1 ? (
                  <>
                    <ChevronDown className="my-1 h-4 w-4 text-orange-500 md:hidden" />
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-orange-500 md:block" />
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
                Preparado para crescer com sua empresa
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                O UltraPDV foi feito para quem opera uma ou várias empresas.
                Cada empresa mantém seus dados, cadastros e operações separados,
                para você crescer sem misturar o que não deve ser compartilhado.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                <Building2 className="h-4 w-4" />
              </span>
              <p className="mt-3 text-[15px] font-semibold text-zinc-900">
                Várias empresas, cada uma no seu espaço
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
                Troque de empresa quando precisar e continue trabalhando com as
                informações certas da operação ativa.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 sm:flex-row sm:items-start">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Printer className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">
                Impressão integrada
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
                O UltraPDV possui o Impressão UltraPDV / UltraPDV Conector para
                impressão de recibos e documentos nas impressoras do computador.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
              Pronto para começar?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-600">
              Crie sua conta e comece a organizar sua operação com o UltraPDV.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/cadastro"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 sm:w-auto"
              >
                Criar minha conta
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 sm:w-auto"
              >
                Já tenho uma conta
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-sm font-semibold text-zinc-900">UltraPDV</p>
            <p className="mt-1 text-sm text-zinc-500">
              Sistema de gestão para empresas.
            </p>
            <p className="mt-3 text-xs text-zinc-400">© 2026 UltraPDV</p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
              Entrar
            </Link>
            <Link href="/cadastro" className="text-zinc-600 hover:text-zinc-900">
              Criar conta
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
