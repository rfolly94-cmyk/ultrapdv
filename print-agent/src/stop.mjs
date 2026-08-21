import { carregarConfigLocal } from "./config-local.mjs";
import { encerrarInstanciaLocal } from "./instancia.mjs";
import { faixaAutomatica, PORTA_PADRAO } from "./portas.mjs";
import { pastaDados, resolverRaizAgente } from "./raiz.mjs";

const config = await carregarConfigLocal();
const portas = [
  config.activePort,
  config.preferredPort,
  PORTA_PADRAO,
  ...faixaAutomatica(),
].filter((p, i, arr) => Number.isInteger(p) && arr.indexOf(p) === i);

const codigo = await encerrarInstanciaLocal({
  portas,
  pasta: pastaDados(resolverRaizAgente()),
  execPath: process.execPath,
});

process.exit(codigo);
