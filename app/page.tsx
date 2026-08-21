import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: {
    absolute: "UltraPDV | Sistema de Gestão, PDV e Estoque",
  },
  description:
    "Gerencie vendas, estoque, clientes, carteira e emissão fiscal com o UltraPDV.",
};

export default function PaginaInicial() {
  return <LandingPage />;
}
