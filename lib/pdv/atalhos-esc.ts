export const DESTINO_FECHAR_PDV = "/vendas";

export type OverlayPdv =
  | "sucesso-venda"
  | "descartar-pix"
  | "preferencias"
  | "cliente"
  | "desconto"
  | "pagamento"
  | "menu-usuario";

const PRIORIDADE_OVERLAY: OverlayPdv[] = [
  "sucesso-venda",
  "descartar-pix",
  "preferencias",
  "cliente",
  "desconto",
  "pagamento",
  "menu-usuario",
];

export function overlayAbertoPdv(aberto: Partial<Record<OverlayPdv, boolean>>) {
  return PRIORIDADE_OVERLAY.find((overlay) => aberto[overlay] === true) ?? null;
}

export function decidirAcaoEscPdv(
  aberto: Partial<Record<OverlayPdv, boolean>>
): { acao: "fechar-overlay"; overlay: OverlayPdv } | { acao: "sair-pdv"; destino: typeof DESTINO_FECHAR_PDV } {
  const overlay = overlayAbertoPdv(aberto);

  if (overlay) {
    return { acao: "fechar-overlay", overlay };
  }

  return { acao: "sair-pdv", destino: DESTINO_FECHAR_PDV };
}
