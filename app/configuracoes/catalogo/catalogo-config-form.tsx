"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { otimizarImagemCatalogo } from "@/lib/catalogo/imagem";
import { normalizarSlug } from "@/lib/catalogo/regras";
import { urlPublicaCatalogo } from "@/lib/catalogo/storage";
import type { CatalogoConfigFormulario } from "@/lib/catalogo/tipos";

import { salvarCatalogoConfig } from "./actions";

function CampoImagem({
  label,
  name,
  atual,
  removerName,
}: {
  label: string;
  name: string;
  atual: string | null;
  removerName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(
    urlPublicaCatalogo(atual)
  );
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <div className="mt-2 flex items-start gap-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-zinc-400">Sem imagem</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="file"
            name={name}
            accept="image/jpeg,image/png,image/webp"
            className="block w-full text-sm"
            onChange={async (event) => {
              const arquivo = event.target.files?.[0];
              if (!arquivo || !inputRef.current) {
                return;
              }

              try {
                const otimizado = await otimizarImagemCatalogo(arquivo);
                const dt = new DataTransfer();
                dt.items.add(otimizado);
                inputRef.current.files = dt.files;
                setPreview(URL.createObjectURL(otimizado));
                setErro(null);
              } catch (error) {
                setErro(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível processar a imagem."
                );
              }
            }}
          />
          {atual && (
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
              <input type="checkbox" name={removerName} value="1" />
              Remover
            </label>
          )}
          {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
        </div>
      </div>
    </div>
  );
}

export function CatalogoConfigForm({
  inicial,
  origem,
}: {
  inicial: CatalogoConfigFormulario;
  origem: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(inicial.slug);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const link = useMemo(() => {
    const normalizado = normalizarSlug(slug);
    return normalizado ? `/catalogo/${normalizado}` : "";
  }, [slug]);

  function salvar(formData: FormData) {
    startTransition(async () => {
      const resultado = await salvarCatalogoConfig(formData);

      if (!resultado.ok) {
        setOk(null);
        setErro(resultado.erro);
        return;
      }

      setErro(null);
      setOk(resultado.mensagem);
      router.refresh();
    });
  }

  return (
    <form action={salvar} className="space-y-6">
      {erro && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </div>
      )}
      {ok && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Geral</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="ativo"
              value="1"
              defaultChecked={inicial.ativo}
            />
            Catálogo ativo
          </label>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Nome exibido
            </label>
            <input
              name="nome_exibido"
              required
              defaultValue={inicial.nome_exibido}
              className="updv-input mt-2 w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Slug
            </label>
            <input
              name="slug"
              required
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="updv-input mt-2 w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-zinc-700">
              Descrição da loja
            </label>
            <textarea
              name="descricao"
              defaultValue={inicial.descricao}
              rows={3}
              className="updv-input mt-2 w-full"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Identidade</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <CampoImagem
            label="Logo"
            name="logo"
            atual={inicial.logo_path}
            removerName="remover_logo"
          />
          <CampoImagem
            label="Banner / capa"
            name="banner"
            atual={inicial.banner_path}
            removerName="remover_banner"
          />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">WhatsApp</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Número do WhatsApp
            </label>
            <input
              name="whatsapp_numero"
              defaultValue={inicial.whatsapp_numero}
              placeholder="5566999999999"
              className="updv-input mt-2 w-full"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Salvo somente com dígitos, sem máscara.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="permitir_whatsapp"
              value="1"
              defaultChecked={inicial.permitir_whatsapp}
            />
            Ativar finalização por WhatsApp
          </label>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-zinc-700">
              Mensagem inicial (opcional)
            </label>
            <input
              name="whatsapp_mensagem"
              defaultValue={inicial.whatsapp_mensagem}
              className="updv-input mt-2 w-full"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Pedidos</h2>
        <div className="mt-4 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="permitir_pedido"
              value="1"
              defaultChecked={inicial.permitir_pedido}
            />
            Permitir Enviar Pedido
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Estoque</h2>
        <div className="mt-4">
          <label className="block text-sm font-medium text-zinc-700">
            Produto sem estoque
          </label>
          <select
            name="produto_sem_estoque"
            defaultValue={inicial.produto_sem_estoque}
            className="updv-select mt-2 w-full max-w-sm"
          >
            <option value="mostrar_esgotado">Mostrar como esgotado</option>
            <option value="ocultar">Ocultar produto</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            A quantidade real não é exibida no catálogo.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Entrega</h2>
        <div className="mt-4 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="permitir_retirada"
              value="1"
              defaultChecked={inicial.permitir_retirada}
            />
            Permitir retirada
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="permitir_entrega"
              value="1"
              defaultChecked={inicial.permitir_entrega}
            />
            Permitir entrega
          </label>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Informação de entrega
            </label>
            <input
              name="info_entrega"
              defaultValue={inicial.info_entrega}
              placeholder="Consulte taxa de entrega pelo WhatsApp."
              className="updv-input mt-2 w-full"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Seu catálogo</h2>
        {link ? (
          <p className="mt-2 font-mono text-sm text-zinc-700">{link}</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">Defina um slug.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={async () => {
              if (!link) {
                return;
              }

              await navigator.clipboard.writeText(`${origem}${link}`);
              setOk("Link copiado.");
            }}
          >
            Copiar link
          </button>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="updv-btn updv-btn-ghost"
            >
              Abrir catálogo
            </a>
          )}
        </div>
      </section>

      <button
        type="submit"
        disabled={isPending}
        className="updv-btn updv-btn-primary"
      >
        {isPending ? "Salvando..." : "Salvar catálogo"}
      </button>
    </form>
  );
}
