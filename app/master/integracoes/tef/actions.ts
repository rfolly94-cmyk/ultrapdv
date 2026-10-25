"use server";

import { redirect } from "next/navigation";

export async function masterDefinirTef() {
  redirect(
    `/master/integracoes/tef?erro=${encodeURIComponent(
      "A integração operacional do TEF foi desativada. O registro da plataforma permanece e nenhuma cobrança foi religada."
    )}`
  );
}
