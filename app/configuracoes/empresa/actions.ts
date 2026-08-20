"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  executarCicloLogoEmpresa,
  MENSAGEM_FALHA_LOGO,
  MENSAGEM_LOGO_ATUALIZADA,
} from "@/lib/empresa/ciclo-logo";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import {
  BUCKET_LOGOS_EMPRESAS,
  pathLogoDaEmpresa,
  urlPublicaLogoEmpresa,
} from "@/lib/empresa/logo";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Resultado =
  | { ok: true; mensagem: string; logoUrl: string | null }
  | { ok: false; erro: string };

async function resolverEmpresaAdministrador() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, claimsData.claims.sub, "empresa_id");

  if (!vinculo) {
    redirect("/onboarding");
  }

  try {
    await exigirPermissao({
      modulo: "configuracoes",
      acao: "editar_empresa",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return {
        ok: false as const,
        erro: error.message,
      };
    }
    throw error;
  }

  return {
    ok: true as const,
    empresaId: String(vinculo.empresa_id),
  };
}

function revalidarLogoEmpresa() {
  revalidatePath("/", "layout");
  revalidatePath("/configuracoes/empresa");
  revalidatePath("/configuracoes/fiscal/empresa");
  revalidatePath("/pdv");
}

export async function salvarLogomarcaEmpresa(
  formData: FormData
): Promise<Resultado> {
  const contexto = await resolverEmpresaAdministrador();
  if (!contexto.ok) {
    return contexto;
  }

  const empresaId = contexto.empresaId;
  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("empresas")
    .select("id, logo_path")
    .eq("id", empresaId)
    .maybeSingle();

  if (!atual || String(atual.id) !== empresaId) {
    return { ok: false, erro: "Empresa não encontrada." };
  }

  const arquivoForm = formData.get("logo");
  const arquivo =
    arquivoForm instanceof File && arquivoForm.size > 0
      ? {
          bytes: Buffer.from(await arquivoForm.arrayBuffer()),
          nomeArquivo: arquivoForm.name,
          mimeInformado: arquivoForm.type,
          tamanho: arquivoForm.size,
        }
      : null;

  const resultado = await executarCicloLogoEmpresa({
    empresaId,
    pathAtual: atual.logo_path ? String(atual.logo_path) : null,
    remover: formData.get("remover_logo") === "1",
    arquivo,
    upload: async ({ path, bytes, contentType }) => {
      const { error } = await admin.storage
        .from(BUCKET_LOGOS_EMPRESAS)
        .upload(path, bytes, {
          contentType,
          upsert: false,
        });
      return { error: error ? { message: error.message } : null };
    },
    persistir: async (path) => {
      const seguro = path ? pathLogoDaEmpresa(empresaId, path) : null;
      if (path && !seguro) {
        return { error: { message: MENSAGEM_FALHA_LOGO } };
      }

      const { error } = await admin
        .from("empresas")
        .update({ logo_path: seguro })
        .eq("id", empresaId);
      return { error: error ? { message: error.message } : null };
    },
    confirmar: async () => {
      const { data } = await admin
        .from("empresas")
        .select("logo_path")
        .eq("id", empresaId)
        .maybeSingle();
      return pathLogoDaEmpresa(empresaId, data?.logo_path);
    },
    removerArquivo: async (path) => {
      const seguro = pathLogoDaEmpresa(empresaId, path);
      if (!seguro) {
        return;
      }
      await admin.storage.from(BUCKET_LOGOS_EMPRESAS).remove([seguro]);
    },
  });

  if (!resultado.ok) {
    return {
      ok: false,
      erro:
        resultado.erro === MENSAGEM_FALHA_LOGO
          ? MENSAGEM_FALHA_LOGO
          : resultado.erro,
    };
  }

  revalidarLogoEmpresa();

  return {
    ok: true,
    mensagem: MENSAGEM_LOGO_ATUALIZADA,
    logoUrl: urlPublicaLogoEmpresa(resultado.logoPath),
  };
}
