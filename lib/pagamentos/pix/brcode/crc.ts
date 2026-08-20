const POLINOMIO = 0x1021;
const INICIAL = 0xffff;

export function crc16CcittFalse(texto: string) {
  let crc = INICIAL;

  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ POLINOMIO) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function aplicarCrcBrCode(payloadSemCrc: string) {
  const base = `${payloadSemCrc}6304`;
  return `${base}${crc16CcittFalse(base)}`;
}

export function validarCrcBrCode(payload: string) {
  if (payload.length < 8 || !payload.startsWith("000201") || !payload.includes("6304")) {
    return false;
  }

  const semCrc = payload.slice(0, -4);
  const informado = payload.slice(-4).toUpperCase();
  return crc16CcittFalse(semCrc) === informado;
}
