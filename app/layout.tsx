import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { carenciaValida } from "@/lib/assinatura/empresa-pode-operar";
import { resolverAssinaturaEmpresaAtiva } from "@/lib/assinatura/resolver-assinatura-empresa";
import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import {
  obterPerfilSessao,
  obterRotuloUsuarioSessao,
} from "@/lib/usuarios/perfil-sessao";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "UltraPDV",
    template: "%s | UltraPDV",
  },
  description:
    "Sistema de gestão comercial, PDV e emissão fiscal.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [perfil, identidade, usuario, sessaoPermissoes] = await Promise.all([
    obterPerfilSessao(),
    obterIdentidadeEmpresaSessao(),
    obterRotuloUsuarioSessao(),
    obterPermissoesSessao(),
  ]);

  let assinaturaSessao = null;
  let falhaAssinatura = false;
  try {
    assinaturaSessao = await resolverAssinaturaEmpresaAtiva();
  } catch {
    falhaAssinatura = true;
    assinaturaSessao = null;
  }

  const emCarencia = carenciaValida(
    assinaturaSessao?.assinatura?.status,
    assinaturaSessao?.assinatura?.carencia_ate
  );

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-100">
        <AppShell
          perfil={perfil}
          identidade={identidade}
          usuario={usuario}
          permissoes={sessaoPermissoes?.permissoes ?? null}
          assinaturaOperacional={
            falhaAssinatura ? false : (assinaturaSessao?.operacional ?? true)
          }
          carenciaAte={
            emCarencia ? assinaturaSessao?.assinatura?.carencia_ate ?? null : null
          }
          assinaturaSuspensa={
            falhaAssinatura ||
            (assinaturaSessao ? !assinaturaSessao.operacional : false)
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}