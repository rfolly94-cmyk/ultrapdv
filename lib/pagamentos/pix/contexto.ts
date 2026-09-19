import { createAdminClient } from "@/lib/supabase/admin";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import {
  ErroAcessoSessao,
  resolverContextoAutorizadoEmpresa,
} from "@/lib/auth/contexto-autorizado";
import { CODIGO_EMPRESA_NAO_OPERACIONAL } from "@/lib/auth/mensagens-acesso";
import {
  filtrarCredenciaisDoProvedor,
  mesclarSegredosProvedor,
  validarCredenciaisDoProvedor,
} from "./credenciais";
import { ErroPixGeranet } from "./erro";
import { obterProvedorPixGeranet } from "./provedores-geranet";
import type {
  AmbientePixGeranet,
  CredenciaisBancariasPix,
  IntegracaoPixPublica,
} from "./types";
import { obterApiKeyGeranetPlataforma } from "@/lib/fiscal/geranet/credencial-plataforma";

export { ErroPixGeranet } from "./erro";

export async function resolverEmpresaPix() {
  try {
    const ctx = await resolverContextoAutorizadoEmpresa();
    return {
      supabase: ctx.supabase,
      admin: createAdminClient(),
      empresaId: ctx.empresaId,
      perfil: String(ctx.perfil ?? ""),
      usuarioId: ctx.usuarioId,
    };
  } catch (error) {
    if (error instanceof ErroAcessoSessao) {
      throw new ErroPixGeranet(
        error.message,
        error.status,
        error.codigo === CODIGO_EMPRESA_NAO_OPERACIONAL
          ? CODIGO_EMPRESA_NAO_OPERACIONAL
          : error.codigo
      );
    }
    throw error;
  }
}

export async function exigirAdministradorPix() {
  try {
    await exigirPermissao({
      modulo: "financeiro",
      acao: "configurar_pix",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroPixGeranet(error.message, error.status);
    }
    throw error;
  }

  return resolverEmpresaPix();
}

export async function carregarIntegracaoPix(empresaId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integracoes_pix")
    .select(
      "id, empresa_id, gateway, modo, provedor, ambiente, ativo, chave_pix, recebedor_nome, recebedor_cep, recebedor_cidade, recebedor_uf, credenciais_configuradas, certificado_configurado, configuracao_publica"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(
      `Não foi possível carregar a integração PIX: ${error.message}`,
      500
    );
  }

  return (data as IntegracaoPixPublica | null) ?? null;
}

export async function carregarApiKeyGeranet(_empresaId?: string) {
  const admin = createAdminClient();
  let chave = "";
  try {
    chave = await obterApiKeyGeranetPlataforma(admin);
  } catch {
    throw new ErroPixGeranet(
      "Não foi possível ler a API Key Geranet da plataforma.",
      500
    );
  }

  if (!chave && _empresaId) {
    const { data, error } = await admin.rpc("obter_segredos_fiscais", {
      p_empresa_id: _empresaId,
    });
    if (error) {
      throw new ErroPixGeranet(
        "Não foi possível ler a API Key Geranet do cofre fiscal.",
        500
      );
    }
    chave = String(
      (data as { geranet_api_key?: string } | null)?.geranet_api_key ?? ""
    ).trim();
  }

  if (!chave) {
    throw new ErroPixGeranet(
      "A API Geranet da plataforma ainda não está configurada.",
      422
    );
  }

  return chave;
}

export async function carregarCnpjEmpresa(empresaId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("empresas")
    .select("cnpj")
    .eq("id", empresaId)
    .maybeSingle();

  if (error || !data) {
    throw new ErroPixGeranet("Empresa não encontrada.", 404);
  }

  return String(data.cnpj ?? "").replace(/\D/g, "");
}

export async function carregarSegredosProvedor(params: {
  empresaId: string;
  provedor: string;
  ambiente: AmbientePixGeranet;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "obter_segredos_bancarios_provedor",
    {
      p_empresa_id: params.empresaId,
      p_provedor: params.provedor,
      p_ambiente: params.ambiente,
    }
  );

  if (error) {
    throw new ErroPixGeranet(
      "Não foi possível ler as credenciais bancárias do cofre.",
      500
    );
  }

  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}

export async function carregarSegredosLegado(empresaId: string) {
  const admin = createAdminClient();
  const { data } = await admin.rpc("obter_segredos_bancarios", {
    p_empresa_id: empresaId,
  });

  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}

export async function montarCredenciaisGeranetPix({
  empresaId,
  provedor,
  ambiente,
  chavePixPublica,
}: {
  empresaId: string;
  provedor: string;
  ambiente: AmbientePixGeranet;
  chavePixPublica?: string | null;
}): Promise<CredenciaisBancariasPix> {
  const meta = obterProvedorPixGeranet(provedor);
  if (!meta?.configuracaoDisponivel) {
    throw new ErroPixGeranet(
      "Configuração deste provedor ainda não foi mapeada no UltraPDV."
    );
  }

  const [existentes, aliasGerencianet, legado] = await Promise.all([
    carregarSegredosProvedor({ empresaId, provedor, ambiente }),
    provedor === "efibank"
      ? carregarSegredosProvedor({
          empresaId,
          provedor: "gerencianet",
          ambiente,
        })
      : Promise.resolve({}),
    provedor === "efibank" || provedor === "gerencianet"
      ? carregarSegredosLegado(empresaId)
      : Promise.resolve({}),
  ]);

  const mescladas = mesclarSegredosProvedor({
    provedor,
    ambiente,
    novos: {},
    existentes: { ...aliasGerencianet, ...existentes },
    legado,
  });

  const credenciais = filtrarCredenciaisDoProvedor(
    provedor,
    mescladas,
    chavePixPublica,
    ambiente
  );

  const erros = validarCredenciaisDoProvedor(provedor, credenciais, ambiente);
  if (erros.length > 0) {
    throw new ErroPixGeranet(erros[0] ?? "Credenciais PIX incompletas.");
  }

  return credenciais;
}

export async function carregarCredenciaisBancarias(
  empresaId: string,
  chavePixPublica?: string | null,
  provedor?: string,
  ambiente?: AmbientePixGeranet
): Promise<CredenciaisBancariasPix> {
  const integracao = provedor
    ? { provedor, ambiente: ambiente ?? "2" }
    : await carregarIntegracaoPix(empresaId);

  if (!integracao) {
    throw new ErroPixGeranet("Integração PIX não configurada.");
  }

  if (!integracao.provedor) {
    throw new ErroPixGeranet("Integração PIX Geranet sem provedor configurado.");
  }

  return montarCredenciaisGeranetPix({
    empresaId,
    provedor: integracao.provedor,
    ambiente: (integracao.ambiente as AmbientePixGeranet) ?? "2",
    chavePixPublica,
  });
}
