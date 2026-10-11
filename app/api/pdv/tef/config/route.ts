import { lerConfigTefSessao } from "@/lib/pdv/tef/servico";

import { responderTef } from "../_shared";

export async function GET() {
  try {
    return Response.json(await lerConfigTefSessao());
  } catch (error) {
    return responderTef(error);
  }
}
