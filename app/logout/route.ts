import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { registrarEventoAcessoAuth } from "@/lib/auth/auditoria-acesso";
import { COOKIE_RECUPERACAO_SENHA } from "@/lib/auth/recuperacao";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function expirarCookieAuth(
  response: NextResponse,
  name: string
) {
  response.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  await supabase.auth.signOut();

  const jar = await cookies();
  jar.delete(COOKIE_RECUPERACAO_SENHA);

  void registrarEventoAcessoAuth({
    evento: "logout",
    usuarioId: usuarioId ? String(usuarioId) : null,
  });

  revalidatePath("/", "layout");

  const destino = new URL("/login", request.url);
  destino.searchParams.set("logout", "1");

  const response = NextResponse.redirect(destino, { status: 303 });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");

  for (const cookie of jar.getAll()) {
    response.cookies.set(cookie);
  }

  for (const cookie of request.cookies.getAll()) {
    if (
      cookie.name.includes("-auth-token") ||
      cookie.name === COOKIE_RECUPERACAO_SENHA
    ) {
      expirarCookieAuth(response, cookie.name);
    }
  }

  return response;
}
