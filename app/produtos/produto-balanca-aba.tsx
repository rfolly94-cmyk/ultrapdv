"use client";

import { CampoValor } from "@/components/ui/campo-valor";
import type { ProdutoFormularioValores } from "./produto-cadastro-form";

export function ProdutoBalancaAba({
  produto,
}: {
  produto?: ProdutoFormularioValores;
}) {
  const descricaoInicial =
    produto?.descricao_balanca ?? produto?.nome ?? "";

  return (
    <div className="md:col-span-3 grid gap-5 md:grid-cols-3">
      <p className="md:col-span-3 text-sm text-zinc-600">
        Produtos em KG ficam elegíveis para balança. O preço enviado é sempre o
        preço de venda. O vínculo com cada balança é feito em Configurações →
        Balanças. A validade da etiqueta não altera lote nem estoque.
      </p>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          PLU / código da balança
        </label>
        <input
          name="plu"
          defaultValue={produto?.plu ?? ""}
          maxLength={8}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Único nesta empresa. Pode repetir em outra empresa. Se ficar vazio, o
          UltraPDV gera o próximo PLU ao vincular o produto a uma balança.
        </p>
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-zinc-700">
          Descrição para balança
        </label>
        <input
          name="descricao_balanca"
          defaultValue={descricaoInicial}
          maxLength={50}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Validade da etiqueta (dias)
        </label>
        <CampoValor
          name="validade_etiqueta_dias"
          defaultValue={
            produto?.validade_etiqueta_dias != null
              ? String(produto.validade_etiqueta_dias)
              : ""
          }
          inputMode="numeric"
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Só para a etiqueta da balança. Não muda validade de lote.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Tara padrão
        </label>
        <CampoValor
          name="tara_padrao"
          defaultValue={
            produto?.tara_padrao != null ? String(produto.tara_padrao) : ""
          }
          inputMode="decimal"
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Departamento / setor
        </label>
        <input
          name="departamento_balanca"
          defaultValue={produto?.departamento_balanca ?? ""}
          maxLength={40}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      </div>

      <div className="md:col-span-3">
        <label className="block text-sm font-medium text-zinc-700">
          Mensagem adicional
        </label>
        <input
          name="mensagem_balanca"
          defaultValue={produto?.mensagem_balanca ?? ""}
          maxLength={80}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      </div>
    </div>
  );
}
