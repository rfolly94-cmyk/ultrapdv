"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Ban, PackageMinus, PackagePlus } from "lucide-react";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { CampoValor } from "@/components/ui/campo-valor";
import { EstoqueModuleTabs } from "@/components/estoque/estoque-module-tabs";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";

import {
  atualizarLimitesEstoque,
  listarMovimentacoesEstoque,
  movimentarEstoque,
  type MovimentacaoEstoque,
} from "@/app/estoque/actions";

type ProdutoEstoque = {
  id: string;
  codigo: string;
  codigo_barras: string | null;
  nome: string;
  unidade_medida: string;
  ativo: boolean;
  quantidade: number | string;
  estoque_minimo: number | string;
  estoque_maximo: number | string | null;
};

type Operacao = "ENTRADA" | "SAIDA" | "AJUSTE";

type Props = {
  empresaNome: string;
  perfil?: string;
  produtos: ProdutoEstoque[];
};

function numero(
  valor: number | string | null | undefined
) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function quantidadeTexto(
  valor: number | string | null | undefined
) {
  return numero(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function dataHora(valor: string) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return valor;
  }

  return data.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function rotuloTipo(tipo: string) {
  const mapa: Record<string, string> = {
    ENTRADA: "Entrada",
    SAIDA: "Saída",
    AJUSTE_POSITIVO: "Ajuste (+)",
    AJUSTE_NEGATIVO: "Ajuste (−)",
    VENDA: "Venda",
    ESTORNO_EDICAO: "Estorno de edição",
    CANCELAMENTO_VENDA: "Cancelamento",
  };

  return mapa[tipo] ?? tipo;
}

function extrairNumeroObservacao(observacao: string | null) {
  if (!observacao) {
    return null;
  }

  const match = observacao.match(/#\s*(\d+)/);
  return match?.[1] ?? null;
}

function tituloMovimento(movimento: MovimentacaoEstoque) {
  const numeroVenda = extrairNumeroObservacao(movimento.observacao);

  if (movimento.tipo === "VENDA") {
    return numeroVenda ? `Venda #${numeroVenda}` : "Venda";
  }

  if (movimento.tipo === "CANCELAMENTO_VENDA") {
    return numeroVenda
      ? `Cancelou Venda #${numeroVenda}`
      : "Cancelou Venda";
  }

  if (movimento.tipo === "ESTORNO_EDICAO") {
    return "Estorno de edição";
  }

  if (
    movimento.tipo.startsWith("AJUSTE") ||
    movimento.origem === "AJUSTE_MANUAL" ||
    movimento.tipo === "ENTRADA" ||
    movimento.tipo === "SAIDA"
  ) {
    return "Ajuste de Estoque";
  }

  return rotuloTipo(movimento.tipo);
}

function deltaMovimento(movimento: MovimentacaoEstoque) {
  return (
    numero(movimento.saldo_posterior) - numero(movimento.saldo_anterior)
  );
}

function normalizar(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function EstoqueWorkspace({
  empresaNome,
  produtos,
}: Props) {
  const router = useRouter();
  const podeMovimentar = useTemPermissao("estoque", "movimentar");
  const podeAjustar = useTemPermissao("estoque", "ajustar");
  const importadorNoPlano = useRecursoLiberado("importador");
  const ehAdmin = podeMovimentar || podeAjustar;

  const [busca, setBusca] = useState("");
  const [somenteBaixo, setSomenteBaixo] = useState(false);
  const [produtoPainel, setProdutoPainel] =
    useState<ProdutoEstoque | null>(null);
  const [produtoMovimento, setProdutoMovimento] =
    useState<ProdutoEstoque | null>(null);
  const [produtoLimites, setProdutoLimites] =
    useState<ProdutoEstoque | null>(null);
  const [operacao, setOperacao] = useState<Operacao>("ENTRADA");
  const [quantidade, setQuantidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [minimo, setMinimo] = useState("");
  const [maximo, setMaximo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [historico, setHistorico] = useState<
    MovimentacaoEstoque[]
  >([]);
  const [carregandoHistorico, setCarregandoHistorico] =
    useState(false);
  const [isPending, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = normalizar(busca);

    return produtos.filter((produto) => {
      const qtd = numero(produto.quantidade);
      const min = numero(produto.estoque_minimo);

      if (somenteBaixo && qtd > min) {
        return false;
      }

      if (!termo) {
        return true;
      }

      return (
        normalizar(produto.nome).includes(termo) ||
        normalizar(produto.codigo).includes(termo) ||
        normalizar(produto.codigo_barras ?? "").includes(termo)
      );
    });
  }, [busca, produtos, somenteBaixo]);

  const totalProdutos = produtos.length;
  const zerados = produtos.filter(
    (produto) => numero(produto.quantidade) === 0
  ).length;
  const abaixoMinimo = produtos.filter(
    (produto) =>
      numero(produto.quantidade) <=
      numero(produto.estoque_minimo)
  ).length;

  async function carregarHistorico(produtoId: string) {
    setCarregandoHistorico(true);
    const resultado = await listarMovimentacoesEstoque(
      produtoId
    );
    setCarregandoHistorico(false);

    if (!resultado.ok) {
      setHistorico([]);
      setErro(resultado.erro);
      return;
    }

    setHistorico(resultado.movimentacoes);
  }

  function abrirPainel(produto: ProdutoEstoque) {
    setProdutoPainel(produto);
    setErro(null);
    setHistorico([]);
    void carregarHistorico(produto.id);
  }

  function abrirAjuste(produto: ProdutoEstoque) {
    setProdutoMovimento(produto);
    setOperacao("ENTRADA");
    setQuantidade("");
    setObservacao("");
    setErro(null);
  }

  function abrirLimites(produto: ProdutoEstoque) {
    setProdutoLimites(produto);
    setMinimo(
      String(produto.estoque_minimo ?? 0).replace(".", ",")
    );
    setMaximo(
      produto.estoque_maximo === null
        ? ""
        : String(produto.estoque_maximo).replace(".", ",")
    );
    setErro(null);
  }

  function mostrarToast(mensagem: string) {
    setToast(mensagem);
    window.setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    function teclado(event: KeyboardEvent) {
      if (event.key === "F2" && produtoPainel && !produtoMovimento) {
        event.preventDefault();
        if (ehAdmin) {
          abrirAjuste(produtoPainel);
        }
      }

      if (event.key === "Escape") {
        if (produtoMovimento && !isPending) {
          setProdutoMovimento(null);
          return;
        }

        if (produtoPainel && !isPending) {
          setProdutoPainel(null);
        }
      }
    }

    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [ehAdmin, isPending, produtoMovimento, produtoPainel]);

  function salvarMovimento() {
    if (!produtoMovimento || !ehAdmin) {
      return;
    }

    setErro(null);

    startTransition(async () => {
      const resultado = await movimentarEstoque({
        produtoId: produtoMovimento.id,
        operacao,
        quantidade,
        observacao,
      });

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      const novoSaldo = quantidadeTexto(
        resultado.quantidadeAtual
      );

      setProdutoMovimento(null);
      if (produtoPainel) {
        setProdutoPainel({
          ...produtoPainel,
          quantidade: resultado.quantidadeAtual ?? produtoPainel.quantidade,
        });
        void carregarHistorico(produtoPainel.id);
      }
      mostrarToast(
        `Estoque de ${produtoMovimento.nome} atualizado para ${novoSaldo} ${produtoMovimento.unidade_medida}.`
      );
      router.refresh();
    });
  }

  function salvarLimites() {
    if (!produtoLimites || !ehAdmin) {
      return;
    }

    setErro(null);

    startTransition(async () => {
      const resultado = await atualizarLimitesEstoque({
        produtoId: produtoLimites.id,
        estoqueMinimo: minimo,
        estoqueMaximo: maximo,
      });

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      setProdutoLimites(null);
      mostrarToast(
        `Limites de ${produtoLimites.nome} atualizados.`
      );
      router.refresh();
    });
  }

  const saldoAtual = produtoMovimento
    ? numero(produtoMovimento.quantidade)
    : 0;
  const quantidadeInformada = numero(
    quantidade.replace(",", ".")
  );
  const quantidadeValida =
    quantidade.trim() !== "" &&
    Number.isFinite(
      Number(quantidade.replace(",", "."))
    );

  let saldoPrevisto: number | null = null;
  if (produtoMovimento && quantidadeValida) {
    if (operacao === "ENTRADA") {
      saldoPrevisto = saldoAtual + quantidadeInformada;
    } else if (operacao === "SAIDA") {
      saldoPrevisto = saldoAtual - quantidadeInformada;
    } else {
      saldoPrevisto = quantidadeInformada;
    }
  }

  const saidaNegativa =
    operacao === "SAIDA" &&
    saldoPrevisto !== null &&
    saldoPrevisto < 0;
  const quantidadeInvalidaOperacao =
    (operacao === "ENTRADA" || operacao === "SAIDA") &&
    (!quantidadeValida || quantidadeInformada <= 0);
  const ajusteInvalido =
    operacao === "AJUSTE" &&
    (!quantidadeValida || quantidadeInformada < 0);
  const confirmarDesabilitado =
    isPending ||
    saidaNegativa ||
    quantidadeInvalidaOperacao ||
    ajusteInvalido;

  return (
    <main className="updv-page">
      <PageHeader
        title="Estoque"
        count={totalProdutos}
        description={[
          `${abaixoMinimo} abaixo do mínimo`,
          `${zerados} zerados`,
          empresaNome || null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          importadorNoPlano ? (
            <a
              href="/configuracoes/importar-dados?tipo=produtos"
              className="updv-btn updv-btn-ghost"
            >
              Importar produtos
            </a>
          ) : null
        }
      />
      <EstoqueModuleTabs />
      {toast && (
        <div className="mx-4 mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {toast}
        </div>
      )}
      <ListToolbar
        searchPlaceholder="Buscar por produto, código ou código de barras"
        searchValue={busca}
        onSearchChange={setBusca}
        filters={
          <label className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-600">
            <input
              type="checkbox"
              checked={somenteBaixo}
              onChange={(event) => setSomenteBaixo(event.target.checked)}
            />
            Somente baixo
          </label>
        }
      />

        <DataTable minWidth={880}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Código</th>
              <th className="num">Saldo</th>
              <th className="num">Mínimo</th>
              <th className="num">Máximo</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((produto) => {
              const qtd = numero(produto.quantidade);
              const min = numero(produto.estoque_minimo);
              const baixo = qtd <= min;

              return (
                <tr
                  key={produto.id}
                  data-clickable="true"
                  data-selected={produtoPainel?.id === produto.id}
                  onClick={() => abrirPainel(produto)}
                >
                  <td className="font-medium">
                    {produto.nome}
                    {!produto.ativo ? (
                      <span className="ml-2 text-zinc-400">Inativo</span>
                    ) : null}
                  </td>
                  <td>{produto.codigo}</td>
                  <td className="num font-medium">
                    {quantidadeTexto(produto.quantidade)}{" "}
                    {produto.unidade_medida}
                  </td>
                  <td className="num">
                    {quantidadeTexto(produto.estoque_minimo)}
                  </td>
                  <td className="num">
                    {produto.estoque_maximo === null
                      ? "—"
                      : quantidadeTexto(produto.estoque_maximo)}
                  </td>
                  <td>
                    <StatusBadge status={baixo ? "baixo" : "normal"} />
                  </td>
                  <td>
                    <RowActions
                      items={[
                        {
                          label: "Movimentações",
                          onClick: () => abrirPainel(produto),
                        },
                        {
                          label: "Limites",
                          onClick: () => abrirLimites(produto),
                          hidden: !ehAdmin,
                        },
                      ]}
                    />
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

      <DetailDrawer
        title={produtoPainel?.nome ?? ""}
        open={Boolean(produtoPainel)}
        size="md"
        onClose={() => {
          if (!isPending) {
            setProdutoPainel(null);
          }
        }}
        footer={
          ehAdmin && produtoPainel ? (
            <button
              type="button"
              onClick={() => abrirAjuste(produtoPainel)}
              className="h-12 w-full rounded-md bg-blue-600 text-sm font-bold uppercase tracking-wide text-white hover:bg-blue-700"
            >
              Alterar estoque - F2
            </button>
          ) : null
        }
      >
        {produtoPainel && (
          <>
            <div className="grid grid-cols-3 gap-3 border-b border-zinc-200 pb-4 text-center">
              <div>
                <p className="text-2xl font-bold text-zinc-950">
                  {quantidadeTexto(produtoPainel.quantidade)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Estoque Atual
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-950">0</p>
                <p className="mt-1 text-[11px] text-zinc-400">Pedidos</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-950">
                  {quantidadeTexto(produtoPainel.quantidade)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Disponível
                </p>
              </div>
            </div>

            <div className="mt-4">
              {carregandoHistorico ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  Carregando histórico...
                </p>
              ) : historico.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  Nenhuma movimentação registrada para este produto.
                </p>
              ) : (
                <ol className="space-y-0">
                  {historico.map((movimento, index) => {
                    const delta = deltaMovimento(movimento);
                    const Icone =
                      movimento.tipo === "CANCELAMENTO_VENDA"
                        ? Ban
                        : delta < 0
                          ? PackageMinus
                          : PackagePlus;

                    return (
                      <li
                        key={movimento.id}
                        className="relative flex gap-3 py-3"
                      >
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            movimento.tipo === "CANCELAMENTO_VENDA"
                              ? "bg-zinc-100 text-zinc-500"
                              : delta < 0
                                ? "bg-red-50 text-red-600"
                                : "bg-emerald-50 text-emerald-600"
                          }`}
                        >
                          <Icone className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-zinc-950">
                            {tituloMovimento(movimento)}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {dataHora(movimento.created_at)}
                          </p>
                          {movimento.observacao &&
                            !extrairNumeroObservacao(
                              movimento.observacao
                            ) && (
                              <p className="mt-1 truncate text-xs text-zinc-500">
                                {movimento.observacao}
                              </p>
                            )}
                        </div>
                        <div className="relative w-12 shrink-0 text-right">
                          {index < historico.length - 1 && (
                            <span className="absolute right-[7px] top-6 h-[calc(100%+6px)] w-px bg-zinc-200" />
                          )}
                          <span className="relative z-10 inline-block h-2 w-2 rounded-full bg-zinc-300" />
                          <p className="mt-1 text-sm font-bold text-zinc-950">
                            {quantidadeTexto(movimento.saldo_posterior)}
                          </p>
                          <p
                            className={`text-xs font-semibold ${
                              delta < 0
                                ? "text-red-600"
                                : delta > 0
                                  ? "text-emerald-600"
                                  : "text-zinc-400"
                            }`}
                          >
                            {delta > 0 ? "+" : ""}
                            {quantidadeTexto(delta)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </DetailDrawer>

      {produtoMovimento && (
        <Modal
          titulo="Alterar estoque"
          onClose={() => {
            if (!isPending) {
              setProdutoMovimento(null);
            }
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <CampoLeitura
              label="Produto"
              valor={produtoMovimento.nome}
            />
            <CampoLeitura
              label="Código"
              valor={produtoMovimento.codigo}
            />
            <CampoLeitura
              label="Estoque atual"
              valor={`${quantidadeTexto(produtoMovimento.quantidade)} ${produtoMovimento.unidade_medida}`}
            />
          </div>

          {ehAdmin ? (
            <>
              <div className="mt-5">
                <label className="text-sm font-medium text-zinc-700">
                  Operação
                </label>
                <select
                  value={operacao}
                  onChange={(event) =>
                    setOperacao(event.target.value as Operacao)
                  }
                  className={inputClass}
                >
                  <option value="ENTRADA">Entrada</option>
                  <option value="SAIDA">Saída</option>
                  <option value="AJUSTE">Ajuste</option>
                </select>
              </div>

              {operacao === "AJUSTE" && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No <strong>ajuste</strong>, o valor digitado é o{" "}
                  <strong>novo saldo desejado</strong> do produto.
                  Ele substitui o estoque atual; não é uma entrada
                  nem uma saída.
                </div>
              )}

              <div className="mt-4">
                <label className="text-sm font-medium text-zinc-700">
                  {operacao === "AJUSTE"
                    ? "Novo saldo desejado"
                    : operacao === "ENTRADA"
                      ? "Quantidade a entrar"
                      : "Quantidade a sair"}
                </label>
                <CampoValor
                  autoFocus
                  value={quantidade}
                  onChange={(event) =>
                    setQuantidade(event.target.value)
                  }
                  inputMode="decimal"
                  placeholder={
                    operacao === "AJUSTE"
                      ? "Informe o saldo final"
                      : "0"
                  }
                  className={inputClass}
                />
                {saldoPrevisto !== null && (
                  <p className="mt-2 text-sm text-zinc-600">
                    {operacao === "AJUSTE"
                      ? `Saldo atual ${quantidadeTexto(saldoAtual)} ${produtoMovimento.unidade_medida} → novo saldo ${quantidadeTexto(saldoPrevisto)} ${produtoMovimento.unidade_medida}.`
                      : operacao === "ENTRADA"
                        ? `${quantidadeTexto(saldoAtual)} + ${quantidadeTexto(quantidadeInformada)} = ${quantidadeTexto(saldoPrevisto)} ${produtoMovimento.unidade_medida}.`
                        : `${quantidadeTexto(saldoAtual)} − ${quantidadeTexto(quantidadeInformada)} = ${quantidadeTexto(saldoPrevisto)} ${produtoMovimento.unidade_medida}.`}
                  </p>
                )}
                {operacao === "SAIDA" &&
                  saldoPrevisto !== null &&
                  saldoPrevisto < 0 && (
                    <p className="mt-1 text-sm text-red-600">
                      A saída não pode deixar o saldo negativo.
                    </p>
                  )}
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-zinc-700">
                  Observação{" "}
                  <span className="font-normal text-zinc-400">
                    (opcional)
                  </span>
                </label>
                <textarea
                  value={observacao}
                  onChange={(event) =>
                    setObservacao(event.target.value)
                  }
                  rows={3}
                  placeholder="Motivo da movimentação"
                  className={inputClass}
                />
              </div>
            </>
          ) : (
            <p className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              Somente administrador pode lançar entrada, saída ou
              ajuste.
            </p>
          )}

          {erro && <Erro>{erro}</Erro>}

          {ehAdmin && (
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setProdutoMovimento(null)}
                className="rounded-lg border border-zinc-300 px-5 py-3 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmarDesabilitado}
                onClick={salvarMovimento}
                className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
              >
                {isPending ? "Confirmando..." : "Confirmar"}
              </button>
            </div>
          )}
        </Modal>
      )}

      {produtoLimites && ehAdmin && (
        <Modal
          titulo="Limites de estoque"
          onClose={() => {
            if (!isPending) {
              setProdutoLimites(null);
            }
          }}
        >
          <p className="font-medium text-zinc-900">
            {produtoLimites.nome}
          </p>

          <div className="mt-5">
            <label className="text-sm font-medium text-zinc-700">
              Estoque mínimo
            </label>
            <CampoValor
              autoFocus
              value={minimo}
              onChange={(event) => setMinimo(event.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">
              Estoque máximo
            </label>
            <CampoValor
              value={maximo}
              onChange={(event) => setMaximo(event.target.value)}
              inputMode="decimal"
              placeholder="Opcional"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-400">
              Deixe vazio para não definir máximo.
            </p>
          </div>

          {erro && <Erro>{erro}</Erro>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setProdutoLimites(null)}
              className="rounded-lg border border-zinc-300 px-5 py-3 text-sm font-semibold hover:bg-zinc-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={salvarLimites}
              className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            >
              {isPending ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function CampoLeitura({
  label,
  valor,
}: {
  label: string;
  valor: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-900">
        {valor}
      </p>
    </div>
  );
}

function Erro({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {children}
    </div>
  );
}

function Modal({
  titulo,
  children,
  onClose,
  largo = false,
}: {
  titulo: string;
  children: ReactNode;
  onClose: () => void;
  largo?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className={[
          "relative z-10 w-full rounded-2xl bg-white p-6 shadow-2xl",
          largo ? "max-w-4xl" : "max-w-lg",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-zinc-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
          >
            Fechar
          </button>
        </div>
        <div className="mt-5 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100";
