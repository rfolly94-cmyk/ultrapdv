"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ShoppingBag, X } from "lucide-react";

import {
  CARRINHO_VAZIO,
  adicionarAoCarrinho,
  alterarQuantidadeCarrinho,
  carrinhoTemItemSemPreco,
  gravarCarrinho,
  lerCarrinho,
  snapshotCarrinho,
  totalCarrinho,
} from "@/lib/catalogo/carrinho";
import {
  formatarMoeda,
  rotuloDisponibilidade,
  validarWhatsapp,
} from "@/lib/catalogo/regras";
import {
  ERRO_CELULAR_CATALOGO,
  formatarTelefoneBrasileiro,
} from "@/lib/catalogo/telefone";
import { urlPublicaCatalogo } from "@/lib/catalogo/storage";
import type {
  CatalogoCarrinhoItem,
  CatalogoPublicoOk,
} from "@/lib/catalogo/tipos";
import { montarMensagemWhatsapp, urlWhatsapp } from "@/lib/catalogo/whatsapp";

import { criarPedidoCatalogo } from "../actions";

function PlaceholderImagem() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-300">
      <ShoppingBag className="h-8 w-8" strokeWidth={1.25} />
    </div>
  );
}

export function CatalogoPublicoClient({
  catalogo,
}: {
  catalogo: CatalogoPublicoOk;
}) {
  const router = useRouter();
  const { loja, produtos, categorias } = catalogo;
  const [busca, setBusca] = useState("");
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const carrinho = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("ultrapdv-catalogo-carrinho", onChange);
      return () =>
        window.removeEventListener("ultrapdv-catalogo-carrinho", onChange);
    },
    () => snapshotCarrinho(loja.slug),
    () => CARRINHO_VAZIO
  );
  const [aberto, setAberto] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setCarrinho(
    proximo:
      | CatalogoCarrinhoItem[]
      | ((atual: CatalogoCarrinhoItem[]) => CatalogoCarrinhoItem[])
  ) {
    const atual = lerCarrinho(loja.slug);
    const valor = typeof proximo === "function" ? proximo(atual) : proximo;
    gravarCarrinho(loja.slug, valor);
    window.dispatchEvent(new Event("ultrapdv-catalogo-carrinho"));
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return produtos.filter((produto) => {
      if (categoriaId && produto.categoria_id !== categoriaId) {
        return false;
      }

      if (!termo) {
        return true;
      }

      return (
        produto.nome.toLowerCase().includes(termo) ||
        produto.codigo.toLowerCase().includes(termo)
      );
    });
  }, [busca, categoriaId, produtos]);

  const quantidadeItens = carrinho.reduce(
    (soma, item) => soma + item.quantidade,
    0
  );
  const total = totalCarrinho(carrinho);
  const semPreco = carrinhoTemItemSemPreco(carrinho);
  const podePedido = loja.permitir_pedido && !semPreco;
  const podeWhatsapp =
    loja.permitir_whatsapp && Boolean(loja.whatsapp_numero);

  function adicionar(produto: (typeof produtos)[number]) {
    if (produto.disponibilidade === "esgotado") {
      return;
    }

    try {
      setErro(null);
      setCarrinho((atual) =>
        adicionarAoCarrinho(atual, {
          produtoId: produto.id,
          codigo: produto.codigo,
          nome: produto.nome,
          quantidade: 1,
          preco: produto.preco,
          mostrarPreco: produto.mostrar_preco,
          imagem: produto.imagem,
        })
      );
      setAberto(true);
    } catch (error) {
      setErro(
        error instanceof Error ? error.message : "Não foi possível adicionar."
      );
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
            {urlPublicaCatalogo(loja.logo) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urlPublicaCatalogo(loja.logo) ?? ""}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs font-semibold">
                {loja.nome_exibido.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold">
              {loja.nome_exibido}
            </h1>
            {loja.descricao && (
              <p className="truncate text-xs text-zinc-500">{loja.descricao}</p>
            )}
          </div>
          {loja.whatsapp_numero && (
            <a
              href={urlWhatsapp(loja.whatsapp_numero, "Olá!")}
              className="hidden text-sm font-medium text-emerald-700 sm:inline"
            >
              WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="relative rounded-full bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
          >
            Carrinho
            {quantidadeItens > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-xs">
                {quantidadeItens}
              </span>
            )}
          </button>
        </div>
      </header>

      {urlPublicaCatalogo(loja.banner) && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <div className="h-28 overflow-hidden rounded-2xl bg-zinc-200 sm:h-36">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urlPublicaCatalogo(loja.banner) ?? ""}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar produtos..."
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-zinc-400"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategoriaId(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              !categoriaId
                ? "bg-zinc-950 text-white"
                : "bg-white text-zinc-600"
            }`}
          >
            Todos
          </button>
          {categorias.map((categoria) => (
            <button
              key={categoria.id}
              type="button"
              onClick={() => setCategoriaId(categoria.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                categoriaId === categoria.id
                  ? "bg-zinc-950 text-white"
                  : "bg-white text-zinc-600"
              }`}
            >
              {categoria.nome}
            </button>
          ))}
        </div>

        {erro && (
          <p className="mt-3 text-sm text-red-600">{erro}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visiveis.map((produto) => {
            const esgotado = produto.disponibilidade === "esgotado";

            return (
              <article
                key={produto.id}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
              >
                <div className="aspect-square">
                  {urlPublicaCatalogo(produto.imagem) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urlPublicaCatalogo(produto.imagem) ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderImagem />
                  )}
                </div>
                <div className="p-3">
                  {(produto.categoria || produto.marca) && (
                    <p className="truncate text-[11px] text-zinc-500">
                      {[produto.categoria, produto.marca]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <h2 className="mt-0.5 line-clamp-2 text-sm font-medium">
                    {produto.nome}
                  </h2>
                  <p className="mt-1 text-sm font-semibold">
                    {produto.mostrar_preco && produto.preco !== null
                      ? formatarMoeda(produto.preco)
                      : "Consultar preço"}
                  </p>
                  <p
                    className={`mt-1 text-[11px] ${
                      esgotado ? "text-red-600" : "text-zinc-500"
                    }`}
                  >
                    {rotuloDisponibilidade(produto.disponibilidade)}
                  </p>
                  <button
                    type="button"
                    disabled={esgotado}
                    onClick={() => adicionar(produto)}
                    className="mt-2 h-9 w-full rounded-lg bg-zinc-950 text-sm font-medium text-white disabled:bg-zinc-200 disabled:text-zinc-500"
                  >
                    {esgotado ? "Esgotado" : "Adicionar"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {visiveis.length === 0 && (
          <p className="mt-10 text-center text-sm text-zinc-500">
            Nenhum produto encontrado.
          </p>
        )}
      </div>

      {aberto && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setAberto(false);
              setCheckout(false);
            }}
          />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4">
              <h2 className="text-[15px] font-semibold">
                {checkout ? "Finalizar" : "Carrinho"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  setCheckout(false);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!checkout ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {carrinho.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      Seu carrinho está vazio.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {carrinho.map((item) => (
                        <li
                          key={item.produtoId}
                          className="flex gap-3 border-b border-zinc-100 pb-3"
                        >
                          <div className="h-14 w-14 overflow-hidden rounded-lg bg-zinc-100">
                            {urlPublicaCatalogo(item.imagem) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={urlPublicaCatalogo(item.imagem) ?? ""}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <PlaceholderImagem />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {item.nome}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {item.mostrarPreco && item.preco !== null
                                ? formatarMoeda(item.preco)
                                : "Consultar preço"}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                className="h-7 w-7 rounded border"
                                onClick={() =>
                                  setCarrinho((atual) =>
                                    alterarQuantidadeCarrinho(
                                      atual,
                                      item.produtoId,
                                      item.quantidade - 1
                                    )
                                  )
                                }
                              >
                                -
                              </button>
                              <span className="text-sm">{item.quantidade}</span>
                              <button
                                type="button"
                                className="h-7 w-7 rounded border"
                                onClick={() =>
                                  setCarrinho((atual) =>
                                    alterarQuantidadeCarrinho(
                                      atual,
                                      item.produtoId,
                                      item.quantidade + 1
                                    )
                                  )
                                }
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="ml-auto text-xs text-red-600"
                                onClick={() =>
                                  setCarrinho((atual) =>
                                    atual.filter(
                                      (linha) =>
                                        linha.produtoId !== item.produtoId
                                    )
                                  )
                                }
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="border-t border-zinc-200 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>Total</span>
                    <strong>
                      {semPreco ? "Consultar" : formatarMoeda(total)}
                    </strong>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={carrinho.length === 0}
                      onClick={() => setCarrinho([])}
                      className="h-10 flex-1 rounded-lg border text-sm"
                    >
                      Limpar
                    </button>
                    <button
                      type="button"
                      disabled={carrinho.length === 0}
                      onClick={() => setCheckout(true)}
                      className="h-10 flex-1 rounded-lg bg-zinc-950 text-sm font-medium text-white"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <CheckoutCatalogo
                loja={loja}
                carrinho={carrinho}
                podePedido={podePedido}
                podeWhatsapp={podeWhatsapp}
                semPreco={semPreco}
                isPending={isPending}
                erro={erro}
                onVoltar={() => setCheckout(false)}
                onErro={setErro}
                onEnviar={(dados) => {
                  startTransition(async () => {
                    const resultado = await criarPedidoCatalogo({
                      slug: loja.slug,
                      ...dados,
                      itens: carrinho.map((item) => ({
                        produtoId: item.produtoId,
                        quantidade: item.quantidade,
                        preco: 1,
                      })),
                    });

                    if (!resultado.ok) {
                      setErro(resultado.erro);
                      return;
                    }

                    sessionStorage.setItem(
                      `ultrapdv.catalogo.pedido.${loja.slug}.${resultado.codigo}`,
                      JSON.stringify({
                        total: resultado.total,
                        nome: dados.clienteNome,
                        tipoEntrega: dados.tipoEntrega,
                        itens: carrinho.map((item) => ({
                          nome: item.nome,
                          quantidade: item.quantidade,
                          subtotal:
                            item.mostrarPreco && item.preco !== null
                              ? item.preco * item.quantidade
                              : null,
                        })),
                      })
                    );
                    setCarrinho([]);
                    router.push(
                      `/catalogo/${loja.slug}/pedido/${resultado.codigo}`
                    );
                  });
                }}
                onWhatsapp={(dados) => {
                  if (!loja.whatsapp_numero) {
                    setErro("WhatsApp da loja não configurado.");
                    return;
                  }

                  const mensagem = montarMensagemWhatsapp({
                    mensagemInicial: loja.whatsapp_mensagem,
                    itens: carrinho.map((item) => ({
                      nome: item.nome,
                      quantidade: item.quantidade,
                      precoUnitario: item.preco,
                      mostrarPreco: item.mostrarPreco,
                    })),
                    nome: dados.clienteNome,
                    tipoEntrega: dados.tipoEntrega,
                    observacao: dados.observacao,
                  });

                  const url = urlWhatsapp(loja.whatsapp_numero, mensagem);

                  if (!url) {
                    setErro("WhatsApp da loja não configurado.");
                    return;
                  }

                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function CheckoutCatalogo({
  loja,
  carrinho,
  podePedido,
  podeWhatsapp,
  semPreco,
  isPending,
  erro,
  onVoltar,
  onErro,
  onEnviar,
  onWhatsapp,
}: {
  loja: CatalogoPublicoOk["loja"];
  carrinho: CatalogoCarrinhoItem[];
  podePedido: boolean;
  podeWhatsapp: boolean;
  semPreco: boolean;
  isPending: boolean;
  erro: string | null;
  onVoltar: () => void;
  onErro: (erro: string | null) => void;
  onEnviar: (dados: {
    clienteNome: string;
    clienteWhatsapp: string;
    tipoEntrega: "retirada" | "entrega";
    cep?: string;
    rua?: string;
    numero?: string;
    bairro?: string;
    complemento?: string;
    cidade?: string;
    referencia?: string;
    observacao?: string;
  }) => void;
  onWhatsapp: (dados: {
    clienteNome: string;
    tipoEntrega: "retirada" | "entrega";
    observacao?: string;
  }) => void;
}) {
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [tipo, setTipo] = useState<"retirada" | "entrega">(
    loja.permitir_retirada ? "retirada" : "entrega"
  );
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [complemento, setComplemento] = useState("");
  const [cidade, setCidade] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");

  function validarBase() {
    if (nome.trim().length < 2) {
      onErro("Informe o nome.");
      return false;
    }

    if (!validarWhatsapp(whatsapp).ok) {
      onErro(ERRO_CELULAR_CATALOGO);
      return false;
    }

    onErro(null);
    return true;
  }

  const dados = {
    clienteNome: nome.trim(),
    clienteWhatsapp: whatsapp,
    tipoEntrega: tipo,
    cep,
    rua,
    numero,
    bairro,
    complemento,
    cidade,
    referencia,
    observacao,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <button
          type="button"
          onClick={onVoltar}
          className="text-sm text-zinc-500"
        >
          Voltar ao carrinho
        </button>

        <div className="mt-4 grid gap-3">
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Nome"
            className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
          />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={whatsapp}
            onChange={(event) =>
              setWhatsapp(formatarTelefoneBrasileiro(event.target.value))
            }
            placeholder="(99) 99999-9999"
            className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
          />

          <div className="flex gap-2">
            {loja.permitir_retirada && (
              <button
                type="button"
                onClick={() => setTipo("retirada")}
                className={`h-10 flex-1 rounded-lg text-sm ${
                  tipo === "retirada"
                    ? "bg-zinc-950 text-white"
                    : "border border-zinc-200"
                }`}
              >
                Retirada
              </button>
            )}
            {loja.permitir_entrega && (
              <button
                type="button"
                onClick={() => setTipo("entrega")}
                className={`h-10 flex-1 rounded-lg text-sm ${
                  tipo === "entrega"
                    ? "bg-zinc-950 text-white"
                    : "border border-zinc-200"
                }`}
              >
                Entrega
              </button>
            )}
          </div>

          {tipo === "entrega" && (
            <div className="grid gap-2">
              {loja.info_entrega && (
                <p className="text-xs text-zinc-500">{loja.info_entrega}</p>
              )}
              <input
                value={cep}
                onChange={(event) => setCep(event.target.value)}
                placeholder="CEP (opcional)"
                className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
              />
              <input
                value={rua}
                onChange={(event) => setRua(event.target.value)}
                placeholder="Rua"
                className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={numero}
                  onChange={(event) => setNumero(event.target.value)}
                  placeholder="Número"
                  className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
                />
                <input
                  value={bairro}
                  onChange={(event) => setBairro(event.target.value)}
                  placeholder="Bairro"
                  className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
                />
              </div>
              <input
                value={complemento}
                onChange={(event) => setComplemento(event.target.value)}
                placeholder="Complemento"
                className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
              />
              <input
                value={cidade}
                onChange={(event) => setCidade(event.target.value)}
                placeholder="Cidade"
                className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
              />
              <input
                value={referencia}
                onChange={(event) => setReferencia(event.target.value)}
                placeholder="Referência"
                className="h-11 rounded-lg border border-zinc-200 px-3 text-sm"
              />
            </div>
          )}

          <textarea
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
            placeholder="Observações do pedido"
            maxLength={500}
            rows={3}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
        </div>

        {semPreco && (
          <p className="mt-3 text-xs text-amber-700">
            Há itens para consultar preço. Use o WhatsApp para finalizar.
          </p>
        )}
        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      </div>

      <div className="grid gap-2 border-t border-zinc-200 p-4">
        {podePedido && (
          <button
            type="button"
            disabled={isPending || carrinho.length === 0}
            onClick={() => {
              const celular = validarWhatsapp(whatsapp);
              if (validarBase() && celular.ok) {
                onEnviar({
                  ...dados,
                  clienteWhatsapp: celular.numero,
                });
              }
            }}
            className="h-11 rounded-lg bg-zinc-950 text-sm font-medium text-white"
          >
            {isPending ? "Enviando..." : "Enviar pedido"}
          </button>
        )}
        {podeWhatsapp && (
          <button
            type="button"
            disabled={carrinho.length === 0}
            onClick={() => {
              if (validarBase()) {
                onWhatsapp({
                  clienteNome: nome.trim(),
                  tipoEntrega: tipo,
                  observacao,
                });
              }
            }}
            className="h-11 rounded-lg bg-emerald-600 text-sm font-medium text-white"
          >
            Finalizar pelo WhatsApp
          </button>
        )}
      </div>
    </div>
  );
}
