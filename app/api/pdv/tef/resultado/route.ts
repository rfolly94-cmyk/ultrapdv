import { registrarResultadoTefSessao } from "@/lib/pdv/tef/servico";

import { lerCorpo, responderTef } from "../_shared";

export async function POST(request: Request) {
  try {
    return Response.json(await registrarResultadoTefSessao(await lerCorpo(request)));
  } catch (error) {
    return responderTef(error);
  }
}
