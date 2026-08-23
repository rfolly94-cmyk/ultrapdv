import { tituloTemSaldo } from "@/lib/carteira/titulos";
import { numeroSeguro } from "@/lib/relatorios/formatacao";

export const FILTROS_LISTAGEM_CLIENTES = [
  "todos",
  "debito",
  "credito",
  "zerado",
  "vencidos",
  "limite_disponivel",
  "limite_comprometido",
  "fiado_bloqueado",
] as const;

export type FiltroListagemClientes =
  (typeof FILTROS_LISTAGEM_CLIENTES)[number];

export type TituloListagemCliente = {
  cliente_id: string;
  empresa_id?: string | null;
  valor_aberto: number | string | null;
  status: string;
  vencimento: string | null;
};

export type CreditoListagemCliente = {
  cliente_id: string;
  empresa_id?: string | null;
  valor_disponivel: number | string | null;
  status: string;
};

export type SituacaoCarteiraCliente = {
  debitoAberto: number;
  creditoAberto: number;
  vencido: number;
  limiteDisponivel: number;
};

export type ClienteListagemBase = {
  id: string;
  limite_credito?: number | string | null;
  bloqueado?: boolean | null;
};

export type ClienteListagem = {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  tipo_pessoa: string;
  cpf_cnpj: string | null;
  inscricao_estadual: string | null;
  contribuinte_icms: boolean | null;
  indicador_ie_destinatario: string | null;
  consumidor_final: boolean | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigo_municipio_ibge: string | null;
  uf: string | null;
  limite_credito: number | string | null;
  saldo_devedor: number | string | null;
  bloqueado: boolean;
  dia_vencimento: number | null;
  observacao: string | null;
  ativo: boolean;
  situacaoCarteira: SituacaoCarteiraCliente;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFiltroListagemClientes(
  valor: string | string[] | null | undefined
): FiltroListagemClientes {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  const filtro = String(texto ?? "").trim();
  if (
    FILTROS_LISTAGEM_CLIENTES.includes(filtro as FiltroListagemClientes)
  ) {
    return filtro as FiltroListagemClientes;
  }
  return "todos";
}

export function sanitizarBuscaCliente(valor: string) {
  return String(valor ?? "")
    .replace(/[%_,()]/g, " ")
    .trim();
}

export function buscaPareceUuidCliente(valor: string) {
  return UUID.test(valor.trim());
}

export function creditoCarteiraAberto(
  status: string,
  valorDisponivel?: number | string | null
) {
  const situacao = String(status ?? "").trim().toUpperCase();
  if (situacao !== "DISPONIVEL" && situacao !== "PARCIAL") {
    return false;
  }
  if (valorDisponivel === undefined || valorDisponivel === null) {
    return true;
  }
  return numeroSeguro(valorDisponivel) > 0;
}

function dataVencimentoIso(valor: string | null | undefined) {
  const texto = String(valor ?? "").trim();
  if (!texto) {
    return null;
  }
  return texto.slice(0, 10);
}

export function tituloCarteiraVencido(input: {
  status: string;
  valorAberto?: number | string | null;
  vencimento: string | null | undefined;
  hojeIso: string;
}) {
  if (!tituloTemSaldo(input.status, numeroSeguro(input.valorAberto))) {
    return false;
  }
  const vencimento = dataVencimentoIso(input.vencimento);
  return Boolean(vencimento && vencimento < input.hojeIso);
}

export function agregarCarteiraPorCliente(input: {
  titulos: TituloListagemCliente[];
  creditos: CreditoListagemCliente[];
  hojeIso: string;
}): Map<string, Pick<SituacaoCarteiraCliente, "debitoAberto" | "creditoAberto" | "vencido">> {
  const mapa = new Map<
    string,
    Pick<SituacaoCarteiraCliente, "debitoAberto" | "creditoAberto" | "vencido">
  >();

  function linha(clienteId: string) {
    const atual = mapa.get(clienteId) ?? {
      debitoAberto: 0,
      creditoAberto: 0,
      vencido: 0,
    };
    mapa.set(clienteId, atual);
    return atual;
  }

  for (const titulo of input.titulos) {
    const aberto = numeroSeguro(titulo.valor_aberto);
    if (!tituloTemSaldo(titulo.status, aberto)) {
      continue;
    }
    const atual = linha(titulo.cliente_id);
    atual.debitoAberto += aberto;
    if (
      tituloCarteiraVencido({
        status: titulo.status,
        valorAberto: aberto,
        vencimento: titulo.vencimento,
        hojeIso: input.hojeIso,
      })
    ) {
      atual.vencido += aberto;
    }
  }

  for (const credito of input.creditos) {
    const disponivel = numeroSeguro(credito.valor_disponivel);
    if (!creditoCarteiraAberto(credito.status, disponivel)) {
      continue;
    }
    linha(credito.cliente_id).creditoAberto += disponivel;
  }

  for (const atual of mapa.values()) {
    atual.debitoAberto = arredondarDinheiro(atual.debitoAberto);
    atual.creditoAberto = arredondarDinheiro(atual.creditoAberto);
    atual.vencido = arredondarDinheiro(atual.vencido);
  }

  return mapa;
}

export function situacaoCarteiraCliente(input: {
  cliente: ClienteListagemBase;
  carteira?: Pick<
    SituacaoCarteiraCliente,
    "debitoAberto" | "creditoAberto" | "vencido"
  >;
}): SituacaoCarteiraCliente {
  const debitoAberto = arredondarDinheiro(input.carteira?.debitoAberto ?? 0);
  const limite = numeroSeguro(input.cliente.limite_credito);
  return {
    debitoAberto,
    creditoAberto: arredondarDinheiro(input.carteira?.creditoAberto ?? 0),
    vencido: arredondarDinheiro(input.carteira?.vencido ?? 0),
    limiteDisponivel: arredondarDinheiro(Math.max(0, limite - debitoAberto)),
  };
}

export function clientePassaNoFiltroListagem(input: {
  filtro: FiltroListagemClientes;
  cliente: ClienteListagemBase;
  situacao: SituacaoCarteiraCliente;
}) {
  switch (input.filtro) {
    case "debito":
      return input.situacao.debitoAberto > 0;
    case "credito":
      return input.situacao.creditoAberto > 0;
    case "zerado":
      return (
        input.situacao.debitoAberto <= 0 && input.situacao.creditoAberto <= 0
      );
    case "vencidos":
      return input.situacao.vencido > 0;
    case "limite_disponivel":
      return input.situacao.limiteDisponivel > 0;
    case "limite_comprometido":
      return input.situacao.debitoAberto > 0;
    case "fiado_bloqueado":
      return Boolean(input.cliente.bloqueado);
    default:
      return true;
  }
}

export function valorFinanceiroListagem(input: {
  filtro: FiltroListagemClientes;
  situacao: SituacaoCarteiraCliente;
}) {
  switch (input.filtro) {
    case "debito":
    case "limite_comprometido":
      return input.situacao.debitoAberto;
    case "credito":
      return input.situacao.creditoAberto;
    case "vencidos":
      return input.situacao.vencido;
    case "limite_disponivel":
      return input.situacao.limiteDisponivel;
    case "zerado":
      return 0;
    default:
      return input.situacao.debitoAberto;
  }
}

export function totalFinanceiroListagem(input: {
  filtro: FiltroListagemClientes;
  situacoes: SituacaoCarteiraCliente[];
}) {
  return arredondarDinheiro(
    input.situacoes.reduce(
      (total, situacao) =>
        total + valorFinanceiroListagem({ filtro: input.filtro, situacao }),
      0
    )
  );
}

export function rotuloTotalListagem(filtro: FiltroListagemClientes) {
  switch (filtro) {
    case "debito":
      return "Total em aberto";
    case "credito":
      return "Total em crédito";
    case "vencidos":
      return "Total vencido";
    case "limite_disponivel":
      return "Limite disponível";
    case "limite_comprometido":
      return "Total em aberto";
    case "zerado":
      return "Total";
    case "fiado_bloqueado":
      return "Total devido";
    default:
      return "Total devido";
  }
}

export type VarianteColunaFinanceira = "debito" | "credito" | "vencido" | "quitado";

export type ItemColunaFinanceira = {
  variante: VarianteColunaFinanceira;
  rotulo: string;
  valor: number;
};

export function itensColunaFinanceira(input: {
  filtro: FiltroListagemClientes;
  situacao: SituacaoCarteiraCliente;
}): ItemColunaFinanceira[] {
  const { filtro, situacao } = input;

  if (filtro === "debito" || filtro === "limite_comprometido") {
    return [
      {
        variante: "debito",
        rotulo: "Débito em aberto",
        valor: situacao.debitoAberto,
      },
    ];
  }

  if (filtro === "credito") {
    return [
      {
        variante: "credito",
        rotulo: "Crédito",
        valor: situacao.creditoAberto,
      },
    ];
  }

  if (filtro === "vencidos") {
    return [
      {
        variante: "vencido",
        rotulo: "Vencido",
        valor: situacao.vencido,
      },
    ];
  }

  if (filtro === "zerado") {
    return [{ variante: "quitado", rotulo: "Quitado", valor: 0 }];
  }

  if (filtro === "limite_disponivel") {
    return [
      {
        variante: "credito",
        rotulo: "Limite disponível",
        valor: situacao.limiteDisponivel,
      },
    ];
  }

  const itens: ItemColunaFinanceira[] = [];
  if (situacao.debitoAberto > 0) {
    itens.push({
      variante: "debito",
      rotulo: "Débito em aberto",
      valor: situacao.debitoAberto,
    });
  }
  if (situacao.creditoAberto > 0) {
    itens.push({
      variante: "credito",
      rotulo: "Crédito",
      valor: situacao.creditoAberto,
    });
  }
  if (itens.length === 0) {
    itens.push({ variante: "quitado", rotulo: "Quitado", valor: 0 });
  }
  return itens;
}

export function contadoresListagemClientes(
  situacoes: Array<{
    debitoAberto: number;
    creditoAberto: number;
    vencido: number;
  }>
) {
  return {
    debito: situacoes.filter((item) => item.debitoAberto > 0).length,
    credito: situacoes.filter((item) => item.creditoAberto > 0).length,
    vencidos: situacoes.filter((item) => item.vencido > 0).length,
  };
}

export function formatarDocumentoCliente(
  tipoPessoa: string,
  documento: string | null
) {
  const digitos = String(documento ?? "").replace(/\D/g, "");

  if (tipoPessoa === "F" && digitos.length === 11) {
    return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  if (tipoPessoa === "J" && digitos.length === 14) {
    return digitos.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }

  return digitos || "Sem documento";
}

export function resolverModoRecebimentoListagem(input: {
  tipo: "total" | "parcial";
  itemIds: string[];
  totalSelecionado: number;
  valorInformado: number | null;
}) {
  if (input.itemIds.length === 0) {
    return { ok: false as const, erro: "Selecione ao menos um item." };
  }

  if (input.tipo === "total") {
    return {
      ok: true as const,
      modo: "ITENS" as const,
      valor: null,
      itemIds: input.itemIds,
    };
  }

  const valor = arredondarDinheiro(input.valorInformado ?? 0);
  if (valor <= 0) {
    return {
      ok: false as const,
      erro: "Informe um valor a receber maior que zero.",
    };
  }

  const teto = arredondarDinheiro(input.totalSelecionado);
  if (valor > teto) {
    return {
      ok: false as const,
      erro: "Valor a receber não pode ser maior que o total aberto selecionado.",
    };
  }

  if (valor >= teto) {
    return {
      ok: true as const,
      modo: "ITENS" as const,
      valor: null,
      itemIds: input.itemIds,
    };
  }

  return {
    ok: true as const,
    modo: "PARCIAL" as const,
    valor,
    itemIds: input.itemIds,
  };
}

export function estadoBotoesBaixaModal(input: {
  valorTexto: string;
  valorFocado: boolean;
  temItensSelecionados: boolean;
  valorInformado: number | null;
  totalSelecionado: number;
  enviando: boolean;
}) {
  const campoComValor = input.valorTexto.length > 0;
  const campoAtivo = input.valorFocado || campoComValor;
  const valorValido =
    input.valorInformado != null &&
    input.valorInformado > 0 &&
    input.valorInformado <= input.totalSelecionado;

  return {
    baixaTotalDesabilitada:
      input.enviando || !input.temItensSelecionados || campoAtivo,
    baixaParcialDesabilitada:
      input.enviando ||
      !input.temItensSelecionados ||
      (campoAtivo && !valorValido),
  };
}

export function aplicarBaixaNaListagem<
  T extends { id: string; situacaoCarteira: SituacaoCarteiraCliente },
>(input: {
  clientes: T[];
  filtro: FiltroListagemClientes;
  clienteId: string;
  situacao: SituacaoCarteiraCliente;
  contadores: { debito: number; credito: number; vencidos: number };
}) {
  const anterior = input.clientes.find((cliente) => cliente.id === input.clienteId);
  const atualizados = input.clientes.map((cliente) =>
    cliente.id === input.clienteId
      ? { ...cliente, situacaoCarteira: input.situacao }
      : cliente
  );
  const filtrados = atualizados.filter((cliente) =>
    clientePassaNoFiltroListagem({
      filtro: input.filtro,
      cliente,
      situacao: cliente.situacaoCarteira,
    })
  );

  const debitoAntes = anterior?.situacaoCarteira.debitoAberto ?? 0;
  const creditoAntes = anterior?.situacaoCarteira.creditoAberto ?? 0;
  const vencidoAntes = anterior?.situacaoCarteira.vencido ?? 0;

  return {
    clientes: filtrados,
    total: totalFinanceiroListagem({
      filtro: input.filtro,
      situacoes: filtrados.map((cliente) => cliente.situacaoCarteira),
    }),
    contadores: {
      debito:
        input.contadores.debito +
        Number(input.situacao.debitoAberto > 0) -
        Number(debitoAntes > 0),
      credito:
        input.contadores.credito +
        Number(input.situacao.creditoAberto > 0) -
        Number(creditoAntes > 0),
      vencidos:
        input.contadores.vencidos +
        Number(input.situacao.vencido > 0) -
        Number(vencidoAntes > 0),
    },
  };
}

export function montarHrefListagemClientes(input: {
  filtro?: FiltroListagemClientes;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (input.filtro && input.filtro !== "todos") {
    params.set("filtro", input.filtro);
  }
  const busca = String(input.q ?? "").trim();
  if (busca) {
    params.set("q", busca);
  }
  const query = params.toString();
  return query ? `/clientes?${query}` : "/clientes";
}

function arredondarDinheiro(valor: number) {
  return Math.round((numeroSeguro(valor) + Number.EPSILON) * 100) / 100;
}
