import { classificarFormaTef, type FormaTef } from "@/lib/pdv/tef/regras";

export type FormaAtalhoTef = FormaTef & {
  id: string;
  permite_parcelamento?: boolean | null;
  ordem?: number | null;
};

export type OpcaoCreditoTef = {
  codigo: "avista" | "parcelado";
  rotulo: string;
};

function chaveForma(forma: FormaTef) {
  return `${forma.codigo ?? ""} ${forma.tipo ?? ""} ${forma.nome ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ehPixMaquininha(forma: FormaTef | null | undefined) {
  if (!forma || forma.permite_fiado === true) return false;
  const chave = chaveForma(forma);
  if (!chave.includes("pix")) return false;
  if (
    chave.includes("geranet") ||
    chave.includes("bank") ||
    chave.includes("qr") ||
    chave.includes("dinamico") ||
    chave.includes("estatico") ||
    chave.includes("local")
  ) {
    return false;
  }
  return chave.includes("maquininha") || chave.includes("paygo") || (chave.includes("c6") && chave.includes("pay"));
}

export function escolherFormaTef<T extends FormaAtalhoTef>(formas: T[], modalidade: "debito" | "credito") {
  const candidatas = formas
    .filter((forma) => classificarFormaTef(forma) === modalidade)
    .slice()
    .sort((a, b) => {
      const peso = (forma: T) => (chaveForma(forma).includes("c6") ? 0 : 1);
      const porNome = peso(a) - peso(b);
      if (porNome !== 0) return porNome;
      return (a.ordem ?? 99) - (b.ordem ?? 99);
    });
  return candidatas[0] ?? null;
}

export function escolherPixMaquininha<T extends FormaAtalhoTef>(formas: T[]) {
  const candidatas = formas
    .filter((forma) => ehPixMaquininha(forma))
    .slice()
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
  return candidatas[0] ?? null;
}

export function opcoesCreditoTef(forma: FormaAtalhoTef | null): OpcaoCreditoTef[] {
  if (!forma || classificarFormaTef(forma) !== "credito") return [];
  const opcoes: OpcaoCreditoTef[] = [{ codigo: "avista", rotulo: "À vista" }];
  if (forma.permite_parcelamento === true) {
    opcoes.push({ codigo: "parcelado", rotulo: "Parcelado no PinPad" });
  }
  return opcoes;
}

export function modalidadePinpadDaForma(forma: FormaTef | null | undefined): "debito" | "credito" | "pix" | null {
  const cartao = classificarFormaTef(forma);
  if (cartao) return cartao;
  if (ehPixMaquininha(forma)) return "pix";
  return null;
}
