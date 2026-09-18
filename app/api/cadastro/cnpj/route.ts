import { NextResponse } from "next/server";

import {
  consultarCnpjWs,
  consumirRateLimitConsultaCnpj,
  MENSAGEM_CNPJ_INVALIDO,
  MENSAGEM_CNPJ_LIMITE,
  mensagemConsultaCnpj,
} from "@/lib/cadastro/cnpj";
import { somenteDigitosDocumento } from "@/lib/fiscal/destinatario/documento";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error } = await obterClaimsSessao(supabase);
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return json({ ok: false, erro: "Não autenticado." }, 401);
  }

  const cnpj = somenteDigitosDocumento(
    new URL(request.url).searchParams.get("cnpj")
  );
  if (cnpj.length !== 14) {
    return json(
      { ok: false, motivo: "invalido", erro: MENSAGEM_CNPJ_INVALIDO },
      400
    );
  }

  const limite = consumirRateLimitConsultaCnpj(usuarioId);
  if (!limite.ok) {
    return json(
      { ok: false, motivo: "limite", erro: MENSAGEM_CNPJ_LIMITE },
      429
    );
  }

  const resultado = await consultarCnpjWs(cnpj);
  if (!resultado.ok) {
    const status =
      resultado.motivo === "invalido"
        ? 400
        : resultado.motivo === "nao_encontrado"
          ? 404
          : resultado.motivo === "limite"
            ? 429
            : resultado.motivo === "timeout"
              ? 504
              : 502;
    return json(
      {
        ok: false,
        motivo: resultado.motivo,
        erro: resultado.mensagem || mensagemConsultaCnpj(resultado.motivo),
      },
      status
    );
  }

  return json({
    ok: true,
    dados: resultado.dados,
    aviso: resultado.dados.incompleto
      ? "Consulta concluída com dados incompletos. Complete os campos manualmente."
      : undefined,
  });
}
