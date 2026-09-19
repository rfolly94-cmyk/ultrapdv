export function ambienteProducao(valor = process.env.NODE_ENV) {
  return valor === "production";
}
