"use client";

import {
  useMemo,
  useState,
  useTransition,
} from "react";
import { X } from "lucide-react";

import {
  UNIDADE_MEDIDA_PADRAO,
  UNIDADES_MEDIDA,
  rotuloUnidadeMedida,
  unidadePermiteDecimal,
} from "@/lib/produtos/unidades-medida";

import {
  cadastrarCategoriaRapida,
  cadastrarMarcaRapida,
  cadastrarProduto,
} from "./actions";
import { ProdutoBalancaAba } from "./produto-balanca-aba";
import { ProdutoCatalogoCampos } from "./produto-catalogo-campos";
import { ProdutoValidadeAba } from "./produto-validade-aba";
import { produtoElegivelBalanca } from "@/lib/balancas/elegivel";
import { CampoValor } from "@/components/ui/campo-valor";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import {
  ORIGENS_MERCADORIA,
} from "@/lib/fiscal/tabelas-fiscais";
import {
  avaliarStatusFiscalProduto,
  somenteDigitos,
  type GrupoFiscalResumo,
} from "@/lib/fiscal/status-fiscal-produto";

export type ItemRelacionado = {
  id: string;
  nome: string;
};

export type ProdutoFormularioValores = {
  id?: string;
  codigo: string;
  codigo_barras: string | null;
  nome: string;
  descricao: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  grupo_fiscal_id: string | null;
  ncm?: string | null;
  cest?: string | null;
  origem_produto?: string | null;
  unidade_medida: string;
  preco_custo: number | string | null;
  preco_venda: number | string | null;
  ativo?: boolean;
  catalogo_publicado?: boolean;
  catalogo_descricao?: string | null;
  catalogo_destaque?: boolean;
  catalogo_mostrar_preco?: boolean;
  catalogo_imagem_path?: string | null;
  controlar_validade?: boolean;
  plu?: string | null;
  descricao_balanca?: string | null;
  validade_etiqueta_dias?: number | null;
  tara_padrao?: number | string | null;
  departamento_balanca?: string | null;
  mensagem_balanca?: string | null;
};

type ProdutoCadastroFormProps = {
  categorias: ItemRelacionado[];
  marcas: ItemRelacionado[];
  gruposFiscais: GrupoFiscalResumo[];
  podeInformarEstoqueInicial?: boolean;
  produto?: ProdutoFormularioValores;
  clonando?: boolean;
};

type ProdutoFormCamposProps = {
  categorias: ItemRelacionado[];
  marcas: ItemRelacionado[];
  gruposFiscais: GrupoFiscalResumo[];
  produto?: ProdutoFormularioValores;
  mostrarEstoqueInicial?: boolean;
  podeInformarEstoqueInicial?: boolean;
};

function precoTexto(
  valor: number | string | null | undefined
) {
  const numero = Number(valor ?? 0);

  if (!Number.isFinite(numero)) {
    return "0,00";
  }

  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ProdutoCadastroForm({
  categorias,
  marcas,
  gruposFiscais,
  podeInformarEstoqueInicial = false,
  produto,
  clonando = false,
}: ProdutoCadastroFormProps) {
  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 className="text-xl font-semibold">
        {clonando ? "Clonar produto" : "Novo produto"}
      </h2>
      {clonando && (
        <p className="mt-2 text-sm text-zinc-600">
          Os dados do produto original foram copiados. Revise e clique em
          Cadastrar produto para gravar. Código, EAN e estoque não são
          copiados.
        </p>
      )}

      <form
        action={cadastrarProduto}
        className="mt-5 grid gap-5 md:grid-cols-3"
      >
        <ProdutoFormCampos
          categorias={categorias}
          marcas={marcas}
          gruposFiscais={gruposFiscais}
          produto={produto}
          mostrarEstoqueInicial
          podeInformarEstoqueInicial={
            podeInformarEstoqueInicial
          }
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

export function ProdutoFormCampos({
  categorias,
  marcas,
  gruposFiscais,
  produto,
  mostrarEstoqueInicial = false,
  podeInformarEstoqueInicial = false,
}: ProdutoFormCamposProps) {
  const unidadeInicial =
    produto?.unidade_medida || UNIDADE_MEDIDA_PADRAO;
  const [unidade, setUnidade] = useState(unidadeInicial);
  const [aba, setAba] = useState<"cadastro" | "validade" | "balanca">(
    "cadastro"
  );
  const mostraAbaBalanca = produtoElegivelBalanca(unidade);
  const abaExibida =
    aba === "balanca" && !mostraAbaBalanca ? "cadastro" : aba;
  const catalogoNoPlano = useRecursoLiberado("catalogo");

  const unidades = useMemo(() => {
    if (
      UNIDADES_MEDIDA.some(
        (item) => item.value === unidadeInicial
      )
    ) {
      return [...UNIDADES_MEDIDA];
    }

    return [
      {
        value: unidadeInicial,
        label: unidadeInicial,
      },
      ...UNIDADES_MEDIDA,
    ];
  }, [unidadeInicial]);

  const categoriaInicial = categorias.find(
    (item) => item.id === produto?.categoria_id
  );
  const marcaInicial = marcas.find(
    (item) => item.id === produto?.marca_id
  );

  const [grupoId, setGrupoId] = useState(
    produto?.grupo_fiscal_id ?? ""
  );
  const [ncm, setNcm] = useState(
    somenteDigitos(produto?.ncm)
  );
  const [cest, setCest] = useState(
    somenteDigitos(produto?.cest)
  );

  const grupoSelecionado = useMemo(
    () => gruposFiscais.find((grupo) => grupo.id === grupoId) ?? null,
    [gruposFiscais, grupoId]
  );

  const status = avaliarStatusFiscalProduto({
    ncm,
    grupo: grupoSelecionado,
  });

  return (
    <>
      <nav
        aria-label="Cadastro do produto"
        className="md:col-span-3 flex h-10 items-center gap-1 border-b border-zinc-200"
      >
        {(
          [
            { id: "cadastro" as const, label: "Cadastro" },
            { id: "validade" as const, label: "Validade" },
            ...(mostraAbaBalanca
              ? [{ id: "balanca" as const, label: "Balança" }]
              : []),
          ]
        ).map((item) => {
          const ativa = abaExibida === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAba(item.id)}
              className={[
                "relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium",
                ativa
                  ? "text-[var(--primary)]"
                  : "text-zinc-500 hover:text-zinc-800",
              ].join(" ")}
            >
              {item.label}
              {ativa && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[var(--primary)]" />
              )}
            </button>
          );
        })}
      </nav>

      {produto?.id && (
        <input
          type="hidden"
          name="id"
          value={produto.id}
        />
      )}

      <div className={abaExibida === "cadastro" ? "contents" : "hidden"}>

      {produto?.id ? (
        <Campo
          label="Código"
          name="codigo"
          defaultValue={produto.codigo}
          required
        />
      ) : (
        <CampoCodigoNovo />
      )}

      <Campo
        label="Código de barras"
        name="codigo_barras"
        defaultValue={produto?.codigo_barras}
      />

      <Campo
        label="Produto"
        name="nome"
        defaultValue={produto?.nome}
        required
      />

      <Campo
        label="Descrição"
        name="descricao"
        defaultValue={produto?.descricao}
      />

      <CampoRelacionado
        label="Categoria"
        name="categoria_id"
        itensIniciais={categorias}
        tipo="categoria"
        valorInicial={categoriaInicial ?? null}
      />

      <CampoRelacionado
        label="Marca"
        name="marca_id"
        itensIniciais={marcas}
        tipo="marca"
        valorInicial={marcaInicial ?? null}
      />

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Unidade de medida
        </label>

        <select
          name="unidade_medida"
          required
          value={unidade}
          onChange={(event) =>
            setUnidade(event.target.value)
          }
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        >
          {unidades.map((item) => (
            <option
              key={item.value}
              value={item.value}
            >
              {rotuloUnidadeMedida(item.value)}
            </option>
          ))}
        </select>
      </div>

      <Campo
        label="Preço de custo"
        name="preco_custo"
        defaultValue={precoTexto(produto?.preco_custo)}
      />

      <Campo
        label="Preço de venda"
        name="preco_venda"
        defaultValue={precoTexto(produto?.preco_venda)}
        required
      />

      {mostrarEstoqueInicial &&
        podeInformarEstoqueInicial && (
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Estoque inicial
            </label>

            <CampoValor
              name="estoque_inicial"
              type="number"
              min="0"
              step={
                unidadePermiteDecimal(unidade)
                  ? "0.0001"
                  : "1"
              }
              defaultValue="0"
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />

            <p className="mt-1 text-xs text-zinc-500">
              Quantidade disponível no momento do
              cadastro.
            </p>
          </div>
        )}

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 md:col-span-3">
        <input
          type="checkbox"
          name="ativo"
          value="1"
          defaultChecked={produto?.ativo !== false}
          className="size-4 rounded border-zinc-300"
        />
        Produto ativo
      </label>

      {catalogoNoPlano ? <ProdutoCatalogoCampos produto={produto} /> : null}

      <details
        className="md:col-span-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4"
        open={Boolean(produto)}
      >
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">
              Dados fiscais
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              NCM, CEST, origem e grupo fiscal pertencem ao
              produto. CFOP e tributos vêm do grupo na emissão.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              status.ok
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {status.rotulo}
          </span>
        </summary>

        {!status.ok && status.motivos.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {status.motivos.map((motivo) => (
              <li key={motivo}>{motivo}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <CampoSelect
            label="Grupo Fiscal"
            name="grupo_fiscal_id"
            itens={gruposFiscais}
            defaultValue={grupoId}
            onChange={setGrupoId}
            dica="Define as regras tributárias usadas na emissão."
          />

          <CampoDigitos
            label="NCM"
            name="ncm"
            valor={ncm}
            onChange={setNcm}
            maxLength={8}
            placeholder="00000000"
          />

          <CampoDigitos
            label="CEST"
            name="cest"
            valor={cest}
            onChange={setCest}
            maxLength={7}
            dica="Opcional — informe somente quando aplicável ao produto."
          />

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Origem da mercadoria
            </label>
            <select
              name="origem_produto"
              defaultValue={produto?.origem_produto ?? "0"}
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            >
              {ORIGENS_MERCADORIA.map((origem) => (
                <option key={origem.codigo} value={origem.codigo}>
                  {origem.codigo} — {origem.descricao}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>
      </div>

      <div className={abaExibida === "validade" ? "md:col-span-3" : "hidden"}>
        <ProdutoValidadeAba
          produtoId={produto?.id}
          controlarValidade={Boolean(produto?.controlar_validade)}
        />
      </div>

      {mostraAbaBalanca && (
        <div className={abaExibida === "balanca" ? "contents" : "hidden"}>
          <ProdutoBalancaAba produto={produto} />
        </div>
      )}
    </>
  );
}

function CampoRelacionado({
  label,
  name,
  itensIniciais,
  tipo,
  valorInicial = null,
}: {
  label: string;
  name: string;
  itensIniciais: ItemRelacionado[];
  tipo: "categoria" | "marca";
  valorInicial?: ItemRelacionado | null;
}) {
  const [itens, setItens] =
    useState<ItemRelacionado[]>(itensIniciais);

  const [texto, setTexto] = useState(
    valorInicial?.nome ?? ""
  );
  const [selecionado, setSelecionado] =
    useState<ItemRelacionado | null>(valorInicial);
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

  function selecionar(item: ItemRelacionado) {
    setSelecionado(item);
    setTexto(item.nome);
    setAberto(false);
    setErro("");
  }

  function limpar() {
    setSelecionado(null);
    setTexto("");
    setAberto(false);
    setErro("");
  }

  function criarRapido() {
    const nome = texto.trim();

    if (nome.length < 2) {
      setErro(`Informe o nome da ${tipo}.`);
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
          (item) => item.id === resultado.item!.id
        );

        return jaExiste
          ? atuais
          : [...atuais, resultado.item!].sort(
              (a, b) =>
                a.nome.localeCompare(b.nome, "pt-BR")
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
          placeholder={`Digite para buscar ${tipo} (opcional)`}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />

        {selecionado && (
          <button
            type="button"
            onClick={limpar}
            title={`Limpar ${tipo}`}
            aria-label={`Limpar ${tipo}`}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white px-2.5 text-zinc-700 hover:bg-zinc-50"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={criarRapido}
          disabled={
            isPending || !texto.trim() || existeExato
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
                onClick={() => selecionar(item)}
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

function CampoSelect({
  label,
  name,
  itens,
  required = false,
  defaultValue = "",
  dica,
  onChange,
}: {
  label: string;
  name: string;
  itens: GrupoFiscalResumo[];
  required?: boolean;
  defaultValue?: string;
  dica?: string;
  onChange?: (valor: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>

      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
      >
        <option value="">
          — Sem grupo fiscal —
        </option>

        {itens.map((item) => (
          <option
            key={item.id}
            value={item.id}
          >
            {item.ativo ? item.nome : `${item.nome} (inativo)`}
          </option>
        ))}
      </select>

      {dica && (
        <p className="mt-1 text-xs text-zinc-500">
          {dica}
        </p>
      )}

      {!itens.length && (
        <p className="mt-1 text-xs text-amber-700">
          Nenhum grupo fiscal ativo cadastrado.
        </p>
      )}
    </div>
  );
}

function CampoDigitos({
  label,
  name,
  valor,
  onChange,
  maxLength,
  placeholder,
  dica,
}: {
  label: string;
  name: string;
  valor: string;
  onChange: (valor: string) => void;
  maxLength: number;
  placeholder?: string;
  dica?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <input
        name={name}
        value={valor}
        inputMode="numeric"
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(
            somenteDigitos(event.target.value).slice(0, maxLength)
          )
        }
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
      />
      {dica && (
        <p className="mt-1 text-xs text-zinc-500">{dica}</p>
      )}
    </div>
  );
}

function CampoCodigoNovo() {
  const [codigoAutomatico, setCodigoAutomatico] = useState(true);

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        Código do produto
      </label>

      <label className="mt-2 flex items-center gap-2 text-sm text-zinc-800">
        <input
          type="checkbox"
          name="codigo_automatico"
          value="1"
          checked={codigoAutomatico}
          onChange={(event) =>
            setCodigoAutomatico(event.target.checked)
          }
          className="h-4 w-4"
        />
        Código automático
      </label>

      <input
        name="codigo"
        defaultValue=""
        disabled={codigoAutomatico}
        readOnly={codigoAutomatico}
        required={!codigoAutomatico}
        placeholder={
          codigoAutomatico
            ? "Gerado automaticamente ao salvar"
            : "Informe o código"
        }
        className={`mt-2 w-full rounded-lg border px-3 py-2.5 outline-none transition ${
          codigoAutomatico
            ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-500"
            : "border-zinc-300 bg-white focus:border-zinc-900"
        }`}
      />
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

      <CampoValor
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        inputMode="decimal"
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
      />
    </div>
  );
}
