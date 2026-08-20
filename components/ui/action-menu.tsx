"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export type ActionMenuItem = {
  label: string;
  onClick?: () => void;
  href?: string;
  target?: "_blank" | "_self";
  danger?: boolean;
  hidden?: boolean;
};

const LARGURA_MENU = 240;

export function ActionMenu({
  items,
  trigger,
}: {
  items: ActionMenuItem[];
  trigger?: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState({ top: 0, left: 0 });
  const gatilhoRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visiveis = items.filter((item) => !item.hidden);

  function atualizarPosicao() {
    const gatilho = gatilhoRef.current;
    if (!gatilho) {
      return;
    }

    const rect = gatilho.getBoundingClientRect();
    const altura = visiveis.length * 32 + 8;
    const abreParaCima =
      rect.bottom + altura > window.innerHeight - 8 &&
      rect.top > altura + 8;
    const top = abreParaCima
      ? Math.max(8, rect.top - altura)
      : rect.bottom + 4;
    const left = Math.min(
      Math.max(8, rect.right - LARGURA_MENU),
      window.innerWidth - LARGURA_MENU - 8
    );

    setPosicao({ top, left });
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
  }, [aberto, visiveis.length]);

  if (visiveis.length === 0) {
    return null;
  }

  return (
    <div ref={gatilhoRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          atualizarPosicao();
          setAberto((atual) => !atual);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        aria-label="Ações"
        aria-expanded={aberto}
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>

      {aberto &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: posicao.top,
              left: posicao.left,
              width: LARGURA_MENU,
            }}
            className="z-[80] rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
          >
            {visiveis.map((item) =>
              item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.target}
                  rel={item.target === "_blank" ? "noreferrer" : undefined}
                  className={`block px-3 py-1.5 text-[13px] hover:bg-zinc-50 ${
                    item.danger ? "text-red-600" : "text-zinc-700"
                  }`}
                  onClick={() => setAberto(false)}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setAberto(false);
                    item.onClick?.();
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-zinc-50 ${
                    item.danger ? "text-red-600" : "text-zinc-700"
                  }`}
                >
                  {item.label}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
