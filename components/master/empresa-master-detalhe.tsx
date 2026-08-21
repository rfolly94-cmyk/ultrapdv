"use client";

import { useState } from "react";
import Link from "next/link";

import { MasterAcoesAssinatura } from "@/components/master/master-acoes-assinatura";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ROTULOS_EVENTO_EMPRESA,
  formatarCnpjMaster,
  rotuloUsoComLimite,
} from "@/lib/master/apresentacao-empresa";
import type { EmpresaMasterDetalheDados } from "@/lib/master/empresa-tipos";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

const ABAS = [
  { id: "resumo", label: "Resumo" },
  { id: "assinatura", label: "Assinatura" },
  { id: "uso", label: "Uso" },
  { id: "usuarios", label: "Usuários" },
  { id: "auditoria", label: "Auditoria" },
] as const;

type Aba = (typeof ABAS)[number]["id"];

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[12px] text-zinc-500">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-zinc-950">{valor}</dd>
    </div>
  );
}

function Indicador({
  rotulo,
  principal,
  complemento,
}: {
  rotulo: string;
  principal: string;
  complemento?: string | null;
}) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-[12px] text-zinc-500">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-950">{principal}</p>
      {complemento ? (
        <p className="mt-0.5 text-sm text-zinc-500">{complemento}</p>
      ) : null}
    </article>
  );
}

function numeroOuTraco(valor: number | null | undefined) {
  return valor == null ? "—" : String(valor);
}

export function EmpresaMasterDetalhe({
  detalhe,
}: {
  detalhe: EmpresaMasterDetalheDados;
}) {
  const [aba, setAba] = useState<Aba>("resumo");
  const { empresa, assinatura, planos, uso, usuarios, historico } = detalhe;
  const nome = empresa.nomeFantasia || empresa.razaoSocial || "Empresa";
  const status = String(assinatura?.status ?? "");
  const suspensa = status === "suspensa";
  const usuariosLimite = rotuloUsoComLimite(
    uso.usuarios,
    uso.limiteUsuarios,
    "usuário",
    "usuários"
  );

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/master/empresas"
          className="text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
        >
          ← Empresas
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
              {nome}
            </h1>
            {empresa.razaoSocial && empresa.razaoSocial !== nome ? (
              <p className="mt-1 text-sm text-zinc-600">{empresa.razaoSocial}</p>
            ) : null}
            <p className="mt-1 text-sm text-zinc-500">
              CNPJ: {formatarCnpjMaster(empresa.cnpj)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-zinc-900">
                {assinatura?.plano_nome ? `Plano ${assinatura.plano_nome}` : "Sem plano"}
              </span>
              <StatusBadge status={status || "ativa"}>
                {status === "trial"
                  ? "Assinatura em teste"
                  : status === "ativa"
                    ? "Assinatura ativa"
                    : status === "suspensa"
                      ? "Assinatura suspensa"
                      : status === "carencia"
                        ? "Assinatura em carência"
                        : status === "cancelada"
                          ? "Assinatura cancelada"
                          : "Sem assinatura"}
              </StatusBadge>
            </div>
          </div>
          <MasterAcoesAssinatura
            variante="cabecalho"
            empresaId={empresa.id}
            planoId={assinatura?.plano_id ?? null}
            planoNome={assinatura?.plano_nome ?? null}
            valorContratado={assinatura?.valor_mensal_contratado ?? null}
            vencimento={assinatura?.vencimento_em ?? null}
            status={status}
            planos={planos}
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <nav
          aria-label="Seções da empresa"
          className="flex h-9 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-3"
        >
          {ABAS.map((item) => {
            const ativa = aba === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                className={[
                  "relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium",
                  ativa ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-800",
                ].join(" ")}
              >
                {item.label}
                {ativa ? (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 bg-zinc-950" />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="p-5">
          {aba === "resumo" ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Campo rotulo="Razão social" valor={empresa.razaoSocial || "—"} />
                <Campo rotulo="Nome fantasia" valor={empresa.nomeFantasia || "—"} />
                <Campo rotulo="CNPJ" valor={formatarCnpjMaster(empresa.cnpj)} />
                <Campo rotulo="Cadastro" valor={formatarData(empresa.cadastro)} />
                <Campo rotulo="Plano" valor={assinatura?.plano_nome || "—"} />
                <Campo
                  rotulo="Status da assinatura"
                  valor={
                    status === "trial"
                      ? "Em teste"
                      : status === "ativa"
                        ? "Ativa"
                        : status === "suspensa"
                          ? "Suspensa"
                          : status === "carencia"
                            ? "Carência"
                            : status === "cancelada"
                              ? "Cancelada"
                              : "Sem assinatura"
                  }
                />
                <Campo
                  rotulo="Valor contratado"
                  valor={
                    assinatura?.valor_mensal_contratado == null
                      ? "—"
                      : formatarMoeda(assinatura.valor_mensal_contratado)
                  }
                />
              </dl>
              <div className="grid gap-3 sm:grid-cols-2">
                <Indicador
                  rotulo="Usuários"
                  principal={usuariosLimite.principal}
                  complemento={usuariosLimite.complemento}
                />
                <Indicador
                  rotulo="Produtos"
                  principal={numeroOuTraco(uso.produtos)}
                />
                <Indicador
                  rotulo="Clientes"
                  principal={numeroOuTraco(uso.clientes)}
                />
                <Indicador
                  rotulo="Filiais"
                  principal="—"
                  complemento="Cadastro de filiais ainda não existe nesta versão."
                />
              </div>
            </div>
          ) : null}

          {aba === "assinatura" ? (
            <div className="space-y-6">
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Campo rotulo="Plano atual" valor={assinatura?.plano_nome || "—"} />
                <div>
                  <dt className="text-[12px] text-zinc-500">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={status || "ativa"}>
                      {status === "trial"
                        ? "Em teste"
                        : status === "ativa"
                          ? "Ativa"
                          : status === "suspensa"
                            ? "Suspensa"
                            : status === "carencia"
                              ? "Carência"
                              : status === "cancelada"
                                ? "Cancelada"
                                : "Sem assinatura"}
                    </StatusBadge>
                  </dd>
                </div>
                <Campo
                  rotulo="Valor mensal contratado"
                  valor={
                    assinatura?.valor_mensal_contratado == null
                      ? "—"
                      : formatarMoeda(assinatura.valor_mensal_contratado)
                  }
                />
                <Campo rotulo="Início" valor={formatarData(assinatura?.inicio_em)} />
                <Campo
                  rotulo="Vencimento"
                  valor={formatarData(assinatura?.vencimento_em)}
                />
                {status === "trial" ? (
                  <Campo
                    rotulo="Período de teste"
                    valor={
                      assinatura?.dias_teste
                        ? `${assinatura.dias_teste} dia(s) · até ${formatarData(assinatura.vencimento_em)}`
                        : `Até ${formatarData(assinatura?.vencimento_em)}`
                    }
                  />
                ) : null}
                {assinatura?.carencia_ate ? (
                  <Campo
                    rotulo="Carência"
                    valor={formatarData(assinatura.carencia_ate)}
                  />
                ) : null}
                {assinatura?.liberado_ate ? (
                  <Campo
                    rotulo="Liberação temporária"
                    valor={formatarDataHora(assinatura.liberado_ate)}
                  />
                ) : null}
              </dl>
              {assinatura?.observacao ? (
                <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                  {assinatura.observacao}
                </p>
              ) : null}
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Ações</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Alterações comerciais desta empresa. Os dados de venda e cadastro
                  são preservados.
                </p>
                <div className="mt-4">
                  <MasterAcoesAssinatura
                    empresaId={empresa.id}
                    planoId={assinatura?.plano_id ?? null}
                    planoNome={assinatura?.plano_nome ?? null}
                    valorContratado={assinatura?.valor_mensal_contratado ?? null}
                    vencimento={assinatura?.vencimento_em ?? null}
                    status={status}
                    planos={planos}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {aba === "uso" ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">
                Indicadores da empresa selecionada. Limites do plano são
                informativos e não bloqueiam o ERP nesta etapa.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Indicador
                  rotulo="Usuários"
                  principal={usuariosLimite.principal}
                  complemento={usuariosLimite.complemento}
                />
                <Indicador
                  rotulo="Filiais"
                  principal={
                    uso.limiteFiliais == null
                      ? "Ilimitado"
                      : `Limite ${uso.limiteFiliais}`
                  }
                  complemento="Cadastro de filiais ainda não existe nesta versão."
                />
                <Indicador
                  rotulo="Produtos"
                  principal={numeroOuTraco(uso.produtos)}
                />
                <Indicador
                  rotulo="Clientes"
                  principal={numeroOuTraco(uso.clientes)}
                />
                <Indicador
                  rotulo="Vendas no mês"
                  principal={numeroOuTraco(uso.vendasMes)}
                />
                <Indicador
                  rotulo="NFC-e no mês"
                  principal={numeroOuTraco(uso.nfceMes)}
                />
                <Indicador
                  rotulo="NF-e no mês"
                  principal={numeroOuTraco(uso.nfeMes)}
                />
              </div>
            </div>
          ) : null}

          {aba === "usuarios" ? (
            usuarios.length === 0 ? (
              <p className="py-6 text-sm text-zinc-500">
                Nenhum usuário vinculado a esta empresa.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="updv-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>E-mail</th>
                      <th>Perfil</th>
                      <th>Principal</th>
                      <th>Ativo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((usuario) => (
                      <tr key={usuario.id}>
                        <td className="font-medium">{usuario.nome}</td>
                        <td>{usuario.email}</td>
                        <td>{usuario.rotuloPerfil}</td>
                        <td>{usuario.principal ? "Sim" : "Não"}</td>
                        <td>
                          <StatusBadge status={usuario.ativo ? "ativo" : "inativo"}>
                            {usuario.ativo ? "Ativo" : "Inativo"}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {aba === "auditoria" ? (
            historico.length === 0 ? (
              <p className="py-6 text-sm text-zinc-500">
                Nenhum evento Master nesta empresa.
              </p>
            ) : (
              <ol className="space-y-3">
                {historico.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-zinc-200 px-4 py-3"
                  >
                    <p className="text-[12px] text-zinc-500">
                      {formatarDataHora(item.createdAt)}
                    </p>
                    <p className="mt-1 font-medium text-zinc-950">
                      {ROTULOS_EVENTO_EMPRESA[item.tipo] || item.tipo}
                    </p>
                    {item.detalhe ? (
                      <p className="mt-0.5 text-sm text-zinc-600">{item.detalhe}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-zinc-500">
                      Administrador: {item.administrador || "—"}
                    </p>
                  </li>
                ))}
              </ol>
            )
          ) : null}
        </div>
      </section>

      {suspensa ? (
        <p className="text-sm text-zinc-500">
          Esta empresa está suspensa pela assinatura da plataforma. Os dados
          operacionais foram preservados.
        </p>
      ) : null}
    </div>
  );
}
