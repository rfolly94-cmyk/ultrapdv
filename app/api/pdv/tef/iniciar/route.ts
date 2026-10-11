import { iniciarTefSessao } from "@/lib/pdv/tef/servico";

import { lerCorpo, responderTef } from "../_shared";

export async function POST(request: Request) {
  try {
    return Response.json(await iniciarTefSessao(await lerCorpo(request)));
  } catch (error) {
    return responderTef(error);
  }
}
