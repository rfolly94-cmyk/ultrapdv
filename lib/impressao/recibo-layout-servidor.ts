import "server-only";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createClient } from "@/lib/supabase/server";
import {
  layoutReciboPadrao,
  sanitizarLayoutRecibo,
  type ReciboLayoutConfig,
} from "./recibo-layout";
import { resolverLogoReciboEmpresa } from "./resolver-logo-recibo";

export async function carregarLayoutReciboDaEmpresaAtiva(args: {
  empresaId: string;
}): Promise<ReciboLayoutConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recibos_layout_config")
    .select("empresa_id, layout")
    .eq("empresa_id", args.empresaId)
    .maybeSingle();

  if (!data || data.empresa_id !== args.empresaId) {
    return layoutReciboPadrao();
  }

  const sanitizado = sanitizarLayoutRecibo(data.layout);
  return sanitizado.ok ? sanitizado.valor : layoutReciboPadrao();
}

export async function salvarLayoutReciboDaEmpresaAtiva(input: {
  layout: unknown;
}): Promise<
  | { ok: true; layout: ReciboLayoutConfig }
  | { ok: false; erro: string; status?: number }
> {
  let sessao;
  try {
    sessao = await exigirPermissao({
      modulo: "configuracoes",
      acao: "acessar",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return { ok: false, erro: error.message, status: error.status };
    }
    throw error;
  }

  const sanitizado = sanitizarLayoutRecibo(input.layout);
  if (!sanitizado.ok) {
    return sanitizado;
  }

  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;
  if (error || !usuarioId) {
    return { ok: false, erro: "Não autenticado.", status: 401 };
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, String(usuarioId), "empresa_id");

  if (!vinculo || vinculo.empresa_id !== sessao.empresaId) {
    return { ok: false, erro: "Empresa ativa não encontrada.", status: 403 };
  }

  const { error: upsertErro } = await supabase
    .from("recibos_layout_config")
    .upsert(
      {
        empresa_id: vinculo.empresa_id,
        layout: sanitizado.valor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id" }
    );

  if (upsertErro) {
    return { ok: false, erro: upsertErro.message, status: 500 };
  }

  return { ok: true, layout: sanitizado.valor };
}

export async function carregarIdentidadeReciboEmpresaAtiva(empresaId: string) {
  const supabase = await createClient();
  const [{ data: empresa }, { data: fiscal }, { data: catalogo }] =
    await Promise.all([
      supabase
        .from("empresas")
        .select("nome_fantasia, razao_social, cnpj, logo_path")
        .eq("id", empresaId)
        .maybeSingle(),
      supabase
        .from("empresas_fiscal")
        .select(
          "inscricao_estadual, telefone, email, logradouro, numero, bairro, municipio, uf"
        )
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("catalogo_config")
        .select("whatsapp_numero")
        .eq("empresa_id", empresaId)
        .maybeSingle()
        .then((resultado) =>
          resultado.error ? { data: null } : resultado
        ),
    ]);

  const rua = [fiscal?.logradouro, fiscal?.numero].filter(Boolean).join(", ");
  const cidade = [fiscal?.municipio, fiscal?.uf].filter(Boolean).join("/");
  const logo = await resolverLogoReciboEmpresa({
    supabase,
    empresaId,
    logoPath: empresa?.logo_path,
    incorporar: false,
  });

  return {
    nomeFantasia: String(empresa?.nome_fantasia ?? empresa?.razao_social ?? "Empresa"),
    razaoSocial: String(empresa?.razao_social ?? ""),
    documento: String(empresa?.cnpj ?? ""),
    ie: String(fiscal?.inscricao_estadual ?? ""),
    endereco: [rua, fiscal?.bairro, cidade].filter(Boolean).join(" - "),
    telefone: String(fiscal?.telefone ?? ""),
    email: String(fiscal?.email ?? ""),
    whatsapp: String(catalogo?.whatsapp_numero ?? ""),
    logoUrl: logo.url,
  };
}
