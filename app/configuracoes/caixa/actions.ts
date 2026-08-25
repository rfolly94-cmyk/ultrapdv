"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import {
  MENSAGEM_CONTROLE_CAIXA_ATIVADO,
  MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR,
} from "@/lib/caixa/mensagens";
import { buscarCaixaAbertoEmpresa } from "@/lib/caixa/sessao-aberta";
import { mensagemErroCaixa } from "@/lib/caixa/valor";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createClient } from "@/lib/supabase/server";

type Resultado =
  | { ok: true; mensagem?: string }
  | { ok: false; erro: string };

function revalidarControleCaixa() {
  revalidatePath("/configuracoes/caixa");
  revalidatePath("/caixa");
  revalidatePath("/pdv");
  revalidatePath("/fiscal");
  revalidatePath("/fiscal/nfe/nova");
  revalidatePath("/fiscal/nfe", "layout");
}

export async function definirControleCaixa(input: {
  ativo: boolean;
}): Promise<Resultado> {
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

  try {
    await exigirPermissao({
      modulo: "configuracoes",
      acao: "editar_empresa",
    });
  } catch (error) {
    if (error instanceof ErroPermissao && error.status === 401) {
      redirect("/login");
    }
    if (error instanceof ErroPermissao) {
      return { ok: false, erro: error.message };
    }
    throw error;
  }

  const ativo = input.ativo === true;

  if (!ativo) {
    const aberto = await buscarCaixaAbertoEmpresa(supabase, empresaId);
    if (aberto) {
      return { ok: false, erro: MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR };
    }
  }

  const { error } = await supabase.rpc("rpc_definir_controle_caixa", {
    p_ativo: ativo,
  });

  if (error) {
    const texto = String(error.message ?? "");
    if (/enquanto houver um Caixa aberto/i.test(texto)) {
      return { ok: false, erro: MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR };
    }
    return {
      ok: false,
      erro: mensagemErroCaixa(
        error,
        "Não foi possível atualizar o controle de Caixa."
      ),
    };
  }

  revalidarControleCaixa();

  if (ativo) {
    return { ok: true, mensagem: MENSAGEM_CONTROLE_CAIXA_ATIVADO };
  }

  return { ok: true };
}
