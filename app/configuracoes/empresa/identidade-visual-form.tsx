"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { salvarLogomarcaEmpresa } from "./actions";

type Props = {
  logoUrl: string | null;
  empresaNome: string | null;
};

export function IdentidadeVisualForm({ logoUrl, empresaNome }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [remover, setRemover] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pendente, startTransition] = useTransition();

  useEffect(() => {
    setPreview(logoUrl);
    setRemover(false);
  }, [logoUrl]);

  function definirPreview(proximo: string | null) {
    setPreview((atual) => {
      if (atual && atual.startsWith("blob:")) {
        URL.revokeObjectURL(atual);
      }
      return proximo;
    });
  }

  function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) {
      return;
    }

    if (!["image/png", "image/jpeg", "image/jpg"].includes(arquivo.type)) {
      setSucesso(false);
      setMensagem("Envie somente PNG ou JPEG.");
      return;
    }

    setRemover(false);
    definirPreview(URL.createObjectURL(arquivo));
    setMensagem(null);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const resultado = await salvarLogomarcaEmpresa(form);
          setSucesso(resultado.ok);
          if (resultado.ok) {
            definirPreview(resultado.logoUrl);
            setRemover(false);
            setMensagem(resultado.mensagem);
            if (inputRef.current) {
              inputRef.current.value = "";
            }
            router.refresh();
            return;
          }

          definirPreview(logoUrl);
          setRemover(false);
          if (inputRef.current) {
            inputRef.current.value = "";
          }
          setMensagem(resultado.erro);
        });
      }}
    >
      {mensagem && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm ${
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {mensagem}
        </div>
      )}

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">
          Identidade visual
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          A logomarca de {empresaNome || "esta empresa"} aparece no UltraPDV e
          no DANFE/PDF da NF-e e da NFC-e. Cada empresa tem a sua.
        </p>

        <div className="mt-4 flex items-start gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
            {preview && !remover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Pré-visualização da logomarca"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="px-2 text-center text-[11px] text-zinc-400">
                Sem logo
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <input
              ref={inputRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg"
              className="block w-full text-sm"
              onChange={(event) => escolherArquivo(event.target.files?.[0])}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="updv-btn updv-btn-ghost"
                onClick={() => inputRef.current?.click()}
              >
                {preview ? "Trocar logo" : "Escolher imagem"}
              </button>
              {(preview || logoUrl) && (
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost text-red-700"
                  onClick={() => {
                    setRemover(true);
                    definirPreview(null);
                    if (inputRef.current) {
                      inputRef.current.value = "";
                    }
                  }}
                >
                  Remover logo
                </button>
              )}
            </div>

            {remover && <input type="hidden" name="remover_logo" value="1" />}

            <p className="text-[12px] text-zinc-500">
              Aceita PNG ou JPEG. Prefira fundo transparente ou branco, formato
              horizontal ou quadrado, boa resolução e arquivo leve (até 2 MB).
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={pendente}
          className="updv-btn updv-btn-primary mt-4"
        >
          {pendente ? "Salvando..." : "Salvar identidade"}
        </button>
      </section>
    </form>
  );
}
