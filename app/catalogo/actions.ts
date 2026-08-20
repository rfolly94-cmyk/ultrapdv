"use server";

import { createClient } from "@/lib/supabase/server";
import {
  CATALOGO_ITENS_MAX,
  CATALOGO_OBS_MAX,
  validarQuantidadeCatalogo,
  validarSlug,
  validarWhatsapp,
} from "@/lib/catalogo/regras";

export type ResultadoPedidoCatalogo =
  | {
      ok: true;
      codigo: number;
      total: number;
    }
  | {
      ok: false;
      erro: string;
    };

export async function criarPedidoCatalogo(input: {
  slug: string;
  clienteNome: string;
  clienteWhatsapp: string;
  tipoEntrega: "retirada" | "entrega";
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  referencia?: string;
  observacao?: string;
  itens: Array<{
    produtoId: string;
    quantidade: number;
    preco?: number;
  }>;
}): Promise<ResultadoPedidoCatalogo> {
  const slug = validarSlug(input.slug);

  if (!slug.ok) {
    return { ok: false, erro: "Catálogo não encontrado." };
  }

  const nome = String(input.clienteNome ?? "").trim();

  if (nome.length < 2 || nome.length > 80) {
    return { ok: false, erro: "Informe o nome." };
  }

  const whatsapp = validarWhatsapp(input.clienteWhatsapp);

  if (!whatsapp.ok) {
    return { ok: false, erro: whatsapp.erro };
  }

  if (
    input.tipoEntrega !== "retirada" &&
    input.tipoEntrega !== "entrega"
  ) {
    return { ok: false, erro: "Informe retirada ou entrega." };
  }

  const observacao = String(input.observacao ?? "").trim();

  if (observacao.length > CATALOGO_OBS_MAX) {
    return {
      ok: false,
      erro: "A observação deve ter no máximo 500 caracteres.",
    };
  }

  if (!Array.isArray(input.itens) || input.itens.length < 1) {
    return { ok: false, erro: "O carrinho está vazio." };
  }

  if (input.itens.length > CATALOGO_ITENS_MAX) {
    return { ok: false, erro: "O pedido ultrapassou o limite de itens." };
  }

  let itens: Array<{ produto_id: string; quantidade: number }>;

  try {
    itens = input.itens.map((item) => {
      if (!validarQuantidadeCatalogo(Number(item.quantidade))) {
        throw new Error("Quantidade inválida.");
      }

      return {
        produto_id: item.produtoId,
        quantidade: Number(item.quantidade),
      };
    });
  } catch {
    return { ok: false, erro: "Quantidade inválida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_catalogo_criar_pedido", {
    p_slug: slug.slug,
    p_cliente_nome: nome,
    p_cliente_whatsapp: whatsapp.numero,
    p_tipo_entrega: input.tipoEntrega,
    p_cep: input.cep ?? null,
    p_rua: input.rua ?? null,
    p_numero: input.numero ?? null,
    p_bairro: input.bairro ?? null,
    p_complemento: input.complemento ?? null,
    p_cidade: input.cidade ?? null,
    p_referencia: input.referencia ?? null,
    p_observacao: observacao || null,
    p_itens: itens,
  });

  if (error) {
    return {
      ok: false,
      erro: error.message || "Não foi possível enviar o pedido.",
    };
  }

  const registro = data as {
    ok?: boolean;
    codigo?: number;
    total?: number;
  } | null;

  if (!registro?.ok || !registro.codigo) {
    return { ok: false, erro: "Não foi possível confirmar o pedido." };
  }

  return {
    ok: true,
    codigo: Number(registro.codigo),
    total: Number(registro.total ?? 0),
  };
}
