export const MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO =
  "Produto não encontrado para o código informado.";

const INTERVALO_MAX_SCANNER_MS = 45;
const MIN_CHARS_SCANNER = 4;
const FOLGA_ENTER_SCANNER_MS = 80;

export type ProdutoCodigoPdv = {
  id: string;
  codigo: string;
  codigo_barras: string | null;
};

export type DetectorScannerPdv = {
  ultimoTs: number;
  charsNoBurst: number;
  maiorIntervalo: number;
};

export type AcaoEnterBuscaPdv =
  | { tipo: "adicionar"; produto: ProdutoCodigoPdv }
  | { tipo: "nao-encontrado" }
  | { tipo: "ignorar" };

export function detectorScannerVazio(): DetectorScannerPdv {
  return { ultimoTs: 0, charsNoBurst: 0, maiorIntervalo: 0 };
}

export function normalizarCodigoProduto(valor: string | null | undefined) {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function pareceCodigoProduto(termo: string) {
  const texto = String(termo ?? "").trim();
  if (texto.length < 3 || /\s/.test(texto)) {
    return false;
  }
  if (!/^[0-9A-Za-z._-]+$/.test(texto)) {
    return false;
  }
  const soDigitos = texto.replace(/\D/g, "");
  if (soDigitos.length >= 4) {
    return true;
  }
  return /\d/.test(texto);
}

export function encontrarProdutoPorCodigoExato<T extends ProdutoCodigoPdv>(
  produtos: T[],
  termo: string
): T | null {
  const alvo = normalizarCodigoProduto(termo);
  if (!alvo) {
    return null;
  }

  const encontrados = produtos.filter((produto) => {
    return (
      normalizarCodigoProduto(produto.codigo) === alvo ||
      normalizarCodigoProduto(produto.codigo_barras) === alvo
    );
  });

  return encontrados[0] ?? null;
}

export function registrarTeclaBusca(
  estado: DetectorScannerPdv,
  key: string,
  agora: number
): DetectorScannerPdv {
  if (key === "Backspace" || key === "Delete" || key === "Escape") {
    return detectorScannerVazio();
  }
  if (key === "Enter" || key.length !== 1) {
    return estado;
  }
  if (!estado.ultimoTs) {
    return { ultimoTs: agora, charsNoBurst: 1, maiorIntervalo: 0 };
  }

  const intervalo = agora - estado.ultimoTs;
  if (intervalo > INTERVALO_MAX_SCANNER_MS) {
    return { ultimoTs: agora, charsNoBurst: 1, maiorIntervalo: intervalo };
  }

  return {
    ultimoTs: agora,
    charsNoBurst: estado.charsNoBurst + 1,
    maiorIntervalo: Math.max(estado.maiorIntervalo, intervalo),
  };
}

export function pareceLeituraScanner(
  estado: DetectorScannerPdv,
  agora: number
) {
  if (estado.charsNoBurst < MIN_CHARS_SCANNER) {
    return false;
  }
  if (agora - estado.ultimoTs > FOLGA_ENTER_SCANNER_MS) {
    return false;
  }
  return (
    estado.maiorIntervalo > 0 && estado.maiorIntervalo <= INTERVALO_MAX_SCANNER_MS
  );
}

export function decidirAcaoEnterBuscaPdv<T extends ProdutoCodigoPdv>(input: {
  termo: string;
  produtos: T[];
  produtosFiltrados: T[];
  leituraScanner: boolean;
}): AcaoEnterBuscaPdv {
  const termo = String(input.termo ?? "").trim();
  if (!termo) {
    return { tipo: "ignorar" };
  }

  const exato = encontrarProdutoPorCodigoExato(input.produtos, termo);
  if (exato) {
    return { tipo: "adicionar", produto: exato };
  }

  if (input.leituraScanner || pareceCodigoProduto(termo)) {
    return { tipo: "nao-encontrado" };
  }

  if (input.produtosFiltrados.length === 1) {
    return { tipo: "adicionar", produto: input.produtosFiltrados[0] };
  }

  return { tipo: "ignorar" };
}

export function quantidadeAposAdicionarPdv(
  quantidadeAtual: number | undefined,
  quantidadeInformada: number
) {
  const qtd = Math.max(1, Math.floor(Number(quantidadeInformada) || 1));
  return (Number(quantidadeAtual) || 0) + qtd;
}
