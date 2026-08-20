import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { AdminPlataformaChrome } from "@/components/plataforma/admin-chrome";
import {
  ErroAdminPlataforma,
  obterContextoAdminPlataforma,
} from "@/lib/plataforma/contexto";

export const dynamic = "force-dynamic";

export const metadata = {
  title: {
    default: "Administração",
    template: "%s | UltraPDV Administração",
  },
};

export default async function AdminPlataformaLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    await obterContextoAdminPlataforma();
  } catch (error) {
    if (error instanceof ErroAdminPlataforma) {
      if (error.status === 401) {
        redirect(
          "/login?erro=" +
            encodeURIComponent("Entre para acessar a administração.")
        );
      }
      notFound();
    }
    throw error;
  }

  return <AdminPlataformaChrome>{children}</AdminPlataformaChrome>;
}
