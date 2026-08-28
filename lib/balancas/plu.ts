import { TAMANHO_MAX_PLU } from "./dados-produto";

export const MENSAGEM_PLU_COLISAO =
  "Não foi possível gerar um PLU único. Tente novamente.";

export const MENSAGEM_PLU_ESGOTADO =
  "Não há PLU numérico disponível nesta empresa.";

const PLU_MAXIMO = 10 ** TAMANHO_MAX_PLU - 1;

export function pluPreenchido(plu: string | null | undefined) {
  return Boolean(String(plu ?? "").trim());
}

function pluComoInteiro(plu: string) {
  const limpo = String(plu ?? "").trim();
  if (!/^\d{1,8}$/.test(limpo)) {
    return null;
  }
  const numero = Number(limpo);
  if (!Number.isInteger(numero) || numero < 1) {
    return null;
  }
  return numero;
}

export function precisaGerarPluVinculo(params: {
  vinculado: boolean;
  plu: string | null | undefined;
}) {
  return params.vinculado && !pluPreenchido(params.plu);
}

export function proximoPluDisponivel(plusExistentes: readonly string[]) {
  let maximo = 0;
  for (const plu of plusExistentes) {
    const numero = pluComoInteiro(plu);
    if (numero != null && numero > maximo) {
      maximo = numero;
    }
  }

  const proximo = maximo + 1;
  if (proximo > PLU_MAXIMO) {
    throw new Error(MENSAGEM_PLU_ESGOTADO);
  }

  return String(proximo);
}

export async function atribuirPluComRetry(params: {
  lerPluAtual: () => Promise<string | null>;
  listarPlusDaEmpresa: () => Promise<string[]>;
  gravarNovoPlu: (plu: string) => Promise<"ok" | "colisao">;
  maxTentativas?: number;
}): Promise<{ ok: true; plu: string } | { ok: false; erro: string }> {
  const maxTentativas = params.maxTentativas ?? 8;

  try {
    for (let tentativa = 0; tentativa < maxTentativas; tentativa += 1) {
      const atual = String((await params.lerPluAtual()) ?? "").trim();
      if (atual) {
        return { ok: true, plu: atual };
      }

      const plusDaEmpresa = await params.listarPlusDaEmpresa();
      const proximo = proximoPluDisponivel(plusDaEmpresa);
      const gravacao = await params.gravarNovoPlu(proximo);
      if (gravacao === "ok") {
        return { ok: true, plu: proximo };
      }
    }

    return { ok: false, erro: MENSAGEM_PLU_COLISAO };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o PLU da balança.",
    };
  }
}
