import {
  ERRO_CELULAR_CATALOGO,
  celularBrasileiroValido,
  formatarTelefoneBrasileiro,
  normalizarTelefoneBrasileiro,
} from "./telefone";

export const CATALOGO_SLUG_MIN = 2;
export const CATALOGO_SLUG_MAX = 48;
export const CATALOGO_QTD_MAX = 99;
export const CATALOGO_ITENS_MAX = 30;
export const CATALOGO_OBS_MAX = 500;
export const CATALOGO_NOME_MAX = 80;
export const CATALOGO_IMAGEM_MAX_BYTES = 5 * 1024 * 1024;

export const CATALOGO_SLUGS_RESERVADOS = new Set([
  "admin",
  "api",
  "cadastro",
  "catalogo",
  "configuracoes",
  "login",
  "onboarding",
  "painel",
  "pdv",
  "produtos",
  "ultrapdv",
  "vendas",
  "www",
]);

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizarSlug(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CATALOGO_SLUG_MAX);
}

export function validarSlug(valor: string) {
  const slug = normalizarSlug(valor);

  if (
    slug.length < CATALOGO_SLUG_MIN ||
    slug.length > CATALOGO_SLUG_MAX
  ) {
    return {
      ok: false as const,
      erro: "O link deve ter entre 2 e 48 caracteres.",
    };
  }

  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false as const,
      erro: "Use apenas letras minúsculas, números e hífen.",
    };
  }

  if (CATALOGO_SLUGS_RESERVADOS.has(slug)) {
    return {
      ok: false as const,
      erro: "Este link está reservado. Escolha outro.",
    };
  }

  return { ok: true as const, slug };
}

export function normalizarWhatsapp(valor: string) {
  return normalizarTelefoneBrasileiro(valor);
}

export function validarWhatsapp(valor: string) {
  const numero = normalizarTelefoneBrasileiro(valor);

  if (!celularBrasileiroValido(numero)) {
    return {
      ok: false as const,
      erro: ERRO_CELULAR_CATALOGO,
    };
  }

  return { ok: true as const, numero };
}

export function validarQuantidadeCatalogo(valor: number) {
  return (
    Number.isFinite(valor) &&
    valor > 0 &&
    valor <= CATALOGO_QTD_MAX
  );
}

export function recalcularPedido(itens: Array<{ quantidade: number; precoAtual: number }>) {
  const linhas = itens.map((item) => {
    const quantidade = Number(item.quantidade);
    const preco = Number(item.precoAtual);

    if (!validarQuantidadeCatalogo(quantidade)) {
      throw new Error("Quantidade inválida.");
    }

    if (!Number.isFinite(preco) || preco < 0) {
      throw new Error("Preço inválido.");
    }

    const precoUnitario = Math.round(preco * 100) / 100;
    const subtotal =
      Math.round(precoUnitario * quantidade * 100) / 100;

    return {
      quantidade,
      precoUnitario,
      subtotal,
    };
  });

  const total = Math.round(
    linhas.reduce((soma, item) => soma + item.subtotal, 0) * 100
  ) / 100;

  return { linhas, total };
}

export function disponibilidadePublica(quantidade: number) {
  if (quantidade > 0 && quantidade <= 3) {
    return "ultimas" as const;
  }

  if (quantidade > 0) {
    return "disponivel" as const;
  }

  return "esgotado" as const;
}

export function rotuloDisponibilidade(
  valor: "disponivel" | "ultimas" | "esgotado"
) {
  if (valor === "ultimas") {
    return "Últimas unidades";
  }

  if (valor === "esgotado") {
    return "Esgotado";
  }

  return "Disponível";
}

export function produtoVisivelNoCatalogo(input: {
  catalogoAtivo: boolean;
  produtoAtivo: boolean;
  catalogoPublicado: boolean;
  quantidade: number;
  produtoSemEstoque: "mostrar_esgotado" | "ocultar";
}) {
  if (
    !input.catalogoAtivo ||
    !input.produtoAtivo ||
    !input.catalogoPublicado
  ) {
    return false;
  }

  if (
    input.quantidade <= 0 &&
    input.produtoSemEstoque === "ocultar"
  ) {
    return false;
  }

  return true;
}

export function precoPublico(input: {
  mostrarPreco: boolean;
  precoVenda: number;
}) {
  if (!input.mostrarPreco) {
    return null;
  }

  return Math.round(Number(input.precoVenda) * 100) / 100;
}

export function formatarMoeda(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function codigoPedidoAmigavel(codigo: number) {
  return `#${codigo}`;
}

export function pedidoPodeConverter(status: string, vendaId?: string | null) {
  if (vendaId) {
    return false;
  }

  return (
    status === "NOVO" ||
    status === "EM_ATENDIMENTO" ||
    status === "ACEITO"
  );
}

export function formatarWhatsappExibicao(valor: string) {
  const nacional = normalizarTelefoneBrasileiro(valor);

  if (nacional.length === 11) {
    return formatarTelefoneBrasileiro(nacional);
  }

  if (nacional.length === 10) {
    return nacional.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  }

  return nacional;
}

export function montarObservacaoPedidoPdv(input: {
  codigo: number;
  clienteNome: string;
  clienteWhatsapp: string;
  tipoEntrega: "retirada" | "entrega";
  endereco?: string | null;
  observacao?: string | null;
}) {
  const linhas = [
    `Pedido Online ${codigoPedidoAmigavel(input.codigo)}`,
    `Cliente: ${input.clienteNome} · WhatsApp: ${formatarWhatsappExibicao(input.clienteWhatsapp)}`,
    `Forma: ${input.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}`,
  ];

  if (input.endereco) {
    linhas.push(`Endereço: ${input.endereco}`);
  }

  if (input.observacao?.trim()) {
    linhas.push(`Obs: ${input.observacao.trim()}`);
  }

  return linhas.join("\n");
}
