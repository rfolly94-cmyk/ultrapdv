function tefDesativado() {
  return Response.json(
    {
      ok: false,
      codigo: "TEF_DESATIVADO",
      erro: "A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.",
    },
    { status: 410 }
  );
}

export function GET() {
  return tefDesativado();
}

export function POST() {
  return tefDesativado();
}
