"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Funnel } from "lucide-react";

import {
  montarHrefListagemClientes,
  type FiltroListagemClientes,
} from "@/lib/clientes/listagem";

const OPCOES: Array<{
  id: FiltroListagemClientes;
  label: string;
  contador?: "debito" | "credito" | "vencidos";
}> = [
  { id: "todos", label: "Todos os clientes" },
  { id: "debito", label: "Clientes com débito", contador: "debito" },
  { id: "credito", label: "Clientes com crédito", contador: "credito" },
  { id: "zerado", label: "Saldo zerado" },
  { id: "vencidos", label: "Débitos vencidos", contador: "vencidos" },
  { id: "limite_disponivel", label: "Com limite disponível" },
  { id: "limite_comprometido", label: "Limite comprometido" },
  { id: "fiado_bloqueado", label: "Fiado bloqueado" },
];

export function ClientesFiltro({
  filtro,
  busca,
  contadores,
}: {
  filtro: FiltroListagemClientes;
  busca: string;
  contadores: {
    debito: number;
    credito: number;
    vencidos: number;
  };
}) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState({ top: 0, left: 0 });
  const gatilhoRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ativo = filtro !== "todos";

  function atualizarPosicao() {
    const gatilho = gatilhoRef.current;
    if (!gatilho) {
      return;
    }
    const rect = gatilho.getBoundingClientRect();
    setPosicao({
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - 260),
    });
  }

  useEffect(() => {
    if (!aberto) {
      return;
    }

    function fechar(event: MouseEvent) {
      const alvo = event.target as Node;
      if (
        gatilhoRef.current?.contains(alvo) ||
        menuRef.current?.contains(alvo)
      ) {
        return;
      }
      setAberto(false);
    }

    function reposicionar() {
      atualizarPosicao();
    }

    document.addEventListener("mousedown", fechar);
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    return () => {
      document.removeEventListener("mousedown", fechar);
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
    };
  }, [aberto]);

  return (
    <div ref={gatilhoRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          atualizarPosicao();
          setAberto((atual) => !atual);
        }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${
          ativo
            ? "border-blue-600 bg-blue-50 text-blue-600"
            : "border-blue-500 bg-white text-blue-600"
        }`}
        aria-label="Filtrar clientes"
        aria-expanded={aberto}
      >
        <Funnel className="h-4 w-4" />
      </button>

      {aberto &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: posicao.top,
              left: posicao.left,
              width: 248,
            }}
            className="z-[80] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
          >
            {OPCOES.map((opcao) => {
              const selecionado = filtro === opcao.id;
              const quantidade = opcao.contador
                ? contadores[opcao.contador]
                : null;
              return (
                <a
                  key={opcao.id}
                  href={montarHrefListagemClientes({
                    filtro: opcao.id,
                    q: busca,
                  })}
                  className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-zinc-700 hover:bg-zinc-50"
                  onClick={() => setAberto(false)}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {selecionado ? (
                      <Check className="h-3.5 w-3.5 text-blue-600" />
                    ) : null}
                  </span>
                  <span>
                    {opcao.label}
                    {quantidade !== null ? ` (${quantidade})` : ""}
                  </span>
                </a>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
