"use client";

import { ImagePlus } from "lucide-react";
import { useRef } from "react";

export function SuporteUploadImagem({
  disabled,
  onArquivo,
}: {
  disabled?: boolean;
  onArquivo: (arquivo: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(event) => {
          const arquivo = event.target.files?.[0];
          event.target.value = "";
          if (arquivo) {
            onArquivo(arquivo);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        className="updv-btn updv-btn-icon updv-btn-ghost"
        aria-label="Enviar imagem"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="h-4 w-4" />
      </button>
    </>
  );
}
