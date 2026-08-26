import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "local-network-access=(self), loopback-network=(self)",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/vendas/pedidos-online",
        destination: "/vendas/pedidos",
        permanent: true,
      },
      {
        source: "/categorias",
        destination: "/produtos/categorias",
        permanent: true,
      },
      {
        source: "/cadastro/categorias",
        destination: "/produtos/categorias",
        permanent: true,
      },
      {
        source: "/marcas",
        destination: "/produtos/marcas",
        permanent: true,
      },
      {
        source: "/cadastro/marcas",
        destination: "/produtos/marcas",
        permanent: true,
      },
      {
        source: "/app/estoque",
        destination: "/estoque",
        permanent: true,
      },
      {
        source: "/configuracoes/financeiro",
        destination: "/configuracoes/financeiro/pix",
        permanent: true,
      },
      {
        source: "/contabilidade/xml",
        destination: "/contabilidade/xmls",
        permanent: true,
      },
      {
        source: "/fiscal/nfe/operacoes/:id",
        destination: "/fiscal/nfe/:id/editar",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
