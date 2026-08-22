"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import {
  exigirOperacaoCatalogo,
  resultadoNegacaoCatalogo,
} from "@/lib/catalogo/acesso-operacao";
import { createClient } from "@/lib/supabase/server";
import {
  normalizarWhatsapp,
  validarSlug,
  validarWhatsapp,
} from "@/lib/catalogo/regras";
import {
  bucketCatalogo,
  caminhoBannerCatalogo,
  caminhoLogoCatalogo,
} from "@/lib/catalogo/storage";

type Resultado =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  await exigirEmpresaOperacionalOuRedirecionar(String(vinculo.empresa_id));

  return { supabase, empresaId: vinculo.empresa_id };
}

async function enviarImagemConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string,
  arquivo: FormDataEntryValue | null
) {
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return undefined;
  }

  if (arquivo.size > 5 * 1024 * 1024) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }

  const buffer = Buffer.from(await arquivo.arrayBuffer());
  const { error } = await supabase.storage
    .from(bucketCatalogo())
    .upload(path, buffer, {
      contentType: "image/webp",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || "Não foi possível enviar a imagem.");
  }

  return path;
}

export async function salvarCatalogoConfig(
  formData: FormData
): Promise<Resultado> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirOperacaoCatalogo({
      empresaId: String(empresaId),
      acao: "configurar",
      origem: "configuracoes/catalogo",
    });
  } catch (error) {
    const negacao = resultadoNegacaoCatalogo(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

  const ativo = formData.get("ativo") === "1";
  const nome = String(formData.get("nome_exibido") ?? "").trim();
  const slugValidado = validarSlug(String(formData.get("slug") ?? ""));
  const descricao = String(formData.get("descricao") ?? "").trim();
  const permitirPedido = formData.get("permitir_pedido") === "1";
  const permitirWhatsapp = formData.get("permitir_whatsapp") === "1";
  const whatsappBruto = String(formData.get("whatsapp_numero") ?? "");
  const whatsappMensagem = String(
    formData.get("whatsapp_mensagem") ?? ""
  ).trim();
  const produtoSemEstoque = String(
    formData.get("produto_sem_estoque") ?? "mostrar_esgotado"
  );
  const permitirRetirada = formData.get("permitir_retirada") === "1";
  const permitirEntrega = formData.get("permitir_entrega") === "1";
  const infoEntrega = String(formData.get("info_entrega") ?? "").trim();

  if (nome.length < 2 || nome.length > 80) {
    return { ok: false, erro: "Informe o nome exibido da loja." };
  }

  if (!slugValidado.ok) {
    return { ok: false, erro: slugValidado.erro };
  }

  if (ativo && !permitirPedido && !permitirWhatsapp) {
    return {
      ok: false,
      erro: "Ative pelo menos uma forma de finalização.",
    };
  }

  if (!permitirRetirada && !permitirEntrega) {
    return {
      ok: false,
      erro: "Ative retirada, entrega ou ambas.",
    };
  }

  if (
    produtoSemEstoque !== "mostrar_esgotado" &&
    produtoSemEstoque !== "ocultar"
  ) {
    return { ok: false, erro: "Regra de estoque inválida." };
  }

  let whatsappNumero: string | null = null;

  if (permitirWhatsapp) {
    const validado = validarWhatsapp(whatsappBruto);

    if (!validado.ok) {
      return {
        ok: false,
        erro: "Informe o WhatsApp da loja para ativar essa finalização.",
      };
    }

    whatsappNumero = validado.numero;
  } else if (normalizarWhatsapp(whatsappBruto)) {
    const validado = validarWhatsapp(whatsappBruto);

    if (!validado.ok) {
      return { ok: false, erro: validado.erro };
    }

    whatsappNumero = validado.numero;
  }

  const { data: atual } = await supabase
    .from("catalogo_config")
    .select("id, logo_path, banner_path")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  let logoPath = atual?.logo_path ?? null;
  let bannerPath = atual?.banner_path ?? null;

  try {
    if (formData.get("remover_logo") === "1" && logoPath) {
      await supabase.storage.from(bucketCatalogo()).remove([logoPath]);
      logoPath = null;
    }

    if (formData.get("remover_banner") === "1" && bannerPath) {
      await supabase.storage.from(bucketCatalogo()).remove([bannerPath]);
      bannerPath = null;
    }

    const logoNovo = await enviarImagemConfig(
      supabase,
      caminhoLogoCatalogo(empresaId),
      formData.get("logo")
    );
    const bannerNovo = await enviarImagemConfig(
      supabase,
      caminhoBannerCatalogo(empresaId),
      formData.get("banner")
    );

    if (logoNovo) {
      logoPath = logoNovo;
    }

    if (bannerNovo) {
      bannerPath = bannerNovo;
    }
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível enviar as imagens.",
    };
  }

  const payload = {
    empresa_id: empresaId,
    ativo,
    nome_exibido: nome,
    slug: slugValidado.slug,
    descricao: descricao || null,
    logo_path: logoPath,
    banner_path: bannerPath,
    whatsapp_numero: whatsappNumero,
    whatsapp_mensagem: whatsappMensagem || null,
    permitir_pedido: permitirPedido,
    permitir_whatsapp: permitirWhatsapp,
    produto_sem_estoque: produtoSemEstoque,
    permitir_retirada: permitirRetirada,
    permitir_entrega: permitirEntrega,
    info_entrega: infoEntrega || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = atual?.id
    ? await supabase
        .from("catalogo_config")
        .update(payload)
        .eq("empresa_id", empresaId)
        .eq("id", atual.id)
    : await supabase.from("catalogo_config").insert(payload);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, erro: "Este link já está em uso por outra loja." };
    }

    return { ok: false, erro: error.message };
  }

  revalidatePath("/configuracoes/catalogo");
  revalidatePath(`/catalogo/${slugValidado.slug}`);

  return { ok: true, mensagem: "Catálogo salvo com sucesso." };
}
