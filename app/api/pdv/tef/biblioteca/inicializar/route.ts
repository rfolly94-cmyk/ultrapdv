import { lerCorpo, responderTef } from "@/app/api/pdv/tef/_shared";
import { prepararInicializacaoBiblioteca } from "@/lib/pdv/tef/servico";

export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  try {
    return Response.json(
      await prepararInicializacaoBiblioteca(String(corpo.dispositivoId ?? ""))
    );
  } catch (error) {
    return responderTef(error);
  }
}
