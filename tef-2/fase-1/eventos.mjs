export function eventoEstruturado(evento) {
  return { ...evento };
}

export function contemSegredo(evento) {
  return /\d{13,19}/.test(JSON.stringify(evento ?? {}));
}
