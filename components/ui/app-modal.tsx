"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

const larguras = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function AppModal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "sm",
  overlayClassName = "z-40",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof larguras;
  overlayClassName?: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/40 p-4 ${overlayClassName}`}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-xl ${larguras[size]}`}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
          <h2 className="truncate text-[15px] font-semibold text-zinc-950">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="updv-btn updv-btn-icon updv-btn-ghost"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
