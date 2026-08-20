"use client";

import { useEffect, useState } from "react";

import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";

function NomeEmpresa({ nome }: { nome?: string | null }) {
  return (
    <span className="truncate text-[13px] font-semibold text-zinc-950">
      {nome?.trim() || "UltraPDV"}
    </span>
  );
}

export function LogoEmpresa({
  src,
  nome,
  compacto = false,
}: {
  src?: string | null;
  nome?: string | null;
  compacto?: boolean;
}) {
  const url = logoUrlUtilizavel(src);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    setFalhou(false);
  }, [url]);

  if (!url || falhou) {
    if (compacto) {
      return null;
    }

    return <NomeEmpresa nome={nome} />;
  }

  return (
    <span className="flex min-w-0 max-w-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={url}
        src={url}
        alt={nome ? `Logomarca ${nome}` : "Logomarca da empresa"}
        className="h-8 max-h-10 w-auto max-w-full object-contain"
        onError={() => setFalhou(true)}
      />
    </span>
  );
}
