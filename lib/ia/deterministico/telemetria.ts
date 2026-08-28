type EventoTelemetriaIa =
  | "deterministico"
  | "ia"
  | "fallbackProvider"
  | "erroProvider";

const contadores: Record<EventoTelemetriaIa, number> = {
  deterministico: 0,
  ia: 0,
  fallbackProvider: 0,
  erroProvider: 0,
};

export function registrarTelemetriaIa(evento: EventoTelemetriaIa) {
  contadores[evento] += 1;
}

export function lerTelemetriaIa() {
  return { ...contadores };
}
