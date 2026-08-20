"use client";

import {
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  cadastrarCategoriaRapida,
  cadastrarMarcaRapida,
  cadastrarProduto,
} from "./actions";

type Item = {
  id: string;
  nome: string;
};

type ProdutoCadastroFormProps = {
  categorias: Item[];
  marcas: Item[];
};

export function ProdutoCadastroForm({
  categorias,
  marcas,
}: ProdutoCadastroFormProps) {
  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 className="text-xl font-semibold">
        Novo produto
      </h2>

      <form
        action={cadastrarProduto}
        className="mt-5 grid gap-5 md:grid-cols-3"
      >
        <Campo
          label="Código"
          name="codigo"
          required
        />

        <Campo
          label="Código de barras"
          name="codigo_barras"
        />

        <Campo
          label="Produto"
          name="nome"
          required
        />

        <Campo
          label="Descrição"
          name="descricao"
        />

        <CampoRelacionado
          label="Categoria"
          name="categoria_id"
          itensIniciais={categorias}
          tipo="categoria"
          required
        />

        <CampoRelacionado
          label="Marca"
          name="marca_id"
          itensIniciais={marcas}
          tipo="marca"
          required
        />

        <Campo
          label="Unidade"
          name="unidade_medida"
          defaultValue="UN"
          required
        />

        <Campo
          label="Preço de custo"
          name="preco_custo"
          defaultValue="0,00"
        />

        <Campo
          label="Preço de venda"
          name="preco_venda"
          defaultValue="0,00"
          required
        />

        <div className="md:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-800"
          >
            Cadastrar produto
          </button>
        </div>
      </form>
    </section>
  );
}

function CampoRelacionado({
  label,
  name,
  itensIniciais,
  tipo,
  required = false,
}: {
  label: string;
  name: string;
  itensIniciais: Item[];
  tipo: "categoria" | "marca";
  required?: boolean;
}) {
  const [itens, setItens] =
    useState<Item[]>(itensIniciais);

  const [texto, setTexto] = useState("");
  const [selecionado, setSelecionado] =
    useState<Item | null>(null);

  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [isPending, startTransition] =
    useTransition();

  const normalizar = (valor: string) =>
    valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const filtrados = useMemo(() => {
    const busca = normalizar(texto);

    if (!busca) {
      return itens.slice(0, 8);
    }

    return itens
      .filter((item) =>
        normalizar(item.nome).includes(busca)
      )
      .slice(0, 8);
  }, [itens, texto]);

  const existeExato = itens.some(
    (item) =>
      normalizar(item.nome) === normalizar(texto)
  );

  function selecionar(item: Item) {
    setSelecionado(item);
    setTexto(item.nome);
    setAberto(false);
    setErro("");
  }

  function criarRapido() {
    const nome = texto.trim();

    if (nome.length < 2) {
      setErro(
        `Informe o nome da ${tipo}.`
      );
      return;
    }

    setErro("");

    startTransition(async () => {
      const resultado =
        tipo === "categoria"
          ? await cadastrarCategoriaRapida(nome)
          : await cadastrarMarcaRapida(nome);

      if (!resultado.ok || !resultado.item) {
        setErro(
          resultado.erro ??
            "Não foi possível cadastrar."
        );
        return;
      }

      setItens((atuais) => {
        const jaExiste = atuais.some(
          (item) =>
            item.id === resultado.item!.id
        );

        return jaExiste
          ? atuais
          : [...atuais, resultado.item!].sort(
              (a, b) =>
                a.nome.localeCompare(
                  b.nome,
                  "pt-BR"
                )
            );
      });

      selecionar(resultado.item);
    });
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>

      <input
        type="hidden"
        name={name}
        value={selecionado?.id ?? ""}
        required={required}
      />

      <div className="mt-2 flex gap-2">
        <input
          value={texto}
          onChange={(event) => {
            setTexto(event.target.value);
            setSelecionado(null);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          autoComplete="off"
          placeholder={`Digite para buscar ${tipo}`}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />

        <button
          type="button"
          onClick={criarRapido}
          disabled={
            isPending ||
            !texto.trim() ||
            existeExato
          }
          title={`Adicionar ${tipo}`}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-4 text-xl font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>

      {erro && (
        <p className="mt-1 text-xs text-red-600">
          {erro}
        </p>
      )}

      {aberto && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
          {filtrados.length > 0 ? (
            filtrados.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) =>
                  event.preventDefault()
                }
                onClick={() =>
                  selecionar(item)
                }
                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-zinc-50"
              >
                {item.nome}
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-zinc-500">
              Nenhum registro encontrado.
            </div>
          )}

          {texto.trim() && !existeExato && (
            <button
              type="button"
              onMouseDown={(event) =>
                event.preventDefault()
              }
              onClick={criarRapido}
              disabled={isPending}
              className="block w-full border-t border-zinc-100 px-3 py-3 text-left text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
            >
              {isPending
                ? "Cadastrando..."
                : `+ Adicionar "${texto.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>

      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
      />
    </div>
  );
}
