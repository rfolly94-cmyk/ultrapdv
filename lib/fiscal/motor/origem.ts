import { ORIGENS_MERCADORIA, existeCodigo } from "@/lib/fiscal/tabelas-fiscais";

import { marcaNaoDeterminaOrigem } from "./texto";

export type FonteOrigemMercadoria = "produto" | "nfe_entrada" | "usuario" | "incerta";

export type EvidenciaOrigemEntrada = {
  origem: string | null;
  ncm: string | null;
  cest: string | null;
  descricao: string | null;
  cfop: string | null;
  cst: string | null;
};

export function descricaoOrigemMercadoria(codigo: string | null | undefined) {
  const valor = String(codigo ?? "").trim();
  const opcao = ORIGENS_MERCADORIA.find((item) => item.codigo === valor);
  return opcao ? `${opcao.codigo} — ${opcao.descricao}` : null;
}

export function origemMercadoriaValida(codigo: string | null | undefined) {
  return existeCodigo(ORIGENS_MERCADORIA, String(codigo ?? "").trim());
}

export function origemAlteraTributacao(params: {
  origemAtual: string | null;
  origemResolvida: string | null;
}) {
  const atual = String(params.origemAtual ?? "").trim();
  const resolvida = String(params.origemResolvida ?? "").trim();
  return Boolean(atual && resolvida && atual !== resolvida);
}

export function resolverOrigemMercadoria(params: {
  origemConfirmadaProduto?: string | null;
  evidenciaEntrada?: EvidenciaOrigemEntrada | null;
  origemInformadaUsuario?: string | null;
  marca?: string | null;
}): {
  codigo: string | null;
  descricao: string | null;
  fonte: FonteOrigemMercadoria;
  motivo: string;
  perguntar: boolean;
} {
  const produto = String(params.origemConfirmadaProduto ?? "").trim();
  if (origemMercadoriaValida(produto)) {
    return {
      codigo: produto,
      descricao: descricaoOrigemMercadoria(produto),
      fonte: "produto",
      motivo: "Origem já confirmada no cadastro fiscal do produto.",
      perguntar: false,
    };
  }

  const entrada = String(params.evidenciaEntrada?.origem ?? "").trim();
  if (origemMercadoriaValida(entrada)) {
    return {
      codigo: entrada,
      descricao: descricaoOrigemMercadoria(entrada),
      fonte: "nfe_entrada",
      motivo:
        "Origem lida como evidência da NF-e de entrada. O fornecedor pode estar incorreto; conferir com a base oficial.",
      perguntar: false,
    };
  }

  const usuario = String(params.origemInformadaUsuario ?? "").trim();
  if (origemMercadoriaValida(usuario)) {
    return {
      codigo: usuario,
      descricao: descricaoOrigemMercadoria(usuario),
      fonte: "usuario",
      motivo: "Origem informada explicitamente pelo usuário nesta conversa.",
      perguntar: false,
    };
  }

  const marca = String(params.marca ?? "").trim();
  const recusaMarca = marcaNaoDeterminaOrigem(marca)
    ? ` A marca ${marca} não determina origem (nacional ou importada).`
    : marca
      ? " Marca não é evidência de origem."
      : "";

  return {
    codigo: null,
    descricao: null,
    fonte: "incerta",
    motivo: `Origem da mercadoria não confirmada.${recusaMarca} Informe se é nacional, importação direta ou estrangeira adquirida no mercado interno.`,
    perguntar: true,
  };
}

export function perguntaOrigemMercadoria() {
  return [
    "A mercadoria é nacional ou estrangeira?",
    "Se estrangeira: importação direta ou adquirida no mercado interno?",
    "Há conteúdo de importação conhecido (códigos 3, 5 ou 8)?",
  ];
}
