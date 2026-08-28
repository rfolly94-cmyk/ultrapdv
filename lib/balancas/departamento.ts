export const DEPARTAMENTO_PADRAO_INICIAL = "01";
export const AJUDA_DEPARTAMENTO_PADRAO =
  "Usado nos produtos que não possuem departamento específico.";

const LAYOUT_COM_DEPARTAMENTO = "mgv7";

export function layoutExigeDepartamentoPadrao(
  layout: string | null | undefined
) {
  return String(layout ?? "").trim() === LAYOUT_COM_DEPARTAMENTO;
}

export function departamentoInformado(valor: unknown) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

export function departamentoNumericoBalanca(valor: unknown): string | null {
  const limpo = departamentoInformado(valor);
  if (!limpo || !/^\d{1,2}$/.test(limpo)) {
    return null;
  }
  const codigo = Number(limpo);
  if (!Number.isInteger(codigo) || codigo < 1 || codigo > 99) {
    return null;
  }
  return String(codigo).padStart(2, "0");
}

export function sugerirDepartamentoPadrao(params: {
  layout: string | null | undefined;
  atual?: string | null | undefined;
}) {
  const atual = departamentoInformado(params.atual);
  if (atual) {
    return departamentoNumericoBalanca(atual) ?? atual;
  }
  if (layoutExigeDepartamentoPadrao(params.layout)) {
    return DEPARTAMENTO_PADRAO_INICIAL;
  }
  return "";
}

export function departamentoPadraoDaConfiguracao(config: {
  layout?: string | null;
  configuracao?: { departamentoPadrao?: string | null };
} | null) {
  const salvo = config?.configuracao?.departamentoPadrao;
  const numerico = departamentoNumericoBalanca(salvo);
  if (numerico) {
    return numerico;
  }
  if (
    salvo === undefined &&
    layoutExigeDepartamentoPadrao(config?.layout)
  ) {
    return DEPARTAMENTO_PADRAO_INICIAL;
  }
  return null;
}

export function departamentoEfetivoBalanca(
  departamentoProduto: string | null | undefined,
  departamentoPadrao: string | null | undefined
): {
  valor: string | null;
  fonte: "produto" | "padrao" | null;
} {
  const proprio = departamentoInformado(departamentoProduto);
  if (proprio) {
    return {
      valor: departamentoNumericoBalanca(proprio) ?? proprio,
      fonte: "produto",
    };
  }

  const padrao = departamentoInformado(departamentoPadrao);
  if (padrao) {
    return {
      valor: departamentoNumericoBalanca(padrao) ?? padrao,
      fonte: "padrao",
    };
  }

  return { valor: null, fonte: null };
}

export function rotuloDepartamentoTabela(
  departamentoProduto: string | null | undefined,
  departamentoPadrao: string | null | undefined
) {
  const efetivo = departamentoEfetivoBalanca(
    departamentoProduto,
    departamentoPadrao
  );
  if (!efetivo.valor) {
    return "—";
  }
  if (efetivo.fonte === "padrao") {
    return `${efetivo.valor} (padrão)`;
  }
  return efetivo.valor;
}
