import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { destinoAposConfirmacaoAuth } from "@/lib/auth/destino-confirmacao";
import { COOKIE_RECUPERACAO_SENHA } from "@/lib/auth/recuperacao";
import { createClient } from "@/lib/supabase/server";

function urlApp(request: NextRequest, caminho: string) {
  return new URL(caminho, request.url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  if ((!tokenHash || !type) && !code) {
    return NextResponse.redirect(
      urlApp(
        request,
        "/login?erro=" +
          encodeURIComponent("Não foi possível confirmar o link.")
      )
    );
  }

  const supabase = await createClient();
  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      })
    : await supabase.auth.exchangeCodeForSession(String(code));

  if (error) {
    return NextResponse.redirect(
      urlApp(
        request,
        "/login?erro=" +
          encodeURIComponent("Não foi possível confirmar seu cadastro.")
      )
    );
  }

  if (String(type ?? "").toLowerCase() === "recovery") {
    const response = NextResponse.redirect(
      urlApp(request, destinoAposConfirmacaoAuth(type, false))
    );
    response.cookies.set(COOKIE_RECUPERACAO_SENHA, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (!usuarioId) {
    return NextResponse.redirect(urlApp(request, "/login"));
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(usuarioId))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  return NextResponse.redirect(
    urlApp(
      request,
      destinoAposConfirmacaoAuth(type, Boolean(vinculo))
    )
  );
}
