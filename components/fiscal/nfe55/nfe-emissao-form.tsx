"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  adicionarItemOperacaoFiscal,
  atualizarIdentidadeDestinatarioOperacao,
  atualizarItemOperacaoFiscal,
  buscarClientesOperacaoFiscal,
  buscarProdutosOperacaoFiscal,
  confirmarRecebimentoTransferencia,
  confirmarSaidaOperacaoFiscal,
  criarOperacaoFiscal,
  prepararVendaParaEmissaoNfe,
  removerItemOperacaoFiscal,
  salvarCadastroDestinatarioOperacao,
  salvarDestinatarioBonificacao,
  salvarDestinoTransferencia,
  salvarNaturezaOperacaoFiscal,
  salvarCabecalhoFiscalOperacao,
  salvarPagamentosOperacaoVenda,
  salvarTotaisOperacaoFiscal,
  salvarTransporteOperacaoFiscal,
  salvarEnderecoEntregaOperacaoFiscal,
  salvarAutorizadosXmlOperacaoFiscal,
  verificarOperacaoFiscalAction,
  vincularEstabelecimentoTransferencia,
} from "@/app/fiscal/nfe/operacoes-actions";
import { EmissaoFiscalAcoes } from "@/components/fiscal/emissao-fiscal-acoes";
import { EmissaoFiscalHistorico } from "@/components/fiscal/emissao-fiscal-historico";
import {
  NfeCampo,
  NfeRecolhivel,
  NfeSecao,
  nfeInput,
  nfeSelect,
  nfeSomenteLeitura,
} from "@/components/fiscal/nfe55/nfe-form-primitives";
import { CampoValor } from "@/components/ui/campo-valor";
import {
  NfePagamentoVenda,
  pagamentosNfeParaRascunho,
  type PagamentoDigitadoNfe,
} from "@/components/fiscal/nfe55/nfe-pagamento-venda";
import { NfeFaturaCobranca } from "@/components/fiscal/nfe55/nfe-fatura-cobranca";
import type { PixGeranetCheckoutState } from "@/components/pdv/pix-geranet-checkout";
import type { PixLocalCheckoutState } from "@/components/pdv/pix-local-checkout";
import type { PixConfigPdv } from "@/lib/pagamentos/pix/modo-ativo";
import type { FormaPagamentoCheckout } from "@/lib/pdv/formas-pagamento-checkout";
import {
  TransporteVendaForm,
  type DadosTransporteVenda,
  type TransportadoraCadastro,
  type TransporteVendaFormHandle,
} from "@/components/vendas/transporte-venda-form";
import { hrefEdicaoOperacaoFiscal, resolverAcoesEmissaoFiscal } from "@/lib/fiscal/acoes-emissao";
import {
  HREF_RASCUNHOS_NFE,
  MENSAGEM_SAIR_NFE_COM_ALTERACOES,
} from "@/lib/fiscal/nfe55/rascunhos-nfe";
import { PdvCaixaFechado } from "@/components/pdv/pdv-caixa-fechado";
import { CaixaAvisoReabertoFaixa } from "@/components/caixa/caixa-aviso-reaberto";
import type { CaixaAvisoReaberto } from "@/lib/caixa/tipos";
import {
  MENSAGEM_CAIXA_FECHADO_NFE_VENDA,
} from "@/lib/caixa/mensagens";
import { nfeVendaNovaExigeCaixa, recusarInicioVendaNfeSemCaixa } from "@/lib/caixa/nfe-venda";
import {
  enderecoEntregaVazio,
  type EnderecoEntregaNfe,
  type EnderecoEntregaSnapshot,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import {
  autorizadoXmlVazio,
  LIMITE_AUTORIZADOS_XML_NFE,
  type AutorizadoXmlNfe,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import { paraCentavos } from "@/lib/fiscal/distribuir-desconto-itens";
import { ehFormaPix } from "@/lib/pagamentos/pix/local-regras";
import {
  avaliarPagamentosDigitadosNfe,
  centavosDeTextoPagamento,
  pagamentosNfeFechamTotal,
  sincronizarPagamentoUnicoComTotal,
  textoPagamentoDeCentavos,
  mensagemPagamentoNfeIncompleto,
} from "@/lib/fiscal/nfe55/sincronizar-pagamentos";
import {
  adicionarDiasIsoLocal,
  faturaNfePadrao,
  gerarParcelasFaturaNfe,
  somaDuplicatasCentavos,
  tipoCobrancaPrazoNfe,
  totalAPrazoFaturaCentavos,
  totalAPrazoPagamentosCentavos,
  validarFaturaParaEmissaoNfe,
  type CondicaoPagamentoNfe,
  type FaturaNfe,
  type TipoCobrancaPrazoNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import {
  formaEhDuplicataMercantil,
  pagamentosImediatosNfeCentavos,
  saldoDuplicataMercantilCentavos,
} from "@/lib/fiscal/nfe55/pagamento-fiscal-nfe";
import { hojeIso } from "@/lib/produtos/lotes";
import {
  normalizarIndicadorIeDestinatario,
  resolverDestinatarioFiscalDaOrigem,
  resolverDestinatarioFiscalNfe,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import type { EventoEmissaoFiscal } from "@/lib/fiscal/eventos-emissao";
import type { TentativaFiscalResumo } from "@/lib/fiscal/emissao-tentativas";
import { emissaoBloqueiaRetransmissao } from "@/lib/fiscal/geranet/classificar-emissao";
import {
  interpretarRespostaEmissaoVenda,
  resolverDestinoAposEmissaoVenda,
} from "@/lib/vendas/resolver-rota-edicao-venda";
import {
  ROTULOS_FIN_NFE,
  ROTULOS_TIPO_OPERACAO,
  ROTULOS_TP_NF,
  MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV,
  ehCodigoTipoOperacaoInterno,
  type FinNfeSuportada,
  type TpNf,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  avisoNaturezaNestaTela,
  destinatarioTipoPeloTipoOperacao,
  naturezaExigeFinanceiro,
  tipoOperacaoEmitivelNestaTela,
} from "@/lib/fiscal/nfe55/defaults-natureza";
import {
  MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO,
  operacaoPodeConfirmarRecebimento,
  operacaoPodeConfirmarSaida,
  operacaoPodeEmitir,
  podeEditarDocumentoFiscal,
  podeEditarNumeracaoFiscal,
  rotuloStatusOperacaoFiscal,
} from "@/lib/fiscal/operacoes/status-operacao";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  normalizarTotaisNota,
  totalLiquidoNota,
  type TotaisNotaNfe,
} from "@/lib/fiscal/nfe55/totais-nota";
import {
  ROTULOS_INDICADOR_PRESENCA_NFE,
  ROTULOS_INDICADOR_INTERMEDIADOR_NFE,
  INDICADORES_PRESENCA_NFE,
  INDICADORES_INTERMEDIADOR_NFE,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import type { PoliticaCancelamentoPublica } from "@/lib/fiscal/politica-cancelamento";
import { useBuscaCep } from "@/lib/endereco/use-busca-cep";
import {
  formatarPrecoItemNfe,
  formatarQuantidadeItemNfe,
  parseNumeroComercialNfe,
  totalItemNfe,
  validarQuantidadeItemNfe,
  validarValorUnitarioItemNfe,
} from "@/lib/fiscal/nfe55/item-comercial";
import { unidadePermiteDecimal } from "@/lib/produtos/unidades-medida";

function reaisParaInput(valor: number) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

function textoParaReais(valor: string) {
  let texto = valor.trim();
  if (!texto) return 0;
  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) return 0;
  return Math.round(numero * 100) / 100;
}

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const PRESENCA = INDICADORES_PRESENCA_NFE.map(
  (codigo) => [codigo, ROTULOS_INDICADOR_PRESENCA_NFE[codigo]] as const
);

const INTERMEDIADOR = INDICADORES_INTERMEDIADOR_NFE.map(
  (codigo) => [codigo, ROTULOS_INDICADOR_INTERMEDIADOR_NFE[codigo]] as const
);

const CRT = [
  ["1", "1 - Simples Nacional"],
  ["2", "2 - Simples Nacional - excesso de sublimite"],
  ["3", "3 - Regime Normal"],
] as const;

export type NaturezaFormularioNfe = {
  id: string;
  descricao: string;
  tipoOperacaoInterno: string;
  tpNf: string;
  finNfe: string;
  padrao: boolean;
};

export type ClienteFormularioNfe = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  tipoPessoa?: string;
  cpfCnpj?: string;
  inscricaoEstadual?: string | null;
  contribuinteIcms?: boolean;
  indicadorIe?: string | null;
  consumidorFinal?: boolean;
  telefone?: string | null;
  email?: string | null;
  cep?: string | null;
  uf?: string | null;
  municipio?: string | null;
  codigoMunicipioIbge?: string | null;
  bairro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
};

type DestinatarioCadastroEdit = {
  nome: string;
  nomeFantasia: string;
  cpfCnpj: string;
  inscricaoEstadual: string;
  contribuinteIcms: boolean;
  indicadorIe: "1" | "2" | "9";
  telefone: string;
  email: string;
  cep: string;
  uf: string;
  municipio: string;
  codigoMunicipioIbge: string;
  bairro: string;
  logradouro: string;
  numero: string;
  complemento: string;
};

function cadastroDestinatarioVazio(): DestinatarioCadastroEdit {
  return {
    nome: "",
    nomeFantasia: "",
    cpfCnpj: "",
    inscricaoEstadual: "",
    contribuinteIcms: false,
    indicadorIe: "9",
    telefone: "",
    email: "",
    cep: "",
    uf: "",
    municipio: "",
    codigoMunicipioIbge: "",
    bairro: "",
    logradouro: "",
    numero: "",
    complemento: "",
  };
}

function cadastroDestinatarioDoCliente(
  cliente: ClienteFormularioNfe | null
): DestinatarioCadastroEdit {
  if (!cliente) {
    return cadastroDestinatarioVazio();
  }
  return {
    nome: cliente.nome ?? "",
    nomeFantasia: cliente.nomeFantasia ?? "",
    cpfCnpj: cliente.cpfCnpj ?? "",
    inscricaoEstadual: cliente.inscricaoEstadual ?? "",
    indicadorIe: normalizarIndicadorIeDestinatario(
      cliente.indicadorIe,
      Boolean(cliente.contribuinteIcms)
    ),
    contribuinteIcms: Boolean(cliente.contribuinteIcms),
    telefone: cliente.telefone ?? "",
    email: cliente.email ?? "",
    cep: cliente.cep ?? "",
    uf: cliente.uf ?? "",
    municipio: cliente.municipio ?? "",
    codigoMunicipioIbge: cliente.codigoMunicipioIbge ?? "",
    bairro: cliente.bairro ?? "",
    logradouro: cliente.logradouro ?? "",
    numero: cliente.numero ?? "",
    complemento: cliente.complemento ?? "",
  };
}

export type ItemFormularioNfe = {
  id: string;
  descricao: string;
  codigo?: string | null;
  unidade?: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  precoCatalogo?: number;
  estoque: number;
  cfop: string | null;
  ncm: string | null;
  icms?: string | null;
};

export function NfeEmissaoForm({
  operacao,
  origemNome,
  destinos,
  estabelecimentosParaVincular,
  clientes,
  naturezas,
  tiposOperacao,
  itens,
  transportadoras,
  emissao,
  eventos,
  tentativas = [],
  tentativasCabecalho = 0,
  politicaCancelamento,
  bloqueioCancelamentoOperacional,
  seriePrevista,
  numeroPrevisto,
  seriesNfe = [],
  regimeTributario,
  indicadorPresenca,
  intermediador,
  ambienteFiscal = "2",
  formasPagamento = [],
  pixConfig = null,
  emitenteCnpj = "",
  seriePrevistaNfce: _seriePrevistaNfce = "",
  numeroPrevistoNfce: _numeroPrevistoNfce = "",
  caixaAberto = false,
  controleCaixaAtivo = true,
  caixaReabertoAviso = null,
  podeAbrirCaixa = false,
}: {
  operacao: {
    id: string | null;
    tipo: string;
    status: string;
    naturezaId: string | null;
    naturezaDescricao: string | null;
    tpNf: string | null;
    finNfe: string | null;
    destinatarioId: string | null;
    destinoEmpresaId: string | null;
    vinculoId: string | null;
    destinoGerenciado: boolean;
    saidaProcessadaEm: string | null;
    recebimentoProcessadoEm: string | null;
    dadosTransporte: DadosTransporteVenda | null;
    informacaoComplementarUsuario: string | null;
    informacaoAdicionalFisco: string | null;
    serieEmissao: string | null;
    numeroEmissao: string | null;
    vendaId?: string | null;
    numeroVenda?: string | null;
    pagamentosRascunho?: Array<{
      formaPagamentoId: string;
      valorCentavos: number;
      pixLocalRecebimentoId?: string | null;
    }>;
    fatura?: FaturaNfe | null;
    condicaoPagamento?: CondicaoPagamentoNfe;
    totaisNota?: TotaisNotaNfe;
    enderecoEntrega?: EnderecoEntregaSnapshot;
    autorizadosXml?: AutorizadoXmlNfe[];
    consumidorFinalSnapshot?: boolean | null;
    consumidorFinalOrigem?: "cadastro" | "manual" | "operacao" | "origem_pdv" | null;
    indicadorIeSnapshot?: "1" | "2" | "9" | null;
    dataEmissao?: string | null;
    horaEmissao?: string | null;
    dataSaida?: string | null;
    horaSaida?: string | null;
    numeracaoAutomatica?: boolean;
  };
  origemNome: string;
  emitenteCnpj?: string;
  destinos: Array<{ id: string; empresaDestinoId: string; nome: string; cnpj: string }>;
  estabelecimentosParaVincular: Array<{ id: string; nome: string; cnpj: string }>;
  clientes: ClienteFormularioNfe[];
  naturezas: NaturezaFormularioNfe[];
  tiposOperacao: Array<{
    codigo: string;
    rotulo: string;
    movimentaEstoque: boolean;
    vinculaVenda: boolean;
  }>;
  itens: ItemFormularioNfe[];
  transportadoras: TransportadoraCadastro[];
  emissao: {
    id: string;
    status: string;
    modelo: string;
    serie: string;
    numero: string;
    chaveAcesso: string | null;
    protocolo: string | null;
    cstat: string | null;
    motivo: string | null;
    geranetHttpStatus: number | null;
    geranetSituacao: string | null;
    erroComunicacao: string | null;
    classificacao?: string | null;
    autorizadaAt?: string | null;
  } | null;
  eventos: EventoEmissaoFiscal[];
  tentativas?: TentativaFiscalResumo[];
  tentativasCabecalho?: number;
  politicaCancelamento: PoliticaCancelamentoPublica | null;
  bloqueioCancelamentoOperacional?: string | null;
  seriePrevista: string;
  numeroPrevisto: string;
  seriesNfe?: Array<{ serie: number; proximoNumero: number }>;
  regimeTributario: string;
  indicadorPresenca: string;
  intermediador: string;
  ambienteFiscal?: "1" | "2";
  formasPagamento?: FormaPagamentoCheckout[];
  pixConfig?: PixConfigPdv | null;
  seriePrevistaNfce?: string;
  numeroPrevistoNfce?: string;
  caixaAberto?: boolean;
  controleCaixaAtivo?: boolean;
  caixaReabertoAviso?: CaixaAvisoReaberto | null;
  podeAbrirCaixa?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [naturezaId, setNaturezaId] = useState(operacao.naturezaId ?? "");
  const [tpNf, setTpNf] = useState(operacao.tpNf || "1");
  const [finNfe, setFinNfe] = useState(operacao.finNfe || "1");
  const [presenca, setPresenca] = useState(indicadorPresenca);
  const [intermediadorEdit, setIntermediadorEdit] = useState(intermediador || "0");
  const [serieEdit, setSerieEdit] = useState(
    operacao.serieEmissao || seriePrevista || (seriesNfe[0] ? String(seriesNfe[0].serie) : "")
  );
  const [numeracaoAutomatica, setNumeracaoAutomatica] = useState(
    operacao.numeracaoAutomatica !== false
  );
  const [numeroEdit, setNumeroEdit] = useState(operacao.numeroEmissao || numeroPrevisto || "");
  const [dataEmissao, setDataEmissao] = useState(operacao.dataEmissao ?? "");
  const [horaEmissao, setHoraEmissao] = useState(operacao.horaEmissao ?? "");
  const [dataSaida, setDataSaida] = useState(operacao.dataSaida ?? "");
  const [horaSaida, setHoraSaida] = useState(operacao.horaSaida ?? "");
  const [cabecalhoSujo, setCabecalhoSujo] = useState(false);
  const [destinatarioId, setDestinatarioId] = useState(operacao.destinatarioId ?? "");
  const [vinculoId, setVinculoId] = useState(operacao.vinculoId ?? "");
  const [empresaVincular, setEmpresaVincular] = useState("");
  const [infoUsuario, setInfoUsuario] = useState(
    operacao.informacaoComplementarUsuario ?? ""
  );
  const [infoFisco, setInfoFisco] = useState(operacao.informacaoAdicionalFisco ?? "");
  const [chaveRef, setChaveRef] = useState("");
  const [referencias, setReferencias] = useState<string[]>([]);
  const [mostrarMaisTotais, setMostrarMaisTotais] = useState(false);
  const [totaisTexto, setTotaisTexto] = useState(() => {
    const totais = normalizarTotaisNota(operacao.totaisNota);
    return {
      frete: reaisParaInput(totais.frete),
      seguro: reaisParaInput(totais.seguro),
      outro: reaisParaInput(totais.outro),
      desconto: reaisParaInput(totais.desconto),
    };
  });
  const [itemAberto, setItemAberto] = useState<string | null>(null);
  const [ajusteItens, setAjusteItens] = useState<
    Record<string, { quantidade: number; valorUnitario: number }>
  >({});
  const [buscaProduto, setBuscaProduto] = useState("");
  const [produtos, setProdutos] = useState<
    Array<{
      id: string;
      nome: string;
      codigo: string;
      unidade: string;
      ncm: string | null;
      estoque: number;
      preco: number;
    }>
  >([]);
  const [buscaNatureza, setBuscaNatureza] = useState("");
  const [naturezasAbertas, setNaturezasAbertas] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clientesBusca, setClientesBusca] = useState<ClienteFormularioNfe[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoDigitadoNfe[]>(() =>
    (operacao.pagamentosRascunho ?? []).map((pagamento) => ({
      formaPagamentoId: pagamento.formaPagamentoId,
      valorTexto: (pagamento.valorCentavos / 100).toFixed(2).replace(".", ","),
    }))
  );
  const [pixLocal, setPixLocal] = useState<PixLocalCheckoutState | null>(null);
  const [pixGeranet, setPixGeranet] = useState<PixGeranetCheckoutState | null>(null);
  const [condicaoPagamento, setCondicaoPagamento] = useState<CondicaoPagamentoNfe>(
    operacao.condicaoPagamento ?? (operacao.fatura ? "prazo" : "vista")
  );
  const [tipoCobrancaPrazo, setTipoCobrancaPrazo] = useState<TipoCobrancaPrazoNfe>(() =>
    tipoCobrancaPrazoNfe({ fatura: operacao.fatura })
  );
  const [fatura, setFatura] = useState<FaturaNfe | null>(operacao.fatura ?? null);
  const [tipoPessoaEdit, setTipoPessoaEdit] = useState("");
  const [consumidorFinalOrigem, setConsumidorFinalOrigem] = useState<
    "cadastro" | "manual" | "operacao" | "origem_pdv"
  >(
    operacao.consumidorFinalOrigem === "origem_pdv"
      ? "origem_pdv"
      : operacao.consumidorFinalSnapshot != null
        ? "operacao"
        : "cadastro"
  );
  const [consumidorFinalEdit, setConsumidorFinalEdit] = useState(() => {
    if (operacao.consumidorFinalSnapshot != null) {
      return Boolean(operacao.consumidorFinalSnapshot);
    }
    const inicial = clientes.find((item) => item.id === operacao.destinatarioId);
    return (
      resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: operacao.tipo,
        origemVenda: operacao.vendaId ? "pdv" : "nfe_manual",
        contribuinteIcms: inicial?.contribuinteIcms,
        indicadorIeCadastro: inicial?.indicadorIe,
        consumidorFinalCadastro: inicial?.consumidorFinal,
      }).consumidorFinal === "1"
    );
  });
  const [destCadastro, setDestCadastro] = useState<DestinatarioCadastroEdit>(() => {
    const cadastro = cadastroDestinatarioDoCliente(
      clientes.find((item) => item.id === operacao.destinatarioId) ?? null
    );
    if (operacao.indicadorIeSnapshot) {
      cadastro.indicadorIe = operacao.indicadorIeSnapshot;
      cadastro.contribuinteIcms = operacao.indicadorIeSnapshot === "1";
    }
    return cadastro;
  });
  const buscaCepDestinatario = useBuscaCep((endereco) => {
    setDestCadastro((atual) => ({
      ...atual,
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      municipio: endereco.municipio,
      uf: endereco.uf,
      codigoMunicipioIbge: endereco.codigoMunicipioIbge,
    }));
  });
  const entregaInicial = operacao.enderecoEntrega;
  const [entregaDiferente, setEntregaDiferente] = useState(
    Boolean(entregaInicial?.diferente)
  );
  const [entregaCampos, setEntregaCampos] = useState<EnderecoEntregaNfe>(
    () => entregaInicial?.entrega ?? enderecoEntregaVazio()
  );
  const [autorizadosXml, setAutorizadosXml] = useState<AutorizadoXmlNfe[]>(
    () => operacao.autorizadosXml ?? []
  );
  const buscaCepEntrega = useBuscaCep((endereco) => {
    setEntregaCampos((atual) => ({
      ...atual,
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      municipio: endereco.municipio,
      uf: endereco.uf,
      codigoMunicipio: endereco.codigoMunicipioIbge,
    }));
  });
  const [, setValidadaLocalmenteState] = useState(
    operacaoPodeEmitir(operacao.status)
  );
  const [rascunhoSujo, setRascunhoSujo] = useState(false);
  function setValidadaLocalmente(valor: boolean) {
    setValidadaLocalmenteState(valor);
    if (!valor) {
      setRascunhoSujo(true);
    }
  }
  const [caixaLiberadoLocal, setCaixaLiberadoLocal] = useState(false);
  const emitindo = useRef(false);
  const saindo = useRef(false);
  const recebendo = useRef(false);
  const transporteRef = useRef<TransporteVendaFormHandle>(null);
  const buscaProdutoTimer = useRef<number | null>(null);
  const buscaClienteTimer = useRef<number | null>(null);
  const destinatarioIdAnterior = useRef(operacao.destinatarioId ?? "");
  const destCadastroSincronizadoId = useRef(operacao.destinatarioId ?? "");

  const natureza = naturezas.find((item) => item.id === naturezaId) ?? null;
  const tipoAtual = natureza?.tipoOperacaoInterno || operacao.tipo;
  const tipoCatalogo =
    tiposOperacao.find((item) => item.codigo === tipoAtual) ??
    tiposOperacao.find((item) => item.codigo === operacao.tipo) ??
    null;
  const exigeCaixaVendaNova =
    controleCaixaAtivo !== false &&
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: tipoAtual || operacao.tipo,
      vinculaVenda: tipoCatalogo?.vinculaVenda === true,
      vendaId: operacao.vendaId,
    });
  const caixaAbertoEfetivo = caixaAberto || caixaLiberadoLocal;
  const vendaNovaSemCaixa = exigeCaixaVendaNova && !caixaAbertoEfetivo;
  function recusaCaixaParaTipo(tipo: string) {
    return recusarInicioVendaNfeSemCaixa({
      tipoOperacaoInterno: tipo,
      vinculaVenda:
        tiposOperacao.find((item) => item.codigo === tipo)?.vinculaVenda === true,
      vendaId: operacao.vendaId,
      controleAtivo: controleCaixaAtivo !== false,
      caixaAberto: caixaAbertoEfetivo,
    });
  }
  const emitivel = tipoOperacaoEmitivelNestaTela(tipoAtual);
  const destTipo = destinatarioTipoPeloTipoOperacao(tipoAtual);
  const nfeAutorizada = emissao?.status === "autorizada";
  const edicaoDocumento = podeEditarDocumentoFiscal({
    statusOperacao: operacao.status,
    emissao,
  });
  const edicaoNumeracao = podeEditarNumeracaoFiscal({
    statusOperacao: operacao.status,
    emissao,
  });
  const estadoEmissao = emissao
    ? resolverEstadoOperacionalDeEmissaoPersistida(emissao)
    : null;
  const documentoAmbiguo =
    estadoEmissao?.documentoFiscalAmbiguo === true ||
    estadoEmissao?.caso === "aguardando_reconciliacao" ||
    operacao.status === "aguardando_reconciliacao";
  const nfeNaoAutorizadaConfirmada =
    Boolean(emissao) &&
    edicaoDocumento.permitido &&
    (estadoEmissao?.caso === "rejeitada" ||
      estadoEmissao?.estado === "erro_envio" ||
      estadoEmissao?.estado === "rejeitada_sefaz" ||
      operacao.status === "rejeitada");
  const podeEditarCabecalho = edicaoDocumento.permitido;
  const podeEditarNumeracao = edicaoDocumento.permitido && edicaoNumeracao.permitido;
  const podeTrocarNatureza = podeEditarCabecalho;
  const podeEditar = edicaoDocumento.permitido && emitivel;
  const podeEditarIdentidadeDestinatario =
    Boolean(destinatarioId) &&
    podeEditarCabecalho;
  const evidencias = emissao
    ? {
        status: emissao.status,
        classificacao: emissao.classificacao,
        cstat: emissao.cstat,
        motivo: emissao.motivo,
        protocolo: emissao.protocolo,
        chave_acesso: emissao.chaveAcesso,
        geranet_http_status: emissao.geranetHttpStatus,
        geranet_situacao: emissao.geranetSituacao,
        erro_comunicacao: emissao.erroComunicacao,
      }
    : null;
  const acoesFiscais = emissao
    ? resolverAcoesEmissaoFiscal({
        emissao,
        bloqueioCancelamentoOperacional,
      })
    : null;
  const bloqueiaRetransmissao = evidencias
    ? emissaoBloqueiaRetransmissao(evidencias)
    : false;
  const podeEmitir =
    emitivel &&
    !bloqueiaRetransmissao &&
    !vendaNovaSemCaixa &&
    !nfeAutorizada &&
    edicaoDocumento.permitido &&
    (acoesFiscais?.podeRetransmitir === true || Boolean(naturezaId));
  const destinatario = useMemo(() => {
    const lista = [...clientes, ...clientesBusca];
    return lista.find((item) => item.id === destinatarioId) ?? null;
  }, [clientes, clientesBusca, destinatarioId]);
  const serieSelecionada = seriesNfe.find((item) => String(item.serie) === String(serieEdit));
  const serieExibida = operacao.serieEmissao || serieEdit || seriePrevista || "";
  const numeroPrevistoSerie =
    serieSelecionada ? String(serieSelecionada.proximoNumero) : numeroPrevisto;
  const numeroReservado = Boolean(emissao?.numero);
  const numeroExibido = numeroReservado
    ? String(emissao?.numero ?? operacao.numeroEmissao ?? "")
    : numeracaoAutomatica
      ? numeroPrevistoSerie
      : numeroEdit || numeroPrevistoSerie || "";
  const naturezasFiltradas = useMemo(() => {
    const termo = buscaNatureza.trim().toLowerCase();
    const base = operacao.vendaId
      ? naturezas.filter((item) => item.tipoOperacaoInterno === "venda")
      : naturezas;
    const lista = termo
      ? base.filter(
          (item) =>
            item.descricao.toLowerCase().includes(termo) ||
            (ehCodigoTipoOperacaoInterno(item.tipoOperacaoInterno) &&
              ROTULOS_TIPO_OPERACAO[item.tipoOperacaoInterno]
                .toLowerCase()
                .includes(termo))
        )
      : base;
    return [...lista].sort((a, b) => {
      const ae = tipoOperacaoEmitivelNestaTela(a.tipoOperacaoInterno) ? 0 : 1;
      const be = tipoOperacaoEmitivelNestaTela(b.tipoOperacaoInterno) ? 0 : 1;
      return ae - be || a.descricao.localeCompare(b.descricao, "pt-BR");
    });
  }, [buscaNatureza, naturezas, operacao.vendaId]);
  const destino = destinos.find((item) => item.id === vinculoId) ?? null;
  const itensExibidos = useMemo(
    () =>
      itens.map((item) => {
        const ajuste = ajusteItens[item.id];
        if (!ajuste) {
          return item;
        }
        return {
          ...item,
          quantidade: ajuste.quantidade,
          valorUnitario: ajuste.valorUnitario,
          valorTotal: totalItemNfe(ajuste.quantidade, ajuste.valorUnitario),
        };
      }),
    [ajusteItens, itens]
  );
  const totalProdutos = itensExibidos.reduce((soma, item) => soma + item.valorTotal, 0);
  const totaisNota = normalizarTotaisNota({
    frete: textoParaReais(totaisTexto.frete),
    seguro: textoParaReais(totaisTexto.seguro),
    outro: textoParaReais(totaisTexto.outro),
    desconto: textoParaReais(totaisTexto.desconto),
  });
  const totalNfe = totalLiquidoNota(totalProdutos, totaisNota);
  const totalVendaCentavos = paraCentavos(totalNfe);
  const permiteTrocoPorFormaId = useMemo(
    () =>
      Object.fromEntries(
        formasPagamento.map((forma) => [forma.id, forma.permite_troco === true])
      ) as Record<string, boolean>,
    [formasPagamento]
  );
  const formaIdsDuplicata = useMemo(
    () =>
      formasPagamento
        .filter((forma) => formaEhDuplicataMercantil(forma))
        .map((forma) => forma.id),
    [formasPagamento]
  );
  const totalFiadoCentavos = useMemo(
    () =>
      totalAPrazoPagamentosCentavos({
        pagamentos: pagamentos.map((pagamento) => ({
          formaPagamentoId: pagamento.formaPagamentoId,
          valorCentavos: centavosDeTextoPagamento(pagamento.valorTexto),
        })),
        formas: formasPagamento,
      }),
    [formasPagamento, pagamentos]
  );
  const totalAPrazoCentavos = totalAPrazoFaturaCentavos({
    condicao: condicaoPagamento === "prazo" || totalFiadoCentavos > 0 ? "prazo" : "vista",
    totalNfeCentavos: totalVendaCentavos,
    totalFiadoCentavos,
  });
  const temPagamentoPosterior = totalFiadoCentavos > 0;
  const totalDuplicataCentavos = pagamentos.reduce((soma, pagamento) => {
    const forma = formasPagamento.find((item) => item.id === pagamento.formaPagamentoId);
    if (!formaEhDuplicataMercantil(forma)) {
      return soma;
    }
    return soma + centavosDeTextoPagamento(pagamento.valorTexto);
  }, 0);
  const temDuplicataMercantil =
    condicaoPagamento === "prazo" &&
    tipoCobrancaPrazo === "duplicata" &&
    !temPagamentoPosterior;
  const pagamentosImediatosCentavos = pagamentosImediatosNfeCentavos({
    pagamentos: pagamentos.map((pagamento) => ({
      formaPagamentoId: pagamento.formaPagamentoId,
      valorCentavos: centavosDeTextoPagamento(pagamento.valorTexto),
    })),
    formas: formasPagamento,
  });
  const saldoDuplicataDisponivelCentavos = saldoDuplicataMercantilCentavos({
    totalNfeCentavos: totalVendaCentavos,
    pagamentosImediatosCentavos,
  });
  const saldoDuplicataCentavos = temDuplicataMercantil
    ? saldoDuplicataDisponivelCentavos
    : 0;
  const coberturaDuplicataCentavos = temDuplicataMercantil
    ? fatura?.parcelasPersonalizadas
      ? fatura.valorLiquidoCentavos
      : saldoDuplicataCentavos
    : 0;
  const pagamentoAvaliacao = useMemo(
    () =>
      avaliarPagamentosDigitadosNfe({
        totalVendaCentavos,
        pagamentos,
        permiteTrocoPorFormaId,
        coberturaDuplicataCentavos,
        formaIdsDuplicata,
      }),
    [
      coberturaDuplicataCentavos,
      formaIdsDuplicata,
      pagamentos,
      permiteTrocoPorFormaId,
      totalVendaCentavos,
    ]
  );
  const totalPagoAgoraCentavos = temPagamentoPosterior
    ? Math.max(0, totalVendaCentavos - totalFiadoCentavos)
    : pagamentosImediatosCentavos;
  const codigoPagamentoFatura =
    formasPagamento.find((forma) => formaEhDuplicataMercantil(forma))?.codigo_fiscal ??
    "14";

  function garantirFaturaDuplicata(valorCentavos = saldoDuplicataCentavos) {
    const coberto = Math.max(0, Math.round(valorCentavos));
    if (coberto <= 0) {
      return;
    }
    setFatura((atual) => {
      if (atual?.parcelasPersonalizadas) {
        return atual;
      }
      if (!atual) {
        return faturaNfePadrao({
          numero: operacao.numeroVenda || "1",
          valorCentavos: coberto,
          codigoPagamento: codigoPagamentoFatura,
        });
      }
      const liquido = Math.max(0, coberto - atual.descontoCentavos);
      if (
        atual.valorCentavos === coberto &&
        atual.valorLiquidoCentavos === liquido &&
        somaDuplicatasCentavos(atual.duplicatas) === liquido
      ) {
        return atual;
      }
      return {
        ...atual,
        valorCentavos: coberto,
        valorLiquidoCentavos: liquido,
        origem: atual.origem === "carteira" ? "carteira" : "automatica",
        duplicatas: gerarParcelasFaturaNfe({
          valorLiquidoCentavos: liquido,
          quantidade: Math.max(1, atual.duplicatas.length || 1),
          primeiroVencimento:
            atual.duplicatas[0]?.dataVencimento || adicionarDiasIsoLocal(hojeIso(), 30),
          intervaloDias: 30,
          codigoPagamento: atual.duplicatas[0]?.codigoPagamento ?? codigoPagamentoFatura,
        }),
      };
    });
  }

  function aplicarCondicaoPagamento(proxima: CondicaoPagamentoNfe) {
    setCondicaoPagamento(proxima);
    setValidadaLocalmente(false);
    if (proxima === "vista") {
      setFatura(null);
      return;
    }
    if (temPagamentoPosterior || tipoCobrancaPrazo === "posterior") {
      setTipoCobrancaPrazo("posterior");
      setFatura(null);
      return;
    }
    setTipoCobrancaPrazo("duplicata");
    garantirFaturaDuplicata(saldoDuplicataDisponivelCentavos);
  }

  function aplicarTipoCobrancaPrazo(tipo: TipoCobrancaPrazoNfe) {
    if (temPagamentoPosterior && tipo === "duplicata") {
      return;
    }
    setTipoCobrancaPrazo(tipo);
    setValidadaLocalmente(false);
    if (tipo === "posterior") {
      setFatura(null);
      return;
    }
    garantirFaturaDuplicata(saldoDuplicataDisponivelCentavos);
  }

  const totalPagamentoAnteriorRef = useRef<number | null>(null);

  useEffect(() => {
    if (!podeEditar) {
      totalPagamentoAnteriorRef.current = totalVendaCentavos;
      return;
    }
    const totalMudou =
      totalPagamentoAnteriorRef.current !== null &&
      totalPagamentoAnteriorRef.current !== totalVendaCentavos;
    const primeiraAvaliacao = totalPagamentoAnteriorRef.current === null;
    totalPagamentoAnteriorRef.current = totalVendaCentavos;
    if (!primeiraAvaliacao && !totalMudou) {
      return;
    }
    const vigentes = pagamentos
      .map((pagamento) => ({
        formaPagamentoId: pagamento.formaPagamentoId,
        valorCentavos: centavosDeTextoPagamento(pagamento.valorTexto),
      }))
      .filter((pagamento) => pagamento.valorCentavos > 0);
    const sincronizado = sincronizarPagamentoUnicoComTotal({
      totalVendaCentavos,
      pagamentos: vigentes,
      permiteTrocoPorFormaId,
    });
    if (!sincronizado.sincronizou) {
      return;
    }
    const proximo = sincronizado.pagamentos.map((pagamento) => ({
      formaPagamentoId: pagamento.formaPagamentoId,
      valorTexto: textoPagamentoDeCentavos(pagamento.valorCentavos),
    }));
    const pixAlterado = proximo.some(
      (pagamento) =>
        ehFormaPix(
          formasPagamento.find((forma) => forma.id === pagamento.formaPagamentoId) ?? null
        )
    );
    if (pixAlterado) {
      setPixLocal(null);
      setPixGeranet(null);
    }
    setPagamentos(proximo);
    setValidadaLocalmente(false);
  }, [
    formasPagamento,
    pagamentos,
    podeEditar,
    permiteTrocoPorFormaId,
    totalVendaCentavos,
  ]);

  useEffect(() => {
    if (!podeEditar || totalFiadoCentavos <= 0) {
      return;
    }
    if (condicaoPagamento !== "prazo") {
      setCondicaoPagamento("prazo");
    }
    if (tipoCobrancaPrazo !== "posterior") {
      setTipoCobrancaPrazo("posterior");
    }
    if (fatura) {
      setFatura(null);
    }
  }, [condicaoPagamento, fatura, podeEditar, tipoCobrancaPrazo, totalFiadoCentavos]);

  useEffect(() => {
    if (!podeEditar || totalFiadoCentavos > 0 || totalDuplicataCentavos <= 0) {
      return;
    }
    if (condicaoPagamento !== "prazo") {
      setCondicaoPagamento("prazo");
    }
    if (tipoCobrancaPrazo !== "duplicata") {
      setTipoCobrancaPrazo("duplicata");
    }
  }, [
    condicaoPagamento,
    podeEditar,
    tipoCobrancaPrazo,
    totalDuplicataCentavos,
    totalFiadoCentavos,
  ]);

  useEffect(() => {
    if (!podeEditar || totalFiadoCentavos > 0 || !temDuplicataMercantil) {
      return;
    }
    garantirFaturaDuplicata(saldoDuplicataDisponivelCentavos);
  }, [
    podeEditar,
    saldoDuplicataCentavos,
    temDuplicataMercantil,
    totalFiadoCentavos,
  ]);

  const agora = useMemo(() => {
    const data = new Date();
    const iso = new Date(data.getTime() - data.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    return { data: iso.slice(0, 10), hora: iso.slice(11, 16) };
  }, []);

  function executar(
    acao: () => Promise<
      | { ok: true; mensagem?: string; operacaoId?: string }
      | { ok: false; erro: string; pendencias?: string[] }
    >,
    destino: "edicao" | "rascunhos" = "edicao"
  ) {
    setErro(null);
    setSucesso(null);
    setPendencias([]);
    startTransition(async () => {
      const cabecalho = await persistirCabecalhoSeSujo();
      if (!cabecalho.ok) {
        setErro(cabecalho.erro);
        emitindo.current = false;
        saindo.current = false;
        recebendo.current = false;
        return;
      }
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro);
        setPendencias(resultado.pendencias ?? []);
        emitindo.current = false;
        saindo.current = false;
        recebendo.current = false;
        return;
      }
      setRascunhoSujo(false);
      setSucesso(resultado.mensagem ?? "Rascunho salvo. O estoque não foi movimentado.");
      emitindo.current = false;
      saindo.current = false;
      recebendo.current = false;
      if (destino === "rascunhos") {
        router.push(HREF_RASCUNHOS_NFE);
        return;
      }
      if (resultado.operacaoId && resultado.operacaoId !== operacao.id) {
        router.replace(hrefEdicaoOperacaoFiscal(resultado.operacaoId));
        return;
      }
      router.refresh();
    });
  }

  async function garantirOperacao() {
    if (operacao.id) {
      return operacao.id;
    }
    if (!naturezaId) {
      setErro("Selecione uma natureza de operação da empresa ativa.");
      return null;
    }
    if (!emitivel) {
      return null;
    }
    const recusaCaixa = recusaCaixaParaTipo(tipoAtual);
    if (recusaCaixa) {
      setErro(recusaCaixa);
      return null;
    }
    const criado = await criarOperacaoFiscal({ naturezaId });
    if (!criado.ok || !criado.operacaoId) {
      setErro(criado.ok ? "Rascunho criado sem identificador." : criado.erro);
      return null;
    }
    router.replace(hrefEdicaoOperacaoFiscal(criado.operacaoId));
    return criado.operacaoId;
  }

  function mudarNatureza(novoId: string) {
    const nova = naturezas.find((item) => item.id === novoId);
    if (!nova) {
      setNaturezaId(novoId);
      return;
    }
    if (operacao.vendaId && nova.tipoOperacaoInterno !== "venda") {
      setErro(MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV);
      return;
    }
    const tipoNovo = nova.tipoOperacaoInterno;
    const tipoAnterior = tipoAtual;
    if (
      tipoNovo !== tipoAnterior &&
      (itens.length > 0 || destinatarioId || vinculoId) &&
      !window.confirm(
        "Trocar a natureza altera os padrões desta NF-e e pode limpar destinatário incompatível. Continuar?"
      )
    ) {
      return;
    }
    setErro(null);
    setNaturezaId(novoId);
    setFinNfe(nova.finNfe || finNfe);
    setTpNf(nova.tpNf || tpNf);
    setValidadaLocalmente(false);
    setCabecalhoSujo(false);
    if (!tipoOperacaoEmitivelNestaTela(tipoNovo)) {
      return;
    }
    if (recusaCaixaParaTipo(tipoNovo)) {
      return;
    }
    if (operacao.id) {
      executar(() => salvarNaturezaOperacaoFiscal({ operacaoId: operacao.id!, naturezaId: novoId }));
      return;
    }
    executar(() => criarOperacaoFiscal({ naturezaId: novoId }));
  }

  function persistirCabecalhoFiscal(
    operacaoId?: string | null,
    extra?: {
      tpNf?: string;
      serie?: string;
      numero?: string;
      numeracaoAutomatica?: boolean;
      finNfe?: string;
      indicadorPresenca?: string;
      indicativoIntermediador?: string;
      dataEmissao?: string;
      horaEmissao?: string;
      dataSaida?: string;
      horaSaida?: string;
    }
  ) {
    const idOperacao = operacaoId || operacao.id;
    if (!idOperacao || !podeEditarCabecalho) {
      return Promise.resolve({ ok: true as const, mensagem: "Cabeçalho sem alteração." });
    }
    setValidadaLocalmente(false);
    const automatica = extra?.numeracaoAutomatica ?? numeracaoAutomatica;
    return salvarCabecalhoFiscalOperacao({
      operacaoId: idOperacao,
      tpNf: extra?.tpNf ?? tpNf,
      serie: podeEditarNumeracao ? extra?.serie ?? serieEdit : undefined,
      numero: podeEditarNumeracao && !automatica ? extra?.numero ?? numeroEdit : undefined,
      numeracaoAutomatica: podeEditarNumeracao ? automatica : undefined,
      finNfe: extra?.finNfe ?? finNfe,
      indicadorPresenca: extra?.indicadorPresenca ?? presenca,
      indicativoIntermediador: extra?.indicativoIntermediador ?? intermediadorEdit,
      dataEmissao: extra?.dataEmissao || dataEmissao || agora.data,
      horaEmissao: extra?.horaEmissao || horaEmissao || agora.hora,
      dataSaida: extra?.dataSaida || dataSaida || agora.data,
      horaSaida: extra?.horaSaida || horaSaida || agora.hora,
      informacaoComplementarUsuario: infoUsuario,
      informacaoAdicionalFisco: infoFisco,
    });
  }

  async function persistirCabecalhoSeSujo(idOperacao?: string | null) {
    const id = idOperacao || operacao.id;
    if (!cabecalhoSujo || !id || !podeEditarCabecalho) {
      return { ok: true as const, mensagem: "Cabeçalho sem alteração." };
    }
    const resultado = await persistirCabecalhoFiscal(id);
    if (resultado.ok) {
      setCabecalhoSujo(false);
    }
    return resultado;
  }

  async function persistirRascunho(opcoes?: { preservarStatusEmissao?: boolean }) {
    const id = await garantirOperacao();
    if (!id) {
      return { ok: false as const, erro: "Não foi possível salvar o rascunho." };
    }
    if (destTipo === "cliente" && destinatarioId) {
      const dest = await salvarDestinatarioBonificacao({
        operacaoId: id,
        clienteId: destinatarioId,
      });
      if (!dest.ok) return dest;
      if (tipoPessoaEdit === "F" || tipoPessoaEdit === "J") {
        const identidade = await atualizarIdentidadeDestinatarioOperacao({
          operacaoId: id,
          clienteId: destinatarioId,
          tipoPessoa: tipoPessoaEdit,
          consumidorFinal: consumidorFinalEdit,
          origemConsumidorFinal: "operacao",
          indicadorIe: destCadastro.indicadorIe,
        });
        if (!identidade.ok) return identidade;
        const cadastro = await salvarCadastroDestinatarioOperacao({
          operacaoId: id,
          clienteId: destinatarioId,
          tipoPessoa: tipoPessoaEdit,
          ...destCadastro,
        });
        if (!cadastro.ok) return cadastro;
      }
    }
    const cabecalho = await persistirCabecalhoFiscal(id);
    if (!cabecalho.ok) return cabecalho;
    setCabecalhoSujo(false);
    const transporte = await transporteRef.current?.persistirSeNecessario();
    if (transporte && !transporte.ok) {
      return { ok: false as const, erro: transporte.erro ?? "Não foi possível salvar o transporte." };
    }
    if (podeEditarCabecalho) {
      const entregaSalva = await salvarEnderecoEntregaOperacaoFiscal({
        operacaoId: id,
        diferente: entregaDiferente,
        entrega: entregaCampos,
      });
      if (!entregaSalva.ok) {
        return entregaSalva;
      }
      const autorizadosSalvos = await salvarAutorizadosXmlOperacaoFiscal({
        operacaoId: id,
        autorizadosXml,
      });
      if (!autorizadosSalvos.ok) {
        return autorizadosSalvos;
      }
    }
    if (destTipo === "estabelecimento" && vinculoId) {
      const dest = await salvarDestinoTransferencia({
        operacaoId: id,
        vinculoId,
      });
      if (!dest.ok) return dest;
    }
    if (tipoAtual === "venda") {
      const pagamentosRascunho = pagamentosNfeParaRascunho(
        pagamentos,
        pixLocal,
        pixGeranet,
        pixConfig,
        formasPagamento
      );
      const pago = await salvarPagamentosOperacaoVenda({
        operacaoId: id,
        pagamentos: pagamentosRascunho,
        condicaoPagamento,
        fatura: temDuplicataMercantil ? fatura : null,
        preservarStatusEmissao: opcoes?.preservarStatusEmissao,
      });
      if (!pago.ok) return pago;
    }
    const totais = await salvarTotaisOperacaoFiscal({
      operacaoId: id,
      totais: totaisNota,
      totalProdutos,
      preservarStatusEmissao: opcoes?.preservarStatusEmissao,
    });
    if (!totais.ok) return totais;
    setRascunhoSujo(false);
    return {
      ok: true as const,
      mensagem: "Rascunho salvo. O estoque não foi movimentado.",
      operacaoId: id,
    };
  }

  async function validarNfe() {
    const persistido = await persistirRascunho();
    if (!persistido.ok || !persistido.operacaoId) {
      return persistido;
    }
    if (itens.length === 0) {
      return { ok: false as const, erro: "Adicione ao menos um item antes de validar." };
    }
    if (financeiro && !pagamentosNfeFechamTotal(pagamentoAvaliacao)) {
      return {
        ok: false as const,
        erro:
          pagamentoAvaliacao.restanteCentavos > 0
            ? mensagemPagamentoNfeIncompleto(pagamentoAvaliacao.restanteCentavos)
            : pagamentoAvaliacao.mensagem ?? "Pagamentos não conferem com o total da venda.",
      };
    }
    if (financeiro) {
      const erroFatura = validarFaturaParaEmissaoNfe({
        temDuplicataMercantil,
        fatura,
        totalAPrazoCentavos: coberturaDuplicataCentavos,
      });
      if (erroFatura) {
        return { ok: false as const, erro: erroFatura };
      }
    }
    if (destTipo === "cliente" && !destinatarioId) {
      return { ok: false as const, erro: "Selecione o destinatário." };
    }
    if (destTipo === "estabelecimento" && !vinculoId) {
      return { ok: false as const, erro: "Selecione o estabelecimento de destino." };
    }
    const verificada = await verificarOperacaoFiscalAction({
      operacaoId: persistido.operacaoId,
    });
    if (!verificada.ok) {
      return verificada;
    }
    return { ...verificada, operacaoId: persistido.operacaoId };
  }

  function focarPendencias() {
    requestAnimationFrame(() => {
      document.getElementById("nfe-pendencias")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function cancelarEdicao() {
    if (
      (cabecalhoSujo || rascunhoSujo) &&
      !window.confirm(MENSAGEM_SAIR_NFE_COM_ALTERACOES)
    ) {
      return;
    }
    router.push(HREF_RASCUNHOS_NFE);
  }

  function emitir() {
    if (emitindo.current || pending) return;
    if (bloqueiaRetransmissao) {
      setErro(
        "Esta emissão não pode ser reenviada. Abra a venda e reconcilie o documento fiscal."
      );
      focarPendencias();
      return;
    }
    if (vendaNovaSemCaixa) {
      setErro(MENSAGEM_CAIXA_FECHADO_NFE_VENDA);
      focarPendencias();
      return;
    }
    if (pagamentoImpedeEmissao) {
      setErro(
        mensagemPagamentoDesalinhado ?? "Pagamentos não conferem com o total da venda."
      );
      focarPendencias();
      return;
    }
    if (nfeAutorizada || !edicaoDocumento.permitido) {
      setErro("Esta NF-e não pode mais ser alterada nem reemitida por esta tela.");
      focarPendencias();
      return;
    }
    if (!podeEmitir) {
      setErro(
        exigeCaixaVendaNova && !caixaAbertoEfetivo
          ? MENSAGEM_CAIXA_FECHADO_NFE_VENDA
          : "Informe a natureza da operação antes de emitir."
      );
      focarPendencias();
      return;
    }
    emitindo.current = true;
    setErro(null);
    setSucesso(null);
    setPendencias([]);
    startTransition(async () => {
      const validada = await validarNfe();
      if (!validada.ok || !validada.operacaoId) {
        setErro(
          validada.ok ? "Rascunho sem identificador." : validada.erro
        );
        setPendencias(validada.ok ? [] : validada.pendencias ?? []);
        setValidadaLocalmenteState(false);
        emitindo.current = false;
        focarPendencias();
        router.refresh();
        return;
      }
      setValidadaLocalmenteState(true);
      setRascunhoSujo(false);
      if (tipoAtual === "venda") {
        const preparada = await prepararVendaParaEmissaoNfe({
          operacaoId: validada.operacaoId,
        });
        if (!preparada.ok || !preparada.vendaId) {
          setErro(preparada.ok ? "Venda comercial sem identificador." : preparada.erro);
          emitindo.current = false;
          router.refresh();
          return;
        }
        if (
          ambienteFiscal === "1" &&
          !window.confirm(
            "ATENÇÃO: emitir esta NF-e em PRODUÇÃO?\n\nEste documento terá validade fiscal real e consumirá numeração de produção."
          )
        ) {
          emitindo.current = false;
          return;
        }
        const rota = "/api/fiscal/geranet/nfe-emitir-venda";
        const confirmar =
          ambienteFiscal === "1"
            ? "EMITIR_NFE55_VENDA_PRODUCAO"
            : "EMITIR_NFE55_VENDA_HOMOLOGACAO";
        const resposta = await fetch(rota, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": preparada.vendaId,
          },
          body: JSON.stringify({
            confirmar,
            venda_id: preparada.vendaId,
          }),
        });
        const dados = await resposta.json().catch(() => ({}));
        const destino = resolverDestinoAposEmissaoVenda({
          vendaId: preparada.vendaId,
          ok: dados.ok,
          autorizada: dados.autorizada,
          status: dados.status,
          classificacao: dados.classificacao,
          geranet: dados.geranet,
          requer_reconciliacao: dados.requer_reconciliacao,
          podeRetransmitir: dados.podeRetransmitir,
        });
        if (destino) {
          router.push(destino.href);
          return;
        }
        const resultado = interpretarRespostaEmissaoVenda(dados);
        setErro(
          resultado.mensagem || "Falha ao emitir a NF-e da venda."
        );
        setPendencias(Array.isArray(dados.pendencias) ? dados.pendencias : []);
        emitindo.current = false;
        focarPendencias();
        router.refresh();
        return;
      }
      const resposta = await fetch("/api/fiscal/geranet/nfe-emitir-operacao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": validada.operacaoId,
        },
        body: JSON.stringify({ operacao_id: validada.operacaoId }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok || dados.ok === false) {
        setErro(String(dados.erro ?? "Falha ao emitir a NF-e."));
        setPendencias(Array.isArray(dados.pendencias) ? dados.pendencias : []);
        emitindo.current = false;
        focarPendencias();
        router.refresh();
        return;
      }
      setSucesso(
        String(dados.mensagem ?? "NF-e autorizada. O estoque ainda não foi movimentado.")
      );
      emitindo.current = false;
      router.refresh();
    });
  }

  useEffect(() => {
    if (operacaoPodeEmitir(operacao.status)) {
      setValidadaLocalmente(true);
    }
  }, [operacao.status]);

  useEffect(() => {
    setNaturezaId(operacao.naturezaId ?? "");
    setDestinatarioId(operacao.destinatarioId ?? "");
    setVinculoId(operacao.vinculoId ?? "");
    setFinNfe(operacao.finNfe || "1");
    setPresenca(indicadorPresenca);
    setDataSaida(operacao.dataSaida ?? "");
    setHoraSaida(operacao.horaSaida ?? "");
    if (!cabecalhoSujo) {
      setInfoUsuario(operacao.informacaoComplementarUsuario ?? "");
      setInfoFisco(operacao.informacaoAdicionalFisco ?? "");
      setCabecalhoSujo(false);
    }
  }, [
    operacao.id,
    operacao.naturezaId,
    operacao.destinatarioId,
    operacao.vinculoId,
    operacao.informacaoComplementarUsuario,
    operacao.informacaoAdicionalFisco,
    operacao.finNfe,
    operacao.dataSaida,
    operacao.horaSaida,
    indicadorPresenca,
  ]);

  useEffect(() => {
    setTipoPessoaEdit(destinatario?.tipoPessoa === "J" ? "J" : destinatario?.tipoPessoa === "F" ? "F" : "");
    if (destinatarioIdAnterior.current !== destinatarioId) {
      destinatarioIdAnterior.current = destinatarioId;
      const resolvido = resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: tipoAtual,
        origemVenda: operacao.vendaId ? "pdv" : "nfe_manual",
        snapshotOperacao:
          destinatarioId === operacao.destinatarioId
            ? {
                consumidor_final: operacao.consumidorFinalSnapshot,
                consumidor_final_origem: operacao.consumidorFinalOrigem,
                indicador_ie_destinatario: operacao.indicadorIeSnapshot,
              }
            : null,
        contribuinteIcms: destinatario?.contribuinteIcms,
        indicadorIeCadastro: destinatario?.indicadorIe,
        consumidorFinalCadastro: destinatario?.consumidorFinal,
      });
      setConsumidorFinalOrigem(
        operacao.consumidorFinalSnapshot != null && destinatarioId === operacao.destinatarioId
          ? "operacao"
          : "cadastro"
      );
      setConsumidorFinalEdit(resolvido.consumidorFinal === "1");
      return;
    }
    if (
      consumidorFinalOrigem === "operacao" ||
      consumidorFinalOrigem === "manual" ||
      consumidorFinalOrigem === "origem_pdv" ||
      operacao.consumidorFinalSnapshot != null
    ) {
      return;
    }
    setConsumidorFinalEdit(
      resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: tipoAtual,
        origemVenda: operacao.vendaId ? "pdv" : "nfe_manual",
        contribuinteIcms: destinatario?.contribuinteIcms,
        indicadorIeCadastro: destinatario?.indicadorIe,
        consumidorFinalCadastro: destinatario?.consumidorFinal,
      }).consumidorFinal === "1"
    );
  }, [
    destinatarioId,
    destinatario?.tipoPessoa,
    destinatario?.consumidorFinal,
    destinatario?.contribuinteIcms,
    destinatario?.indicadorIe,
    consumidorFinalOrigem,
    operacao.consumidorFinalSnapshot,
    operacao.consumidorFinalOrigem,
    operacao.destinatarioId,
    operacao.indicadorIeSnapshot,
    operacao.vendaId,
    tipoAtual,
  ]);

  useEffect(() => {
    if (!destinatarioId) {
      destCadastroSincronizadoId.current = "";
      setDestCadastro(cadastroDestinatarioVazio());
      return;
    }
    if (!destinatario || destCadastroSincronizadoId.current === destinatario.id) {
      return;
    }
    destCadastroSincronizadoId.current = destinatario.id;
    setDestCadastro(cadastroDestinatarioDoCliente(destinatario));
  }, [destinatarioId, destinatario]);

  useEffect(() => {
    if (buscaProdutoTimer.current) {
      window.clearTimeout(buscaProdutoTimer.current);
    }
    if (buscaProduto.trim().length < 2) {
      setProdutos([]);
      return;
    }
    buscaProdutoTimer.current = window.setTimeout(() => {
      startTransition(async () => {
        const resultado = await buscarProdutosOperacaoFiscal({ busca: buscaProduto });
        if (resultado.ok) {
          setProdutos(resultado.produtos);
        }
      });
    }, 250);
  }, [buscaProduto]);

  useEffect(() => {
    if (buscaClienteTimer.current) {
      window.clearTimeout(buscaClienteTimer.current);
    }
    if (buscaCliente.trim().length < 2) {
      setClientesBusca([]);
      return;
    }
    buscaClienteTimer.current = window.setTimeout(() => {
      startTransition(async () => {
        const resultado = await buscarClientesOperacaoFiscal({ busca: buscaCliente });
        if (resultado.ok) {
          setClientesBusca(resultado.clientes);
        }
      });
    }, 250);
  }, [buscaCliente]);

  const avisoNatureza = natureza ? avisoNaturezaNestaTela(tipoAtual) : null;
  const podeSalvarRascunho = emitivel && Boolean(naturezaId) && !vendaNovaSemCaixa;
  const financeiro = naturezaExigeFinanceiro({
    codigo: tipoAtual,
    vincula_venda: tipoCatalogo?.vinculaVenda,
  });
  const pagamentoImpedeEmissao =
    financeiro &&
    Boolean(podeEditar) &&
    !pagamentosNfeFechamTotal(pagamentoAvaliacao);
  const mensagemPagamentoDesalinhado = pagamentoImpedeEmissao
    ? pagamentoAvaliacao.restanteCentavos > 0
      ? mensagemPagamentoNfeIncompleto(pagamentoAvaliacao.restanteCentavos)
      : pagamentoAvaliacao.mensagem
    : null;

  return (
    <div
      className="nfe-form"
      data-nfe-exige-caixa={exigeCaixaVendaNova ? "true" : "false"}
      data-nfe-caixa-bloqueado={vendaNovaSemCaixa ? "true" : "false"}
    >
      <div className="sticky top-14 z-[15] -mx-4 mb-2 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur-sm lg:top-12">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {exigeCaixaVendaNova && caixaAbertoEfetivo ? (
            <span
              className="self-start text-xs font-medium text-emerald-700 sm:mr-auto sm:self-center"
              data-nfe-caixa-aberto="true"
            >
              Caixa aberto
            </span>
          ) : (
            <span className="hidden sm:mr-auto sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={pending}
              onClick={cancelarEdicao}
            >
              Cancelar
            </button>
            {nfeAutorizada || !edicaoDocumento.permitido ? null : (
              <>
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  disabled={pending || !podeSalvarRascunho}
                  onClick={() => executar(persistirRascunho, "rascunhos")}
                >
                  Salvar como rascunho
                </button>
                <button
                  type="button"
                  className={
                    vendaNovaSemCaixa || !podeEmitir
                      ? "updv-btn updv-btn-primary opacity-50 cursor-not-allowed"
                      : "updv-btn updv-btn-primary"
                  }
                  disabled={pending || !podeEmitir || vendaNovaSemCaixa}
                  title={
                    vendaNovaSemCaixa
                      ? MENSAGEM_CAIXA_FECHADO_NFE_VENDA
                      : pagamentoImpedeEmissao
                        ? mensagemPagamentoDesalinhado ?? undefined
                        : undefined
                  }
                  onClick={emitir}
                >
                  Emitir
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {documentoAmbiguo ? (
        <div id="nfe-pendencias" className="nfe-alerta">
          <p className="font-semibold">NF-e aguardando reconciliação</p>
          <p>
            {edicaoDocumento.motivo ?? MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO}
          </p>
        </div>
      ) : nfeNaoAutorizadaConfirmada ? (
        <div id="nfe-pendencias" className="nfe-alerta">
          <p className="font-semibold">NF-e não autorizada</p>
          <p>
            {emissao?.motivo ||
              estadoEmissao?.descricao ||
              "A SEFAZ ou a Geranet recusou esta tentativa. Corrija os dados e emita novamente."}
          </p>
          {edicaoDocumento.permitido ? (
            <p className="mt-1">
              Os campos voltaram a ficar editáveis. Corrija os dados e clique em
              Emitir para tentar novamente.
            </p>
          ) : null}
          {erro && erro !== emissao?.motivo ? <p className="mt-1">{erro}</p> : null}
          {pendencias.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {pendencias.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : erro ? (
        <div id="nfe-pendencias" className="nfe-alerta">
          {erro}
          {pendencias.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {pendencias.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {sucesso ? <div className="nfe-ok">{sucesso}</div> : null}
      {!erro && avisoNatureza ? (
        <div className={avisoNatureza.tom === "info" ? "nfe-aviso" : "nfe-alerta"}>
          {avisoNatureza.texto}
        </div>
      ) : null}

      {vendaNovaSemCaixa ? (
        <PdvCaixaFechado
          variante="overlay"
          podeAbrir={podeAbrirCaixa}
          rotuloContexto="Venda bloqueada"
          mensagem={MENSAGEM_CAIXA_FECHADO_NFE_VENDA}
          rotuloSair="Voltar"
          onSair={() => router.push("/fiscal")}
          onAberto={() => {
            setCaixaLiberadoLocal(true);
            if (!naturezaId) {
              return;
            }
            if (operacao.id) {
              executar(() =>
                salvarNaturezaOperacaoFiscal({
                  operacaoId: operacao.id as string,
                  naturezaId,
                })
              );
              return;
            }
            executar(() => criarOperacaoFiscal({ naturezaId }));
          }}
        />
      ) : null}

      {caixaAbertoEfetivo && caixaReabertoAviso ? (
        <CaixaAvisoReabertoFaixa aviso={caixaReabertoAviso} />
      ) : null}

      <NfeSecao titulo="Dados da nota">
        <div className="nfe-grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          <NfeCampo label="Tipo de saída">
            <select
              className={nfeSelect}
              value={tpNf || natureza?.tpNf || operacao.tpNf || "1"}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                const valor = event.target.value;
                setTpNf(valor);
                setValidadaLocalmente(false);
                setCabecalhoSujo(false);
                if (operacao.id) {
                  executar(() => persistirCabecalhoFiscal(operacao.id, { tpNf: valor }));
                }
              }}
            >
              {(Object.keys(ROTULOS_TP_NF) as TpNf[]).map((codigo) => (
                <option key={codigo} value={codigo}>
                  {ROTULOS_TP_NF[codigo]}
                </option>
              ))}
            </select>
          </NfeCampo>
          <NfeCampo
            label="Série"
            ajuda={
              podeEditarNumeracao
                ? "Série NF-e 55 da empresa ativa no ambiente atual. Não reserva número ao escolher."
                : "Imutável depois da reserva ou do início da transmissão."
            }
          >
            {podeEditarNumeracao && seriesNfe.length > 0 ? (
              <select
                className={nfeSelect}
                value={serieEdit}
                onChange={(event) => {
                  const valor = event.target.value;
                  const escolhida = seriesNfe.find((item) => String(item.serie) === valor);
                  setSerieEdit(valor);
                  if (numeracaoAutomatica && escolhida) {
                    setNumeroEdit(String(escolhida.proximoNumero));
                  }
                  setValidadaLocalmente(false);
                  setCabecalhoSujo(false);
                  if (operacao.id) {
                    executar(() =>
                      persistirCabecalhoFiscal(operacao.id, {
                        serie: valor,
                        numero: numeracaoAutomatica
                          ? undefined
                          : numeroEdit,
                        numeracaoAutomatica,
                      })
                    );
                  }
                }}
              >
                {seriesNfe.map((item) => (
                  <option key={item.serie} value={String(item.serie)}>
                    {item.serie}
                  </option>
                ))}
              </select>
            ) : (
              <input className={nfeSomenteLeitura} readOnly value={serieExibida || "—"} />
            )}
          </NfeCampo>
          <NfeCampo
            label="Número"
            ajuda={
              !podeEditarNumeracao
                ? "Imutável depois da reserva ou do início da transmissão."
                : numeracaoAutomatica
                  ? "Sugestão do próximo número desta série. A reserva real ocorre somente na transmissão."
                  : "Informe um número livre desta série. Não é reservado ao salvar o rascunho."
            }
          >
            <input
              className={!podeEditarNumeracao ? nfeSomenteLeitura : nfeInput}
              inputMode="numeric"
              readOnly={!podeEditarNumeracao || numeracaoAutomatica}
              value={
                numeracaoAutomatica
                  ? numeroExibido
                    ? `${numeroExibido} (previsto)`
                    : "Automático na emissão"
                  : numeroEdit
              }
              onChange={(event) => {
                setNumeroEdit(event.target.value.replace(/\D/g, ""));
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
              onBlur={() => {
                if (podeEditarNumeracao && operacao.id && !numeracaoAutomatica) {
                  executar(persistirCabecalhoFiscal);
                  setCabecalhoSujo(false);
                }
              }}
            />
            {podeEditarNumeracao ? (
              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
                <input
                  type="checkbox"
                  checked={numeracaoAutomatica}
                  onChange={(event) => {
                    const automatica = event.target.checked;
                    const numeroManual =
                      !automatica
                        ? numeroEdit ||
                          (serieSelecionada
                            ? String(serieSelecionada.proximoNumero)
                            : numeroPrevisto)
                        : undefined;
                    setNumeracaoAutomatica(automatica);
                    if (automatica && serieSelecionada) {
                      setNumeroEdit(String(serieSelecionada.proximoNumero));
                    } else if (!automatica && numeroManual) {
                      setNumeroEdit(numeroManual);
                    }
                    setValidadaLocalmente(false);
                    setCabecalhoSujo(false);
                    if (operacao.id) {
                      executar(() =>
                        persistirCabecalhoFiscal(operacao.id, {
                          numeracaoAutomatica: automatica,
                          numero: automatica ? undefined : numeroManual,
                        })
                      );
                    }
                  }}
                />
                Numeração automática
              </label>
            ) : null}
          </NfeCampo>
          <NfeCampo
            label="Emitente"
            ajuda={
              operacao.vendaId
                ? "Empresa ativa da venda. Não há cadastro de filial neste schema."
                : "Empresa emitente ativa. Não há cadastro de filial neste schema."
            }
          >
            <input
              className={nfeSomenteLeitura}
              readOnly
              value={
                emitenteCnpj
                  ? `${origemNome} · ${emitenteCnpj}`
                  : origemNome || "Empresa ativa"
              }
            />
          </NfeCampo>
          <NfeCampo label="Natureza da operação" className="md:col-span-2 xl:col-span-2">
            <div className="relative">
              <input
                className={podeTrocarNatureza ? nfeInput : nfeSomenteLeitura}
                placeholder="Pesquisar natureza cadastrada da empresa"
                value={buscaNatureza || natureza?.descricao || ""}
                disabled={!podeTrocarNatureza}
                onFocus={() => setNaturezasAbertas(true)}
                onBlur={() => window.setTimeout(() => setNaturezasAbertas(false), 150)}
                onChange={(event) => {
                  setBuscaNatureza(event.target.value);
                  setNaturezasAbertas(true);
                }}
              />
              {naturezasAbertas && podeTrocarNatureza ? (
                <div className="nfe-sugestoes">
                  {naturezasFiltradas.length === 0 ? (
                    <div className="nfe-sugestao text-zinc-500">Nenhuma natureza encontrada</div>
                  ) : (
                    naturezasFiltradas.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="nfe-sugestao"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setBuscaNatureza("");
                          setNaturezasAbertas(false);
                          mudarNatureza(item.id);
                        }}
                      >
                        {item.descricao}
                        {ehCodigoTipoOperacaoInterno(item.tipoOperacaoInterno)
                          ? ` · ${ROTULOS_TIPO_OPERACAO[item.tipoOperacaoInterno]}`
                          : ""}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </NfeCampo>
          <NfeCampo
            label="Data de emissão"
            ajuda="Não é a data de saída da mercadoria. Sem valor manual, a transmissão usa o horário atual."
          >
            <input
              className={nfeInput}
              type="date"
              value={dataEmissao || agora.data}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setDataEmissao(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
              onBlur={() => {
                if (podeEditarCabecalho && operacao.id) {
                  executar(persistirCabecalhoFiscal);
                  setCabecalhoSujo(false);
                }
              }}
            />
          </NfeCampo>
          <NfeCampo label="Hora de emissão" ajuda="Persistida no snapshot fiscal desta NF-e.">
            <input
              className={nfeInput}
              type="time"
              value={horaEmissao || agora.hora}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setHoraEmissao(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
              onBlur={() => {
                if (podeEditarCabecalho && operacao.id) {
                  executar(persistirCabecalhoFiscal);
                  setCabecalhoSujo(false);
                }
              }}
            />
          </NfeCampo>
          <NfeCampo label="Data de saída" ajuda="Independente da data de emissão.">
            <input
              className={nfeInput}
              type="date"
              value={dataSaida || agora.data}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setDataSaida(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
              onBlur={() => {
                if (podeEditarCabecalho && operacao.id) {
                  executar(persistirCabecalhoFiscal);
                  setCabecalhoSujo(false);
                }
              }}
            />
          </NfeCampo>
          <NfeCampo label="Hora de saída">
            <input
              className={nfeInput}
              type="time"
              value={horaSaida || agora.hora}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setHoraSaida(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
              onBlur={() => {
                if (podeEditarCabecalho && operacao.id) {
                  executar(persistirCabecalhoFiscal);
                  setCabecalhoSujo(false);
                }
              }}
            />
          </NfeCampo>
          <NfeCampo
            label="Regime tributário"
            ajuda="Definido pela empresa emitente."
          >
            <input
              className={nfeSomenteLeitura}
              readOnly
              value={CRT.find(([valor]) => valor === regimeTributario)?.[1] ?? regimeTributario}
            />
          </NfeCampo>
          <NfeCampo label="Finalidade">
            <select
              className={nfeSelect}
              value={finNfe || natureza?.finNfe || operacao.finNfe || "1"}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                const valor = event.target.value;
                setFinNfe(valor);
                setValidadaLocalmente(false);
                setCabecalhoSujo(false);
                if (operacao.id) {
                  executar(() => persistirCabecalhoFiscal(operacao.id, { finNfe: valor }));
                }
              }}
            >
              {(["1", "2", "3", "4"] as FinNfeSuportada[]).map((codigo) => (
                <option key={codigo} value={codigo}>
                  {ROTULOS_FIN_NFE[codigo]}
                </option>
              ))}
            </select>
          </NfeCampo>
          <NfeCampo label="Indicador de presença">
            <select
              className={nfeSelect}
              value={presenca}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                const valor = event.target.value;
                setPresenca(valor);
                setValidadaLocalmente(false);
                setCabecalhoSujo(false);
                if (operacao.id) {
                  executar(() =>
                    persistirCabecalhoFiscal(operacao.id, { indicadorPresenca: valor })
                  );
                }
              }}
            >
              {PRESENCA.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </NfeCampo>
          <NfeCampo
            label="Intermediador"
            ajuda="Default da empresa: 0 — Sem intermediador. Pode ser alterado nesta NF-e enquanto for rascunho."
          >
            <select
              className={nfeSelect}
              value={intermediadorEdit}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                const valor = event.target.value;
                setIntermediadorEdit(valor);
                setValidadaLocalmente(false);
                setCabecalhoSujo(false);
                if (operacao.id) {
                  executar(() =>
                    persistirCabecalhoFiscal(operacao.id, {
                      indicativoIntermediador: valor,
                    })
                  );
                }
              }}
            >
              {INTERMEDIADOR.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </NfeCampo>
          <NfeCampo label="Situação" ajuda="Controlada pelo lifecycle fiscal.">
            <input
              className={nfeSomenteLeitura}
              readOnly
              value={
                operacao.id
                  ? rotuloStatusOperacaoFiscal(operacao.status)
                  : "Novo rascunho"
              }
            />
          </NfeCampo>
          <NfeCampo label="Modelo" ajuda="NF-e modelo 55.">
            <input className={nfeSomenteLeitura} readOnly value="55 — NF-e" />
          </NfeCampo>
        </div>
        {!edicaoDocumento.permitido && edicaoDocumento.motivo ? (
          <p className="mt-2 text-[11px] text-zinc-500">{edicaoDocumento.motivo}</p>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500">
            A natureza escolhida define o tipo desta nota. Itens, preços e pagamentos da
            venda permanecem no PDV. Esta tela emite NF-e modelo 55.
          </p>
        )}
      </NfeSecao>

      <NfeSecao titulo="Destinatário">
        {destTipo === "estabelecimento" ? (
          <div className="nfe-grid grid-cols-1 md:grid-cols-3">
            <NfeCampo label="Estabelecimento de destino" className="md:col-span-2">
              <select
                className={nfeSelect}
                value={vinculoId}
                disabled={!podeEditar}
                onChange={(event) => setVinculoId(event.target.value)}
              >
                <option value="">Selecione um estabelecimento vinculado</option>
                {destinos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nome} · {item.cnpj}
                  </option>
                ))}
              </select>
            </NfeCampo>
            {podeEditar && operacao.id ? (
              <div className="flex items-end">
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  disabled={pending || !vinculoId}
                  onClick={() =>
                    executar(() =>
                      salvarDestinoTransferencia({
                        operacaoId: operacao.id as string,
                        vinculoId,
                      })
                    )
                  }
                >
                  Salvar destino
                </button>
              </div>
            ) : null}
            {estabelecimentosParaVincular.length > 0 && podeEditar ? (
              <>
                <NfeCampo label="Vincular outro estabelecimento com acesso">
                  <select
                    className={nfeSelect}
                    value={empresaVincular}
                    onChange={(event) => setEmpresaVincular(event.target.value)}
                  >
                    <option value="">Selecione</option>
                    {estabelecimentosParaVincular.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nome} · {item.cnpj}
                      </option>
                    ))}
                  </select>
                </NfeCampo>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={pending || !empresaVincular}
                    onClick={() =>
                      executar(() =>
                        vincularEstabelecimentoTransferencia({
                          empresaDestinoId: empresaVincular,
                        })
                      )
                    }
                  >
                    Vincular destino
                  </button>
                </div>
              </>
            ) : null}
            <NfeCampo label="CNPJ">
              <input className={nfeInput} readOnly value={destino?.cnpj ?? ""} />
            </NfeCampo>
          </div>
        ) : (
          <>
            <div className="nfe-grid grid-cols-1 md:grid-cols-3">
            <div className="relative md:col-span-2">
              <NfeCampo label="Destinatário">
                <input
                  className={nfeInput}
                  placeholder="Pesquisar nome ou CPF/CNPJ"
                  value={buscaCliente || destCadastro.nome || destinatario?.nome || ""}
                  disabled={!podeEditarCabecalho}
                  onChange={(event) => {
                    const valor = event.target.value;
                    setBuscaCliente(valor);
                    if (destinatarioId) {
                      setDestCadastro((atual) => ({ ...atual, nome: valor }));
                    }
                    if (!valor) {
                      setDestinatarioId("");
                    }
                  }}
                />
              </NfeCampo>
              {clientesBusca.length > 0 ? (
                <div className="nfe-sugestoes">
                  {clientesBusca.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="nfe-sugestao"
                      onClick={() => {
                        setDestinatarioId(item.id);
                        setTipoPessoaEdit(
                          item.tipoPessoa === "J" ? "J" : item.tipoPessoa === "F" ? "F" : ""
                        );
                        const consumidorFinal =
                          resolverDestinatarioFiscalDaOrigem({
                            modelo: "55",
                            tipoOperacaoInterno: tipoAtual,
                            origemVenda: "nfe_manual",
                            contribuinteIcms: item.contribuinteIcms,
                            indicadorIeCadastro: item.indicadorIe,
                            consumidorFinalCadastro: item.consumidorFinal,
                          }).consumidorFinal === "1";
                        setConsumidorFinalOrigem("operacao");
                        setConsumidorFinalEdit(consumidorFinal);
                        destCadastroSincronizadoId.current = item.id;
                        setDestCadastro(cadastroDestinatarioDoCliente(item));
                        setBuscaCliente("");
                        setClientesBusca([]);
                        if (operacao.id) {
                          executar(async () => {
                            const dest = await salvarDestinatarioBonificacao({
                              operacaoId: operacao.id as string,
                              clienteId: item.id,
                            });
                            if (!dest.ok) return dest;
                            if (item.tipoPessoa !== "F" && item.tipoPessoa !== "J") {
                              return dest;
                            }
                            return atualizarIdentidadeDestinatarioOperacao({
                              operacaoId: operacao.id as string,
                              clienteId: item.id,
                              tipoPessoa: item.tipoPessoa === "J" ? "J" : "F",
                              consumidorFinal,
                              origemConsumidorFinal: "operacao",
                              indicadorIe: item.indicadorIe,
                            });
                          });
                        }
                      }}
                    >
                      {item.nome} · {item.cpfCnpj}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
              <NfeCampo label="Tipo de pessoa">
                <select
                  className={nfeSelect}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={tipoPessoaEdit}
                  onChange={(event) => {
                    const tipo = event.target.value === "J" ? "J" : "F";
                    setTipoPessoaEdit(tipo);
                    if (!operacao.id || !destinatarioId) return;
                    executar(() =>
                      atualizarIdentidadeDestinatarioOperacao({
                        operacaoId: operacao.id as string,
                        clienteId: destinatarioId,
                        tipoPessoa: tipo,
                        consumidorFinal: consumidorFinalEdit,
                        origemConsumidorFinal: "operacao",
                        indicadorIe: destCadastro.indicadorIe,
                      })
                    );
                  }}
                >
                  <option value="">Selecione</option>
                  <option value="F">Pessoa física</option>
                  <option value="J">Pessoa jurídica</option>
                </select>
              </NfeCampo>
              <NfeCampo label="Nome fantasia">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.nomeFantasia}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      nomeFantasia: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label={tipoPessoaEdit === "J" ? "CNPJ" : tipoPessoaEdit === "F" ? "CPF" : "CPF/CNPJ"}>
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.cpfCnpj}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      cpfCnpj: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Inscrição estadual">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.inscricaoEstadual}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      inscricaoEstadual: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Indicador IE">
                <select
                  className={nfeSelect}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.indicadorIe}
                  onChange={(event) => {
                    const indicador = normalizarIndicadorIeDestinatario(
                      event.target.value,
                      destCadastro.contribuinteIcms
                    );
                    setDestCadastro((atual) => ({
                      ...atual,
                      indicadorIe: indicador,
                      contribuinteIcms: indicador === "1",
                    }));
                  }}
                >
                  <option value="1">Contribuinte</option>
                  <option value="2">Isento</option>
                  <option value="9">Não contribuinte</option>
                </select>
              </NfeCampo>
              <NfeCampo label="CEP">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.cep}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  onChange={(event) => {
                    const valor = event.target.value;
                    setDestCadastro((atual) => ({ ...atual, cep: valor }));
                    if (podeEditarIdentidadeDestinatario) {
                      buscaCepDestinatario.aoAlterarCep(valor);
                    }
                  }}
                  onBlur={(event) => {
                    if (podeEditarIdentidadeDestinatario) {
                      buscaCepDestinatario.aoSairCep(event.target.value);
                    }
                  }}
                />
                {buscaCepDestinatario.carregando ? (
                  <span className="nfe-campo-ajuda">Consultando CEP…</span>
                ) : buscaCepDestinatario.aviso ? (
                  <span className="mt-1 block text-[11px] text-amber-700">
                    {buscaCepDestinatario.aviso}
                  </span>
                ) : null}
              </NfeCampo>
              <NfeCampo label="UF">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.uf}
                  maxLength={2}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      uf: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Município">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.municipio}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      municipio: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Código IBGE">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.codigoMunicipioIbge}
                  maxLength={7}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      codigoMunicipioIbge: event.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Bairro">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.bairro}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      bairro: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Endereço" className="md:col-span-2">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.logradouro}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      logradouro: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Número">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.numero}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      numero: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Complemento">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.complemento}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      complemento: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="Fone">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.telefone}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      telefone: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
              <NfeCampo label="E-mail">
                <input
                  className={nfeInput}
                  disabled={!podeEditarIdentidadeDestinatario}
                  value={destCadastro.email}
                  onChange={(event) =>
                    setDestCadastro((atual) => ({
                      ...atual,
                      email: event.target.value,
                    }))
                  }
                />
              </NfeCampo>
            </div>
            {destinatarioId ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                Dados incompletos podem ser preenchidos aqui e são gravados no
                cadastro do cliente ao salvar, validar ou emitir.
              </p>
            ) : null}
          </>
        )}
      </NfeSecao>

      {destTipo === "cliente" ? (
        <NfeSecao titulo="Informações fiscais da operação">
          <div className="nfe-campo">
            <span className="nfe-label">Consumidor final desta operação</span>
            <label className="flex min-h-8 items-center gap-2 text-[12.5px] text-zinc-800">
              <input
                type="checkbox"
                disabled={!podeEditarIdentidadeDestinatario}
                checked={consumidorFinalEdit}
                onChange={(event) => {
                  const marcado = event.target.checked;
                  setConsumidorFinalOrigem("operacao");
                  setConsumidorFinalEdit(marcado);
                  if (!operacao.id || !destinatarioId) return;
                  if (tipoPessoaEdit !== "F" && tipoPessoaEdit !== "J") {
                    setErro("Selecione o tipo de pessoa antes de marcar consumidor final.");
                    return;
                  }
                  executar(() =>
                    atualizarIdentidadeDestinatarioOperacao({
                      operacaoId: operacao.id as string,
                      clienteId: destinatarioId,
                      tipoPessoa: tipoPessoaEdit,
                      consumidorFinal: marcado,
                      origemConsumidorFinal: "operacao",
                      indicadorIe: destCadastro.indicadorIe,
                    })
                  );
                }}
              />
              Consumidor final desta operação
            </label>
            <p className="mt-1 text-[11px] text-zinc-500">
              Define se esta operação é destinada ao consumo/uso final.
              Essa informação pertence à NF-e e pode ser diferente da situação
              do destinatário perante o ICMS.
            </p>
          </div>
        </NfeSecao>
      ) : null}

      <div className="nfe-bloco-card">
      <NfeSecao
        titulo="Itens da nota fiscal"
        extra={
          podeEditar ? (
            <button
              type="button"
              className="text-[12px] font-medium text-blue-700"
              onClick={() => document.getElementById("nfe-busca-produto")?.focus()}
            >
              + Adicionar outro item
            </button>
          ) : null
        }
      >
        {podeEditar ? (
          <div className="nfe-itens-toolbar">
            <div className="nfe-busca-item">
            <input
              id="nfe-busca-produto"
              className={nfeInput}
              placeholder="Pesquisar produto da empresa ativa: nome, código ou código de barras"
              value={buscaProduto}
              onChange={(event) => setBuscaProduto(event.target.value)}
              autoComplete="off"
            />
            {produtos.length > 0 ? (
              <div className="nfe-sugestoes nfe-sugestoes-produtos" role="listbox">
                {produtos.map((produto) => (
                  <button
                    key={produto.id}
                    type="button"
                    className="nfe-sugestao"
                    onClick={() => {
                      startTransition(async () => {
                        const persistidoCabecalho = await persistirCabecalhoSeSujo();
                        if (!persistidoCabecalho.ok) {
                          setErro(persistidoCabecalho.erro);
                          return;
                        }
                        const id = operacao.id ?? (await garantirOperacao());
                        if (!id) return;
                        const resultado = await adicionarItemOperacaoFiscal({
                          operacaoId: id,
                          produtoId: produto.id,
                          quantidade: 1,
                          valorUnitario: produto.preco,
                        });
                        if (!resultado.ok) {
                          setErro(resultado.erro);
                          return;
                        }
                        setBuscaProduto("");
                        setProdutos([]);
                        if (!operacao.id) {
                          router.replace(hrefEdicaoOperacaoFiscal(id));
                          return;
                        }
                        router.refresh();
                      });
                    }}
                  >
                    <span className="nfe-sugestao-titulo">{produto.nome}</span>
                    <span className="nfe-sugestao-meta">
                      {produto.codigo || "sem código"} · {produto.unidade} · Estoque:{" "}
                      {produto.estoque}
                      {produto.ncm ? ` · NCM ${produto.ncm}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : buscaProduto.trim().length >= 2 && !pending ? (
              <p className="mt-1 text-[12px] text-zinc-500">
                Nenhum produto da empresa ativa encontrado para “{buscaProduto.trim()}”.
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-zinc-500">
                Produtos ativos da empresa ativa, inclusive com estoque zero ou negativo.
                Estoque é informativo e não impede a inclusão. O estoque não é movimentado ao incluir.
                {tipoAtual === "venda"
                  ? " Na emissão, o PDV usa o preço de venda do catálogo — o valor fiscal do item não vai para o caixa."
                  : ""}
              </p>
            )}
            </div>
          </div>
        ) : null}
        <div className="nfe-itens-wrap">
          <table className="nfe-itens min-w-[980px]">
            <thead>
              <tr>
                <th>Produto ou serviço</th>
                <th>Código</th>
                <th>UN</th>
                <th className="num">Qtde</th>
                <th className="num">Preço un</th>
                <th className="num">Preço total</th>
                <th>NCM</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <ItemLinha
                  key={item.id}
                  item={item}
                  aberto={itemAberto === item.id}
                  podeEditar={Boolean(podeEditar && operacao.id)}
                  pending={pending}
                  onAbrir={() =>
                    setItemAberto((atual) => (atual === item.id ? null : item.id))
                  }
                  onExcluir={() =>
                    executar(() =>
                      removerItemOperacaoFiscal({
                        operacaoId: operacao.id as string,
                        itemId: item.id,
                      })
                    )
                  }
                  onAlterarLocal={(quantidade, valorUnitario) =>
                    setAjusteItens((atual) => ({
                      ...atual,
                      [item.id]: { quantidade, valorUnitario },
                    }))
                  }
                  onAtualizar={(quantidade, valorUnitario) => {
                    const persistido = itens.find((linha) => linha.id === item.id);
                    if (
                      persistido &&
                      persistido.quantidade === quantidade &&
                      persistido.valorUnitario === valorUnitario
                    ) {
                      return;
                    }
                    setAjusteItens((atual) => ({
                      ...atual,
                      [item.id]: { quantidade, valorUnitario },
                    }));
                    executar(() =>
                      atualizarItemOperacaoFiscal({
                        operacaoId: operacao.id as string,
                        itemId: item.id,
                        quantidade,
                        valorUnitario,
                      })
                    );
                  }}
                />
              ))}
              {itensExibidos.length === 0 && !podeEditar ? (
                <tr>
                  <td colSpan={8} className="text-zinc-500">
                    Nenhum item.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </NfeSecao>

      <NfeSecao
        titulo="Cálculo de imposto"
        extra={
          <button
            type="button"
            className="text-[12px] font-medium text-blue-700"
            onClick={() => setMostrarMaisTotais((valor) => !valor)}
          >
            {mostrarMaisTotais ? "Ocultar" : "Mostrar mais >"}
          </button>
        }
      >
        <div className="nfe-totais">
          <NfeCampo label="Total dos produtos">
            <input className={nfeInput} readOnly value={moeda.format(totalProdutos)} />
          </NfeCampo>
          <NfeCampo label="Valor do Frete (R$)">
            <CampoValor
              className={nfeInput}
              readOnly={!podeEditar}
              inputMode="decimal"
              value={podeEditar ? totaisTexto.frete : moeda.format(totaisNota.frete)}
              onChange={(event) =>
                setTotaisTexto((atual) => ({ ...atual, frete: event.target.value }))
              }
            />
          </NfeCampo>
          <NfeCampo label="Valor do Seguro (R$)">
            <CampoValor
              className={nfeInput}
              readOnly={!podeEditar}
              inputMode="decimal"
              value={podeEditar ? totaisTexto.seguro : moeda.format(totaisNota.seguro)}
              onChange={(event) =>
                setTotaisTexto((atual) => ({ ...atual, seguro: event.target.value }))
              }
            />
          </NfeCampo>
          <NfeCampo label="Outras Despesas (R$)">
            <CampoValor
              className={nfeInput}
              readOnly={!podeEditar}
              inputMode="decimal"
              value={podeEditar ? totaisTexto.outro : moeda.format(totaisNota.outro)}
              onChange={(event) =>
                setTotaisTexto((atual) => ({ ...atual, outro: event.target.value }))
              }
            />
          </NfeCampo>
          <NfeCampo label="Desconto (R$)">
            <CampoValor
              className={nfeInput}
              readOnly={!podeEditar}
              inputMode="decimal"
              value={podeEditar ? totaisTexto.desconto : moeda.format(totaisNota.desconto)}
              onChange={(event) =>
                setTotaisTexto((atual) => ({ ...atual, desconto: event.target.value }))
              }
            />
          </NfeCampo>
          <NfeCampo label="Total da NF-e">
            <input className={nfeInput} readOnly value={moeda.format(totalNfe)} />
          </NfeCampo>
        </div>
        {mostrarMaisTotais ? (
          <p className="mt-2 text-[12px] text-zinc-500">
            BC ICMS, ICMS, ST, FCP, IPI, PIS, COFINS, IBS e CBS saem do motor na
            validação. Sem regra configurada, a emissão é bloqueada.
          </p>
        ) : null}
      </NfeSecao>
      </div>

      <NfeRecolhivel titulo="Transporte" manterMontado>
        {operacao.id ? (
          <TransporteVendaForm
            ref={transporteRef}
            numero={operacao.numeroEmissao || "NF-e"}
            dadosTransporte={operacao.dadosTransporte}
            bloqueado={!podeEditarCabecalho}
            transportadoras={transportadoras}
            onSalvar={async (dados) => {
              if (!podeEditarCabecalho || !operacao.id) {
                return { ok: false, erro: edicaoDocumento.motivo ?? "Salve o rascunho antes do transporte." };
              }
              const persistidoCabecalho = await persistirCabecalhoSeSujo();
              if (!persistidoCabecalho.ok) {
                return persistidoCabecalho;
              }
              const resultado = await salvarTransporteOperacaoFiscal({
                operacaoId: operacao.id,
                dadosTransporte: dados,
              });
              if (!resultado.ok) {
                return { ok: false, erro: resultado.erro };
              }
              router.refresh();
              return { ok: true, mensagem: resultado.mensagem };
            }}
          />
        ) : (
          <p className="text-[12.5px] text-zinc-500">
            Salve o rascunho para informar modalidade do frete, transportadora e volumes.
          </p>
        )}
      </NfeRecolhivel>

      <NfeRecolhivel titulo="Local de retirada">
        <p className="text-[12.5px] text-zinc-500">
          O payload Geranet atual usa o endereço do emitente. Local de retirada
          distinto ainda não é transmitido.
        </p>
      </NfeRecolhivel>

      <NfeRecolhivel titulo="Local de entrega" abertoInicial={entregaDiferente}>
        <label className="flex items-start gap-2 text-[13px] text-zinc-800">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!podeEditarCabecalho}
            checked={entregaDiferente}
            onChange={(event) => setEntregaDiferente(event.target.checked)}
          />
          <span>Endereço de entrega diferente do destinatário</span>
        </label>
        {entregaDiferente ? (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <NfeCampo label="Nome" className="md:col-span-2">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.nome}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({ ...atual, nome: event.target.value }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Telefone">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.telefone}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    telefone: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="CPF">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.cpf}
                inputMode="numeric"
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    cpf: event.target.value.replace(/\D/g, "").slice(0, 11),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="CNPJ">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.cnpj}
                inputMode="numeric"
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    cnpj: event.target.value.replace(/\D/g, "").slice(0, 14),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Inscrição estadual">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.inscricaoEstadual}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    inscricaoEstadual: event.target.value,
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="CEP">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.cep}
                inputMode="numeric"
                autoComplete="postal-code"
                onChange={(event) => {
                  const valor = event.target.value.replace(/\D/g, "").slice(0, 8);
                  setEntregaCampos((atual) => ({ ...atual, cep: valor }));
                  if (podeEditarCabecalho) {
                    buscaCepEntrega.aoAlterarCep(valor);
                  }
                }}
                onBlur={(event) => {
                  if (podeEditarCabecalho) {
                    buscaCepEntrega.aoSairCep(event.target.value);
                  }
                }}
              />
              {buscaCepEntrega.carregando ? (
                <span className="nfe-campo-ajuda">Consultando CEP…</span>
              ) : buscaCepEntrega.aviso ? (
                <span className="mt-1 block text-[11px] text-amber-700">
                  {buscaCepEntrega.aviso}
                </span>
              ) : null}
            </NfeCampo>
            <NfeCampo label="Logradouro" className="md:col-span-2">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.logradouro}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    logradouro: event.target.value,
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Número">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.numero}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({ ...atual, numero: event.target.value }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Complemento">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.complemento}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    complemento: event.target.value,
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Bairro">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.bairro}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({ ...atual, bairro: event.target.value }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Município">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.municipio}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    municipio: event.target.value,
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Código IBGE">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.codigoMunicipio}
                maxLength={7}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    codigoMunicipio: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="UF">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.uf}
                maxLength={2}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    uf: event.target.value.toUpperCase(),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="E-mail">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.email}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({ ...atual, email: event.target.value }))
                }
              />
            </NfeCampo>
            <NfeCampo label="Código do país">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.codigoPais}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    codigoPais: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </NfeCampo>
            <NfeCampo label="País">
              <input
                className={nfeInput}
                disabled={!podeEditarCabecalho}
                value={entregaCampos.nomePais}
                onChange={(event) =>
                  setEntregaCampos((atual) => ({
                    ...atual,
                    nomePais: event.target.value,
                  }))
                }
              />
            </NfeCampo>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-zinc-500">
            A NF-e usa o endereço do destinatário. Marque a opção para informar um
            local de entrega distinto. Isso não altera o cadastro do cliente.
          </p>
        )}
      </NfeRecolhivel>

      <NfeRecolhivel
        titulo="Autorizados a acessar o XML"
        abertoInicial={autorizadosXml.length > 0}
      >
        <p className="text-[12.5px] text-zinc-500">
          Informe CPF ou CNPJ (somente números) de cada terceiro autorizado a
          baixar o XML no portal da SEFAZ. O campo só é enviado se houver
          registros. Não altera destinatário, entrega ou transporte.
        </p>
        {autorizadosXml.length > 0 ? (
          <div className="mt-3 grid gap-3">
            {autorizadosXml.map((item, index) => (
              <div
                key={`autorizado-xml-${index}`}
                className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
              >
                <NfeCampo label="CPF">
                  <input
                    className={nfeInput}
                    disabled={!podeEditarCabecalho}
                    value={item.cpf}
                    inputMode="numeric"
                    onChange={(event) => {
                      const cpf = event.target.value.replace(/\D/g, "").slice(0, 11);
                      setAutorizadosXml((atual) =>
                        atual.map((autorizado, posicao) =>
                          posicao === index ? { ...autorizado, cpf } : autorizado
                        )
                      );
                    }}
                  />
                </NfeCampo>
                <NfeCampo label="CNPJ">
                  <input
                    className={nfeInput}
                    disabled={!podeEditarCabecalho}
                    value={item.cnpj}
                    inputMode="numeric"
                    onChange={(event) => {
                      const cnpj = event.target.value.replace(/\D/g, "").slice(0, 14);
                      setAutorizadosXml((atual) =>
                        atual.map((autorizado, posicao) =>
                          posicao === index ? { ...autorizado, cnpj } : autorizado
                        )
                      );
                    }}
                  />
                </NfeCampo>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={!podeEditarCabecalho}
                    onClick={() =>
                      setAutorizadosXml((atual) =>
                        atual.filter((_, posicao) => posicao !== index)
                      )
                    }
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-zinc-500">
            Nenhum autorizado informado. Sem registros, o campo não é enviado
            à Geranet.
          </p>
        )}
        <button
          type="button"
          className="updv-btn updv-btn-ghost mt-3"
          disabled={
            !podeEditarCabecalho ||
            autorizadosXml.length >= LIMITE_AUTORIZADOS_XML_NFE
          }
          onClick={() =>
            setAutorizadosXml((atual) =>
              atual.length >= LIMITE_AUTORIZADOS_XML_NFE
                ? atual
                : [...atual, autorizadoXmlVazio()]
            )
          }
        >
          Adicionar autorizado
        </button>
      </NfeRecolhivel>

      <NfeRecolhivel titulo="Documentos referenciados">
        <div className="flex flex-wrap gap-2">
          <input
            className={`${nfeInput} max-w-md`}
            placeholder="Chave NF-e 44 dígitos"
            value={chaveRef}
            onChange={(event) => setChaveRef(event.target.value)}
          />
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => {
              const chave = chaveRef.replace(/\D/g, "");
              if (chave.length !== 44) {
                setErro("Informe uma chave de NF-e com 44 dígitos.");
                return;
              }
              setReferencias((atual) =>
                atual.includes(chave) ? atual : [...atual, chave]
              );
              setChaveRef("");
            }}
          >
            Adicionar chave
          </button>
        </div>
        {referencias.length > 0 ? (
          <ul className="mt-2 text-[12.5px] text-zinc-600">
            {referencias.map((chave) => (
              <li key={chave}>{chave}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-zinc-500">
            Esta natureza não exige documento anterior. Referências serão usadas
            quando a operação (devolução, complementar, ajuste) exigir.
          </p>
        )}
      </NfeRecolhivel>

      <NfeRecolhivel titulo="Pagamento / Cobrança" className="nfe-secao-card">
        {financeiro ? (
          <>
          <div className="nfe-pagamento-corpo space-y-4">
          <NfePagamentoVenda
            formasPagamento={formasPagamento}
            pixConfig={pixConfig}
            pagamentos={pagamentos}
            onPagamentos={(proximo) => {
              setPagamentos(proximo);
              setValidadaLocalmente(false);
            }}
            pixLocal={pixLocal}
            onPixLocal={setPixLocal}
            pixGeranet={pixGeranet}
            onPixGeranet={setPixGeranet}
            totalCatalogoCentavos={paraCentavos(totalNfe)}
            clienteId={destinatarioId || null}
            podeEditar={Boolean(podeEditar)}
            ocupado={pending}
            onErro={setErro}
            coberturaDuplicataCentavos={coberturaDuplicataCentavos}
          />
          <NfeFaturaCobranca
            condicao={condicaoPagamento}
            onCondicao={aplicarCondicaoPagamento}
            tipoCobranca={tipoCobrancaPrazo}
            onTipoCobranca={aplicarTipoCobrancaPrazo}
            fatura={fatura}
            onFatura={(proxima) => {
              setFatura(proxima);
              setValidadaLocalmente(false);
            }}
            totalNfeCentavos={totalVendaCentavos}
            totalPagoAgoraCentavos={totalPagoAgoraCentavos}
            totalAPrazoCentavos={
              temDuplicataMercantil ? coberturaDuplicataCentavos : totalAPrazoCentavos
            }
            podeEditar={Boolean(podeEditar)}
            temPagamentoPosterior={temPagamentoPosterior}
            temDuplicataMercantil={temDuplicataMercantil}
            bloquearDuplicata={temPagamentoPosterior}
            valorDuplicataCentavos={coberturaDuplicataCentavos}
            restanteConferenciaCentavos={Math.max(
              0,
              totalVendaCentavos - totalPagoAgoraCentavos - coberturaDuplicataCentavos
            )}
          />
          </div>
          </>
        ) : (
          <p className="text-[12.5px] text-zinc-500">
            Natureza sem financeiro. A emissão usa forma 90 (sem pagamento). Não
            gera contas a receber.
          </p>
        )}
      </NfeRecolhivel>

      <NfeRecolhivel titulo="Informações adicionais" abertoInicial>
        <div className="nfe-grid grid-cols-1 md:grid-cols-2">
          <NfeCampo label="Informações complementares">
            <textarea
              className="updv-input min-h-20 w-full py-2"
              value={infoUsuario}
              maxLength={5000}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setInfoUsuario(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
            />
          </NfeCampo>
          <NfeCampo label="Informações ao Fisco">
            <textarea
              className="updv-input min-h-20 w-full py-2"
              value={infoFisco}
              maxLength={2000}
              disabled={!podeEditarCabecalho}
              onChange={(event) => {
                setInfoFisco(event.target.value);
                setCabecalhoSujo(true);
                setValidadaLocalmente(false);
              }}
            />
          </NfeCampo>
        </div>
        {podeEditarCabecalho && operacao.id ? (
          <button
            type="button"
            className="updv-btn updv-btn-ghost mt-2"
            disabled={pending}
            onClick={() =>
              executar(() => {
                setCabecalhoSujo(false);
                return persistirCabecalhoFiscal();
              })
            }
          >
            Salvar informações
          </button>
        ) : null}
      </NfeRecolhivel>

      {emissao && politicaCancelamento ? (
        <NfeSecao titulo="Ciclo fiscal">
          <EmissaoFiscalAcoes
            titulo="NF-e 55"
            emissao={emissao}
            eventos={eventos}
            politicaCancelamento={politicaCancelamento}
            bloqueioCancelamentoOperacional={bloqueioCancelamentoOperacional}
          />
          <EmissaoFiscalHistorico
            emissoes={[
              {
                id: emissao.id,
                modelo: emissao.modelo,
                serie: emissao.serie,
                numero: emissao.numero,
                status: emissao.status,
                cstat: emissao.cstat,
                motivo: emissao.motivo,
              },
            ]}
            eventos={eventos}
            tentativas={tentativas}
            tentativasCabecalho={tentativasCabecalho}
          />
        </NfeSecao>
      ) : null}

      {nfeAutorizada && operacao.id && tipoAtual !== "venda" ? (
        <NfeSecao titulo="Estoque operacional">
          {operacao.status === "em_transito" ? (
            <p className="mb-2 text-[13px] text-amber-800">
              Em trânsito. Confirme o recebimento no estabelecimento de destino.
            </p>
          ) : null}
          {operacaoPodeConfirmarSaida(operacao.status) && !operacao.saidaProcessadaEm ? (
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              disabled={pending}
              onClick={() => {
                if (saindo.current) return;
                saindo.current = true;
                executar(() =>
                  confirmarSaidaOperacaoFiscal({ operacaoId: operacao.id as string })
                );
              }}
            >
              Confirmar saída da mercadoria
            </button>
          ) : (
            <p className="text-[13px] text-emerald-800">Saída processada ✓</p>
          )}
          {tipoAtual === "transferencia" &&
          operacao.destinoGerenciado &&
          operacaoPodeConfirmarRecebimento(operacao.status) ? (
            <button
              type="button"
              className="updv-btn updv-btn-primary mt-2"
              disabled={pending}
              onClick={() => {
                if (recebendo.current) return;
                recebendo.current = true;
                executar(() =>
                  confirmarRecebimentoTransferencia({
                    operacaoId: operacao.id as string,
                  })
                );
              }}
            >
              Confirmar recebimento
            </button>
          ) : null}
        </NfeSecao>
      ) : null}

    </div>
  );
}

function ItemLinha({
  item,
  aberto,
  podeEditar,
  pending,
  onAbrir,
  onExcluir,
  onAlterarLocal,
  onAtualizar,
}: {
  item: ItemFormularioNfe;
  aberto: boolean;
  podeEditar: boolean;
  pending: boolean;
  onAbrir: () => void;
  onExcluir: () => void;
  onAlterarLocal: (quantidade: number, valorUnitario: number) => void;
  onAtualizar: (quantidade: number, valorUnitario: number) => void;
}) {
  const [qtdeTexto, setQtdeTexto] = useState(() =>
    formatarQuantidadeItemNfe(item.quantidade, item.unidade)
  );
  const [precoTexto, setPrecoTexto] = useState(() =>
    formatarPrecoItemNfe(item.valorUnitario)
  );
  const campoFocado = useRef(false);

  useEffect(() => {
    if (campoFocado.current) {
      return;
    }
    setQtdeTexto(formatarQuantidadeItemNfe(item.quantidade, item.unidade));
    setPrecoTexto(formatarPrecoItemNfe(item.valorUnitario));
  }, [item.id, item.quantidade, item.unidade, item.valorUnitario]);

  const totalExibido = useMemo(() => {
    const quantidadeOk = validarQuantidadeItemNfe({
      quantidade: parseNumeroComercialNfe(qtdeTexto),
      unidade: item.unidade,
    });
    const precoOk = validarValorUnitarioItemNfe(parseNumeroComercialNfe(precoTexto));
    if (!quantidadeOk.ok || !precoOk.ok) {
      return item.valorTotal;
    }
    return totalItemNfe(quantidadeOk.quantidade, precoOk.valorUnitario);
  }, [item.unidade, item.valorTotal, precoTexto, qtdeTexto]);

  function aplicarRascunho(qtde: string, preco: string) {
    const quantidadeOk = validarQuantidadeItemNfe({
      quantidade: parseNumeroComercialNfe(qtde),
      unidade: item.unidade,
    });
    const precoOk = validarValorUnitarioItemNfe(parseNumeroComercialNfe(preco));
    if (!quantidadeOk.ok || !precoOk.ok) {
      return;
    }
    onAlterarLocal(quantidadeOk.quantidade, precoOk.valorUnitario);
  }

  function confirmarCampo() {
    campoFocado.current = false;
    const quantidadeOk = validarQuantidadeItemNfe({
      quantidade: parseNumeroComercialNfe(qtdeTexto),
      unidade: item.unidade,
    });
    const precoOk = validarValorUnitarioItemNfe(parseNumeroComercialNfe(precoTexto));
    if (!quantidadeOk.ok || !precoOk.ok) {
      setQtdeTexto(formatarQuantidadeItemNfe(item.quantidade, item.unidade));
      setPrecoTexto(formatarPrecoItemNfe(item.valorUnitario));
      onAlterarLocal(item.quantidade, item.valorUnitario);
      return;
    }
    setQtdeTexto(formatarQuantidadeItemNfe(quantidadeOk.quantidade, item.unidade));
    setPrecoTexto(formatarPrecoItemNfe(precoOk.valorUnitario));
    onAtualizar(quantidadeOk.quantidade, precoOk.valorUnitario);
  }

  return (
    <>
      <tr>
        <td>
          {item.descricao}
          <span className="nfe-item-estoque">Estoque: {item.estoque}</span>
        </td>
        <td>{item.codigo || "—"}</td>
        <td>{item.unidade || "UN"}</td>
        <td className="num">
          {podeEditar ? (
            <CampoValor
              className={`${nfeInput} nfe-item-qtd`}
              inputMode={unidadePermiteDecimal(item.unidade) ? "decimal" : "numeric"}
              value={qtdeTexto}
              disabled={pending}
              aria-label={`Quantidade de ${item.descricao}`}
              onFocus={() => {
                campoFocado.current = true;
              }}
              onChange={(event) => {
                const valor = event.target.value;
                setQtdeTexto(valor);
                aplicarRascunho(valor, precoTexto);
              }}
              onBlur={confirmarCampo}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
          ) : (
            item.quantidade
          )}
        </td>
        <td className="num">
          {podeEditar ? (
            <CampoValor
              className={`${nfeInput} nfe-item-preco`}
              inputMode="decimal"
              value={precoTexto}
              disabled={pending}
              aria-label={`Preço unitário de ${item.descricao}`}
              onFocus={() => {
                campoFocado.current = true;
              }}
              onChange={(event) => {
                const valor = event.target.value;
                setPrecoTexto(valor);
                aplicarRascunho(qtdeTexto, valor);
              }}
              onBlur={confirmarCampo}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
          ) : (
            moeda.format(item.valorUnitario)
          )}
        </td>
        <td className="num">{moeda.format(totalExibido)}</td>
        <td>{item.ncm || "—"}</td>
        <td>
          <button type="button" className="updv-btn-row" onClick={onAbrir}>
            Fiscal
          </button>
          {podeEditar ? (
            <button
              type="button"
              className="updv-btn-row ml-1 text-red-600"
              onClick={onExcluir}
            >
              Excluir
            </button>
          ) : null}
        </td>
      </tr>
      {aberto ? (
        <tr>
          <td colSpan={8} className="bg-zinc-50 text-[12px] text-zinc-600">
            CFOP: {item.cfop || "resolvido na validação"} · NCM: {item.ncm || "—"} ·
            ICMS/CSOSN: {item.icms || "grupo fiscal do produto"} · CEST/PIS/COFINS/IBS/CBS
            pelo motor na verificação. Sem regra, a emissão é bloqueada.
          </td>
        </tr>
      ) : null}
    </>
  );
}
