import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { carregarPermissoesDoVinculo } from "@/lib/permissoes/carregar";
import { decidirAcessoRota, rotaLivrePermissao } from "@/lib/permissoes/rotas";
import { rotaAdminPlataforma } from "@/lib/plataforma/autorizacao";
import { assinaturaBloqueiaOperacao } from "@/lib/assinatura/empresa-pode-operar";
import {
  rotaMaster,
  rotaOperacionalBloqueadaQuandoSuspensa,
} from "@/lib/assinatura/rotas-restritas";

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

  // Valida/renova o JWT da sessão.
  const { data: claimsData } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;
  const pathname = request.nextUrl.pathname;

  // Admin da plataforma / Master não depende de tenant/empresa ativa.
  if (rotaAdminPlataforma(pathname) || rotaMaster(pathname)) {
    return supabaseResponse;
  }

  if (usuarioId) {
    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id, perfil")
      .eq("usuario_id", String(usuarioId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (vinculo && !rotaLivrePermissao(pathname)) {
      if (rotaOperacionalBloqueadaQuandoSuspensa(pathname)) {
        const { data: assinatura, error: erroAssinatura } = await supabase
          .from("assinaturas_empresas")
          .select("status, carencia_ate, liberado_ate")
          .eq("empresa_id", String(vinculo.empresa_id))
          .maybeSingle();

        if (
          assinaturaBloqueiaOperacao(
            assinatura
              ? {
                  ...assinatura,
                  empresa_id: String(vinculo.empresa_id),
                }
              : null,
            erroAssinatura
          )
        ) {
          const url = request.nextUrl.clone();
          url.pathname = "/assinatura";
          url.search = "";
          return NextResponse.redirect(url);
        }
      }

      const sessao = await carregarPermissoesDoVinculo({
        supabase,
        usuarioId: String(usuarioId),
        empresaId: String(vinculo.empresa_id),
        perfil: String(vinculo.perfil ?? ""),
      });

      const acesso = decidirAcessoRota({
        pathname,
        method: request.method,
        permissoes: sessao.permissoes,
      });

      if (!acesso.ok) {
        const url = request.nextUrl.clone();
        url.pathname = acesso.redirect;
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}