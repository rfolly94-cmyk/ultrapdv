"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { MENSAGEM_GAVETA_CAIXA_FECHADO } from "@/lib/caixa/mensagens";
import { origemAberturaGaveta } from "@/lib/caixa/gaveta";
import { buscarCaixaAbertoEmpresa } from "@/lib/caixa/sessao-aberta";
import { mensagemErroCaixa, uuidCaixaValido } from "@/lib/caixa/valor";
import { createClient } from "@/lib/supabase/server";

type Resultado = { ok: true } | { ok: false; erro: string };

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(usuarioId))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);
  await exigirEmpresaOperacionalOuRedirecionar(empresaId);

  return { supabase, empresaId };
}

export async function autorizarAberturaGaveta(): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();
    const aberto = await buscarCaixaAbertoEmpresa(supabase, empresaId);
    if (!aberto) {
      return { ok: false, erro: MENSAGEM_GAVETA_CAIXA_FECHADO };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível verificar o Caixa."),
    };
  }
}

export async function registrarAberturaGaveta(input: {
  origem: string;
  vendaId?: string | null;
}): Promise<Resultado> {
  try {
    const { supabase } = await getContexto();
    const origem = origemAberturaGaveta(input.origem);
    if (!origem) {
      return { ok: false, erro: "Origem da abertura da gaveta inválida." };
    }

    const vendaId = String(input.vendaId ?? "").trim();
    const { error } = await supabase.rpc("rpc_registrar_abertura_gaveta", {
      p_origem: origem,
      p_venda_id:
        origem === "venda" && uuidCaixaValido(vendaId) ? vendaId : null,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(
          error,
          "Não foi possível registrar a abertura da gaveta."
        ),
      };
    }

    revalidatePath("/caixa");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(
        error,
        "Não foi possível registrar a abertura da gaveta."
      ),
    };
  }
}
