"use client";

import {
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import { rotuloUnidadeMedida } from "@/lib/produtos/unidades-medida";

import { AppModal } from "@/components/ui/app-modal";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";

import {
  atualizarPublicacaoCatalogo,
  editarProduto,
  inativarProduto,
  reativarProduto,
} from "./actions";
import {
  ProdutoFormCampos,
  type ItemRelacionado,
  type ProdutoFormularioValores,
} from "./produto-cadastro-form";
import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";

export type ProdutoListagem = ProdutoFormularioValores & {
  id: string;
  ativo: boolean;
  quantidade: number;
  categoria_nome: string | null;
  marca_nome: string | null;
  grupo_nome: string | null;
  grupo_ativo: boolean;
  ncm: string | null;
  cest: string | null;
  origem_produto: string | null;
  fiscal_ok: boolean;
  fiscal_rotulo: string;
  fiscal_motivo: string | null;
};

type FiltroStatus = "todos" | "ativos" | "inativos";

type Props = {
  produtos: ProdutoListagem[];
  categorias: ItemRelacionado[];
  marcas: ItemRelacionado[];
  gruposFiscais: GrupoFiscalResumo[];
  podeCriar?: boolean;
};

function normalizar(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dinheiro(valor: number | string | null) {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function quantidadeTexto(valor: number) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function ProdutosWorkspace({
  produtos,
  categorias,
  marcas,
  gruposFiscais,
  podeCriar = false,
}: Props) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] =
    useState<FiltroStatus>("todos");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [produtoEdicao, setProdutoEdicao] =
    useState<ProdutoListagem | null>(null);
  const [produtoInativacao, setProdutoInativacao] =
    useState<ProdutoListagem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const catalogoNoPlano = useRecursoLiberado("catalogo");

  const filtrados = useMemo(() => {
    const termo = normalizar(busca);

    return produtos.filter((produto) => {
      if (filtro === "ativos" && !produto.ativo) {
        return false;
      }

      if (filtro === "inativos" && produto.ativo) {
        return false;
      }

      if (!termo) {
        return true;
      }

      return (
        normalizar(produto.nome).includes(termo) ||
        normalizar(produto.codigo).includes(termo) ||
        normalizar(produto.codigo_barras ?? "").includes(
          termo
        )
      );
    });
  }, [busca, filtro, produtos]);

  function mostrarToast(mensagem: string) {
    setErro(null);
    setToast(mensagem);
    window.setTimeout(() => setToast(null), 4000);
  }

  function salvarEdicao(formData: FormData) {
    startTransition(async () => {
      const resultado = await editarProduto(formData);

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      setProdutoEdicao(null);
      mostrarToast(resultado.mensagem);
      router.refresh();
    });
  }

  function confirmarInativacao() {
    if (!produtoInativacao) {
      return;
    }

    const produtoId = produtoInativacao.id;

    startTransition(async () => {
      const resultado = await inativarProduto(produtoId);

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      setProdutoInativacao(null);
      mostrarToast(resultado.mensagem);
      router.refresh();
    });
  }

  function alternarSelecao(produtoId: string) {
    setSelecionados((atual) =>
      atual.includes(produtoId)
        ? atual.filter((id) => id !== produtoId)
        : [...atual, produtoId]
    );
  }

  function alternarTodosVisiveis() {
    const ids = filtrados.map((produto) => produto.id);
    const todos = ids.every((id) => selecionados.includes(id));
    setSelecionados(todos ? [] : ids);
  }

  function publicarSelecionados(publicado: boolean) {
    if (selecionados.length === 0) {
      setErro("Selecione pelo menos um produto.");
      return;
    }

    startTransition(async () => {
      const resultado = await atualizarPublicacaoCatalogo(
        selecionados,
        publicado
      );

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      setSelecionados([]);
      mostrarToast(resultado.mensagem);
      router.refresh();
    });
  }

  function confirmarReativacao(produtoId: string) {
    startTransition(async () => {
      const resultado = await reativarProduto(produtoId);

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      mostrarToast(resultado.mensagem);
      router.refresh();
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <ListToolbar
        searchPlaceholder="Buscar produto, código ou código de barras"
        searchValue={busca}
        onSearchChange={setBusca}
        filters={
          <select
            value={filtro}
            onChange={(event) =>
              setFiltro(event.target.value as FiltroStatus)
            }
            className="updv-select w-[140px]"
          >
            <option value="todos">Todos</option>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
          </select>
        }
        actions={
          catalogoNoPlano && selecionados.length > 0 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => publicarSelecionados(true)}
                className="updv-btn updv-btn-ghost"
              >
                Publicar no catálogo
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => publicarSelecionados(false)}
                className="updv-btn updv-btn-ghost"
              >
                Remover do catálogo
              </button>
            </div>
          ) : undefined
        }
      />

      {erro && (
        <div className="mx-4 mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </div>
      )}

      <DataTable minWidth={900}>
        <thead>
          <tr>
            <th className="w-8">
              <input
                type="checkbox"
                checked={
                  filtrados.length > 0 &&
                  filtrados.every((produto) =>
                    selecionados.includes(produto.id)
                  )
                }
                onChange={alternarTodosVisiveis}
                aria-label="Selecionar produtos visíveis"
              />
            </th>
            <th>Ações</th>
            <th>Nome</th>
            <th>Código</th>
            <th className="num">Preço</th>
            <th className="num">Estoque</th>
            <th>Fiscal</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((produto) => {
            const iniciais = produto.nome
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((parte: string) => parte[0]?.toUpperCase() ?? "")
              .join("");

            return (
              <tr key={produto.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selecionados.includes(produto.id)}
                    onChange={() => alternarSelecao(produto.id)}
                    aria-label={`Selecionar ${produto.nome}`}
                  />
                </td>
                <td>
                  <RowActions
                    onEdit={() => {
                      setErro(null);
                      setProdutoEdicao(produto);
                    }}
                    items={[
                      {
                        label: "Clonar produto",
                        hidden: !podeCriar,
                        href: `/produtos?novo=1&clonar=${produto.id}`,
                      },
                      {
                        label: "Fiscal",
                        href: `/produtos?fiscal=${produto.id}`,
                      },
                      {
                        label: "Reativar produto",
                        hidden: produto.ativo,
                        onClick: () => confirmarReativacao(produto.id),
                      },
                      {
                        label: "Inativar produto",
                        danger: true,
                        hidden: !produto.ativo,
                        onClick: () => {
                          setErro(null);
                          setProdutoInativacao(produto);
                        },
                      },
                    ]}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-400 text-[10px] font-bold text-white">
                      {iniciais || "?"}
                    </span>
                    <span className="font-medium">{produto.nome}</span>
                    <StatusBadge
                      status={produto.ativo ? "ativo" : "inativo"}
                    />
                    {produto.catalogo_publicado && (
                      <StatusBadge status="ativo">Catálogo</StatusBadge>
                    )}
                  </div>
                </td>
                <td>{produto.codigo}</td>
                <td className="num font-medium">
                  R$ {dinheiro(produto.preco_venda)}
                </td>
                <td className="num">
                  {quantidadeTexto(produto.quantidade)}{" "}
                  {rotuloUnidadeMedida(produto.unidade_medida)}
                </td>
                <td>
                  <StatusBadge
                    status={produto.fiscal_ok ? "ativo" : "pendente"}
                  >
                    {produto.fiscal_rotulo}
                  </StatusBadge>
                </td>
              </tr>
            );
          })}
          {filtrados.length === 0 && (
            <DataTableEmpty colSpan={7}>
              Nenhum produto encontrado.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>

      <AppModal
        open={Boolean(produtoEdicao)}
        title={produtoEdicao ? `Editar produto · ${produtoEdicao.nome}` : ""}
        onClose={() => setProdutoEdicao(null)}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setProdutoEdicao(null)}
              className="updv-btn updv-btn-ghost"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="produto-edicao-form"
              disabled={isPending}
              className="updv-btn updv-btn-primary"
            >
              {isPending ? "Salvando..." : "Salvar alterações"}
            </button>
          </>
        }
      >
        {produtoEdicao && (
          <form
            id="produto-edicao-form"
            action={salvarEdicao}
            className="grid gap-5 md:grid-cols-3"
          >
            <ProdutoFormCampos
              categorias={categorias}
              marcas={marcas}
              gruposFiscais={gruposFiscais}
              produto={produtoEdicao}
            />
          </form>
        )}
      </AppModal>

      <AppModal
        open={Boolean(produtoInativacao)}
        title="Inativar produto"
        onClose={() => setProdutoInativacao(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setProdutoInativacao(null)}
              className="updv-btn updv-btn-ghost"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarInativacao}
              disabled={isPending}
              className="updv-btn bg-red-600 text-white hover:bg-red-700"
            >
              {isPending ? "Inativando..." : "Inativar produto"}
            </button>
          </>
        }
      >
        <p className="text-sm text-zinc-600">
          O produto sai do PDV, das buscas de nova venda e do catálogo
          público. Ele permanece no banco e no histórico.
        </p>
        <p className="mt-2 text-sm font-medium text-zinc-900">
          {produtoInativacao?.nome}
        </p>
        {produtoInativacao && produtoInativacao.quantidade > 0 ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Este produto possui {quantidadeTexto(produtoInativacao.quantidade)}{" "}
            {rotuloUnidadeMedida(produtoInativacao.unidade_medida)} em estoque.
            A inativação não altera o estoque, vendas ou documentos fiscais já
            registrados.
          </p>
        ) : null}
      </AppModal>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </section>
  );
}
