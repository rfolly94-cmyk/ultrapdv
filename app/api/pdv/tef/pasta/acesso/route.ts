import { responderTef } from "@/app/api/pdv/tef/_shared";
import { prepararAcessoPastaTef } from "@/lib/pdv/tef/servico";

export async function POST(request: Request) {
  let corpo: { dispositivoId?: unknown } = {};
  try {
    const json = await request.json();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      corpo = json as { dispositivoId?: unknown };
    }
  } catch {
    corpo = {};
  }
  if (corpo && typeof corpo === "object" && "caminho" in corpo) {
    return Response.json(
      { ok: false, erro: "A pasta é escolhida neste computador." },
      { status: 400 }
    );
  }
  try {
    return Response.json(
      await prepararAcessoPastaTef(
        typeof corpo.dispositivoId === "string" ? corpo.dispositivoId : ""
      )
    );
  } catch (error) {
    return responderTef(error);
  }
}
