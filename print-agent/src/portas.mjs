import net from "node:net";

export const PORTA_PADRAO = 18181;
export const PORTA_AUTO_MAX = 18190;
export const PORTA_USUARIO_MIN = PORTA_PADRAO;
export const PORTA_USUARIO_MAX = PORTA_AUTO_MAX;

export function mensagemPortaOcupada(porta) {
  return `Porta ${porta} está sendo utilizada por outro aplicativo.`;
}

export function mensagemPortaForaDaFaixa() {
  return `O UltraPDV Conector utiliza portas entre ${PORTA_PADRAO} e ${PORTA_AUTO_MAX}.`;
}

export function portaValida(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= PORTA_USUARIO_MIN && n <= PORTA_USUARIO_MAX;
}

export function faixaAutomatica(
  min = PORTA_PADRAO,
  max = PORTA_AUTO_MAX
) {
  const lista = [];
  for (let p = min; p <= max; p += 1) {
    lista.push(p);
  }
  return lista;
}

export function candidatosPorta(preferred, envPort) {
  const lista = [];
  const doEnv = Number(envPort);
  const pref = portaValida(preferred) ? Number(preferred) : null;
  if (portaValida(doEnv)) {
    lista.push(doEnv);
  }
  if (pref !== null && !lista.includes(pref)) {
    lista.push(pref);
  }
  for (const p of faixaAutomatica()) {
    if (!lista.includes(p)) {
      lista.push(p);
    }
  }
  return lista;
}

export async function escolherPortaLivre({
  preferred,
  envPort,
  ocupada,
} = {}) {
  const candidatos = candidatosPorta(preferred, envPort);
  const conflitos = [];
  for (const porta of candidatos) {
    if (await ocupada(porta)) {
      conflitos.push(porta);
      continue;
    }
    return { porta, conflitos, candidata: porta };
  }
  return {
    porta: null,
    conflitos,
    erro: `Nenhuma porta disponível entre ${PORTA_PADRAO} e ${PORTA_AUTO_MAX}.`,
  };
}

export function portaOcupadaLoopback(porta, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const servidor = net.createServer();
    servidor.once("error", (erro) => {
      resolve(erro && erro.code === "EADDRINUSE");
    });
    servidor.listen(porta, host, () => {
      servidor.close(() => resolve(false));
    });
  });
}
