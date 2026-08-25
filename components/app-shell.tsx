"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { AvisoCarencia } from "@/components/assinatura/aviso-carencia";
import { LogoEmpresa } from "@/components/empresa/logo-empresa";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AssistenteFlutuante } from "@/components/suporte/assistente-flutuante";
import type { IdentidadeEmpresaPublica } from "@/lib/empresa/logo";
import { EntitlementsUiProvider } from "@/lib/plataforma/entitlements/contexto-ui";
import { PermissoesUiProvider } from "@/lib/permissoes/contexto-ui";
import type { PermissoesEfetivas } from "@/lib/permissoes/tipos";

export function AppShell({
  children,
  perfil,
  identidade,
  usuario,
  permissoes = null,
  recursosLiberados = null,
  assinaturaOperacional = true,
  carenciaAte = null,
  assinaturaSuspensa = false,
}: {
  children: React.ReactNode;
  perfil?: string | null;
  identidade?: IdentidadeEmpresaPublica | null;
  usuario?: string | null;
  permissoes?: PermissoesEfetivas | null;
  recursosLiberados?: Record<string, boolean> | null;
  assinaturaOperacional?: boolean;
  carenciaAte?: string | null;
  assinaturaSuspensa?: boolean;
}) {
  const pathname = usePathname();
  const [recolhida, setRecolhida] = useState(false);
  const [mobileAberto, setMobileAberto] = useState(false);

  const semChrome =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/cadastro") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/confirmar-email") ||
    pathname.startsWith("/recuperar-senha") ||
    pathname.startsWith("/nova-senha") ||
    pathname.startsWith("/admin-plataforma") ||
    pathname.startsWith("/master") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/pdv") ||
    pathname.startsWith("/catalogo");

  const largura = recolhida
    ? "w-[var(--sidebar-collapsed)]"
    : "w-[var(--sidebar-expanded)]";
  const padding = recolhida
    ? "lg:pl-[var(--sidebar-collapsed)]"
    : "lg:pl-[var(--sidebar-expanded)]";

  const conteudo = semChrome ? (
    <>{children}</>
  ) : (
    <div className="min-h-screen bg-[var(--background)]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-zinc-200/80 print:hidden lg:block ${largura}`}
      >
        <AppSidebar
          recolhida={recolhida}
          onToggle={() => setRecolhida((atual) => !atual)}
          perfil={perfil}
          identidade={identidade}
          usuario={usuario}
          assinaturaSuspensa={assinaturaSuspensa}
        />
      </aside>

      {mobileAberto && (
        <div className="fixed inset-0 z-40 print:hidden lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileAberto(false)}
          />
          <aside className="relative h-full w-[var(--sidebar-expanded)] border-r border-zinc-200/80 bg-[var(--sidebar-bg)]">
            <AppSidebar
              recolhida={false}
              onToggle={() => setMobileAberto(false)}
              onNavigate={() => setMobileAberto(false)}
              perfil={perfil}
              identidade={identidade}
              usuario={usuario}
              assinaturaSuspensa={assinaturaSuspensa}
            />
          </aside>
        </div>
      )}

      <div className={`${padding} print:pl-0`}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200/80 bg-[var(--sidebar-bg)] px-3 print:hidden lg:hidden">
          <button
            type="button"
            onClick={() => setMobileAberto(true)}
            className="updv-btn updv-btn-ghost"
          >
            Menu
          </button>
          <span className="ml-1 min-w-0">
            <LogoEmpresa
              src={identidade?.logoUrl}
              nome={identidade?.nome}
            />
          </span>
        </header>
        <div className="min-h-screen">
          {assinaturaOperacional && carenciaAte ? (
            <AvisoCarencia ate={carenciaAte} />
          ) : null}
          {children}
        </div>
      </div>
      <AssistenteFlutuante />
    </div>
  );

  return (
    <PermissoesUiProvider value={permissoes}>
      <EntitlementsUiProvider value={recursosLiberados}>
        {conteudo}
      </EntitlementsUiProvider>
    </PermissoesUiProvider>
  );
}
