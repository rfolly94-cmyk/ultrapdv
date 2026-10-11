import { TPAG_CARTAO_CREDITO, TPAG_CARTAO_DEBITO, TPAG_PIX_DINAMICO } from "@/lib/fiscal/validar-pagamentos-eletronicos";
import { cnpjCredenciadoraPayGo } from "@/lib/fiscal/tef/credenciadoras-paygo";
import { resultadoPixPayGo } from "@/lib/pdv/tef/regras";

/**
 * tBand do MOC da NF-e/NFC-e.
 * Só entra código quando o nome devolvido pelo PayGo corresponde à tabela.
 * Rede, credenciadora e "99 Outros" não são usados no lugar da bandeira.
 */
const BANDEIRAS: Array<[string, string[]]> = [
  ["01", ["visa", "visa electron", "visa debito", "visa credito"]],
  ["02", ["mastercard", "master card", "maestro"]],
  ["03", ["american express", "amex"]],
  ["04", ["sorocred"]],
  ["05", ["diners", "diners club"]],
  ["06", ["elo", "elo debito", "elo credito"]],
  ["07", ["hipercard"]],
  ["08", ["aura"]],
  ["09", ["cabal"]],
  ["10", ["alelo"]],
  ["11", ["banescard", "banes card"]],
  ["12", ["calcard"]],
  ["13", ["credz"]],
  ["14", ["discover"]],
  ["15", ["goodcard", "good card"]],
  ["16", ["greencard", "green card"]],
  ["17", ["hiper"]],
  ["18", ["jcb"]],
  ["19", ["mais"]],
  ["20", ["maxvan"]],
  ["21", ["policard"]],
  ["22", ["redecompras", "rede compras"]],
  ["23", ["sodexo"]],
  ["24", ["valecard"]],
  ["25", ["verocheque"]],
  ["26", ["vr"]],
  ["27", ["ticket"]],
];

const STATUS_APROVEITAVEIS = new Set(["autorizada", "vinculada", "confirmada"]);

export type OperacaoFiscalCartao = {
  id: string;
  modalidade: "debito" | "credito";
  valorCentavos: number;
  status: string;
  autorizacao: string | null;
  bandeiraNome: string | null;
  cnpjCredenciadora: string | null;
  cnpjRecebedor: string | null;
  instituicao: string | null;
  rede?: string | null;
  nsu?: string | null;
};

export type PagamentoFiscalCartao = {
  id?: string | null;
  forma_pagamento_nome?: string | null;
  codigo_fiscal?: string | null;
  valor?: number | string | null;
  bandeira?: string | null;
  autorizacao?: string | null;
  tipo_integracao?: string | null;
  cnpj_credenciadora?: string | null;
  cnpj_receb?: string | null;
  indicador_pagamento?: string | null;
  nsu?: string | null;
  pix_tef_comprovado?: boolean;
};

export type DetalhePagamentoGeranet = {
  tipo: string;
  valor: number;
  indicadorPagamento: "0" | "1";
  cnpjCredenciadora?: string;
  tipoBandeira?: string;
  autorizacao?: string;
  tipoIntegracao?: "1";
  cnpjReceb?: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function digitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function normalizarNome(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function centavos(valor: unknown) {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) {
    return 0;
  }
  return Math.round(numero * 100);
}

export function codigoBandeiraFiscal(nome: string | null | undefined) {
  const normalizado = normalizarNome(texto(nome));
  if (!normalizado) {
    return null;
  }
  const aliases = BANDEIRAS.flatMap(([codigo, nomes]) =>
    nomes.map((alias) => ({ codigo, alias }))
  ).sort((a, b) => b.alias.length - a.alias.length);
  for (const item of aliases) {
    if (normalizado === item.alias || normalizado.startsWith(`${item.alias} `)) {
      return item.codigo;
    }
  }
  return null;
}

function credenciadoraDaOperacao(operacao: OperacaoFiscalCartao) {
  return cnpjFiscal(operacao.cnpjCredenciadora) ?? cnpjCredenciadoraPayGo(operacao.rede);
}

function cnpjFiscal(valor: string | null | undefined) {
  const documento = digitos(valor);
  return documento.length === 14 ? documento : null;
}

function modalidadeDoPagamento(codigoFiscal: string | null | undefined) {
  const tPag = texto(codigoFiscal);
  if (tPag === TPAG_CARTAO_CREDITO) {
    return "credito" as const;
  }
  if (tPag === TPAG_CARTAO_DEBITO) {
    return "debito" as const;
  }
  return null;
}

function nomeForma(pagamento: PagamentoFiscalCartao) {
  return texto(pagamento.forma_pagamento_nome) || "Cartão";
}

export function detalhePagamentoGeranet(
  pagamento: PagamentoFiscalCartao,
  valor: number,
  indicadorPagamento: "0" | "1"
): DetalhePagamentoGeranet {
  const base: DetalhePagamentoGeranet = {
    tipo: texto(pagamento.codigo_fiscal),
    valor,
    indicadorPagamento,
  };
  if (texto(pagamento.codigo_fiscal) === TPAG_PIX_DINAMICO) {
    return base;
  }
  if (!modalidadeDoPagamento(pagamento.codigo_fiscal)) {
    return base;
  }
  const credenciadora = cnpjFiscal(pagamento.cnpj_credenciadora);
  const recebedor = cnpjFiscal(pagamento.cnpj_receb);
  const bandeira = texto(pagamento.bandeira);
  const autorizacao = texto(pagamento.autorizacao);
  if (
    pagamento.tipo_integracao !== "1" ||
    !credenciadora ||
    !recebedor ||
    !/^\d{2}$/.test(bandeira) ||
    !autorizacao
  ) {
    return base;
  }
  return {
    ...base,
    tipoIntegracao: "1",
    cnpjCredenciadora: credenciadora,
    tipoBandeira: bandeira,
    autorizacao,
    cnpjReceb: recebedor,
  };
}

function faltas(operacao: OperacaoFiscalCartao) {
  const itens: string[] = [];
  if (!credenciadoraDaOperacao(operacao)) {
    itens.push("CNPJ da credenciadora");
  }
  if (!codigoBandeiraFiscal(operacao.bandeiraNome)) {
    itens.push("bandeira do cartão");
  }
  if (!texto(operacao.autorizacao)) {
    itens.push("código de autorização");
  }
  if (!cnpjFiscal(operacao.cnpjRecebedor)) {
    itens.push("CNPJ do estabelecimento recebedor");
  }
  return itens;
}

/**
 * Associa cada cartão à operação TEF da mesma empresa e venda.
 * Credenciadora, bandeira e recebedor permanecem distintos.
 * O CNPJ da credenciadora só é completado pela tabela ACBr quando a rede PayGo corresponde.
 * O CNPJ do estabelecimento não substitui a credenciadora e nenhuma nova cobrança é feita.
 */
export function avaliarPagamentosFiscaisTef(input: {
  pagamentos: PagamentoFiscalCartao[];
  operacoes: OperacaoFiscalCartao[];
}) {
  const usados = new Set<string>();
  const pagamentos = input.pagamentos.map((pagamento) => ({ ...pagamento }));

  for (const pagamento of pagamentos) {
    const modalidade = modalidadeDoPagamento(pagamento.codigo_fiscal);
    if (!modalidade) {
      continue;
    }
    const valor = centavos(pagamento.valor);
    const autorizacaoInformada = texto(pagamento.autorizacao);
    const candidatos = input.operacoes.filter((operacao) => {
      if (usados.has(operacao.id) || !STATUS_APROVEITAVEIS.has(operacao.status)) {
        return false;
      }
      if (operacao.modalidade !== modalidade || operacao.valorCentavos !== valor) {
        return false;
      }
      if (autorizacaoInformada && texto(operacao.autorizacao) !== autorizacaoInformada) {
        return false;
      }
      return true;
    });

    if (candidatos.length !== 1) {
      if (input.operacoes.length === 0) {
        continue;
      }
      return {
        pagamentos,
        erro: [
          "Não foi possível emitir a NFC-e.",
          `O pagamento ${nomeForma(pagamento)} não ficou vinculado a uma única transação TEF desta venda.`,
          "Nenhuma nova cobrança foi feita e nenhum número fiscal foi reservado.",
        ].join("\n"),
      };
    }

    const operacao = candidatos[0];
    usados.add(operacao.id);
    if (resultadoPixPayGo({
      rede: operacao.rede,
      instituicao: operacao.instituicao,
      nomeBandeiraPadrao: operacao.bandeiraNome,
    })) {
      if (!texto(operacao.nsu)) {
        return {
          pagamentos,
          erro: [
            "Não foi possível emitir a NFC-e.",
            `A transação TEF de ${nomeForma(pagamento)} não informou o NSU do PIX.`,
            "Nenhuma nova cobrança foi feita e nenhum número fiscal foi reservado.",
          ].join("\n"),
        };
      }
      pagamento.codigo_fiscal = TPAG_PIX_DINAMICO;
      pagamento.bandeira = null;
      pagamento.autorizacao = null;
      pagamento.tipo_integracao = null;
      pagamento.cnpj_credenciadora = null;
      pagamento.cnpj_receb = null;
      pagamento.nsu = texto(operacao.nsu);
      pagamento.pix_tef_comprovado = true;
      continue;
    }
    const ausentes = faltas(operacao);
    if (ausentes.length > 0) {
      return {
        pagamentos,
        erro: [
          "Não foi possível emitir a NFC-e.",
          `A transação TEF de ${nomeForma(pagamento)} não informou: ${ausentes.join(", ")}.`,
          "Nenhuma nova cobrança foi feita e nenhum número fiscal foi reservado.",
        ].join("\n"),
      };
    }

    pagamento.tipo_integracao = "1";
    pagamento.cnpj_credenciadora = credenciadoraDaOperacao(operacao);
    pagamento.cnpj_receb = cnpjFiscal(operacao.cnpjRecebedor);
    pagamento.bandeira = codigoBandeiraFiscal(operacao.bandeiraNome);
    pagamento.autorizacao = texto(operacao.autorizacao);
  }

  return { pagamentos, erro: null as string | null };
}
