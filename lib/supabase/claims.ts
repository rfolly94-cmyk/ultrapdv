import { headers } from "next/headers";

import { extrairBearerAuthorization } from "./bearer";

type ClienteAuthClaims = {
  auth: {
    getClaims: (jwt?: string) => Promise<{
      data: { claims: { sub?: string } } | null;
      error: { message?: string } | null;
    }>;
  };
};

export async function obterClaimsSessao<T extends ClienteAuthClaims>(
  supabase: T
) {
  const bearer = extrairBearerAuthorization(
    (await headers()).get("authorization")
  );

  if (bearer) {
    return supabase.auth.getClaims(bearer);
  }

  return supabase.auth.getClaims();
}
