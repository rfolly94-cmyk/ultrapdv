import {
  ORIGENS_MERCADORIA,
  existeCodigo,
} from "@/lib/fiscal/tabelas-fiscais";
import { somenteDigitos } from "@/lib/fiscal/status-fiscal-produto";

// Unidade tributável e fator de conversão ainda não existem.
// A unidade comercial continua em produtos.unidade_medida (UN → UN).

export type DadosFiscaisProduto = {
  ncm: string;
  cest: string;
  origemProduto: string;
};

export type LinhaProdutosFiscal = {
  empresa_id?: string | null;
  produto_id?: string | null;
  ncm?: string | null;
  cest?: string | null;
  origem_produto?: string | null;
};

export const MENSAGEM_NCM_INVALIDO =
  "O NCM deve possuir exatamente 8 dígitos.";

export const MENSAGEM_CEST_INVALIDO =
  "O CEST deve possuir exatamente 7 dígitos.";

export const MENSAGEM_ORIGEM_INVALIDA =
  "Origem da mercadoria inválida.";

export const MENSAGEM_FISCAL_NAO_GRAVADO =
  "O produto comercial foi salvo, mas a configuração fiscal não foi gravada.";

export function lerDadosFiscaisProduto(formData: FormData): DadosFiscaisProduto {
  const ncm = somenteDigitos(String(formData.get("ncm") ?? ""));
  const cest = somenteDigitos(String(formData.get("cest") ?? ""));
  const origemInformada = String(
    formData.get("origem_produto") ?? ""
  ).trim();

  return {
    ncm,
    cest,
    origemProduto: origemInformada || "0",
  };
}

export function validarDadosFiscaisProduto(
  dados: DadosFiscaisProduto
): string | null {
  if (dados.ncm && dados.ncm.length !== 8) {
    return MENSAGEM_NCM_INVALIDO;
  }

  if (dados.cest && dados.cest.length !== 7) {
    return MENSAGEM_CEST_INVALIDO;
  }

  if (!existeCodigo(ORIGENS_MERCADORIA, dados.origemProduto)) {
    return MENSAGEM_ORIGEM_INVALIDA;
  }

  return null;
}

export function payloadAtualizacaoFiscalProduto(
  dados: DadosFiscaisProduto,
  fiscalConfigurado: boolean
) {
  return {
    ncm: dados.ncm || null,
    cest: dados.cest || null,
    origem_produto: dados.origemProduto,
    fiscal_configurado: fiscalConfigurado,
  };
}

export function escolherFiscalDaEmpresa(
  raw: unknown,
  empresaId: string
): LinhaProdutosFiscal | null {
  if (!empresaId) {
    return null;
  }

  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const daEmpresa = rows.filter((row): row is LinhaProdutosFiscal => {
    if (!row || typeof row !== "object") {
      return false;
    }

    return (row as LinhaProdutosFiscal).empresa_id === empresaId;
  });

  return daEmpresa[0] ?? null;
}

export function gravarFiscalNaEmpresa(
  linhas: LinhaProdutosFiscal[],
  empresaId: string,
  produtoId: string,
  payload: ReturnType<typeof payloadAtualizacaoFiscalProduto>
) {
  const linha = linhas.find(
    (item) =>
      item.empresa_id === empresaId && item.produto_id === produtoId
  );

  if (!linha) {
    return null;
  }

  linha.ncm = payload.ncm;
  linha.cest = payload.cest;
  linha.origem_produto = payload.origem_produto;
  return linha;
}
