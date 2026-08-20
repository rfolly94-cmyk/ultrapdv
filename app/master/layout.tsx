import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { MasterChrome } from "@/components/master/master-chrome";
import { ErroMaster, exigirMaster } from "@/lib/master/exigir-master";
import { ErroAdminPlataforma } from "@/lib/plataforma/contexto";

export const dynamic = "force-dynamic";

export const metadata = {
  title: {
    default: "Master",
    template: "%s | UltraPDV Master",
  },
};

export default async function MasterLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    await exigirMaster();
  } catch (error) {
    if (error instanceof ErroMaster || error instanceof ErroAdminPlataforma) {
      if (error.status === 401) {
        redirect(
          "/login?erro=" + encodeURIComponent("Entre para acessar o Master.")
        );
      }
      notFound();
    }
    throw error;
  }

  return <MasterChrome>{children}</MasterChrome>;
}
