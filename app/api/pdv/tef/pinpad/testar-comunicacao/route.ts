import { lerCorpo, responderTef } from "@/app/api/pdv/tef/_shared";
import { prepararAcessoPinpad } from "@/lib/pdv/tef/servico";

export async function POST(request: Request) {
  try {
    const corpo = await lerCorpo(request);
    const dispositivoId =
      corpo && typeof corpo === "object" && "dispositivoId" in corpo
        ? String((corpo as { dispositivoId?: unknown }).dispositivoId ?? "")
        : "";
    return Response.json(await prepararAcessoPinpad(dispositivoId));
  } catch (error) {
    return responderTef(error);
  }
}
