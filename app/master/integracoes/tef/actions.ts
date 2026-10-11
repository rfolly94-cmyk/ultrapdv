"use server";

import { redirect } from "next/navigation";

import { ErroTef, definirDisponibilidadeTefPlataforma } from "@/lib/pdv/tef/servico";

export async function masterDefinirTef(formData: FormData) {
  try {
    await definirDisponibilidadeTefPlataforma(formData.get("habilitada") === "on");
  } catch (error) {
    const mensagem =
      error instanceof ErroTef
        ? error.message
        : "Não foi possível atualizar a disponibilidade do TEF.";
    redirect(`/master/integracoes/tef?erro=${encodeURIComponent(mensagem)}`);
  }
  redirect("/master/integracoes/tef?sucesso=1");
}
