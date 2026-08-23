import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { extrairBearerAuthorization } from "./bearer";

export async function createClient() {
  const cookieStore = await cookies();
  const bearer = extrairBearerAuthorization(
    (await headers()).get("authorization")
  );

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components não conseguem gravar cookies diretamente.
            // O proxy ficará responsável pela atualização da sessão.
          }
        },
      },
      ...(bearer
        ? {
            global: {
              headers: {
                Authorization: `Bearer ${bearer}`,
              },
            },
          }
        : {}),
    }
  );
}