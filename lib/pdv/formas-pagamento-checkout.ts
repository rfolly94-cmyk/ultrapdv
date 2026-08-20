import { ehFormaPix } from "../pagamentos/pix/local-regras";

export const CODIGOS_PIX_LEGADOS = ["PIX_DINAMICO", "PIX_ESTATICO"] as const;

export const MENSAGEM_CONFIGURE_PIX =
  "Configure o PIX em Configurações → Financeiro";

export const MENSAGEM_FORMA_PIX_LEGADA =
  "Esta forma PIX não pode ser usada em vendas novas. Use a forma PIX única do caixa.";

export type FormaPagamentoCheckout = {
  id: string;
  codigo?: string | null;
  nome?: string | null;
  tipo?: string | null;
  codigo_fiscal?: string | null;
  permite_troco?: boolean;
  permite_fiado?: boolean;
  permite_parcelamento?: boolean;
  ordem?: number | null;
  ativo?: boolean | null;
};

function chaveForma(forma: FormaPagamentoCheckout) {
  return `${forma.codigo ?? ""} ${forma.tipo ?? ""} ${forma.nome ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ehFormaPixLegada(forma: FormaPagamentoCheckout | null) {
  if (!forma || !ehFormaPix(forma)) {
    return false;
  }

  const codigo = String(forma.codigo ?? "").toUpperCase();
  if (
    codigo === "PIX_DINAMICO" ||
    codigo === "PIX_ESTATICO"
  ) {
    return true;
  }

  const chave = chaveForma(forma);
  return (
    chave.includes("dinamico") ||
    chave.includes("estatico")
  );
}

export function ehFormaPixTecnologiaDuplicada(
  forma: FormaPagamentoCheckout | null
) {
  if (!forma || !ehFormaPix(forma) || ehFormaPixLegada(forma)) {
    return false;
  }

  const codigo = String(forma.codigo ?? "").toUpperCase();
  const nome = String(forma.nome ?? "").trim().toUpperCase();
  if (codigo === "PIX" || nome === "PIX") {
    return false;
  }

  if (
    codigo === "PIX_LOCAL" ||
    codigo === "PIX_GERANET" ||
    codigo === "PIX_INTEGRADO"
  ) {
    return true;
  }

  const chave = chaveForma(forma);
  return (
    chave.includes("local") ||
    chave.includes("geranet") ||
    chave.includes("integrado")
  );
}

export function ehFormaPixForaDoCheckout(
  forma: FormaPagamentoCheckout | null
) {
  return ehFormaPixLegada(forma) || ehFormaPixTecnologiaDuplicada(forma);
}

export function ehFormaPixComercial(forma: FormaPagamentoCheckout | null) {
  return Boolean(
    forma &&
      ehFormaPix(forma) &&
      forma.permite_fiado !== true &&
      !ehFormaPixForaDoCheckout(forma)
  );
}

export function rotuloFormaCheckout(forma: FormaPagamentoCheckout) {
  if (ehFormaPix(forma) && !forma.permite_fiado) {
    return "PIX";
  }

  return forma.nome ?? forma.codigo ?? "Pagamento";
}

export function escolherFormaPixComercial(
  formas: FormaPagamentoCheckout[]
): FormaPagamentoCheckout | null {
  const candidatas = formas
    .filter((forma) => ehFormaPixComercial(forma))
    .slice()
    .sort((a, b) => {
      const peso = (forma: FormaPagamentoCheckout) => {
        if (String(forma.codigo ?? "").toUpperCase() === "PIX") {
          return 0;
        }
        if (String(forma.nome ?? "").trim().toUpperCase() === "PIX") {
          return 1;
        }
        return 2;
      };
      const porPeso = peso(a) - peso(b);
      if (porPeso !== 0) {
        return porPeso;
      }
      return (a.ordem ?? 99) - (b.ordem ?? 99);
    });

  return candidatas[0] ?? null;
}

export function filtrarFormasPagamentoCheckoutPdv<
  T extends FormaPagamentoCheckout,
>(formas: T[]): T[] {
  const pix = escolherFormaPixComercial(formas);
  const visiveis = formas.filter((forma) => {
    if (ehFormaPixForaDoCheckout(forma)) {
      return false;
    }

    if (ehFormaPix(forma) && !forma.permite_fiado) {
      return pix != null && forma.id === pix.id;
    }

    return true;
  });

  return visiveis.sort(
    (a, b) => (a.ordem ?? 99) - (b.ordem ?? 99)
  );
}

export function consolidarPagamentosCheckoutPdv<
  T extends { formaPagamentoId: string; valorCentavos: number },
>(
  pagamentos: T[],
  formasOriginais: FormaPagamentoCheckout[],
  formasCheckout: FormaPagamentoCheckout[]
) {
  const pixComercial = escolherFormaPixComercial(formasCheckout);
  const porForma = new Map<string, number>();

  for (const pagamento of pagamentos) {
    const original =
      formasOriginais.find((forma) => forma.id === pagamento.formaPagamentoId) ??
      null;
    const formaPagamentoId =
      ehFormaPixForaDoCheckout(original) && pixComercial
        ? pixComercial.id
        : pagamento.formaPagamentoId;
    porForma.set(
      formaPagamentoId,
      (porForma.get(formaPagamentoId) ?? 0) + pagamento.valorCentavos
    );
  }

  return [...porForma.entries()].map(([formaPagamentoId, valorCentavos]) => ({
    formaPagamentoId,
    valorCentavos,
  }));
}

export function validarFormaPixNovaVenda(forma: FormaPagamentoCheckout | null) {
  if (!forma || !ehFormaPix(forma) || forma.permite_fiado) {
    return;
  }

  if (ehFormaPixForaDoCheckout(forma)) {
    throw new Error(MENSAGEM_FORMA_PIX_LEGADA);
  }
}
