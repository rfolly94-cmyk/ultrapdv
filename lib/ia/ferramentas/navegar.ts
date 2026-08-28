import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import {
  hrefCaixaAssistente,
  hrefCarteiraAssistente,
  hrefClienteAssistente,
  hrefConfiguracoesAssistente,
  hrefFiscalAssistente,
  hrefNfeNovaAssistente,
  hrefNovoClienteAssistente,
  hrefNovoProdutoAssistente,
  hrefPdvAssistente,
  hrefProdutoAssistente,
  hrefSeguroAssistente,
  hrefVendaAssistente,
} from "../rotas";
import type { NomeFerramentaIa, ResultadoFerramentaIa } from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

async function navegar(params: {
  ctx: ContextoFerramentaIa;
  ferramenta: NomeFerramentaIa;
  recurso: Parameters<typeof autorizarFerramentaIa>[0]["recurso"];
  acao: Parameters<typeof autorizarFerramentaIa>[0]["acao"];
  href: string;
  label: string;
  texto: string;
}): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: params.recurso,
    acao: params.acao,
  });
  if (!auth.ok) {
    return recusaFerramentaIa(params.ferramenta, auth);
  }
  const href = hrefSeguroAssistente(params.href);
  if (!href) {
    return {
      ok: false,
      ferramenta: params.ferramenta,
      erro: "Rota interna não permitida.",
      codigo: "falha",
    };
  }
  return {
    ok: true,
    ferramenta: params.ferramenta,
    dados: {
      navegacao: true,
      href,
      mensagem: params.texto,
    },
    acoes: [{ type: "navigate", label: params.label, href }],
  };
}

export async function abrirPdvIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_pdv",
    recurso: "pdv",
    acao: "acessar",
    href: hrefPdvAssistente(),
    label: "Abrir PDV",
    texto: "Vou abrir o PDV.",
  });
}

export async function abrirProdutosIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_produtos",
    recurso: "produtos",
    acao: "acessar",
    href: "/produtos",
    label: "Abrir produtos",
    texto: "Vou abrir o cadastro de produtos.",
  });
}

export async function novoProdutoIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "novo_produto",
    recurso: "produtos",
    acao: "acessar",
    href: hrefNovoProdutoAssistente(),
    label: "Novo produto",
    texto: "Vou abrir o cadastro de um produto novo. Nada será gravado pelo Assistente.",
  });
}

export async function abrirClientesIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_clientes",
    recurso: "clientes",
    acao: "acessar",
    href: "/clientes",
    label: "Abrir clientes",
    texto: "Vou abrir o cadastro de clientes.",
  });
}

export async function novoClienteIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "novo_cliente",
    recurso: "clientes",
    acao: "acessar",
    href: hrefNovoClienteAssistente(),
    label: "Novo cliente",
    texto: "Vou abrir o cadastro de cliente para você preencher os dados. O Assistente não grava cadastro.",
  });
}

export async function abrirVendasIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_vendas",
    recurso: "vendas",
    acao: "acessar",
    href: "/vendas",
    label: "Abrir vendas",
    texto: "Vou abrir a lista de vendas.",
  });
}

export async function abrirVendaIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  const vendaId = String(args.vendaId ?? ctx.tela.vendaId ?? "").trim();
  if (!vendaId) {
    return {
      ok: false,
      ferramenta: "abrir_venda" as const,
      erro: "Informe a venda para abrir.",
      codigo: "nao_encontrado" as const,
    };
  }
  return navegar({
    ctx,
    ferramenta: "abrir_venda",
    recurso: "vendas",
    acao: "acessar",
    href: hrefVendaAssistente(vendaId),
    label: "Abrir venda",
    texto: "Vou abrir essa venda. Qualquer cancelamento ou alteração precisa ser feito na tela oficial.",
  });
}

export async function abrirCaixaIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_caixa",
    recurso: "caixa",
    acao: "acessar",
    href: hrefCaixaAssistente(),
    label: "Abrir caixa",
    texto: "Vou abrir o Caixa para você realizar a operação. O Assistente não movimenta o caixa.",
  });
}

export async function abrirCarteiraIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  const clienteId = String(args.clienteId ?? ctx.tela.clienteId ?? "").trim();
  return navegar({
    ctx,
    ferramenta: "abrir_carteira",
    recurso: "clientes",
    acao: "acessar_carteira",
    href: clienteId ? hrefCarteiraAssistente(clienteId) : "/clientes",
    label: clienteId ? "Abrir carteira" : "Abrir clientes",
    texto: clienteId
      ? "Vou abrir a Carteira deste cliente. Recebimento e baixa só na tela oficial."
      : "Vou abrir os clientes para você acessar a Carteira.",
  });
}

export async function abrirFiscalIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_fiscal",
    recurso: "fiscal",
    acao: "acessar",
    href: hrefFiscalAssistente(),
    label: "Abrir fiscal",
    texto: "Vou abrir o módulo Fiscal.",
  });
}

export async function iniciarNfeIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "iniciar_nfe",
    recurso: "fiscal",
    acao: "acessar",
    href: hrefNfeNovaAssistente(),
    label: "Emitir NF-e",
    texto: "Vou abrir o fluxo oficial de NF-e. O Assistente não emite nem transmite documento fiscal.",
  });
}

export async function iniciarNfceIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "iniciar_nfce",
    recurso: "pdv",
    acao: "acessar",
    href: hrefPdvAssistente(),
    label: "Abrir PDV (NFC-e)",
    texto: "A NFC-e é emitida no PDV ou na venda. Vou abrir o PDV. O Assistente não transmite documento.",
  });
}

export async function abrirConfiguracoesIa(ctx: ContextoFerramentaIa) {
  return navegar({
    ctx,
    ferramenta: "abrir_configuracoes",
    recurso: "fiscal",
    acao: "acessar",
    href: hrefConfiguracoesAssistente(),
    label: "Abrir configurações fiscais",
    texto: "Vou abrir as configurações fiscais. O Assistente não altera configuração.",
  });
}

export function hrefProdutoFichaAssistente(produtoId: string) {
  return hrefProdutoAssistente(produtoId);
}

export function hrefClienteFichaAssistente(clienteId: string) {
  return hrefClienteAssistente(clienteId);
}
