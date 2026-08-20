import type { FiltrosRelatorio } from "@/lib/relatorios/tipos";

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-[140px]">
      <span className="mb-1 block text-[11px] font-medium text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  name,
  defaultValue,
  opcoes,
}: {
  name: string;
  defaultValue?: string;
  opcoes: Array<{ id: string; nome: string }>;
}) {
  return (
    <select name={name} defaultValue={defaultValue || ""} className="updv-input">
      {opcoes.map((opcao) => (
        <option key={opcao.id} value={opcao.id}>
          {opcao.nome}
        </option>
      ))}
    </select>
  );
}

export function RelatorioFiltros({
  filtros,
  opcoes,
}: {
  filtros: FiltrosRelatorio;
  opcoes: Record<string, Array<{ id: string; nome: string }>>;
}) {
  const personalizado = filtros.periodo === "personalizado";

  return (
    <form
      method="get"
      action="/relatorios"
      className="print-hide space-y-3 border-b border-zinc-200 bg-white px-4 py-3"
    >
      <input type="hidden" name="aba" value={filtros.aba} />
      {filtros.subaba ? <input type="hidden" name="subaba" value={filtros.subaba} /> : null}

      <div className="flex flex-wrap items-end gap-3">
        <Campo label="Período">
          <Select
            name="periodo"
            defaultValue={filtros.periodo}
            opcoes={[
              { id: "hoje", nome: "Hoje" },
              { id: "ontem", nome: "Ontem" },
              { id: "7d", nome: "Últimos 7 dias" },
              { id: "30d", nome: "Últimos 30 dias" },
              { id: "mes", nome: "Este mês" },
              { id: "mes_anterior", nome: "Mês anterior" },
              { id: "personalizado", nome: "Personalizado" },
            ]}
          />
        </Campo>

        {personalizado && (
          <>
            <Campo label="Data inicial">
              <input
                type="date"
                name="de"
                defaultValue={filtros.de ?? ""}
                className="updv-input"
              />
            </Campo>
            <Campo label="Data final">
              <input
                type="date"
                name="ate"
                defaultValue={filtros.ate ?? ""}
                className="updv-input"
              />
            </Campo>
          </>
        )}

        {filtros.aba === "vendas" && (
          <>
            <Campo label="Cliente">
              <Select
                name="cliente"
                defaultValue={filtros.clienteId}
                opcoes={[{ id: "", nome: "Todos" }, ...(opcoes.clientes ?? [])]}
              />
            </Campo>
            <Campo label="Vendedor">
              <Select
                name="vendedor"
                defaultValue={filtros.vendedorId}
                opcoes={[{ id: "", nome: "Todos" }, ...(opcoes.vendedores ?? [])]}
              />
            </Campo>
            <Campo label="Pagamento">
              <Select
                name="forma"
                defaultValue={filtros.formaId}
                opcoes={[{ id: "", nome: "Todos" }, ...(opcoes.formas ?? [])]}
              />
            </Campo>
            <Campo label="Status">
              <Select
                name="status"
                defaultValue={filtros.status}
                opcoes={[
                  { id: "", nome: "Todos" },
                  { id: "finalizada", nome: "Finalizadas" },
                  { id: "cancelada", nome: "Canceladas" },
                ]}
              />
            </Campo>
          </>
        )}

        {(filtros.aba === "produtos" || filtros.aba === "estoque") && (
          <>
            <Campo label="Busca">
              <input
                name="q"
                defaultValue={filtros.q}
                placeholder="Produto"
                className="updv-input"
              />
            </Campo>
            <Campo label="Categoria">
              <Select
                name="categoria"
                defaultValue={filtros.categoriaId}
                opcoes={[{ id: "", nome: "Todas" }, ...(opcoes.categorias ?? [])]}
              />
            </Campo>
            <Campo label="Marca">
              <Select
                name="marca"
                defaultValue={filtros.marcaId}
                opcoes={[{ id: "", nome: "Todas" }, ...(opcoes.marcas ?? [])]}
              />
            </Campo>
          </>
        )}

        {filtros.aba === "produtos" && (
          <Campo label="Ordenação">
            <Select
              name="ordenacao"
              defaultValue={filtros.ordenacao}
              opcoes={[
                { id: "", nome: "Mais vendidos" },
                { id: "faturamento", nome: "Maior faturamento" },
              ]}
            />
          </Campo>
        )}

        {filtros.aba === "estoque" && filtros.subaba !== "movimentacoes" && (
          <Campo label="Situação">
            <Select
              name="situacao"
              defaultValue={filtros.situacao}
              opcoes={[
                { id: "todos", nome: "Todos" },
                { id: "com", nome: "Com estoque" },
                { id: "sem", nome: "Sem estoque" },
                { id: "baixo", nome: "Estoque baixo" },
                { id: "negativo", nome: "Estoque negativo" },
              ]}
            />
          </Campo>
        )}

        {filtros.aba === "estoque" && filtros.subaba === "movimentacoes" && (
          <Campo label="Tipo">
            <Select
              name="status"
              defaultValue={filtros.status}
              opcoes={[
                { id: "", nome: "Todos" },
                { id: "VENDA", nome: "Venda" },
                { id: "CANCELAMENTO_VENDA", nome: "Cancelamento" },
                { id: "ENTRADA", nome: "Entrada" },
                { id: "AJUSTE_POSITIVO", nome: "Ajuste positivo" },
                { id: "AJUSTE_NEGATIVO", nome: "Ajuste negativo" },
                { id: "ESTORNO_EDICAO", nome: "Estorno de edição" },
              ]}
            />
          </Campo>
        )}

        {filtros.aba === "clientes" && (
          <>
            <Campo label="Busca">
              <input
                name="q"
                defaultValue={filtros.q}
                placeholder="Cliente"
                className="updv-input"
              />
            </Campo>
            <Campo label="Situação">
              <Select
                name="status"
                defaultValue={filtros.status}
                opcoes={[
                  { id: "", nome: "Todos" },
                  { id: "ativo", nome: "Ativos" },
                  { id: "bloqueado", nome: "Bloqueados" },
                ]}
              />
            </Campo>
            <Campo label="Sem comprar há">
              <Select
                name="sem_comprar"
                defaultValue={filtros.semComprar}
                opcoes={[
                  { id: "", nome: "—" },
                  { id: "30", nome: "30 dias" },
                  { id: "60", nome: "60 dias" },
                  { id: "90", nome: "90 dias" },
                  { id: "180", nome: "180 dias" },
                ]}
              />
            </Campo>
            <Campo label="Ordenação">
              <Select
                name="ordenacao"
                defaultValue={filtros.ordenacao}
                opcoes={[
                  { id: "", nome: "Maior comprador" },
                  { id: "compras", nome: "Mais compras" },
                  { id: "ultima", nome: "Última compra" },
                ]}
              />
            </Campo>
          </>
        )}

        {filtros.aba === "pagamentos" && (
          <Campo label="Forma">
            <Select
              name="forma"
              defaultValue={filtros.formaId}
              opcoes={[{ id: "", nome: "Todas" }, ...(opcoes.formas ?? [])]}
            />
          </Campo>
        )}

        {filtros.aba === "fiscal" && (
          <>
            <Campo label="Modelo">
              <Select
                name="modelo"
                defaultValue={filtros.modelo}
                opcoes={[
                  { id: "", nome: "Todos" },
                  { id: "55", nome: "55 NF-e" },
                  { id: "65", nome: "65 NFC-e" },
                ]}
              />
            </Campo>
            <Campo label="Status">
              <Select
                name="status"
                defaultValue={filtros.status}
                opcoes={[
                  { id: "", nome: "Todos" },
                  { id: "autorizada", nome: "Autorizada" },
                  { id: "rejeitada", nome: "Rejeitada" },
                  { id: "cancelada", nome: "Cancelada" },
                  { id: "aguardando_reconciliacao", nome: "Aguardando reconciliação" },
                  { id: "erro_comunicacao", nome: "Erro de comunicação" },
                  { id: "enviando", nome: "Em processamento" },
                ]}
              />
            </Campo>
          </>
        )}

        <Campo label="Por página">
          <Select
            name="por_pagina"
            defaultValue={String(filtros.porPagina)}
            opcoes={[
              { id: "25", nome: "25" },
              { id: "50", nome: "50" },
              { id: "100", nome: "100" },
            ]}
          />
        </Campo>

        <div className="flex gap-2 pb-0.5">
          <button type="submit" className="updv-btn updv-btn-primary">
            Aplicar filtros
          </button>
          <a
            href={`/relatorios?aba=${filtros.aba}`}
            className="updv-btn updv-btn-ghost"
          >
            Limpar
          </a>
        </div>
      </div>
    </form>
  );
}
