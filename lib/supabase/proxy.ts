import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { carregarEstadoAcessoSessao } from "@/lib/auth/carregar-estado-acesso";
import {
  decidirGateSessao,
  ehRotaApi,
  ehRotaPlataforma,
  ehRotaPublicaIntencional,
  jsonSemPermissao,
} from "@/lib/auth/gate-rotas";
import { classificarEstadoAcesso } from "@/lib/auth/estado-acesso";
import { extrairBearerAuthorization } from "@/lib/supabase/bearer";
import { carregarPermissoesDoVinculo } from "@/lib/permissoes/carregar";
import { decidirAcessoRota, rotaLivrePermissao } from "@/lib/permissoes/rotas";
import { assinaturaBloqueiaOperacao } from "@/lib/assinatura/empresa-pode-operar";
import { rotaOperacionalBloqueadaQuandoSuspensa } from "@/lib/assinatura/rotas-restritas";

function aplicarCookiesSessao(
  origem: NextResponse,
  destino: NextResponse
) {
  origem.cookies.getAll().forEach((cookie) => {
    destino.cookies.set(cookie);
  });
  return destino;
}

function responderGate(
  origem: NextResponse,
  request: NextRequest,
  decisao: ReturnType<typeof decidirGateSessao>
) {
  if (decisao.tipo === "seguir") {
    return null;
  }

  if (decisao.tipo === "json") {
    return aplicarCookiesSessao(
      origem,
      NextResponse.json(
        {
          ok: false,
          erro: decisao.erro,
          codigo: decisao.codigo,
        },
        { status: decisao.status }
      )
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = decisao.destino;
  url.search = "";
  return aplicarCookiesSessao(origem, NextResponse.redirect(url));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );

          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  const bearer = extrairBearerAuthorization(
    request.headers.get("authorization")
  );
  const { data: claimsData } = bearer
    ? await supabase.auth.getClaims(bearer)
    : await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;
  const pathname = request.nextUrl.pathname;

  if (ehRotaPublicaIntencional(pathname) || ehRotaPlataforma(pathname)) {
    return supabaseResponse;
  }

  const estado = usuarioId
    ? await carregarEstadoAcessoSessao(supabase, String(usuarioId))
    : classificarEstadoAcesso({});

  let empresaOperacional: boolean | null = null;
  if (estado.temVinculoOperacional && estado.empresaId) {
    const { data: assinatura, error: erroAssinatura } = await supabase
      .from("assinaturas_empresas")
      .select("status, carencia_ate, liberado_ate")
      .eq("empresa_id", estado.empresaId)
      .maybeSingle();

    empresaOperacional = !assinaturaBloqueiaOperacao(
      assinatura
        ? {
            ...assinatura,
            empresa_id: estado.empresaId,
          }
        : null,
      erroAssinatura
    );
  }

  const decisao = decidirGateSessao({
    pathname,
    autenticado: Boolean(usuarioId),
    estado,
    empresaOperacional,
    rotaOperacional: rotaOperacionalBloqueadaQuandoSuspensa(pathname),
  });

  const bloqueio = responderGate(supabaseResponse, request, decisao);
  if (bloqueio) {
    return bloqueio;
  }

  if (usuarioId && estado.temVinculoOperacional && estado.empresaId) {
    if (!rotaLivrePermissao(pathname)) {
      const sessao = await carregarPermissoesDoVinculo({
        supabase,
        usuarioId: String(usuarioId),
        empresaId: estado.empresaId,
        perfil: String(estado.perfil ?? ""),
      });

      const acesso = decidirAcessoRota({
        pathname,
        method: request.method,
        permissoes: sessao.permissoes,
      });

      if (!acesso.ok) {
        if (ehRotaApi(pathname)) {
          const negado = jsonSemPermissao();
          return aplicarCookiesSessao(
            supabaseResponse,
            NextResponse.json(
              {
                ok: false,
                erro: negado.tipo === "json" ? negado.erro : "Acesso negado.",
                codigo: "SEM_PERMISSAO",
              },
              { status: 403 }
            )
          );
        }

        const url = request.nextUrl.clone();
        url.pathname = acesso.redirect;
        url.search = "";
        return aplicarCookiesSessao(
          supabaseResponse,
          NextResponse.redirect(url)
        );
      }
    }
  }

  return supabaseResponse;
}
