"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { contarFilaSuporteMaster } from "@/app/master/suporte/actions";
import { createClient } from "@/lib/supabase/client";

export function MasterNavSuporte({
  href,
  ativo,
  inicial = 0,
}: {
  href: string;
  ativo: boolean;
  inicial?: number;
}) {
  const [total, setTotal] = useState(inicial);

  useEffect(() => {
    let ativoLocal = true;
    async function carregar() {
      const resultado = await contarFilaSuporteMaster();
      if (ativoLocal && resultado.ok) {
        setTotal(resultado.total);
      }
    }
    void carregar();
    const supabase = createClient();
    const canal = supabase
      .channel("master-suporte-fila")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suporte_conversas" },
        () => {
          void carregar();
        }
      )
      .subscribe();
    const timer = window.setInterval(() => void carregar(), 15000);
    return () => {
      ativoLocal = false;
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, []);

  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        ativo ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
      }`}
    >
      Suporte
      {total > 0 ? (
        <span className={`ml-2 text-xs ${ativo ? "text-zinc-300" : "text-zinc-500"}`}>
          • {total}
        </span>
      ) : null}
    </Link>
  );
}
