import { redirect } from "next/navigation";

import {
  VendasLista,
  type VendaListaItem,
} from "@/components/vendas/vendas-lista";
import {
  filtrarRegistrosDaEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import { carregarFusoHorarioFiscal } from "@/lib/fiscal/fuso-horario-empresa";
import { createClient } from "@/lib/supabase/server";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";
import {
  dataColunaListaVenda,
  filtroCoalesceDataVenda,
  parseFiltrosListaVendas,
  resolverPeriodoListaVendas,
  vendaNoPeriodoLista,
} from "@/lib/vendas/periodo-lista";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import { resolverOrigemVendaComercial } from "@/lib/vendas/resolver-rota-edicao-venda";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    periodo?: string;
    inicio?: string;
    fim?: string;
    status?: string;
    modelo?: string;
    q?: string;
  }>;
};

function idsUnicos(
  valores: Array<string | null | undefined>
) {
  return Array.from(
    new Set(
      valores.filter(
        (valor): valor is string =>
          typeof valor === "string" &&
          valor.length > 0
      )
    )
  );
}

export default async function VendasPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const filtros = parseFiltrosListaVendas(params);
  const supabase = await createClient();

  const {
    data: claimsData,
    error: authError,
  } = await supabase.auth.getClaims();

  const authUserId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !authUserId
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "vendas"
  );
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(
      String(vinculo.empresa_id)
    );
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Vendas"
            descricao="Este recurso não está disponível no plano atual da sua empresa. Lista, detalhe, edição e cancelamento humanos de vendas estão disponíveis em planos que incluem este recurso. O PDV continua finalizando vendas, e estoque, pagamentos, carteira e emissão fiscal seguem pelos recursos correspondentes. As vendas já registradas não são apagadas."
            planoNome={entitlements.planoNome}
            voltarHref="/pdv"
            voltarLabel="Ir ao PDV"
          />
        </div>
      </main>
    );
  }

  const { data: fiscalEmpresa } = await supabase
    .from("empresas_fiscal")
    .select("empresa_id, fuso_horario")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  const fusoHorario =
    carregarFusoHorarioFiscal(
      fiscalEmpresa,
      vinculo.empresa_id
    ) || "America/Sao_Paulo";

  const janela = resolverPeriodoListaVendas(
    filtros.periodo,
    filtros.inicio,
    filtros.fim,
    fusoHorario
  );

  const pedidosNovosResult = await supabase
    .from("catalogo_pedidos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", vinculo.empresa_id)
    .eq("status", "NOVO");

  const pedidosNovos = pedidosNovosResult.error
    ? 0
    : (pedidosNovosResult.count ?? 0);

  const {
    data: vendas,
    error: vendasError,
  } = await supabase
    .from("vendas")
    .select(`
      id,
      empresa_id,
      numero,
      cliente_id,
      usuario_id,
      status,
      tipo_venda,
      modelo_fiscal_intencao,
      valor_produtos,
      desconto,
      acrescimo,
      frete,
      valor_total,
      troco,
      observacao,
      finalizada_at,
      created_at
    `)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .or(
      filtroCoalesceDataVenda(
        janela.inicio,
        janela.fim
      )
    )
    .order(
      "created_at",
      { ascending: false }
    )
    .limit(300);

  if (vendasError) {
    throw new Error(
      `Erro ao listar vendas: ${vendasError.message}`
    );
  }

  const vendasSeguras =
    filtrarRegistrosDaEmpresaAtiva(
      vendas ?? [],
      vinculo.empresa_id
    ).filter((venda) =>
      vendaNoPeriodoLista(
        dataColunaListaVenda(venda),
        janela.inicio,
        janela.fim
      )
    );

  const clienteIds =
    idsUnicos(
      vendasSeguras.map(
        (venda) =>
          venda.cliente_id
      )
    );

  const usuarioIds =
    idsUnicos(
      vendasSeguras.map(
        (venda) =>
          venda.usuario_id
      )
    );

  const vendaIds =
    vendasSeguras.map(
      (venda) =>
        venda.id
    );

  const clientesMap =
    new Map<string, string>();

  if (clienteIds.length > 0) {
    const {
      data: clientes,
      error: clientesError,
    } = await supabase
      .from("clientes")
      .select("id, nome")
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .in("id", clienteIds);

    if (clientesError) {
      throw new Error(
        `Erro ao carregar clientes das vendas: ${clientesError.message}`
      );
    }

    for (const cliente of clientes ?? []) {
      clientesMap.set(
        cliente.id,
        cliente.nome
      );
    }
  }

  const usuariosMap =
    new Map<string, string>();

  if (usuarioIds.length > 0) {
    const {
      data: usuarios,
      error: usuariosError,
    } = await supabase
      .from("usuarios")
      .select("id, nome")
      .in("id", usuarioIds);

    if (usuariosError) {
      throw new Error(
        `Erro ao carregar usuários das vendas: ${usuariosError.message}`
      );
    }

    for (const usuario of usuarios ?? []) {
      usuariosMap.set(
        usuario.id,
        usuario.nome
      );
    }
  }

  type PagamentoLinha = {
    venda_id: string;
    forma_pagamento_nome: string | null;
    forma_pagamento_codigo: string | null;
    codigo_fiscal: string | null;
    valor: number | string;
    status: string;
  };

  let pagamentos: PagamentoLinha[] = [];

  if (vendaIds.length > 0) {
    const {
      data,
      error,
    } = await supabase
      .from("vendas_pagamentos")
      .select(`
        venda_id,
        forma_pagamento_nome,
        forma_pagamento_codigo,
        codigo_fiscal,
        valor,
        status
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .in(
        "venda_id",
        vendaIds
      );

    if (error) {
      throw new Error(
        `Erro ao carregar pagamentos das vendas: ${error.message}`
      );
    }

    pagamentos =
      (data ?? []) as PagamentoLinha[];
  }

  type EmissaoFiscalLinha = {
    id: string;
    origem_id: string | null;
    modelo: string;
    serie: number;
    numero: number | string;
    status: string;
    chave_acesso: string | null;
    protocolo: string | null;
    cstat: string | null;
    motivo: string | null;
    xml_hex: string | null;
    pdf_hex: string | null;
    autorizada_at: string | null;
    created_at: string;
  };

  let emissoesFiscais:
    EmissaoFiscalLinha[] = [];

  if (vendaIds.length > 0) {
    const {
      data,
      error,
    } = await supabase
      .from("fiscal_emissoes")
      .select(`
        id,
        origem_id,
        modelo,
        serie,
        numero,
        status,
        chave_acesso,
        protocolo,
        cstat,
        motivo,
        xml_hex,
        pdf_hex,
        autorizada_at,
        created_at
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "origem_tipo",
        "venda"
      )
      .in(
        "origem_id",
        vendaIds
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

    if (error) {
      throw new Error(
        `Erro ao carregar situação fiscal das vendas: ${error.message}`
      );
    }

    emissoesFiscais =
      (data ?? []) as
        EmissaoFiscalLinha[];
  }

  const origemPorVenda =
    new Map<string, string>();

  if (vendaIds.length > 0) {
    const {
      data: operacoesVenda,
      error: operacoesVendaError,
    } = await supabase
      .from("fiscal_operacoes")
      .select("id, venda_id")
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "tipo_operacao_interno",
        "venda"
      )
      .in(
        "venda_id",
        vendaIds
      );

    if (operacoesVendaError) {
      throw new Error(
        `Erro ao carregar origem das vendas: ${operacoesVendaError.message}`
      );
    }

    for (const operacao of operacoesVenda ?? []) {
      if (!operacao.venda_id) {
        continue;
      }
      origemPorVenda.set(
        String(operacao.venda_id),
        String(operacao.id)
      );
    }
  }

  const fiscalPorVenda =
    new Map<
      string,
      EmissaoFiscalLinha
    >();

  const prioridadeFiscal =
    (status: string) => {
      if (status === "autorizada") {
        return 100;
      }

      if (
        [
          "enviando",
          "aguardando_reconciliacao",
          "erro_comunicacao",
        ].includes(status)
      ) {
        return 80;
      }

      if (status === "cancelada") {
        return 70;
      }

      if (status === "rejeitada") {
        return 50;
      }

      return 10;
    };

  for (const emissao of emissoesFiscais) {
    if (!emissao.origem_id) {
      continue;
    }

    const atual =
      fiscalPorVenda.get(
        emissao.origem_id
      );

    if (
      !atual ||
      prioridadeFiscal(
        emissao.status
      ) >
        prioridadeFiscal(
          atual.status
        )
    ) {
      fiscalPorVenda.set(
        emissao.origem_id,
        emissao
      );
    }
  }

  const pagamentosPorVenda =
    new Map<
      string,
      Array<{
        nome: string;
        codigo: string | null;
        codigoFiscal: string | null;
        valor: number;
        status: string;
      }>
    >();

  for (const pagamento of pagamentos) {
    if (!pagamentoFinanceiramenteValido(pagamento.status)) {
      continue;
    }

    const lista =
      pagamentosPorVenda.get(
        pagamento.venda_id
      ) ?? [];

    lista.push({
      nome:
        pagamento.forma_pagamento_nome ??
        pagamento.forma_pagamento_codigo ??
        "Pagamento",
      codigo:
        pagamento.forma_pagamento_codigo,
      codigoFiscal:
        pagamento.codigo_fiscal,
      valor:
        Number(
          pagamento.valor ?? 0
        ),
      status:
        pagamento.status,
    });

    pagamentosPorVenda.set(
      pagamento.venda_id,
      lista
    );
  }

  const itens: VendaListaItem[] =
    vendasSeguras.map(
      (venda) => ({
        id:
          venda.id,
        numero:
          venda.numero,
        cliente:
          venda.cliente_id
            ? clientesMap.get(
                venda.cliente_id
              ) ??
              "Cliente não encontrado"
            : "Consumidor",
        usuario:
          venda.usuario_id
            ? usuariosMap.get(
                venda.usuario_id
              ) ??
              "Usuário não encontrado"
            : "—",
        status:
          venda.status,
        tipoVenda:
          venda.tipo_venda,
        origem: resolverOrigemVendaComercial(
          origemPorVenda.get(
            venda.id
          )
        ),
        operacaoFiscalId:
          origemPorVenda.get(
            venda.id
          ) ?? null,
        modeloFiscalIntencao:
          venda.modelo_fiscal_intencao,
        valorProdutos:
          Number(
            venda.valor_produtos ?? 0
          ),
        desconto:
          Number(
            venda.desconto ?? 0
          ),
        acrescimo:
          Number(
            venda.acrescimo ?? 0
          ),
        frete:
          Number(
            venda.frete ?? 0
          ),
        valorTotal:
          Number(
            venda.valor_total ?? 0
          ),
        troco:
          Number(
            venda.troco ?? 0
          ),
        dataVenda:
          dataColunaListaVenda(
            venda
          ),
        pagamentos:
          pagamentosPorVenda.get(
            venda.id
          ) ?? [],
        fiscal: (() => {
          const emissao =
            fiscalPorVenda.get(
              venda.id
            );

          if (!emissao) {
            return null;
          }

          return {
            id:
              emissao.id,
            modelo:
              emissao.modelo,
            serie:
              emissao.serie,
            numero:
              String(
                emissao.numero
              ),
            status:
              emissao.status,
            chaveAcesso:
              emissao.chave_acesso,
            protocolo:
              emissao.protocolo,
            cstat:
              emissao.cstat,
            motivo:
              emissao.motivo,
            temXml:
              Boolean(
                emissao.xml_hex
              ),
            temPdf:
              Boolean(
                emissao.pdf_hex
              ),
          };
        })(),
      })
    );

  return (
    <VendasLista
      key={[
        filtros.periodo,
        filtros.inicio,
        filtros.fim,
        filtros.status,
        filtros.modelo,
        filtros.q,
      ].join("|")}
      vendas={itens}
      pedidosNovos={pedidosNovos ?? 0}
      filtros={filtros}
      dataHojeIso={janela.hojeIso}
    />
  );
}
