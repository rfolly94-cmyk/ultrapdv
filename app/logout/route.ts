import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: NextRequest
) {
  const supabase =
    await createClient();

  /*
   * Encerra a sessão Supabase atual.
   * O createClient server-side do UltraPDV é responsável
   * por atualizar/remover os cookies de autenticação.
   */
  await supabase.auth.signOut();

  const destino =
    new URL(
      "/login",
      request.url
    );

  destino.searchParams.set(
    "logout",
    "1"
  );

  const response =
    NextResponse.redirect(
      destino,
      {
        status: 303,
      }
    );

  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  return response;
}
