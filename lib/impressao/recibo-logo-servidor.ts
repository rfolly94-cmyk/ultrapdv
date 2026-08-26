import "server-only";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createClient } from "@/lib/supabase/server";
import {
  BUCKET_RECIBOS_LOGOS,
  pathLogoReciboPersonalizada,
  urlLogoReciboPersonalizada,
  validarUploadLogoRecibo,
} from "./logo-recibo-personalizada";
import {
  carregarLayoutReciboDaEmpresaAtiva,
  salvarLayoutReciboDaEmpresaAtiva,
} from "./recibo-layout-servidor";

async function sessaoConfiguracaoRecibo() {
  const sessao = await exigirPermissao({
    modulo: "configuracoes",
    acao: "acessar",
  });
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;
  if (error || !usuarioId) {
    throw new ErroPermissao("Não autenticado.", 401);
  }
  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, String(usuarioId), "empresa_id");
  if (!vinculo || vinculo.empresa_id !== sessao.empresaId) {
    throw new ErroPermissao("Empresa ativa não encontrada.", 403);
  }
  return { supabase, empresaId: String(vinculo.empresa_id) };
}

async function persistirPathLogoRecibo(args: {
  empresaId: string;
  path: string | null;
  fontePersonalizada: boolean;
}) {
  const atual = await carregarLayoutReciboDaEmpresaAtiva({
    empresaId: args.empresaId,
  });
  const layout = {
    ...atual,
    cabecalho: {
      ...atual.cabecalho,
      logo: true,
      logoFonte: args.fontePersonalizada
        ? ("personalizada" as const)
        : ("empresa" as const),
      logoPersonalizadaPath: pathLogoReciboPersonalizada(
        args.empresaId,
        args.path
      ),
    },
  };
  return salvarLayoutReciboDaEmpresaAtiva({ layout });
}

export async function salvarLogoPersonalizadaReciboDaEmpresaAtiva(arquivo: {
  bytes: Buffer;
  nomeArquivo?: string | null;
  mimeInformado?: string | null;
  tamanho: number;
}) {
  const { supabase, empresaId } = await sessaoConfiguracaoRecibo();
  const validado = validarUploadLogoRecibo({
    empresaId,
    nomeArquivo: arquivo.nomeArquivo,
    mimeInformado: arquivo.mimeInformado,
    tamanho: arquivo.tamanho,
    bytes: arquivo.bytes,
  });
  const pathNovo = validado.path;
  const atual = await carregarLayoutReciboDaEmpresaAtiva({ empresaId });
  const pathAntigo = pathLogoReciboPersonalizada(
    empresaId,
    atual.cabecalho.logoPersonalizadaPath
  );

  const enviado = await supabase.storage
    .from(BUCKET_RECIBOS_LOGOS)
    .upload(pathNovo, arquivo.bytes, {
      contentType: validado.tipo,
      upsert: false,
    });
  if (enviado.error) {
    return { ok: false as const, erro: "Não foi possível enviar a logo do recibo." };
  }

  const persistido = await persistirPathLogoRecibo({
    empresaId,
    path: pathNovo,
    fontePersonalizada: true,
  });
  if (!persistido.ok) {
    await supabase.storage.from(BUCKET_RECIBOS_LOGOS).remove([pathNovo]);
    return persistido;
  }

  if (pathAntigo && pathAntigo !== pathNovo) {
    await supabase.storage.from(BUCKET_RECIBOS_LOGOS).remove([pathAntigo]);
  }

  return {
    ok: true as const,
    layout: persistido.layout,
    logoUrl: urlLogoReciboPersonalizada(empresaId, pathNovo),
  };
}

export async function removerLogoPersonalizadaReciboDaEmpresaAtiva() {
  const { supabase, empresaId } = await sessaoConfiguracaoRecibo();
  const atual = await carregarLayoutReciboDaEmpresaAtiva({ empresaId });
  const pathAntigo = pathLogoReciboPersonalizada(
    empresaId,
    atual.cabecalho.logoPersonalizadaPath
  );
  const persistido = await persistirPathLogoRecibo({
    empresaId,
    path: null,
    fontePersonalizada: false,
  });
  if (!persistido.ok) {
    return persistido;
  }
  if (pathAntigo) {
    await supabase.storage.from(BUCKET_RECIBOS_LOGOS).remove([pathAntigo]);
  }
  return {
    ok: true as const,
    layout: persistido.layout,
    logoUrl: null as string | null,
  };
}
