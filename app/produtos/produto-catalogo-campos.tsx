"use client";

import { useRef, useState } from "react";

import { otimizarImagemCatalogo } from "@/lib/catalogo/imagem";
import { urlPublicaCatalogo } from "@/lib/catalogo/storage";

export type ProdutoCatalogoValores = {
  catalogo_publicado?: boolean;
  catalogo_descricao?: string | null;
  catalogo_destaque?: boolean;
  catalogo_mostrar_preco?: boolean;
  catalogo_imagem_path?: string | null;
};

export function ProdutoCatalogoCampos({
  produto,
}: {
  produto?: ProdutoCatalogoValores;
}) {
  const inputArquivo = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(
    urlPublicaCatalogo(produto?.catalogo_imagem_path)
  );
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  async function aoSelecionar(arquivo: File | undefined) {
    if (!arquivo || !inputArquivo.current) {
      return;
    }

    setErro(null);
    setProcessando(true);

    try {
      const otimizado = await otimizarImagemCatalogo(arquivo);
      const dt = new DataTransfer();
      dt.items.add(otimizado);
      inputArquivo.current.files = dt.files;
      setPreview(URL.createObjectURL(otimizado));
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível processar a imagem."
      );
      inputArquivo.current.value = "";
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className="md:col-span-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-semibold text-zinc-950">
        Catálogo Online
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        O produto só aparece no catálogo público se estiver
        ativo e com Exibir no catálogo marcado.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            name="catalogo_publicado"
            value="1"
            defaultChecked={Boolean(produto?.catalogo_publicado)}
            className="h-4 w-4"
          />
          Exibir no catálogo
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            name="catalogo_destaque"
            value="1"
            defaultChecked={Boolean(produto?.catalogo_destaque)}
            className="h-4 w-4"
          />
          Destaque
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            name="catalogo_mostrar_preco"
            value="1"
            defaultChecked={produto?.catalogo_mostrar_preco !== false}
            className="h-4 w-4"
          />
          Mostrar preço
        </label>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-zinc-700">
          Descrição para catálogo
        </label>
        <textarea
          name="catalogo_descricao"
          defaultValue={produto?.catalogo_descricao ?? ""}
          rows={3}
          maxLength={500}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-900"
          placeholder="Texto comercial público (opcional)"
        />
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-zinc-700">
          Imagem principal
        </label>
        <div className="mt-2 flex items-start gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[10px] text-zinc-400">Sem foto</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <input
              ref={inputArquivo}
              type="file"
              name="catalogo_imagem"
              accept="image/jpeg,image/png,image/webp"
              className="block w-full text-sm"
              onChange={(event) => aoSelecionar(event.target.files?.[0])}
            />
            <p className="mt-1 text-xs text-zinc-500">
              JPEG, PNG ou WebP. A imagem é otimizada no navegador.
            </p>
            {produto?.catalogo_imagem_path && (
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  name="catalogo_remover_imagem"
                  value="1"
                />
                Remover imagem atual
              </label>
            )}
            {processando && (
              <p className="mt-1 text-xs text-zinc-500">Otimizando...</p>
            )}
            {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
