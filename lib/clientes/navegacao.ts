export const ABAS_CARTEIRA_CLIENTE = [
  "EM_ABERTO",
  "QUITADAS",
  "TODAS",
  "RECEBIMENTOS",
  "MOVIMENTACOES",
  "CREDITOS",
  "COMPRAS",
] as const;

export type AbaCarteiraCliente = (typeof ABAS_CARTEIRA_CLIENTE)[number];

export function hrefCadastroCliente(clienteId: string) {
  return `/clientes?editar=${clienteId}`;
}

export function hrefCarteiraCliente(
  clienteId: string,
  aba?: AbaCarteiraCliente
) {
  const base = `/clientes/${clienteId}/carteira`;
  return aba && aba !== "EM_ABERTO" ? `${base}?aba=${aba}` : base;
}

export function hrefExtratoCliente(clienteId: string) {
  return hrefCarteiraCliente(clienteId, "MOVIMENTACOES");
}

export function hrefReceberCliente(clienteId: string) {
  return hrefCarteiraCliente(clienteId);
}

export function hrefVendasDoCliente(clienteId: string) {
  return hrefCarteiraCliente(clienteId, "COMPRAS");
}

export function hrefImprimirExtratoCliente(clienteId: string) {
  return `/clientes/${clienteId}/carteira/imprimir-abertos`;
}

export function hrefNovaVendaCliente() {
  return "/pdv";
}

export function hrefWhatsappCliente(telefone: string | null | undefined) {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (!digitos) {
    return null;
  }
  const internacional = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${internacional}`;
}

export function parseAbaCarteiraCliente(
  valor: string | string[] | null | undefined
): AbaCarteiraCliente {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  const aba = String(texto ?? "").trim().toUpperCase();
  if (ABAS_CARTEIRA_CLIENTE.includes(aba as AbaCarteiraCliente)) {
    return aba as AbaCarteiraCliente;
  }
  return "EM_ABERTO";
}
