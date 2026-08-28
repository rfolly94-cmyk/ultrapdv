import {
  MENSAGEM_SEM_PRODUTOS_VALIDOS,
  type ProdutoCargaBalanca,
  type ResultadoExportacaoBalanca,
} from "../tipos";

/**
 * Toledo MGV7 — Itensmgv.txt versão 4.
 *
 * Documentação oficial:
 * https://help.toledobrasil.com/mgv7/v7_0_/HTML_PAGES/arquivos_de_cadastro.html
 *
 * Não implementar MGV6 nesta fase. O id `mgv7` deixa a arquitetura
 * pronta para um layout legado futuro.
 */
export const LAYOUT_TOLEDO_MGV7 = "mgv7";
export const ARQUIVO_ITENS_MGV7 = "Itensmgv.txt";
export const MIME_ITENS_MGV7 = "text/plain";

export const MGV7_TAMANHO_CODIGO_ITEM = 6;
export const MGV7_TAMANHO_D1 = 25;
export const MGV7_TAMANHO_D2 = 25;
export const MGV7_TAMANHO_D3 = 35;
export const MGV7_TAMANHO_D4 = 35;
export const MGV7_TAMANHO_DESCRICAO =
  MGV7_TAMANHO_D1 + MGV7_TAMANHO_D2 + MGV7_TAMANHO_D3 + MGV7_TAMANHO_D4;
export const MGV7_PRECO_MAXIMO_CENTAVOS = 999_999;
export const MGV7_DEPARTAMENTO_MIN = 1;
export const MGV7_DEPARTAMENTO_MAX = 99;

const CRLF = "\r\n";

const WIN1252_EXTRAS: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

export function layoutToledoMgv7Implementado(layout: string) {
  return layout === LAYOUT_TOLEDO_MGV7;
}

function byteWindows1252(codigo: number): number | null {
  if (codigo <= 0x7f) {
    return codigo;
  }
  if (codigo >= 0xa0 && codigo <= 0xff) {
    return codigo;
  }
  return WIN1252_EXTRAS[codigo] ?? null;
}

export function encodeWindows1252(texto: string): number[] | { erro: string } {
  const bytes: number[] = [];
  for (const caractere of texto) {
    const codigo = caractere.codePointAt(0);
    if (codigo == null) {
      continue;
    }
    const byte = byteWindows1252(codigo);
    if (byte == null) {
      return {
        erro: `A descrição contém o caractere "${caractere}", que não cabe no encoding do arquivo Toledo MGV7.`,
      };
    }
    bytes.push(byte);
  }
  return bytes;
}

function latin1(bytes: number[]) {
  return String.fromCharCode(...bytes);
}

function campoTexto(
  texto: string,
  tamanho: number
): { ok: true; valor: string } | { ok: false; erro: string } {
  const encoded = encodeWindows1252(texto);
  if ("erro" in encoded) {
    return { ok: false, erro: encoded.erro };
  }
  if (encoded.length > tamanho) {
    return {
      ok: false,
      erro: `A descrição excede o limite de ${tamanho} bytes deste campo do MGV7.`,
    };
  }
  while (encoded.length < tamanho) {
    encoded.push(0x20);
  }
  return { ok: true, valor: latin1(encoded) };
}

function campoNumerico(valor: number, tamanho: number, rotulo: string) {
  if (!Number.isInteger(valor) || valor < 0) {
    return {
      ok: false as const,
      erro: `${rotulo} inválido para o arquivo MGV7.`,
    };
  }
  const texto = String(valor);
  if (texto.length > tamanho) {
    return {
      ok: false as const,
      erro: `${rotulo} excede ${tamanho} dígitos do MGV7.`,
    };
  }
  return {
    ok: true as const,
    valor: texto.padStart(tamanho, "0"),
  };
}

export function reaisParaCentavosMgv7(
  preco: number
): { ok: true; centavos: number } | { ok: false; erro: string } {
  if (!Number.isFinite(preco) || preco <= 0) {
    return {
      ok: false,
      erro: "O preço de venda precisa ser maior que zero.",
    };
  }

  const partes = preco.toFixed(2).match(/^(\d+)\.(\d{2})$/);
  if (!partes) {
    return { ok: false, erro: "Preço inválido para o formato MGV7." };
  }

  const reais = Number(partes[1]);
  const centavosParte = Number(partes[2]);
  const centavos = reais * 100 + centavosParte;
  if (!Number.isInteger(centavos) || centavos > MGV7_PRECO_MAXIMO_CENTAVOS) {
    return {
      ok: false,
      erro: "O preço de venda excede o limite de 6 dígitos do MGV7 (R$ 9.999,99).",
    };
  }

  return { ok: true, centavos };
}

export function codigoItemMgv7(
  plu: string
): { ok: true; valor: string } | { ok: false; erro: string } {
  const limpo = String(plu ?? "").trim();
  if (!limpo) {
    return { ok: false, erro: "Informe o PLU/código da balança." };
  }
  if (!/^\d{1,6}$/.test(limpo)) {
    return {
      ok: false,
      erro: "O PLU deve ter até 6 dígitos numéricos (código do item do MGV7).",
    };
  }
  return {
    ok: true,
    valor: limpo.padStart(MGV7_TAMANHO_CODIGO_ITEM, "0"),
  };
}

export function departamentoMgv7(
  departamento: string | null | undefined
): { ok: true; valor: string; codigo: number } | { ok: false; erro: string } {
  const limpo = String(departamento ?? "").trim();
  if (!limpo) {
    return {
      ok: false,
      erro: "Informe o departamento numérico da balança (01 a 99).",
    };
  }
  if (!/^\d{1,2}$/.test(limpo)) {
    return {
      ok: false,
      erro: "O departamento da Toledo MGV7 deve ser um código de 01 a 99.",
    };
  }
  const codigo = Number(limpo);
  if (codigo < MGV7_DEPARTAMENTO_MIN || codigo > MGV7_DEPARTAMENTO_MAX) {
    return {
      ok: false,
      erro: "O departamento da Toledo MGV7 deve ser um código de 01 a 99.",
    };
  }
  return { ok: true, valor: String(codigo).padStart(2, "0"), codigo };
}

export function validadeMgv7(
  validadeDias: number | null | undefined
):
  | { ok: true; valor: string; dias: number; imprimeDatas: boolean }
  | { ok: false; erro: string } {
  if (validadeDias == null) {
    return { ok: true, valor: "000", dias: 0, imprimeDatas: false };
  }
  if (!Number.isInteger(validadeDias)) {
    return {
      ok: false,
      erro: "A validade da etiqueta deve ser um número inteiro de dias.",
    };
  }
  const permitida =
    (validadeDias >= 0 && validadeDias <= 990) ||
    validadeDias === 998 ||
    validadeDias === 999;
  if (!permitida) {
    return {
      ok: false,
      erro: "A validade da etiqueta deve ser 0 a 990, 998 ou 999 (MGV7).",
    };
  }
  return {
    ok: true,
    valor: String(validadeDias).padStart(3, "0"),
    dias: validadeDias,
    imprimeDatas: validadeDias >= 1 && validadeDias <= 990,
  };
}

export function descreverItemMgv7(descricao: string):
  | { ok: true; d1: string; d2: string; d3: string; d4: string }
  | { ok: false; erro: string } {
  const limpo = descricao.trim();
  if (!limpo) {
    return { ok: false, erro: "Informe a descrição para balança." };
  }
  const encoded = encodeWindows1252(limpo);
  if ("erro" in encoded) {
    return { ok: false, erro: encoded.erro };
  }
  if (encoded.length > MGV7_TAMANHO_DESCRICAO) {
    return {
      ok: false,
      erro: `A descrição excede ${MGV7_TAMANHO_DESCRICAO} bytes do MGV7 (D1+D2+D3+D4). Não truncamos silenciosamente.`,
    };
  }

  const fatia = (inicio: number, tamanho: number) => {
    const parte = encoded.slice(inicio, inicio + tamanho);
    while (parte.length < tamanho) {
      parte.push(0x20);
    }
    return latin1(parte);
  };

  return {
    ok: true,
    d1: fatia(0, MGV7_TAMANHO_D1),
    d2: fatia(MGV7_TAMANHO_D1, MGV7_TAMANHO_D2),
    d3: fatia(MGV7_TAMANHO_D1 + MGV7_TAMANHO_D2, MGV7_TAMANHO_D3),
    d4: fatia(
      MGV7_TAMANHO_D1 + MGV7_TAMANHO_D2 + MGV7_TAMANHO_D3,
      MGV7_TAMANHO_D4
    ),
  };
}

export function validarItemToledoMgv7(produto: {
  plu: string | null;
  descricao: string;
  preco: number;
  validadeDias: number | null;
  departamento: string | null;
}): string[] {
  const problemas: string[] = [];
  const codigo = codigoItemMgv7(String(produto.plu ?? ""));
  if (!codigo.ok) {
    problemas.push(codigo.erro);
  }
  const depto = departamentoMgv7(produto.departamento);
  if (!depto.ok) {
    problemas.push(depto.erro);
  }
  const preco = reaisParaCentavosMgv7(produto.preco);
  if (!preco.ok) {
    problemas.push(preco.erro);
  }
  const validade = validadeMgv7(produto.validadeDias);
  if (!validade.ok) {
    problemas.push(validade.erro);
  }
  const descricao = descreverItemMgv7(produto.descricao);
  if (!descricao.ok) {
    problemas.push(descricao.erro);
  }
  return problemas;
}

function associacaoVazia() {
  return "||";
}

export function montarLinhaItensMgv7(
  produto: ProdutoCargaBalanca
): { ok: true; linha: string } | { ok: false; erro: string } {
  const codigo = codigoItemMgv7(produto.plu);
  if (!codigo.ok) {
    return codigo;
  }
  const depto = departamentoMgv7(produto.departamento);
  if (!depto.ok) {
    return depto;
  }
  const preco = reaisParaCentavosMgv7(produto.preco);
  if (!preco.ok) {
    return preco;
  }
  const precoCampo = campoNumerico(preco.centavos, 6, "Preço");
  if (!precoCampo.ok) {
    return precoCampo;
  }
  const validade = validadeMgv7(produto.validadeDias);
  if (!validade.ok) {
    return validade;
  }
  const descricao = descreverItemMgv7(produto.descricao);
  if (!descricao.ok) {
    return descricao;
  }

  const lote = campoTexto("", 12);
  const eanEspecialG = campoTexto("", 11);
  const eanFornecedor = campoTexto("", 12);
  const eanEspecialG1 = campoTexto("", 12);
  if (!lote.ok || !eanEspecialG.ok || !eanFornecedor.ok || !eanEspecialG1.ok) {
    return { ok: false, erro: "Falha ao montar campos de texto do MGV7." };
  }

  const imprime = validade.imprimeDatas ? "1" : "0";

  const linha =
    depto.valor +
    "0" +
    codigo.valor +
    precoCampo.valor +
    validade.valor +
    descricao.d1 +
    descricao.d2 +
    "000000" +
    "0000" +
    "000000" +
    imprime +
    imprime +
    "0000" +
    lote.valor +
    eanEspecialG.valor +
    "0" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    eanFornecedor.valor +
    "000000" +
    associacaoVazia() +
    descricao.d3 +
    descricao.d4 +
    "000000" +
    "000000" +
    "000000" +
    "000000" +
    "0" +
    associacaoVazia() +
    "0" +
    associacaoVazia() +
    eanEspecialG1.valor +
    "0000" +
    "000000" +
    associacaoVazia() +
    "0" +
    "00000" +
    CRLF;

  return { ok: true, linha };
}

export function exportarToledoMgv7(
  produtos: ProdutoCargaBalanca[]
): ResultadoExportacaoBalanca {
  if (produtos.length === 0) {
    return { ok: false, erro: MENSAGEM_SEM_PRODUTOS_VALIDOS };
  }

  const linhas: string[] = [];
  for (const produto of produtos) {
    const linha = montarLinhaItensMgv7(produto);
    if (!linha.ok) {
      return { ok: false, erro: linha.erro };
    }
    linhas.push(linha.linha);
  }

  return {
    ok: true,
    nomeArquivo: ARQUIVO_ITENS_MGV7,
    conteudo: linhas.join(""),
    mime: MIME_ITENS_MGV7,
  };
}
