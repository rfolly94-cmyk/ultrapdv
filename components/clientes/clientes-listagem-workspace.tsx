"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ColunaFinanceiraCliente } from "@/components/clientes/coluna-financeira";
import { ModalCreditoCliente } from "@/components/clientes/modal-credito-cliente";
import { ModalDebitoCliente } from "@/components/clientes/modal-debito-cliente";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { ClientesFiltro } from "@/components/clientes/clientes-filtro";
import { carregarResumoCarteiraCliente } from "@/app/clientes/[id]/carteira/actions";
import type { ClienteListagem } from "@/lib/clientes/listagem";
import type {
  CreditoAbertoListagem,
  FormaRecebimentoListagem,
  ItemAbertoListagem,
} from "@/lib/clientes/carregar-resumo-carteira";
import {
  aplicarBaixaNaListagem,
  formatarDocumentoCliente,
  itensColunaFinanceira,
  rotuloTotalListagem,
  type FiltroListagemClientes,
} from "@/lib/clientes/listagem";
import {
  hrefCadastroCliente,
  hrefCarteiraCliente,
  hrefExtratoCliente,
  hrefImprimirExtratoCliente,
  hrefNovaVendaCliente,
  hrefReceberCliente,
  hrefVendasDoCliente,
  hrefWhatsappCliente,
} from "@/lib/clientes/navegacao";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

type ResumoModal = {
  clienteId: string;
  clienteNome: string;
  tipo: "debito" | "credito";
  itens: ItemAbertoListagem[];
  creditos: CreditoAbertoListagem[];
  formas: FormaRecebimentoListagem[];
};

export function ClientesListagemWorkspace({
  clientesIniciais,
  totalInicial,
  contadoresIniciais,
  filtro,
  busca,
  podeAcessarCarteira,
  podeReceberCarteira,
  podeNovaVenda,
  podeVerVendas,
}: {
  clientesIniciais: ClienteListagem[];
  totalInicial: number;
  contadoresIniciais: { debito: number; credito: number; vencidos: number };
  filtro: FiltroListagemClientes;
  busca: string;
  podeAcessarCarteira: boolean;
  podeReceberCarteira: boolean;
  podeNovaVenda: boolean;
  podeVerVendas: boolean;
}) {
  const router = useRouter();
  const [clientes, setClientes] = useState(clientesIniciais);
  const [total, setTotal] = useState(totalInicial);
  const [contadores, setContadores] = useState(contadoresIniciais);
  const [resumo, setResumo] = useState<ResumoModal | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    setClientes(clientesIniciais);
    setTotal(totalInicial);
    setContadores(contadoresIniciais);
  }, [clientesIniciais, totalInicial, contadoresIniciais]);

  async function abrir(cliente: ClienteListagem, tipo: "debito" | "credito") {
    if (!podeAcessarCarteira) {
      return;
    }
    setCarregando(true);
    setMensagem(null);
    const resposta = await carregarResumoCarteiraCliente(cliente.id);
    setCarregando(false);
    if (!resposta.ok) {
      setMensagem(resposta.erro);
      setResumo({
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        tipo,
        itens: [],
        creditos: [],
        formas: [],
      });
      return;
    }
    setResumo({
      clienteId: cliente.id,
      clienteNome: resposta.resumo.clienteNome,
      tipo,
      itens: resposta.resumo.itens,
      creditos: resposta.resumo.creditos,
      formas: resposta.resumo.formas,
    });
  }

  function aplicarResumoNoCliente(
    clienteId: string,
    situacao: {
      debitoAberto: number;
      creditoAberto: number;
      vencido: number;
    }
  ) {
    const atual = clientes.find((cliente) => cliente.id === clienteId);
    const limite = Number(atual?.limite_credito ?? 0);
    const resultado = aplicarBaixaNaListagem({
      clientes,
      filtro,
      clienteId,
      situacao: {
        debitoAberto: situacao.debitoAberto,
        creditoAberto: situacao.creditoAberto,
        vencido: situacao.vencido,
        limiteDisponivel: Math.max(0, limite - situacao.debitoAberto),
      },
      contadores,
    });
    setClientes(resultado.clientes);
    setTotal(resultado.total);
    setContadores(resultado.contadores);
  }

  async function receber(input: {
    modo: "ITENS" | "PARCIAL";
    itemIds: string[];
    valor: number | null;
    formaPagamentoId: string;
  }) {
    if (!resumo) {
      return;
    }
    setEnviando(true);
    setMensagem(null);
    try {
      const response = await fetch(
        `/api/clientes/${resumo.clienteId}/carteira/receber`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forma_pagamento_id: input.formaPagamentoId,
            modo: input.modo,
            valor: input.valor,
            item_ids: input.itemIds,
            idempotency_key: crypto.randomUUID(),
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setMensagem(payload.erro ?? "Não foi possível registrar o recebimento.");
        return;
      }

      const atualizado = await carregarResumoCarteiraCliente(resumo.clienteId);
      if (!atualizado.ok) {
        setMensagem(atualizado.erro);
        router.refresh();
        return;
      }

      setResumo({
        ...resumo,
        itens: atualizado.resumo.itens,
        creditos: atualizado.resumo.creditos,
        formas: atualizado.resumo.formas,
      });
      aplicarResumoNoCliente(resumo.clienteId, atualizado.resumo.situacao);
      setMensagem(
        `Recebimento de ${formatarMoeda(
          payload.resultado?.valor_recebido ?? input.valor ?? 0
        )} registrado.`
      );
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error ? error.message : "Falha inesperada."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <ListToolbar
        searchAction="/clientes"
        searchDefault={busca}
        searchPlaceholder="Buscar nome, CPF/CNPJ ou telefone"
        searchExtras={
          filtro !== "todos" ? (
            <input type="hidden" name="filtro" value={filtro} />
          ) : null
        }
        filters={
          <ClientesFiltro
            filtro={filtro}
            busca={busca}
            contadores={contadores}
          />
        }
        actions={
          <p className="shrink-0 text-sm font-semibold text-zinc-900">
            {rotuloTotalListagem(filtro)}: {formatarMoeda(total)}
          </p>
        }
      />

      {mensagem && !resumo ? (
        <p className="px-4 text-[13px] text-zinc-600">{mensagem}</p>
      ) : null}

      <DataTable minWidth={900}>
        <thead>
          <tr>
            <th>Ações</th>
            <th>Nome</th>
            <th>Saldo</th>
            <th>CPF/CNPJ</th>
            <th>Telefone</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((cliente) => {
            const iniciais = cliente.nome
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((parte: string) => parte[0]?.toUpperCase() ?? "")
              .join("");
            const whatsapp = hrefWhatsappCliente(cliente.telefone);
            return (
              <tr key={cliente.id}>
                <td>
                  <RowActions
                    editHref={hrefCadastroCliente(cliente.id)}
                    items={[
                      {
                        label: "Ver cadastro",
                        href: hrefCadastroCliente(cliente.id),
                      },
                      {
                        label: "Editar",
                        href: hrefCadastroCliente(cliente.id),
                      },
                      {
                        label: "Abrir carteira",
                        href: hrefCarteiraCliente(cliente.id),
                        hidden: !podeAcessarCarteira,
                      },
                      {
                        label: "Ver extrato",
                        href: hrefExtratoCliente(cliente.id),
                        hidden: !podeAcessarCarteira,
                      },
                      {
                        label: "Receber pagamento",
                        href: hrefReceberCliente(cliente.id),
                        hidden: !podeReceberCarteira,
                      },
                      {
                        label: "Nova venda",
                        href: hrefNovaVendaCliente(),
                        hidden: !podeNovaVenda,
                      },
                      {
                        label: "Ver vendas do cliente",
                        href: podeAcessarCarteira
                          ? hrefVendasDoCliente(cliente.id)
                          : `/vendas?q=${encodeURIComponent(cliente.nome)}`,
                        hidden: !podeVerVendas,
                      },
                      {
                        label: "Imprimir extrato",
                        href: hrefImprimirExtratoCliente(cliente.id),
                        target: "_blank",
                        hidden: !podeAcessarCarteira,
                      },
                      {
                        label: "WhatsApp",
                        href: whatsapp ?? undefined,
                        target: "_blank",
                        hidden: !whatsapp,
                      },
                    ]}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-400 text-[10px] font-bold text-white">
                      {iniciais || "?"}
                    </span>
                    <span className="font-medium">{cliente.nome}</span>
                  </div>
                </td>
                <td>
                  <ColunaFinanceiraCliente
                    itens={itensColunaFinanceira({
                      filtro,
                      situacao: cliente.situacaoCarteira,
                    })}
                    onDebito={
                      podeAcessarCarteira
                        ? () => {
                            void abrir(cliente, "debito");
                          }
                        : undefined
                    }
                    onCredito={
                      podeAcessarCarteira
                        ? () => {
                            void abrir(cliente, "credito");
                          }
                        : undefined
                    }
                  />
                </td>
                <td>
                  {formatarDocumentoCliente(
                    cliente.tipo_pessoa,
                    cliente.cpf_cnpj
                  )}
                </td>
                <td>{cliente.telefone ?? "—"}</td>
                <td>
                  <StatusBadge status={cliente.ativo ? "ativo" : "inativo"} />
                  {cliente.bloqueado ? (
                    <span className="ml-1">
                      <StatusBadge status="bloqueado" />
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {!clientes.length && (
            <DataTableEmpty colSpan={6}>
              {carregando ? "Carregando..." : "Nenhum cliente encontrado."}
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>

      <ModalDebitoCliente
        open={resumo?.tipo === "debito"}
        clienteNome={resumo?.clienteNome ?? ""}
        itens={resumo?.itens ?? []}
        formas={resumo?.formas ?? []}
        podeReceber={podeReceberCarteira}
        enviando={enviando || carregando}
        mensagem={resumo?.tipo === "debito" ? mensagem : null}
        onClose={() => {
          setResumo(null);
          setMensagem(null);
        }}
        onReceber={receber}
      />
      <ModalCreditoCliente
        open={resumo?.tipo === "credito"}
        clienteNome={resumo?.clienteNome ?? ""}
        creditos={resumo?.creditos ?? []}
        onClose={() => {
          setResumo(null);
          setMensagem(null);
        }}
      />
    </>
  );
}
