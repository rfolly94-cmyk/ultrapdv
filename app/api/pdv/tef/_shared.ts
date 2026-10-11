import { NextResponse } from "next/server";

import { ErroAcessoSessao } from "@/lib/auth/contexto-autorizado";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { resultadoNegacaoPdv } from "@/lib/pdv/acesso-operacao";
import { ErroTef } from "@/lib/pdv/tef/servico";

export function responderTef(error: unknown) {
  if (error instanceof ErroTef) {
    return NextResponse.json(
      { ok: false, erro: error.message },
      { status: error.status }
    );
  }
  if (error instanceof ErroAcessoSessao) {
    return NextResponse.json(
      { ok: false, erro: error.message },
      { status: error.status }
    );
  }
  if (error instanceof ErroPermissao) {
    return NextResponse.json(
      { ok: false, erro: error.message },
      { status: error.status }
    );
  }
  const negacao = resultadoNegacaoPdv(error);
  if (negacao) {
    return NextResponse.json(negacao, { status: 403 });
  }
  return NextResponse.json(
    { ok: false, erro: "Não foi possível concluir a operação TEF." },
    { status: 500 }
  );
}

export async function lerCorpo(request: Request) {
  try {
    const corpo = (await request.json()) as unknown;
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
      return {};
    }
    return corpo as Record<string, unknown>;
  } catch {
    return {};
  }
}
