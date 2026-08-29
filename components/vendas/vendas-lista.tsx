"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useState,
} from "react";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { CancelarVendaComercial } from "@/components/vendas/cancelar-venda-comercial";
import { DocumentoFiscalBotoes } from "@/components/vendas/documento-fiscal-botoes";
import { VendasModuleTabs } from "@/components/vendas/vendas-module-tabs";
import { VendasPeriodoFiltro } from "@/components/vendas/vendas-periodo-filtro";
import { imprimirUrlPdfNoUltraPdvConector } from "@/lib/impressao/imprimir-pdf";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import {
  montarHrefListaVendas,
  type FiltrosListaVendas,
} from "@/lib/vendas/periodo-lista";
import {
  resolverRotaEdicaoVenda,
  resolverRotaEmissaoListaVenda,
  rotuloOrigemVendaComercial,
  type OrigemVendaComercial,
} from "@/lib/vendas/resolver-rota-edicao-venda";

export type VendaListaItem = {
  id: string;
  numero:
    | number
    | string
    | null;
  cliente: string;
  usuario: string;
  status: string;
  tipoVenda: string;
  origem: OrigemVendaComercial;
  operacaoFiscalId: string | null;
  modeloFiscalIntencao:
    | string
    | null;
  valorProdutos: number;
  desconto: number;
  acrescimo: number;
  frete: number;
  valorTotal: number;
  troco: number;
  dataVenda:
    | string
    | null;
  pagamentos: Array<{
    nome: string;
    codigo:
      | string
      | null;
    codigoFiscal:
      | string
      | null;
    valor: number;
    status: string;
  }>;
  fiscal:
    | {
        id: string;
        modelo: string;
        serie: number;
        numero: string;
        status: string;
        chaveAcesso:
          | string
          | null;
        protocolo:
          | string
          | null;
        cstat:
          | string
          | null;
        motivo:
          | string
          | null;
        temXml: boolean;
        temPdf: boolean;
      }
    | null;
};

type Props = {
  vendas: VendaListaItem[];
  pedidosNovos?: number;
  rascunhosNfe?: number;
  filtros: FiltrosListaVendas;
  dataHojeIso: string;
};

const moeda =
  new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  );

function formatarData(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle: "short",
      timeStyle: "short",
    }
  ).format(data);
}

function textoStatus(
  valor: string
) {
  return valor
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (letra) =>
        letra.toUpperCase()
    );
}

function modeloFiscal(
  modelo:
    | string
    | null
) {
  if (modelo === "65") {
    return "NFC-e";
  }

  if (modelo === "55") {
    return "NF-e";
  }

  return "—";
}

function fiscalLabel(
  venda: VendaListaItem
) {
  if (!venda.fiscal) {
    return modeloFiscal(
      venda.modeloFiscalIntencao
    );
  }

  const modelo =
    venda.fiscal.modelo === "55"
      ? "NF-e"
      : venda.fiscal.modelo === "65"
      ? "NFC-e"
      : `Modelo ${venda.fiscal.modelo}`;

  return `${modelo} ${textoStatus(
    venda.fiscal.status
  )}`;
}

function fiscalResumo(
  venda: VendaListaItem
) {
  if (!venda.fiscal) {
    return null;
  }

  const serieNumero = `Série ${venda.fiscal.serie} · Nº ${venda.fiscal.numero}`;
  const motivo =
    venda.fiscal.status === "rejeitada"
      ? venda.fiscal.motivo
      : venda.fiscal.status === "autorizada"
        ? venda.fiscal.protocolo
          ? `Protocolo ${venda.fiscal.protocolo}`
          : venda.fiscal.chaveAcesso
        : venda.fiscal.motivo;

  return (
    <>
      <div className="text-[11px] text-zinc-500">
        {serieNumero}
      </div>
      {motivo ? (
        <div
          className="max-w-[240px] truncate text-[11px] text-zinc-600"
          title={motivo}
        >
          {motivo}
        </div>
      ) : null}
    </>
  );
}

export function VendasLista({
  vendas,
  pedidosNovos = 0,
  rascunhosNfe = 0,
  filtros,
  dataHojeIso,
}: Props) {
  const router = useRouter();
  const nfeLiberada = useRecursoLiberado("nfe");
  const [
    busca,
    setBusca,
  ] = useState(filtros.q);

  const status = filtros.status;
  const modelo = filtros.modelo;

  const [
    vendaExcluir,
    setVendaExcluir,
  ] = useState<{
    id: string;
    numero: number | string | null;
  } | null>(null);
  const [impressaoLista, setImpressaoLista] = useState<string | null>(null);

  async function imprimirPeloConector(url: string, tipoDocumento: string, papel: string) {
    setImpressaoLista("Enviando para o UltraPDV Conector...");
    const resultado = await imprimirUrlPdfNoUltraPdvConector({
      url,
      tipoDocumento,
      papel,
    });
    setImpressaoLista(resultado.ok ? resultado.mensagem : resultado.erro);
  }

  function ir(
    patch: Partial<FiltrosListaVendas>
  ) {
    router.push(
      montarHrefListaVendas({
        ...filtros,
        q: busca.trim(),
        ...patch,
      })
    );
  }

  const vendasFiltradas =
    useMemo(() => {
      const termo =
        busca
          .trim()
          .toLowerCase();

      return vendas.filter(
        (venda) => {
          const pagamentos =
            venda.pagamentos
              .map(
                (item) =>
                  `${item.nome} ${item.codigo ?? ""}`
              )
              .join(" ")
              .toLowerCase();

          const origem =
            rotuloOrigemVendaComercial(
              venda.origem
            ).toLowerCase();

          const bateBusca =
            !termo ||
            String(
              venda.numero ?? ""
            ).includes(termo) ||
            venda.cliente
              .toLowerCase()
              .includes(termo) ||
            venda.usuario
              .toLowerCase()
              .includes(termo) ||
            origem.includes(
              termo
            ) ||
            pagamentos.includes(
              termo
            );

          const bateStatus =
            status === "todos" ||
            venda.status === status;

          const bateModelo =
            modelo === "todos" ||
            (modelo === "sem_modelo"
              ? !venda.modeloFiscalIntencao
              : venda.modeloFiscalIntencao ===
                modelo);

          return (
            bateBusca &&
            bateStatus &&
            bateModelo
          );
        }
      );
    }, [
      vendas,
      busca,
      status,
      modelo,
    ]);

  const statusOpcoes =
    useMemo(
      () => {
        const opcoes = new Set(
          vendas.map(
            (venda) =>
              venda.status
          )
        );

        if (
          status !== "todos"
        ) {
          opcoes.add(status);
        }

        return Array.from(
          opcoes
        ).sort();
      },
      [vendas, status]
    );

  const totalFiltrado =
    useMemo(
      () =>
        vendasFiltradas.reduce(
          (
            total,
            venda
          ) =>
            total +
            venda.valorTotal,
          0
        ),
      [vendasFiltradas]
    );

  const finalizadas =
    vendasFiltradas.filter(
      (venda) =>
        venda.status ===
        "finalizada"
    ).length;

  return (
    <section className="updv-page">
      <PageHeader
        title="Vendas"
        description="Gerencie as vendas da empresa."
        count={vendasFiltradas.length}
        actions={
          <>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {finalizadas} finalizadas · {moeda.format(totalFiltrado)}
            </span>
            <Link href="/pdv" className="updv-btn updv-btn-primary">
              PDV
            </Link>
            {nfeLiberada ? (
              <Link href="/fiscal/nfe/nova" className="updv-btn updv-btn-ghost">
                Nova NF-e
              </Link>
            ) : null}
          </>
        }
      />
      {impressaoLista ? (
        <p className="whitespace-pre-line px-4 text-sm text-zinc-600">
          {impressaoLista}
        </p>
      ) : null}
      <VendasModuleTabs
        pedidosNovos={pedidosNovos}
        rascunhosNfe={rascunhosNfe}
      />

      <ListToolbar
        searchPlaceholder="Buscar por número, cliente, operador ou pagamento"
        searchValue={busca}
        onSearchChange={setBusca}
        filters={
          <>
            <select
              value={status}
              onChange={(event) =>
                ir({
                  status: event.target.value,
                })
              }
              className="updv-select w-[160px]"
            >
              <option value="todos">Todos os status</option>
              {statusOpcoes.map((item) => (
                <option key={item} value={item}>
                  {textoStatus(item)}
                </option>
              ))}
            </select>
            <select
              value={modelo}
              onChange={(event) =>
                ir({
                  modelo: event.target.value,
                })
              }
              className="updv-select w-[140px]"
            >
              <option value="todos">Todos os modelos</option>
              <option value="65">NFC-e</option>
              <option value="55">NF-e</option>
              <option value="sem_modelo">Sem modelo</option>
            </select>
            <VendasPeriodoFiltro
              filtros={{
                ...filtros,
                q: busca.trim(),
              }}
              dataHojeIso={dataHojeIso}
            />
          </>
        }
      />

      <DataTable minWidth={1180}>
        <thead>
          <tr>
            <th>Venda</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Operador</th>
            <th>Origem</th>
            <th>Pagamento</th>
            <th>Status</th>
            <th>Fiscal</th>
            <th className="num">Total</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {vendasFiltradas.map((venda) => {
            const rotaEdicao = resolverRotaEdicaoVenda({
              vendaId: venda.id,
              origem: venda.origem,
              operacaoFiscalId: venda.operacaoFiscalId,
              statusFiscal: venda.fiscal?.status,
            });
            const emitirNfe = resolverRotaEmissaoListaVenda({
              vendaId: venda.id,
              origem: venda.origem,
              operacaoFiscalId: venda.operacaoFiscalId,
              statusFiscal: venda.fiscal?.status,
              modelo: "55",
            });
            const emitirNfce = resolverRotaEmissaoListaVenda({
              vendaId: venda.id,
              origem: venda.origem,
              operacaoFiscalId: venda.operacaoFiscalId,
              statusFiscal: venda.fiscal?.status,
              modelo: "65",
            });
            return (
            <tr key={venda.id}>
              <td className="font-medium">#{venda.numero ?? "—"}</td>
              <td>{formatarData(venda.dataVenda)}</td>
              <td className="max-w-[220px] truncate font-medium">
                {venda.cliente}
              </td>
              <td className="max-w-[180px] truncate">{venda.usuario}</td>
              <td>
                <StatusBadge status={venda.origem}>
                  {rotuloOrigemVendaComercial(venda.origem)}
                </StatusBadge>
              </td>
              <td>
                {venda.pagamentos.length > 0
                  ? venda.pagamentos.map((item) => item.nome).join(" + ")
                  : "—"}
              </td>
              <td>
                <StatusBadge status={venda.status} />
              </td>
              <td>
                {venda.fiscal ? (
                  <div className="space-y-0.5">
                    <StatusBadge
                      status={venda.fiscal.status}
                    >
                      {fiscalLabel(venda)}
                    </StatusBadge>
                    {fiscalResumo(venda)}
                  </div>
                ) : (
                  modeloFiscal(venda.modeloFiscalIntencao)
                )}
              </td>
              <td className="num font-medium">
                {moeda.format(venda.valorTotal)}
              </td>
              <td>
                <RowActions
                  editHref={`/vendas/${venda.id}`}
                  editLabel="Abrir"
                  extra={
                    venda.fiscal &&
                    (venda.fiscal.status === "autorizada" ||
                      venda.fiscal.status === "cancelada") ? (
                      <DocumentoFiscalBotoes
                        emissaoId={venda.fiscal.id}
                        modelo={venda.fiscal.modelo}
                        compacto
                        somente="pdf"
                      />
                    ) : null
                  }
                  items={[
                    {
                      label: "Abrir venda",
                      href: `/vendas/${venda.id}`,
                    },
                    {
                      label: rotaEdicao.label,
                      href: rotaEdicao.href,
                      hidden: rotaEdicao.modo === "venda_detalhe",
                    },
                    {
                      label: "Imprimir comprovante de venda",
                      onClick: () =>
                        void imprimirPeloConector(
                          `/api/impressao/recibo/${venda.id}?papel=80mm`,
                          "recibo",
                          "80mm"
                        ),
                      hidden: venda.status !== "finalizada",
                    },
                    {
                      label: "Visualizar comprovante",
                      href: `/pdv/imprimir/recibo/${venda.id}`,
                      target: "_blank",
                      hidden: venda.status !== "finalizada",
                    },
                    {
                      label: emitirNfe.label,
                      href: emitirNfe.href,
                      hidden: emitirNfe.ocultar,
                    },
                    {
                      label: emitirNfce.label,
                      href: emitirNfce.href,
                      hidden: emitirNfce.ocultar,
                    },
                    {
                      label: "Imprimir DANFE",
                      onClick: () => {
                        if (!venda.fiscal) {
                          return;
                        }
                        void imprimirPeloConector(
                          `/api/impressao/danfe/${venda.fiscal.id}`,
                          venda.fiscal.modelo === "55"
                            ? "danfe_nfe"
                            : "danfe_nfce",
                          venda.fiscal.modelo === "55" ? "a4" : "80mm"
                        );
                      },
                      hidden:
                        !venda.fiscal ||
                        venda.fiscal.status !== "autorizada",
                    },
                    {
                      label: "Abrir DANFE",
                      href: venda.fiscal
                        ? `/api/fiscal/emissoes/${venda.fiscal.id}/arquivo?tipo=pdf`
                        : undefined,
                      hidden:
                        !venda.fiscal ||
                        (venda.fiscal.status !== "autorizada" &&
                          venda.fiscal.status !== "cancelada"),
                    },
                    {
                      label: "Excluir",
                      danger: true,
                      onClick: () =>
                        setVendaExcluir({
                          id: venda.id,
                          numero: venda.numero,
                        }),
                    },
                  ]}
                />
              </td>
            </tr>
            );
          })}
          {vendasFiltradas.length === 0 && (
            <DataTableEmpty colSpan={10}>
              Nenhuma venda encontrada com os filtros atuais.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>

      {vendaExcluir && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-zinc-950/40 p-4">
          <div className="mt-16 w-full max-w-2xl">
            <CancelarVendaComercial
              key={vendaExcluir.id}
              vendaId={vendaExcluir.id}
              numero={vendaExcluir.numero}
              iniciarAberto
              onFechar={() => setVendaExcluir(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
