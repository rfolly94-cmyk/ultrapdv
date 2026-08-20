import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { normalizarUnidadeMedida } from "@/lib/produtos/unidades-medida";
import type { ProdutoCandidatoEntrada } from "./sugerir-produto";
import { sugerirProdutoEntrada } from "./sugerir-produto";

export type VinculoFornecedorProduto = {
  id: string;
  empresa_id: string;
  fornecedor_id: string;
  produto_id: string;
  codigo_produto_fornecedor: string;
  ean_fornecedor?: string | null;
  fator_conversao: number;
  ativo: boolean;
};

export type OrigemReconhecimentoEntrada =
  | "vinculo_salvo"
  | "ean_vinculo"
  | "ean"
  | "codigo"
  | "descricao"
  | "novo";

export type ReconhecimentoItemEntrada = {
  origem: OrigemReconhecimentoEntrada;
  autoVincular: boolean;
  produtoId: string | null;
  rotulo: string;
  fatorConversao: number;
};

export function codigoFornecedorNormalizado(valor: unknown) {
  return String(valor ?? "").trim();
}

export function unidadesEntradaDiferentes(
  unidadeXml?: string | null,
  unidadeProduto?: string | null
) {
  const xml = normalizarUnidadeMedida(unidadeXml);
  const produto = normalizarUnidadeMedida(unidadeProduto);
  if (!xml || !produto) {
    return false;
  }
  return xml !== produto;
}

export function fatorConversaoPodeConfirmar(params: {
  unidadeXml?: string | null;
  unidadeProduto?: string | null;
  fatorConversao?: number | null;
  confirmado?: boolean | null;
}) {
  if (!unidadesEntradaDiferentes(params.unidadeXml, params.unidadeProduto)) {
    return true;
  }
  return params.confirmado === true && Number(params.fatorConversao ?? 0) > 0;
}

export function quantidadeEfetivaEstoque(
  quantidadeRecebida: number,
  fatorConversao: number
) {
  const qtd = Number(quantidadeRecebida ?? 0);
  const fator = Number(fatorConversao ?? 0);
  if (!(qtd > 0) || !(fator > 0)) {
    return 0;
  }
  return Number((qtd * fator).toFixed(4));
}

export function rotuloOrigemReconhecimento(
  origem: OrigemReconhecimentoEntrada
) {
  if (origem === "vinculo_salvo") {
    return "Vínculo salvo";
  }
  if (origem === "ean_vinculo") {
    return "Mesmo EAN de um vínculo deste fornecedor";
  }
  if (origem === "ean") {
    return "Encontrado por EAN";
  }
  if (origem === "codigo") {
    return "Sugestão por código";
  }
  if (origem === "descricao") {
    return "Sugestão por descrição";
  }
  return "Produto não encontrado";
}

export function reconhecerItemEntrada(params: {
  empresaIdAtiva: string;
  fornecedorId?: string | null;
  codigoFornecedor?: string | null;
  ean?: string | null;
  descricao?: string | null;
  vinculos: VinculoFornecedorProduto[];
  produtos: ProdutoCandidatoEntrada[];
}): ReconhecimentoItemEntrada {
  const empresaId = String(params.empresaIdAtiva ?? "").trim();
  const fornecedorId = String(params.fornecedorId ?? "").trim();
  const codigo = codigoFornecedorNormalizado(params.codigoFornecedor);
  const daEmpresa = params.vinculos.filter(
    (vinculo) =>
      registroPertenceAEmpresaAtiva(vinculo, empresaId) &&
      vinculo.ativo &&
      String(vinculo.fornecedor_id) === fornecedorId
  );

  if (codigo) {
    const porCprod = daEmpresa.find(
      (vinculo) =>
        codigoFornecedorNormalizado(vinculo.codigo_produto_fornecedor) ===
        codigo
    );
    if (porCprod) {
      return {
        origem: "vinculo_salvo",
        autoVincular: true,
        produtoId: porCprod.produto_id,
        rotulo: rotuloOrigemReconhecimento("vinculo_salvo"),
        fatorConversao: Number(porCprod.fator_conversao ?? 1),
      };
    }
  }

  const ean = String(params.ean ?? "").replace(/\D/g, "");
  if (ean.length >= 8) {
    const porEanVinculo = daEmpresa.find(
      (vinculo) => String(vinculo.ean_fornecedor ?? "").replace(/\D/g, "") === ean
    );
    if (porEanVinculo) {
      return {
        origem: "ean_vinculo",
        autoVincular: false,
        produtoId: porEanVinculo.produto_id,
        rotulo: rotuloOrigemReconhecimento("ean_vinculo"),
        fatorConversao: Number(porEanVinculo.fator_conversao ?? 1),
      };
    }
  }

  const sugestao = sugerirProdutoEntrada(
    {
      ean: params.ean,
      codigoFornecedor: params.codigoFornecedor,
      descricao: params.descricao,
    },
    params.produtos,
    empresaId
  );

  if (sugestao?.motivo === "EAN/GTIN") {
    return {
      origem: "ean",
      autoVincular: false,
      produtoId: sugestao.produto.id,
      rotulo: rotuloOrigemReconhecimento("ean"),
      fatorConversao: 1,
    };
  }
  if (sugestao?.motivo === "código") {
    return {
      origem: "codigo",
      autoVincular: false,
      produtoId: sugestao.produto.id,
      rotulo: rotuloOrigemReconhecimento("codigo"),
      fatorConversao: 1,
    };
  }
  if (sugestao?.motivo === "descrição") {
    return {
      origem: "descricao",
      autoVincular: false,
      produtoId: sugestao.produto.id,
      rotulo: rotuloOrigemReconhecimento("descricao"),
      fatorConversao: 1,
    };
  }

  return {
    origem: "novo",
    autoVincular: false,
    produtoId: null,
    rotulo: rotuloOrigemReconhecimento("novo"),
    fatorConversao: 1,
  };
}
