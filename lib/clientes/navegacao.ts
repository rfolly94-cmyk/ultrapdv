export function hrefCadastroCliente(clienteId: string) {
  return `/clientes?editar=${clienteId}`;
}

export function hrefCarteiraCliente(clienteId: string) {
  return `/clientes/${clienteId}/carteira`;
}
