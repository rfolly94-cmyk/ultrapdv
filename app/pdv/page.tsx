import { redirect } from "next/navigation";

import { PdvIndisponivelAssinatura } from "@/components/assinatura/pdv-indisponivel";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { createClient } from "@/lib/supabase/server";
import { PdvShell } from "@/components/pdv/pdv-shell";
import { carregarPedidoParaPdv } from "@/lib/catalogo/carregar-pedido-pdv";
import { pathLogoDaEmpresa, urlPublicaLogoEmpresa } from "@/lib/empresa/logo";
import { carregarPreferenciasPdvSessao } from "@/lib/pdv/preferencias-servidor";
import { obterRotuloUsuarioSessao } from "@/lib/usuarios/perfil-sessao";
import {
  classificarIntegracaoPix,
  pixConfigPublicoPdv,
} from "@/lib/pagamentos/pix/modo-ativo";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import { filtrarFormasPagamentoCheckoutPdv } from "@/lib/pdv/formas-pagamento-checkout";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { resolverAssinaturaEmpresa } from "@/lib/assinatura/resolver-assinatura-empresa";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    pedido?: string;
  }>;
};

export default async function PdvPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !usuarioId
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from("usuarios_empresas")
      .select(`
        empresa_id,
        perfil,
        empresas (
          nome_fantasia,
          logo_path
        )
      `)
      .eq("usuario_id", String(usuarioId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const assinatura = await resolverAssinaturaEmpresa(String(vinculo.empresa_id));
  if (!assinatura.operacional) {
    return <PdvIndisponivelAssinatura />;
  }

  const planoPdv = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "pdv"
  );
  if (!planoPdv.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(
      String(vinculo.empresa_id)
    );
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="PDV"
            descricao="Este recurso não está disponível no plano atual da sua empresa. O caixa, a finalização e a edição de venda pelo PDV estão disponíveis em planos que incluem este recurso. Vendas já registradas, estoque, carteira, PIX, impressão e emissão fiscal continuam nos recursos correspondentes."
            planoNome={entitlements.planoNome}
            voltarHref="/painel"
            voltarLabel="Voltar ao início"
          />
        </div>
      </main>
    );
  }

  const empresa =
    Array.isArray(
      vinculo.empresas
    )
      ? vinculo.empresas[0]
      : vinculo.empresas;

  const [
    produtosResult,
    clientesResult,
    formasResult,
    pixResult,
    fiscalResult,
    nfceConfigResult,
    usuarioResult,
    preferencias,
  ] = await Promise.all([
    supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        codigo_barras,
        nome,
        unidade_medida,
        preco_venda,
        catalogo_imagem_path
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq("ativo", true)
      .order("nome"),

    supabase
      .from("clientes")
      .select(`
        id,
        nome,
        cpf_cnpj,
        telefone,
        limite_credito,
        saldo_devedor,
        bloqueado
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq("ativo", true)
      .order("nome"),

    supabase
      .from("formas_pagamento")
      .select(`
        id,
        codigo,
        nome,
        tipo,
        codigo_fiscal,
        permite_troco,
        permite_fiado,
        permite_parcelamento,
        ordem
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq("ativo", true)
      .order("ordem"),

    supabase
      .from("integracoes_pix")
      .select("id, modo, ativo, provedor")
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle(),

    supabase
      .from("empresas_fiscal")
      .select("empresa_id, ambiente")
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle(),

    supabase
      .from("fiscal_nfce_config")
      .select("empresa_id, emitir_nfce_automatico_pdv")
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle(),
    supabase
      .from("usuarios")
      .select("id, nome")
      .eq("id", String(usuarioId))
      .maybeSingle(),
    carregarPreferenciasPdvSessao(),
  ]);

  if (
    produtosResult.error
  ) {
    throw new Error(
      produtosResult.error.message
    );
  }

  if (
    clientesResult.error
  ) {
    throw new Error(
      clientesResult.error.message
    );
  }

  if (
    formasResult.error
  ) {
    throw new Error(
      formasResult.error.message
    );
  }

  const fiscal = registroPertenceAEmpresaAtiva(
    fiscalResult.data,
    vinculo.empresa_id
  )
    ? fiscalResult.data
    : null;
  const nfceConfig = registroPertenceAEmpresaAtiva(
    nfceConfigResult.data,
    vinculo.empresa_id
  )
    ? nfceConfigResult.data
    : null;
  const ambienteFiscal = Number(fiscal?.ambiente) === 1 ? 1 : 2;
  const emitirNfceAutomaticoPdv =
    nfceConfig?.emitir_nfce_automatico_pdv === true;

  const pedidoInicial = params.pedido
    ? await carregarPedidoParaPdv(
        supabase,
        vinculo.empresa_id,
        params.pedido
      )
    : null;

  const planoPix = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "pix_integrado"
  );
  const planoNfce = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "nfce"
  );

  const usuarioNome =
    String(usuarioResult.data?.nome ?? "").trim() ||
    (await obterRotuloUsuarioSessao());
  const logoUrl = urlPublicaLogoEmpresa(
    pathLogoDaEmpresa(
      String(vinculo.empresa_id),
      (empresa as { logo_path?: string | null } | null)?.logo_path
    )
  );

  return (
    <PdvShell
      empresaNome={
        empresa?.nome_fantasia ??
        "Empresa"
      }
      empresaId={String(vinculo.empresa_id)}
      usuarioNome={usuarioNome}
      logoUrl={logoUrl}
      preferenciasIniciais={preferencias}
      produtos={
        produtosResult.data ??
        []
      }
      clientes={
        clientesResult.data ??
        []
      }
      formasPagamento={filtrarFormasPagamentoCheckoutPdv(
        formasResult.data ?? []
      )}
      pedidoInicial={pedidoInicial}
      pixConfig={pixConfigPublicoPdv(
        classificarIntegracaoPix(pixResult.data)
      )}
      pixIntegradoLiberado={planoPix.permitido}
      emitirNfceAutomaticoPdv={
        emitirNfceAutomaticoPdv && planoNfce.permitido
      }
      ambienteFiscal={ambienteFiscal}
    />
  );
}
