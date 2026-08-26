import "server-only";

import { ehFormaPix } from "@/lib/pagamentos/pix/local-regras";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";
import type { createClient } from "@/lib/supabase/server";
import {
  layoutReciboPadrao,
  montarReciboVenda,
  type ReciboLayoutConfig,
  type ReciboVendaCompleto,
} from "./recibo-layout";
import { resolverLogoReciboEmpresa } from "./resolver-logo-recibo";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function montarEndereco(fiscal: {
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
} | null) {
  if (!fiscal) {
    return "";
  }
  const rua = [texto(fiscal.logradouro), texto(fiscal.numero)]
    .filter(Boolean)
    .join(", ");
  const cidade = [texto(fiscal.municipio), texto(fiscal.uf)]
    .filter(Boolean)
    .join("/");
  return [rua, texto(fiscal.bairro), cidade].filter(Boolean).join(" - ");
}

export async function carregarReciboVendaDaEmpresaAtiva(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  vendaId: string;
}): Promise<ReciboVendaCompleto | null> {
  const { supabase, empresaId, vendaId } = args;

  const { data: venda } = await supabase
    .from("vendas")
    .select(
      "id, empresa_id, numero, cliente_id, usuario_id, valor_produtos, valor_total, desconto, acrescimo, troco, observacao, finalizada_at, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("id", vendaId)
    .maybeSingle();

  if (!venda || venda.empresa_id !== empresaId) {
    return null;
  }

  const [
    empresaResult,
    fiscalResult,
    catalogoResult,
    clienteResult,
    itensResult,
    pagamentosResult,
    formasResult,
    vendedorResult,
    tituloResult,
  ] = await Promise.all([
    supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, cnpj, logo_path")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas_fiscal")
      .select(
        "inscricao_estadual, telefone, email, logradouro, numero, bairro, municipio, uf"
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("catalogo_config")
      .select("whatsapp_numero")
      .eq("empresa_id", empresaId)
      .maybeSingle()
      .then((resultado) =>
        resultado.error ? { data: null } : resultado
      ),
    venda.cliente_id
      ? supabase
          .from("clientes")
          .select(
            "id, empresa_id, nome, cpf_cnpj, telefone, saldo_devedor, limite_credito"
          )
          .eq("empresa_id", empresaId)
          .eq("id", venda.cliente_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("vendas_itens")
      .select(
        "produto_codigo, produto_nome, quantidade, valor_unitario, desconto, valor_total, empresa_id"
      )
      .eq("empresa_id", empresaId)
      .eq("venda_id", vendaId)
      .order("created_at", { ascending: true }),
    supabase
      .from("vendas_pagamentos")
      .select(
        "forma_pagamento_nome, forma_pagamento_codigo, valor, status, quantidade_parcelas, bandeira, empresa_id"
      )
      .eq("empresa_id", empresaId)
      .eq("venda_id", vendaId),
    supabase
      .from("formas_pagamento")
      .select("codigo, nome, tipo, permite_fiado, empresa_id")
      .eq("empresa_id", empresaId),
    venda.usuario_id
      ? supabase.from("usuarios").select("id, nome").eq("id", venda.usuario_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("carteira_cliente_titulos")
      .select("empresa_id, venda_id, valor_original, valor_aberto, vencimento, status")
      .eq("empresa_id", empresaId)
      .eq("venda_id", vendaId)
      .maybeSingle()
      .then((resultado) =>
        resultado.error ? { data: null } : resultado
      ),
  ]);

  const empresa = empresaResult.data;
  const fiscal = fiscalResult.data;
  const cliente =
    clienteResult.data && clienteResult.data.empresa_id === empresaId
      ? clienteResult.data
      : null;
  const formas = (formasResult.data ?? []).filter(
    (forma) => forma.empresa_id === empresaId
  );

  const pagamentos = (pagamentosResult.data ?? [])
    .filter(
      (item) =>
        item.empresa_id === empresaId &&
        pagamentoFinanceiramenteValido(item.status)
    )
    .map((item) => {
      const forma = formas.find(
        (candidato) =>
          texto(candidato.codigo).toLowerCase() ===
            texto(item.forma_pagamento_codigo).toLowerCase() ||
          texto(candidato.nome).toLowerCase() ===
            texto(item.forma_pagamento_nome).toLowerCase()
      );
      const fiado = Boolean(forma?.permite_fiado);
      return {
        nome: texto(item.forma_pagamento_nome) || "Pagamento",
        valor: numero(item.valor),
        parcelas: item.quantidade_parcelas ? numero(item.quantidade_parcelas) : null,
        bandeira: texto(item.bandeira) || null,
        pix: ehFormaPix({
          tipo: forma?.tipo,
          codigo: item.forma_pagamento_codigo,
          nome: item.forma_pagamento_nome,
        }),
        fiado,
      };
    });

  const valorFiado = pagamentos
    .filter((item) => item.fiado)
    .reduce((soma, item) => soma + item.valor, 0);
  const titulo =
    tituloResult.data && tituloResult.data.empresa_id === empresaId
      ? tituloResult.data
      : null;
  const saldoDevedor = cliente ? numero(cliente.saldo_devedor) : null;
  const limiteCredito = cliente ? numero(cliente.limite_credito) : null;
  const temFiado = valorFiado > 0 || Boolean(titulo && titulo.status !== "CANCELADO");
  const logo = await resolverLogoReciboEmpresa({
    supabase,
    empresaId,
    logoPath: empresa?.logo_path,
    incorporar: false,
  });

  return {
    vendaId: String(venda.id),
    numero: String(venda.numero ?? "—"),
    dataIso: venda.finalizada_at ?? venda.created_at,
    observacao: texto(venda.observacao) || null,
    clienteNome: texto(cliente?.nome) || "Consumidor",
    clienteDocumento: texto(cliente?.cpf_cnpj),
    clienteTelefone: texto(cliente?.telefone),
    vendedorNome: texto(vendedorResult.data?.nome),
    empresa: {
      nomeFantasia:
        texto(empresa?.nome_fantasia) || texto(empresa?.razao_social) || "Empresa",
      razaoSocial: texto(empresa?.razao_social),
      documento: texto(empresa?.cnpj),
      ie: texto(fiscal?.inscricao_estadual),
      endereco: montarEndereco(fiscal),
      telefone: texto(fiscal?.telefone),
      email: texto(fiscal?.email),
      whatsapp: texto(catalogoResult.data?.whatsapp_numero),
      logoUrl: logo.url,
    },
    itens: (itensResult.data ?? [])
      .filter((item) => item.empresa_id === empresaId)
      .map((item) => ({
        codigo: texto(item.produto_codigo),
        nome: texto(item.produto_nome) || "Item",
        quantidade: numero(item.quantidade),
        valorUnitario: numero(item.valor_unitario),
        desconto: numero(item.desconto),
        total: numero(item.valor_total),
      })),
    pagamentos,
    valorProdutos: numero(venda.valor_produtos ?? venda.valor_total),
    desconto: numero(venda.desconto),
    acrescimo: numero(venda.acrescimo),
    total: numero(venda.valor_total),
    troco: numero(venda.troco),
    carteira: temFiado
      ? {
          temFiado: true,
          valorFiado: valorFiado || numero(titulo?.valor_original),
          vencimento: titulo?.vencimento ? String(titulo.vencimento) : null,
          saldoDevedor,
          saldoAnterior:
            saldoDevedor != null
              ? Math.max(0, saldoDevedor - (valorFiado || numero(titulo?.valor_original)))
              : null,
          limiteCredito,
          creditoDisponivel:
            limiteCredito != null && saldoDevedor != null
              ? Math.max(0, limiteCredito - saldoDevedor)
              : null,
        }
      : null,
  };
}

export function linhasReciboComercial(
  recibo: ReciboVendaCompleto,
  layout?: ReciboLayoutConfig
) {
  return montarReciboVenda(recibo, layout ?? layoutReciboPadrao()).linhasPdf;
}
