import { responderTef } from "@/app/api/pdv/tef/_shared";
import { prepararAcessoPinpad } from "@/lib/pdv/tef/servico";

export async function GET(request: Request) {
  const dispositivoId = new URL(request.url).searchParams.get("dispositivoId") ?? "";
  try {
    return Response.json(await prepararAcessoPinpad(dispositivoId));
  } catch (error) {
    return responderTef(error);
  }
}
