"use server";

import { revalidatePath } from "next/cache";

import { gravarPreferenciasPdvSessao } from "@/lib/pdv/preferencias-servidor";
import type { PreferenciasPdv } from "@/lib/pdv/preferencias";

export async function salvarPreferenciasPdvAction(input: PreferenciasPdv) {
  const resultado = await gravarPreferenciasPdvSessao(input);

  if (resultado.ok) {
    revalidatePath("/pdv");
  }

  return resultado;
}
