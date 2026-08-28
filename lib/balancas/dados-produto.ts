import { produtoElegivelBalanca } from "./elegivel";
import type { DadosCadastroBalanca } from "./tipos";

export const TAMANHO_MAX_PLU = 8;
export const TAMANHO_MAX_DESCRICAO_BALANCA = 50;

function textoOpcional(valor: unknown, max: number) {
  const limpo = String(valor ?? "").trim();
  if (!limpo) {
    return null;
  }
  return limpo.slice(0, max);
}

function inteiroOpcional(valor: unknown) {
  const texto = String(valor ?? "").trim();
  if (!texto) {
    return null;
  }

  const numero = Number(texto.replace(",", "."));
  if (!Number.isInteger(numero)) {
    return Number.NaN;
  }

  return numero;
}

function decimalOpcional(valor: unknown) {
  let texto = String(valor ?? "").trim();
  if (!texto) {
    return null;
  }

  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : Number.NaN;
}

export function normalizarPlu(valor: unknown) {
  return String(valor ?? "")
    .trim()
    .replace(/\s+/g, "");
}

export function lerDadosBalancaProduto(
  formData: FormData,
  opcoes: { nomeProduto: string }
): DadosCadastroBalanca {
  const descricaoInformada = textoOpcional(
    formData.get("descricao_balanca"),
    TAMANHO_MAX_DESCRICAO_BALANCA
  );

  return {
    plu: textoOpcional(normalizarPlu(formData.get("plu")), TAMANHO_MAX_PLU),
    descricaoBalanca:
      descricaoInformada ??
      textoOpcional(opcoes.nomeProduto, TAMANHO_MAX_DESCRICAO_BALANCA),
    validadeEtiquetaDias: inteiroOpcional(
      formData.get("validade_etiqueta_dias")
    ),
    taraPadrao: decimalOpcional(formData.get("tara_padrao")),
    departamento: textoOpcional(formData.get("departamento_balanca"), 40),
    mensagem: textoOpcional(formData.get("mensagem_balanca"), 80),
  };
}

export function validarDadosCadastroBalanca(
  dados: DadosCadastroBalanca,
  unidade: string
) {
  if (!produtoElegivelBalanca(unidade)) {
    return null;
  }

  if (dados.plu && dados.plu.length > TAMANHO_MAX_PLU) {
    return "O PLU deve ter no máximo 8 caracteres.";
  }

  if (
    dados.descricaoBalanca &&
    dados.descricaoBalanca.length > TAMANHO_MAX_DESCRICAO_BALANCA
  ) {
    return "A descrição para balança deve ter no máximo 50 caracteres.";
  }

  if (
    dados.validadeEtiquetaDias !== null &&
    (!Number.isInteger(dados.validadeEtiquetaDias) ||
      dados.validadeEtiquetaDias < 0)
  ) {
    return "Informe a validade da etiqueta em dias, igual ou maior que zero.";
  }

  if (
    dados.taraPadrao !== null &&
    (!Number.isFinite(dados.taraPadrao) || dados.taraPadrao < 0)
  ) {
    return "Informe uma tara padrão válida, igual ou maior que zero.";
  }

  return null;
}

export function payloadProdutosBalancas(
  empresaId: string,
  produtoId: string,
  dados: DadosCadastroBalanca
) {
  return {
    empresa_id: empresaId,
    produto_id: produtoId,
    plu: dados.plu,
    descricao_balanca: dados.descricaoBalanca,
    validade_etiqueta_dias: dados.validadeEtiquetaDias,
    tara_padrao: dados.taraPadrao,
    departamento: dados.departamento,
    mensagem: dados.mensagem,
  };
}
