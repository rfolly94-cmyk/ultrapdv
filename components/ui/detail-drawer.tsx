"use client";

import type { ReactNode } from "react";

const larguras = {
  sm: "w-[440px]",
  md: "w-[560px]",
};

export function DetailDrawer({
  title,
  open,
  onClose,
  children,
  footer,
  size = "sm",
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof larguras;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <aside
        className={`relative flex h-full max-w-full flex-col border-l border-zinc-200 bg-white shadow-xl ${larguras[size]}`}
      >
        <div className="relative flex h-12 shrink-0 items-center justify-center border-b border-zinc-200 px-12">
          <button
            type="button"
            onClick={onClose}
            className="absolute left-3 rounded p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="Fechar"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          <h2 className="truncate text-[15px] font-semibold text-zinc-950">
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="border-t border-zinc-200 p-3">{footer}</div>
        )}
      </aside>
    </div>
  );
}
