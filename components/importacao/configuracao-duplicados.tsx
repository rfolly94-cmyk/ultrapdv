"use client";

import type {
  IdentificadorCliente,
  IdentificadorProduto,
  ModoAusente,
  ModoExistente,
  ModoQuantidadeInvalida,
} from "@/lib/importacao/tipos";

export function ConfiguracaoDuplicadosProdutos({
  identificadores,
  identificador,
  existente,
  categoriaAusente,
  marcaAusente,
  gerarCodigo,
  mostrarCodigoAuto,
  mostrarCategoria,
  mostrarMarca,
  mostrarEstoque,
  quantidadeInvalida,
  onIdentificador,
  onExistente,
  onCategoria,
  onMarca,
  onGerarCodigo,
  onQuantidadeInvalida,
}: {
  identificadores: IdentificadorProduto[];
  identificador: IdentificadorProduto;
  existente: ModoExistente;
  categoriaAusente: ModoAusente;
  marcaAusente: ModoAusente;
  gerarCodigo: boolean;
  mostrarCodigoAuto: boolean;
  mostrarCategoria: boolean;
  mostrarMarca: boolean;
  mostrarEstoque: boolean;
  quantidadeInvalida: ModoQuantidadeInvalida;
  onIdentificador: (valor: IdentificadorProduto) => void;
  onExistente: (valor: ModoExistente) => void;
  onCategoria: (valor: ModoAusente) => void;
  onMarca: (valor: ModoAusente) => void;
  onGerarCodigo: (valor: boolean) => void;
  onQuantidadeInvalida: (valor: ModoQuantidadeInvalida) => void;
}) {
  return (
    <div className="space-y-4 text-[13px]">
      {identificadores.length > 0 ? (
        <fieldset className="rounded-xl border border-zinc-200 bg-white p-4">
          <legend className="px-1 font-semibold">Como identificar produtos já cadastrados?</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {identificadores.map((item) => (
              <label key={item} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={identificador === item}
                  onChange={() => onIdentificador(item)}
                />
                {item === "ean" ? "EAN" : "Código"}
              </label>
            ))}
          </div>
          <p className="mt-3 font-medium">Quando encontrar produto existente</p>
          <select
            className="updv-input mt-1 max-w-md"
            value={existente}
            onChange={(event) => onExistente(event.target.value as ModoExistente)}
          >
            <option value="atualizar">Atualizar produto existente</option>
            <option value="ignorar">Ignorar</option>
            <option value="erro">Considerar como erro</option>
          </select>
        </fieldset>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          Sem Código ou EAN mapeados, a importação só cria produtos novos.
        </p>
      )}

      {mostrarCodigoAuto ? (
        <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <input
            type="checkbox"
            checked={gerarCodigo}
            onChange={(event) => onGerarCodigo(event.target.checked)}
          />
          Gerar código automaticamente quando necessário
        </label>
      ) : null}

      {mostrarCategoria ? (
      <fieldset className="rounded-xl border border-zinc-200 bg-white p-4">
        <legend className="px-1 font-semibold">Quando a categoria não existir</legend>
        <select
          className="updv-input mt-1 max-w-md"
          value={categoriaAusente}
          onChange={(event) => onCategoria(event.target.value as ModoAusente)}
        >
          <option value="criar">Criar automaticamente</option>
          <option value="sem">Deixar produto sem categoria</option>
          <option value="erro">Não importar a linha</option>
        </select>
      </fieldset>
      ) : null}

      {mostrarMarca ? (
      <fieldset className="rounded-xl border border-zinc-200 bg-white p-4">
        <legend className="px-1 font-semibold">Quando a marca não existir</legend>
        <select
          className="updv-input mt-1 max-w-md"
          value={marcaAusente}
          onChange={(event) => onMarca(event.target.value as ModoAusente)}
        >
          <option value="criar">Criar automaticamente</option>
          <option value="sem">Deixar produto sem marca</option>
          <option value="erro">Não importar a linha</option>
        </select>
      </fieldset>
      ) : null}

      {mostrarEstoque ? (
        <fieldset className="rounded-xl border border-zinc-200 bg-white p-4">
          <legend className="px-1 font-semibold">Estoque atual</legend>
          <p className="mt-1 text-[12px] text-zinc-500">
            O valor da planilha é o saldo final. A importação gera movimentação
            rastreável (AJUSTE / IMPORTACAO), sem gravar direto no saldo.
          </p>
          <label className="mt-3 block">
            Valor inválido de quantidade
            <select
              className="updv-input mt-1 max-w-md"
              value={quantidadeInvalida}
              onChange={(event) =>
                onQuantidadeInvalida(event.target.value as ModoQuantidadeInvalida)
              }
            >
              <option value="erro">Marcar linha como erro</option>
              <option value="zero">Considerar como zero</option>
              <option value="ignorar_estoque">
                Ignorar somente o estoque dessa linha
              </option>
            </select>
          </label>
        </fieldset>
      ) : null}
    </div>
  );
}

export function ConfiguracaoDuplicadosClientes({
  identificadores,
  identificador,
  existente,
  onIdentificador,
  onExistente,
}: {
  identificadores: IdentificadorCliente[];
  identificador: IdentificadorCliente;
  existente: ModoExistente;
  onIdentificador: (valor: IdentificadorCliente) => void;
  onExistente: (valor: ModoExistente) => void;
}) {
  const rotulo: Record<IdentificadorCliente, string> = {
    cpf_cnpj: "CPF/CNPJ",
    email: "E-mail",
    telefone: "Telefone",
  };

  return (
    <div className="space-y-4 text-[13px]">
      {identificadores.length > 0 ? (
        <fieldset className="rounded-xl border border-zinc-200 bg-white p-4">
          <legend className="px-1 font-semibold">Como identificar clientes já cadastrados?</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {identificadores.map((item) => (
              <label key={item} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={identificador === item}
                  onChange={() => onIdentificador(item)}
                />
                {rotulo[item]}
              </label>
            ))}
          </div>
          <p className="mt-3 font-medium">Quando encontrar cliente existente</p>
          <select
            className="updv-input mt-1 max-w-md"
            value={existente}
            onChange={(event) => onExistente(event.target.value as ModoExistente)}
          >
            <option value="atualizar">Atualizar cliente existente</option>
            <option value="ignorar">Ignorar</option>
            <option value="erro">Considerar como erro</option>
          </select>
        </fieldset>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          Sem CPF/CNPJ, e-mail ou telefone mapeados, a importação só cria clientes novos.
        </p>
      )}
    </div>
  );
}
