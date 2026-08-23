import { NextResponse } from "next/server";

import { ErroAssinaturaRestrita } from "@/lib/assinatura/exigir-empresa-operacional";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { resultadoErroEntitlement } from "@/lib/plataforma/entitlements/exigir-recurso";

export function aplicarCors(
  resposta: NextResponse,
  metodos = "GET, POST, PATCH, OPTIONS"
) {
  resposta.headers.set("Access-Control-Allow-Origin", "*");
  resposta.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  resposta.headers.set("Access-Control-Allow-Methods", metodos);
  return resposta;
}

export function respostaOptions(metodos = "GET, POST, PATCH, OPTIONS") {
  return aplicarCors(new NextResponse(null, { status: 204 }), metodos);
}

export function jsonCors(
  body: unknown,
  status = 200,
  metodos = "GET, POST, PATCH, OPTIONS"
) {
  return aplicarCors(NextResponse.json(body, { status }), metodos);
}

export function respostaNegacaoApi(error: unknown) {
  if (error instanceof ErroAssinaturaRestrita) {
    return jsonCors({ ok: false, erro: error.message }, 403);
  }

  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return jsonCors(entitlement, 403);
  }

  if (error instanceof ErroPermissao) {
    return jsonCors({ ok: false, erro: error.message }, error.status);
  }

  return null;
}
