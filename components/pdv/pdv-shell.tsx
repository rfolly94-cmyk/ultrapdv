"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  LogOut,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  Smartphone,
  X,
} from "lucide-react";

import { finalizarVendaPdv } from "../../app/pdv/actions";
import { PdvCaixaFechado } from "@/components/pdv/pdv-caixa-fechado";
import { PdvConsumidorNota } from "@/components/pdv/pdv-consumidor-nota";
import { CampoValor } from "@/components/ui/campo-valor";
import { CaixaAvisoReabertoFaixa } from "@/components/caixa/caixa-aviso-reaberto";
import type { CaixaAvisoReaberto } from "@/lib/caixa/tipos";
import {
  buscarConfiguracoesImpressaoAction,
} from "@/app/configuracoes/impressao/actions";
import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import { obterDispositivoId } from "@/lib/impressao/dispositivo";
import { executarDestinoImpressao } from "@/lib/impressao/executar-cliente";
import {
  configDoTipo,
  decidirDestinoImpressaoAutomatica,
  decidirDocumentoImpressao,
} from "@/lib/impressao/regras";
import type {
  ConfiguracaoImpressao,
  DestinoImpressaoAutomatica,
} from "@/lib/impressao/tipos";
import {
  chamarEmissaoNfceVenda,
  type ResultadoEmissaoNfceVenda,
} from "@/lib/fiscal/nfce/chamar-emissao-nfce-venda";
import { resolverAcoesPosVendaPdv } from "@/lib/pdv/acoes-pos-venda";
import {
  MENSAGEM_PAGAMENTOS_ULTRAPASSAM,
  avaliarPagamentosPdv,
  saldoRestanteParaParcela,
} from "@/lib/pdv/pagamentos-teto";
import {
  MENSAGEM_CONFIGURE_PIX,
  escolherFormaPixComercial,
  rotuloFormaCheckout,
} from "@/lib/pdv/formas-pagamento-checkout";
import { nomeProvedorPix } from "@/lib/pagamentos/pix/provedores-geranet";
import type { PedidoPdvInicial } from "@/lib/catalogo/tipos";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import {
  cpfValido,
  MENSAGEM_CPF_INVALIDO,
  somenteDigitosDocumento,
} from "@/lib/fiscal/destinatario/documento";
import { MENSAGEM_CONECTOR_NAO_CONTRATADO } from "@/lib/impressao/mensagens";
import {
  decidirQrAposMudancaValorGeranet,
  MENSAGEM_PIX_GERANET_AGUARDANDO,
  MENSAGEM_PIX_GERANET_DESCARTAR,
  MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA,
} from "@/lib/pagamentos/pix/geranet-regras";
import {
  ehFormaPix,
  mensagemBloqueioPixPendente,
  mensagemPixConfirmadoNaoAltera,
  decidirQrAposMudancaValor,
} from "@/lib/pagamentos/pix/local-regras";
import {
  PixGeranetCheckout,
  type PixGeranetCheckoutState,
} from "./pix-geranet-checkout";
import {
  PixLocalCheckout,
  type PixLocalCheckoutState,
} from "./pix-local-checkout";
import {
  codigoPedidoAmigavel,
  formatarWhatsappExibicao,
  montarObservacaoPedidoPdv,
} from "@/lib/catalogo/regras";
import {
  aoCancelarClienteDoFiado,
  aoMarcarFiado,
  deveResetarPagamentosAposCliente,
  MENSAGEM_FIADO_EXIGE_CLIENTE,
  podeConcluirFiado,
  resetarPagamentosAposClienteFiado,
  type ContextoClientePdv,
} from "@/lib/pdv/fiado-cliente";
import {
  decidirAcaoEscPdv,
  DESTINO_FECHAR_PDV,
} from "@/lib/pdv/atalhos-esc";
import {
  PREFERENCIAS_PDV_PADRAO,
  deveMostrarFotoProduto,
  deveRenderizarLogoCentro,
  estiloTokensPdv,
  preferenciasAposCancelarPreview,
  type PreferenciasPdv,
} from "@/lib/pdv/preferencias";
import {
  MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO,
  decidirAcaoEnterBuscaPdv,
  detectorScannerVazio,
  indiceAposSetaBuscaPdv,
  indiceInicialBuscaPdv,
  pareceLeituraScanner,
  quantidadeAposAdicionarPdv,
  registrarTeclaBusca,
} from "@/lib/pdv/busca-produto";
import { urlPublicaCatalogo } from "@/lib/catalogo/storage";
import { salvarPreferenciasPdvAction } from "@/app/pdv/preferencias-actions";
import { PdvBuscaResultados } from "@/components/pdv/pdv-busca-resultados";
import { PdvPreferenciasModal } from "@/components/pdv/pdv-preferencias-modal";
import { avaliarQuantidadeEstoquePdv } from "@/lib/pdv/venda-sem-estoque";
import { executarAberturaGaveta } from "@/lib/caixa/abrir-gaveta-cliente";
import { deveAbrirGavetaAposVenda } from "@/lib/caixa/gaveta";
import {
  MENSAGEM_GAVETA_CAIXA_FECHADO,
  MENSAGEM_GAVETA_VENDA_SEM_ABRIR,
} from "@/lib/caixa/mensagens";

type Produto = {
  id: string;
  codigo: string;
  codigo_barras:
    | string
    | null;
  nome: string;
  unidade_medida: string;
  preco_venda:
    | number
    | string;
  catalogo_imagem_path?:
    | string
    | null;
  estoqueDisponivel?: number;
};

type Cliente = {
  id: string;
  nome: string;
  cpf_cnpj:
    | string
    | null;
  telefone:
    | string
    | null;
  limite_credito:
    | number
    | string;
  saldo_devedor:
    | number
    | string;
  bloqueado: boolean;
};

type FormaPagamento = {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
  codigo_fiscal:
    | string
    | null;
  permite_troco: boolean;
  permite_fiado: boolean;
  permite_parcelamento: boolean;
  ordem: number;
};

type ItemCarrinho = {
  produtoId: string;
  codigo: string;
  nome: string;
  unidadeMedida: string;
  quantidade: number;
  valorUnitarioCentavos: number;
};

type PagamentoDigitado = {
  formaPagamentoId: string;
  valorTexto: string;
};

type PixConfigPdv = {
  modo: "local_manual" | "geranet";
  provedor?: string | null;
} | null;

type Props = {
  empresaNome: string;
  empresaId?: string;
  usuarioNome?: string | null;
  logoUrl?: string | null;
  preferenciasIniciais?: PreferenciasPdv;
  permitirVendaSemEstoqueInicial?: boolean;
  produtos: Produto[];
  clientes: Cliente[];
  formasPagamento: FormaPagamento[];
  pedidoInicial?: PedidoPdvInicial | null;
  pixConfig?: PixConfigPdv;
  pixIntegradoLiberado?: boolean;
  emitirNfceAutomaticoPdv?: boolean;
  ambienteFiscal?: 1 | 2;
  caixaAberto: boolean;
  caixaSessaoAberta?: boolean;
  podeAbrirCaixa: boolean;
  caixaReabertoAviso?: CaixaAvisoReaberto | null;
  abrirGavetaAposVendaDinheiro?: boolean;
};

type FiscalUltimaVenda = {
  emitindo: boolean;
  kind: ResultadoEmissaoNfceVenda["kind"] | null;
  status: string | null;
  mensagem: string;
  emissaoId: string | null;
  danfeDisponivel: boolean;
};

function paraCentavos(
  valor:
    | number
    | string
) {
  const numero =
    Number(valor);

  if (
    !Number.isFinite(
      numero
    )
  ) {
    return 0;
  }

  return Math.round(
    numero * 100
  );
}

function dinheiroCentavos(
  centavos: number
) {
  return (
    centavos /
    100
  ).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  );
}

function iconeFormaPagamento(forma: FormaPagamento) {
  const chave = `${forma.tipo} ${forma.codigo} ${forma.nome}`.toLowerCase();

  if (chave.includes("pix")) {
    return Smartphone;
  }

  if (
    chave.includes("cartao") ||
    chave.includes("cartão") ||
    chave.includes("credito") ||
    chave.includes("crédito") ||
    chave.includes("debito") ||
    chave.includes("débito")
  ) {
    return CreditCard;
  }

  return Banknote;
}

function normalizar(
  valor: string
) {
  return valor
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function textoParaCentavos(
  valor: string
) {
  let texto =
    valor.trim();

  if (!texto) {
    return 0;
  }

  if (
    texto.includes(".") &&
    texto.includes(",")
  ) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (
    texto.includes(",")
  ) {
    texto =
      texto.replace(
        ",",
        "."
      );
  }

  const numero =
    Number(texto);

  if (
    !Number.isFinite(
      numero
    ) ||
    numero < 0
  ) {
    return 0;
  }

  return Math.round(
    numero * 100
  );
}

function centavosParaInput(
  centavos: number
) {
  return (
    centavos /
    100
  ).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }
  );
}

function documentoCurto(
  documento:
    | string
    | null
) {
  const digitos =
    String(
      documento ?? ""
    ).replace(
      /\D/g,
      ""
    );

  if (
    digitos.length ===
    11
  ) {
    return digitos.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      "$1.$2.$3-$4"
    );
  }

  if (
    digitos.length ===
    14
  ) {
    return digitos.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }

  return digitos;
}

export function PdvShell({
  empresaNome,
  empresaId = "",
  usuarioNome = null,
  logoUrl = null,
  preferenciasIniciais = PREFERENCIAS_PDV_PADRAO,
  permitirVendaSemEstoqueInicial = false,
  produtos,
  clientes,
  formasPagamento,
  pedidoInicial = null,
  pixConfig = null,
  pixIntegradoLiberado = true,
  emitirNfceAutomaticoPdv = false,
  ambienteFiscal = 2,
  caixaAberto,
  caixaSessaoAberta = false,
  podeAbrirCaixa,
  caixaReabertoAviso = null,
  abrirGavetaAposVendaDinheiro = false,
}: Props) {
  const router = useRouter();
  const podeDesconto = useTemPermissao("pdv", "aplicar_desconto");
  const podeFiado = useTemPermissao("pdv", "usar_fiado");
  const conectorLiberado = useRecursoLiberado("impressao_automatica");
  const [
    busca,
    setBusca,
  ] = useState("");

  const [
    indiceSelecionadoBusca,
    setIndiceSelecionadoBusca,
  ] = useState<number | null>(null);

  const [
    quantidadeDigitada,
    setQuantidadeDigitada,
  ] = useState("1");

  const [
    carrinho,
    setCarrinho,
  ] = useState<
    ItemCarrinho[]
  >([]);

  const [
    catalogoPedidoId,
    setCatalogoPedidoId,
  ] = useState<string | null>(
    pedidoInicial?.pedidoId ?? null
  );

  const [
    pedidoObservacao,
    setPedidoObservacao,
  ] = useState<string | null>(
    pedidoInicial?.observacao ?? null
  );

  const pedidoCarregadoRef = useRef(false);

  const [
    clienteSelecionadoId,
    setClienteSelecionadoId,
  ] = useState<
    string | null
  >(null);

  const [
    buscaCliente,
    setBuscaCliente,
  ] = useState("");

  const [
    modalCliente,
    setModalCliente,
  ] = useState(false);

  const [
    modalDesconto,
    setModalDesconto,
  ] = useState(false);

  const [
    descontoTexto,
    setDescontoTexto,
  ] = useState("0,00");

  const [
    descontoCentavos,
    setDescontoCentavos,
  ] = useState(0);

  const [
    modalPagamento,
    setModalPagamento,
  ] = useState(false);

  const [
    cpfNaNotaAtivo,
    setCpfNaNotaAtivo,
  ] = useState(false);

  const [
    cpfNaNota,
    setCpfNaNota,
  ] = useState("");

  const [
    usarDocumentoClienteNaNota,
    setUsarDocumentoClienteNaNota,
  ] = useState(true);

  const [
    contextoCliente,
    setContextoCliente,
  ] = useState<ContextoClientePdv | null>(null);

  const [
    modalPreferencias,
    setModalPreferencias,
  ] = useState(false);

  const [
    menuUsuarioAberto,
    setMenuUsuarioAberto,
  ] = useState(false);

  const [
    preferenciasSalvas,
    setPreferenciasSalvas,
  ] = useState<PreferenciasPdv>(preferenciasIniciais);

  const [
    preferencias,
    setPreferencias,
  ] = useState<PreferenciasPdv>(preferenciasIniciais);

  const [
    salvandoPreferencias,
    setSalvandoPreferencias,
  ] = useState(false);

  const [
    permitirVendaSemEstoqueSalvo,
    setPermitirVendaSemEstoqueSalvo,
  ] = useState(permitirVendaSemEstoqueInicial);

  const [
    permitirVendaSemEstoque,
    setPermitirVendaSemEstoque,
  ] = useState(permitirVendaSemEstoqueInicial);

  const [
    toastPdv,
    setToastPdv,
  ] = useState<string | null>(null);

  const [
    imprimirApos,
    setImprimirApos,
  ] = useState(true);

  const [
    usarFiado,
    setUsarFiado,
  ] = useState(false);

  const [
    pagamentos,
    setPagamentos,
  ] = useState<
    PagamentoDigitado[]
  >([]);

  const [pixLocal, setPixLocal] =
    useState<PixLocalCheckoutState | null>(null);

  const [pixGeranet, setPixGeranet] =
    useState<PixGeranetCheckoutState | null>(null);

  const [descartarGeranetAberto, setDescartarGeranetAberto] =
    useState(false);

  const pixCheckoutKeyRef = useRef<string | null>(null);

  const [
    erroPagamento,
    setErroPagamento,
  ] = useState<
    string | null
  >(null);

  const [
    ultimaVenda,
    setUltimaVenda,
  ] = useState<{
    vendaId: string;
    numero: number;
    totalCentavos: number;
    fiscal: FiscalUltimaVenda | null;
    avisoGaveta?: string | null;
  } | null>(null);

  const [
    configsImpressao,
    setConfigsImpressao,
  ] = useState<ConfiguracaoImpressao[]>([]);

  const [
    impressaoPos,
    setImpressaoPos,
  ] = useState<{
    status: "idle" | "imprimindo" | "ok" | "falha";
    erro: string | null;
    mensagem: string | null;
    destino: DestinoImpressaoAutomatica;
  }>({
    status: "idle",
    erro: null,
    mensagem: null,
    destino: { tipo: "nenhum" },
  });

  const [
    isPending,
    startTransition,
  ] = useTransition();

  const buscaRef =
    useRef<HTMLInputElement>(
      null
    );

  const detectorScannerRef = useRef(detectorScannerVazio());
  const chaveResultadosBuscaRef = useRef("");

  const idempotencyRef =
    useRef<string | null>(
      null
    );

  useEffect(() => {
    buscaRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = obterDispositivoId();
    if (!id) {
      return;
    }
    void buscarConfiguracoesImpressaoAction(id).then((resultado) => {
      if (resultado.ok) {
        setConfigsImpressao(resultado.configs);
      }
    });
  }, []);

  async function tentarImpressaoPosVenda(
    vendaId: string,
    fiscal: FiscalUltimaVenda | null,
    forcar = false
  ) {
    if (!conectorLiberado) {
      if (forcar) {
        setImpressaoPos({
          status: "falha",
          erro: MENSAGEM_CONECTOR_NAO_CONTRATADO,
          mensagem: null,
          destino: { tipo: "nenhum" },
        });
      }
      return false;
    }

    const destino = forcar
      ? decidirDocumentoImpressao({ vendaId, fiscal })
      : decidirDestinoImpressaoAutomatica({
          configs: configsImpressao,
          vendaId,
          fiscal,
          conectorPermitido: true,
        });
    if (destino.tipo === "nenhum") {
      return false;
    }

    setImpressaoPos({
      status: "imprimindo",
      erro: null,
      mensagem: null,
      destino,
    });

    try {
      const resultado = await executarDestinoImpressao({
        destino,
        configs: configsImpressao,
        forcar: true,
        conectorPermitido: conectorLiberado,
      });
      if ("pulou" in resultado && resultado.pulou) {
        setImpressaoPos({
          status: "idle",
          erro: null,
          mensagem: null,
          destino,
        });
        return false;
      }
      if (resultado.ok) {
        setImpressaoPos({
          status: "ok",
          erro: null,
          mensagem:
            "mensagem" in resultado
              ? resultado.mensagem
              : "Enviado para impressão",
          destino,
        });
        return true;
      }
      const erroBase =
        "erro" in resultado
          ? resultado.erro
          : "Venda concluída, mas não foi possível imprimir.";
      setImpressaoPos({
        status: "falha",
        erro:
          fiscal?.kind === "autorizada"
            ? `NFC-e autorizada, mas não foi possível imprimir.\n${erroBase}`
            : erroBase,
        mensagem: null,
        destino,
      });
      return false;
    } catch {
      setImpressaoPos({
        status: "falha",
        erro:
          fiscal?.kind === "autorizada"
            ? "NFC-e autorizada, mas não foi possível imprimir."
            : "Venda concluída, mas não foi possível imprimir.",
        mensagem: null,
        destino,
      });
      return false;
    }
  }

  useEffect(() => {
    if (!toastPdv) {
      return;
    }

    const timer = window.setTimeout(() => setToastPdv(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toastPdv]);

  useEffect(() => {
    if (!pedidoInicial || pedidoCarregadoRef.current) {
      return;
    }

    pedidoCarregadoRef.current = true;
    setCatalogoPedidoId(pedidoInicial.pedidoId);
    setPedidoObservacao(
      montarObservacaoPedidoPdv({
        codigo: pedidoInicial.codigo,
        clienteNome: pedidoInicial.clienteNome,
        clienteWhatsapp: pedidoInicial.clienteWhatsapp,
        tipoEntrega: pedidoInicial.tipoEntrega,
        endereco: pedidoInicial.endereco,
        observacao: pedidoInicial.observacao,
      })
    );

    const itensPedido: ItemCarrinho[] = [];
    for (const item of pedidoInicial.itens) {
      const produto = produtos.find(
        (itemProduto) => itemProduto.id === item.produtoId
      );
      const checagem = avaliarQuantidadeEstoquePdv({
        permitirVendaSemEstoque: permitirVendaSemEstoqueInicial,
        disponivel: Number(produto?.estoqueDisponivel) || 0,
        quantidade: item.quantidade,
      });
      if (!checagem.ok) {
        setToastPdv(checagem.erro);
        continue;
      }
      itensPedido.push({
        produtoId: item.produtoId,
        codigo: item.codigo,
        nome: item.nome,
        unidadeMedida: item.unidadeMedida,
        quantidade: item.quantidade,
        valorUnitarioCentavos: Math.round(item.precoAtual * 100),
      });
    }
    setCarrinho(itensPedido);
  }, [pedidoInicial, permitirVendaSemEstoqueInicial, produtos]);

  const clienteSelecionado =
    useMemo(
      () =>
        clientes.find(
          (cliente) =>
            cliente.id ===
            clienteSelecionadoId
        ) ?? null,
      [
        clientes,
        clienteSelecionadoId,
      ]
    );

  const produtosFiltrados =
    useMemo(() => {
      const termo =
        normalizar(busca);

      if (!termo) {
        return produtos.slice(
          0,
          30
        );
      }

      return produtos
        .filter(
          (produto) => {
            const nome =
              normalizar(
                produto.nome
              );

            const codigo =
              normalizar(
                produto.codigo
              );

            const barras =
              normalizar(
                produto.codigo_barras ??
                  ""
              );

            return (
              nome.includes(
                termo
              ) ||
              codigo.includes(
                termo
              ) ||
              barras.includes(
                termo
              )
            );
          }
        )
        .slice(0, 50);
    }, [
      busca,
      produtos,
    ]);

  const produtosBuscaVisiveis = useMemo(
    () => produtosFiltrados.slice(0, 20),
    [produtosFiltrados]
  );
  const primeiroIdBusca = produtosBuscaVisiveis[0]?.id ?? null;
  const totalBuscaVisivel = produtosBuscaVisiveis.length;
  const chaveResultadosBusca = `${busca.trim()}|${primeiroIdBusca}|${totalBuscaVisivel}`;

  if (chaveResultadosBuscaRef.current !== chaveResultadosBusca) {
    chaveResultadosBuscaRef.current = chaveResultadosBusca;
    setIndiceSelecionadoBusca(
      !busca.trim() ? null : indiceInicialBuscaPdv(totalBuscaVisivel)
    );
  }

  const clientesFiltrados =
    useMemo(() => {
      const termo =
        normalizar(
          buscaCliente
        );

      if (!termo) {
        return clientes.slice(
          0,
          30
        );
      }

      const digitos =
        termo.replace(
          /\D/g,
          ""
        );

      return clientes
        .filter(
          (cliente) => {
            const nome =
              normalizar(
                cliente.nome
              );

            const documento =
              String(
                cliente.cpf_cnpj ??
                  ""
              ).replace(
                /\D/g,
                ""
              );

            const telefone =
              String(
                cliente.telefone ??
                  ""
              ).replace(
                /\D/g,
                ""
              );

            return (
              nome.includes(
                termo
              ) ||
              (
                digitos &&
                documento.includes(
                  digitos
                )
              ) ||
              (
                digitos &&
                telefone.includes(
                  digitos
                )
              )
            );
          }
        )
        .slice(0, 50);
    }, [
      buscaCliente,
      clientes,
    ]);

  const subtotalCentavos =
    carrinho.reduce(
      (
        acumulado,
        item
      ) =>
        acumulado +
        item.quantidade *
          item.valorUnitarioCentavos,
      0
    );

  const descontoAplicado =
    Math.min(
      descontoCentavos,
      subtotalCentavos
    );

  const totalCentavos =
    Math.max(
      0,
      subtotalCentavos -
        descontoAplicado
    );

  const pixLocalAtivo = pixConfig?.modo === "local_manual";

  const pixGeranetAtivo =
    pixConfig?.modo === "geranet" && pixIntegradoLiberado;
  const pixProvedorNome =
    pixGeranetAtivo && pixConfig.provedor
      ? nomeProvedorPix(pixConfig.provedor)
      : "";

  const pixHabilitado = pixLocalAtivo || pixGeranetAtivo;

  const formasPagas =
    formasPagamento.filter(
      (forma) => !forma.permite_fiado
    );

  const formaFiado =
    podeFiado
      ? formasPagamento.find(
          (forma) => forma.permite_fiado
        ) ?? null
      : null;

  function checkoutKeyPixGeranet() {
    if (!pixCheckoutKeyRef.current) {
      pixCheckoutKeyRef.current = crypto.randomUUID();
    }

    return pixCheckoutKeyRef.current;
  }

  function resetarCheckoutPixGeranet() {
    pixCheckoutKeyRef.current = null;
    setPixGeranet(null);
  }

  const formaPix = escolherFormaPixComercial(formasPagamento);

  const quantidadeTotal = carrinho.reduce(
    (acumulado, item) => acumulado + item.quantidade,
    0
  );

  const pagamentosCalculados =
    pagamentos
      .map(
        (pagamento) => ({
          ...pagamento,
          valorCentavos:
            textoParaCentavos(
              pagamento.valorTexto
            ),
          forma:
            formasPagamento.find(
              (forma) =>
                forma.id ===
                pagamento.formaPagamentoId
            ) ?? null,
        })
      )
      .filter(
        (pagamento) =>
          pagamento.valorCentavos >
          0
      );

  const avaliacaoPagamentos = avaliarPagamentosPdv({
    totalVendaCentavos: totalCentavos,
    pagamentos: pagamentosCalculados.map((pagamento) => ({
      valorCentavos: pagamento.valorCentavos,
      permiteTroco: pagamento.forma?.permite_troco === true,
    })),
  });

  const pagamentoExcedente = avaliacaoPagamentos.bloqueado;
  const totalInformado = avaliacaoPagamentos.totalInformadoCentavos;
  const trocoCentavos = avaliacaoPagamentos.trocoCentavos;
  const restanteCentavos = avaliacaoPagamentos.restanteCentavos;
  const valorPixInformado =
    pagamentosCalculados.find((pagamento) => ehFormaPix(pagamento.forma))
      ?.valorCentavos ?? 0;
  const saldoRestantePixCentavos = saldoRestanteParaParcela({
    totalVendaCentavos: totalCentavos,
    outrosPagamentosCentavos: totalInformado - valorPixInformado,
  });

  function invalidarCheckout() {
    idempotencyRef.current =
      null;
    setErroPagamento(null);
  }

  function adicionarProduto(
    produto: Produto
  ) {
    const valor =
      paraCentavos(
        produto.preco_venda
      );

    const qtd = Math.max(
      1,
      Number(quantidadeDigitada.replace(",", ".")) || 1
    );
    const existente = carrinho.find(
      (item) => item.produtoId === produto.id
    );
    const quantidadeNova = existente
      ? quantidadeAposAdicionarPdv(existente.quantidade, qtd)
      : qtd;
    const checagem = avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque,
      disponivel: Number(produto.estoqueDisponivel) || 0,
      quantidade: quantidadeNova,
    });
    if (!checagem.ok) {
      setToastPdv(checagem.erro);
      return;
    }

    invalidarCheckout();
    setCarrinho(
      (atual) => {
        const jaExiste =
          atual.find(
            (item) =>
              item.produtoId ===
              produto.id
          );

        if (jaExiste) {
          return atual.map(
            (item) =>
              item.produtoId ===
              produto.id
                ? {
                    ...item,
                    quantidade: quantidadeAposAdicionarPdv(
                      item.quantidade,
                      qtd
                    ),
                  }
                : item
          );
        }

        return [
          ...atual,
          {
            produtoId:
              produto.id,
            codigo:
              produto.codigo,
            nome:
              produto.nome,
            unidadeMedida:
              produto.unidade_medida,
            quantidade: qtd,
            valorUnitarioCentavos:
              valor,
          },
        ];
      }
    );

    setBusca("");
    setQuantidadeDigitada("1");
    setIndiceSelecionadoBusca(null);
    detectorScannerRef.current = detectorScannerVazio();

    requestAnimationFrame(
      () =>
        buscaRef.current?.focus()
    );
  }

  function alterarQuantidade(
    produtoId: string,
    delta: number
  ) {
    if (delta > 0) {
      const item = carrinho.find((linha) => linha.produtoId === produtoId);
      const produto = produtos.find((linha) => linha.id === produtoId);
      const checagem = avaliarQuantidadeEstoquePdv({
        permitirVendaSemEstoque,
        disponivel: Number(produto?.estoqueDisponivel) || 0,
        quantidade: (item?.quantidade ?? 0) + delta,
      });
      if (!checagem.ok) {
        setToastPdv(checagem.erro);
        return;
      }
    }

    invalidarCheckout();

    setCarrinho(
      (atual) =>
        atual
          .map(
            (item) =>
              item.produtoId ===
              produtoId
                ? {
                    ...item,
                    quantidade:
                      item.quantidade +
                      delta,
                  }
                : item
          )
          .filter(
            (item) =>
              item.quantidade > 0
          )
    );
  }

  function removerItem(
    produtoId: string
  ) {
    invalidarCheckout();

    setCarrinho(
      (atual) =>
        atual.filter(
          (item) =>
            item.produtoId !==
            produtoId
        )
    );
  }

  function limparCarrinho() {
    if (
      carrinho.length === 0
    ) {
      return;
    }

    const confirmou =
      window.confirm(
        "Limpar todos os itens do carrinho?"
      );

    if (!confirmou) {
      return;
    }

    invalidarCheckout();
    setCarrinho([]);
    setCatalogoPedidoId(null);
    setPedidoObservacao(null);
    setClienteSelecionadoId(
      null
    );
    setDescontoCentavos(0);
    setDescontoTexto("0,00");
    setPagamentos([]);
    buscaRef.current?.focus();
  }

  function aoPressionarBusca(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
    detectorScannerRef.current = registrarTeclaBusca(
      detectorScannerRef.current,
      event.key,
      event.timeStamp
    );

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      detectorScannerRef.current = detectorScannerVazio();
      if (!busca.trim() || produtosBuscaVisiveis.length === 0) {
        return;
      }
      setIndiceSelecionadoBusca((atual) =>
        indiceAposSetaBuscaPdv({
          tecla: event.key === "ArrowUp" ? "ArrowUp" : "ArrowDown",
          indiceAtual: atual,
          total: produtosBuscaVisiveis.length,
        })
      );
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const leituraScanner = pareceLeituraScanner(
      detectorScannerRef.current,
      event.timeStamp
    );
    detectorScannerRef.current = detectorScannerVazio();

    const produtoSelecionado =
      indiceSelecionadoBusca == null
        ? null
        : produtosBuscaVisiveis[indiceSelecionadoBusca] ?? null;

    const acao = decidirAcaoEnterBuscaPdv({
      termo: busca,
      produtos,
      produtosFiltrados,
      leituraScanner,
      produtoSelecionado,
    });

    if (acao.tipo === "adicionar") {
      adicionarProduto(acao.produto as Produto);
      return;
    }

    if (acao.tipo === "nao-encontrado") {
      setToastPdv(MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO);
      setBusca("");
      requestAnimationFrame(() => buscaRef.current?.focus());
    }
  }

  function aplicarDesconto() {
    const valor =
      textoParaCentavos(
        descontoTexto
      );

    if (
      valor >
      subtotalCentavos
    ) {
      window.alert(
        "O desconto não pode ser maior que o subtotal."
      );
      return;
    }

    invalidarCheckout();
    setDescontoCentavos(
      valor
    );
    setModalDesconto(
      false
    );
  }

  function fecharPdv() {
    router.push(DESTINO_FECHAR_PDV);
  }

  async function salvarPreferencias(
    proxima: PreferenciasPdv,
    permitirSemEstoque: boolean
  ) {
    setSalvandoPreferencias(true);
    const resultado = await salvarPreferenciasPdvAction({
      ...proxima,
      permitirVendaSemEstoque: permitirSemEstoque,
    });
    setSalvandoPreferencias(false);

    if (!resultado.ok) {
      setToastPdv(resultado.erro);
      return;
    }

    setPreferencias(resultado.preferencias);
    setPreferenciasSalvas(resultado.preferencias);
    setPermitirVendaSemEstoque(resultado.permitirVendaSemEstoque);
    setPermitirVendaSemEstoqueSalvo(resultado.permitirVendaSemEstoque);
    setModalPreferencias(false);
    setToastPdv("Preferências do PDV salvas.");
  }

  async function abrirGavetaPdv() {
    setMenuUsuarioAberto(false);
    if (!caixaSessaoAberta) {
      setToastPdv(MENSAGEM_GAVETA_CAIXA_FECHADO);
      return;
    }
    const saida = await executarAberturaGaveta({ origem: "pdv" });
    setToastPdv(saida.ok ? saida.mensagem : saida.erro);
  }

  function abrirCliente(contexto: ContextoClientePdv = "manual") {
    setContextoCliente(contexto);
    setModalCliente(true);
  }

  function fecharModalCliente() {
    const cancelado = aoCancelarClienteDoFiado({
      contexto: contextoCliente,
    });

    setModalCliente(false);
    setBuscaCliente("");
    setContextoCliente(null);

    if (cancelado.usarFiado === false) {
      setUsarFiado(false);
      setErroPagamento(cancelado.mensagem);
      if (cancelado.reabrirPagamento) {
        setModalPagamento(true);
      }
    }
  }

  function abrirPagamento() {
    if (!caixaAberto) {
      return;
    }

    if (
      carrinho.length === 0
    ) {
      return;
    }

    setErroPagamento(
      null
    );

    if (
      pagamentos.length ===
      0 &&
      formasPagas.length >
        0
    ) {
      setPagamentos([
        {
          formaPagamentoId:
            formasPagas[0].id,
          valorTexto:
            centavosParaInput(
              totalCentavos
            ),
        },
      ]);
    }

    setModalPagamento(
      true
    );
  }

  function alternarFiado(marcado: boolean) {
    if (!formaFiado || !podeFiado) {
      return;
    }

    const decisao = aoMarcarFiado({
      marcado,
      clienteId: clienteSelecionadoId,
    });

    if (decisao === "pedir_cliente") {
      setUsarFiado(false);
      setErroPagamento(MENSAGEM_FIADO_EXIGE_CLIENTE);
      abrirCliente("fiado");
      return;
    }

    setUsarFiado(marcado);

    if (decisao === "ativar") {
      usarRestante(formaFiado.id);
      return;
    }

    atualizarPagamento(formaFiado.id, "");
  }

  function atualizarPagamento(
    formaPagamentoId: string,
    valorTexto: string
  ) {
    const forma = formasPagamento.find((item) => item.id === formaPagamentoId);
    if (ehFormaPix(forma ?? null) && !pixHabilitado) {
      setErroPagamento(MENSAGEM_CONFIGURE_PIX);
      return;
    }
    if (pixLocalAtivo && ehFormaPix(forma ?? null) && pixLocal) {
      const novoCentavos = textoParaCentavos(valorTexto);
      const decisao = decidirQrAposMudancaValor({
        status: pixLocal.status,
        valorQr: pixLocal.valorCentavos,
        valorNovo: novoCentavos,
      });

      if (decisao === "bloquear") {
        setErroPagamento(mensagemPixConfirmadoNaoAltera());
        return;
      }

      if (decisao === "descartar") {
        void fetch("/api/pagamentos/pix/local/descartar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recebimento_id: pixLocal.recebimentoId }),
        });
        setPixLocal(null);
      }
    }

    if (pixGeranetAtivo && ehFormaPix(forma ?? null) && pixGeranet) {
      const novoCentavos = textoParaCentavos(valorTexto);
      const decisao = decidirQrAposMudancaValorGeranet({
        status: pixGeranet.status,
        valorCobranca: pixGeranet.valorCentavos,
        valorNovo: novoCentavos,
      });

      if (decisao === "bloquear") {
        setErroPagamento(MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA);
        return;
      }

      if (decisao === "substituir") {
        setPixGeranet(null);
      }
    }

    invalidarCheckout();

    setPagamentos(
      (atual) => {
        const existe =
          atual.some(
            (pagamento) =>
              pagamento.formaPagamentoId ===
              formaPagamentoId
          );

        if (existe) {
          return atual.map(
            (pagamento) =>
              pagamento.formaPagamentoId ===
              formaPagamentoId
                ? {
                    ...pagamento,
                    valorTexto,
                  }
                : pagamento
          );
        }

        return [
          ...atual,
          {
            formaPagamentoId,
            valorTexto,
          },
        ];
      }
    );
  }

  function usarRestante(
    formaPagamentoId: string,
    pagamentosBase = pagamentosCalculados
  ) {
    const outros =
      pagamentosBase
        .filter(
          (pagamento) =>
            pagamento.formaPagamentoId !==
            formaPagamentoId
        )
        .reduce(
          (
            acumulado,
            pagamento
          ) =>
            acumulado +
            pagamento.valorCentavos,
          0
        );

    const restante =
      Math.max(
        0,
        totalCentavos -
          outros
      );

    const valorTexto =
      centavosParaInput(
        restante
      );

    if (pagamentosBase.length === 0) {
      invalidarCheckout();
      setPagamentos([
        {
          formaPagamentoId,
          valorTexto,
        },
      ]);
      return;
    }

    atualizarPagamento(
      formaPagamentoId,
      valorTexto
    );
  }

  function selecionarCliente(
    clienteId: string
  ) {
    const resetar = deveResetarPagamentosAposCliente({
      contexto: contextoCliente,
      clienteSelecionado: true,
    });

    invalidarCheckout();
    setClienteSelecionadoId(
      clienteId
    );
    setModalCliente(false);
    setBuscaCliente("");

    if (resetar) {
      if (pixLocal) {
        void fetch("/api/pagamentos/pix/local/descartar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recebimento_id: pixLocal.recebimentoId }),
        });
        setPixLocal(null);
      }

      if (pixGeranet) {
        void fetch("/api/pagamentos/pix/geranet/cancelar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cobranca_id: pixGeranet.cobrancaId }),
        });
        resetarCheckoutPixGeranet();
      }

      setUsarFiado(true);
      if (formaFiado) {
        usarRestante(formaFiado.id, []);
      } else {
        setPagamentos(resetarPagamentosAposClienteFiado());
      }
      setErroPagamento(null);
      setModalPagamento(true);
      setContextoCliente(null);
      return;
    }

    setContextoCliente(null);
    buscaRef.current?.focus();
  }

  function removerCliente() {
    invalidarCheckout();
    setClienteSelecionadoId(
      null
    );
  }

  function finalizar() {
    if (!caixaAberto) {
      return;
    }

    setErroPagamento(
      null
    );

    if (
      carrinho.length === 0
    ) {
      setErroPagamento(
        "Adicione ao menos um produto."
      );
      return;
    }

    for (const item of carrinho) {
      const produto = produtos.find((linha) => linha.id === item.produtoId);
      const checagem = avaliarQuantidadeEstoquePdv({
        permitirVendaSemEstoque,
        disponivel: Number(produto?.estoqueDisponivel) || 0,
        quantidade: item.quantidade,
      });
      if (!checagem.ok) {
        setErroPagamento(checagem.erro);
        return;
      }
    }

    if (
      !podeConcluirFiado({
        usarFiado,
        clienteId: clienteSelecionadoId,
      })
    ) {
      setErroPagamento(MENSAGEM_FIADO_EXIGE_CLIENTE);
      abrirCliente("fiado");
      return;
    }

    if (
      totalCentavos <= 0
    ) {
      setErroPagamento(
        "O total da venda deve ser maior que zero."
      );
      return;
    }

    if (
      pagamentosCalculados.length ===
      0
    ) {
      setErroPagamento(
        "Informe ao menos uma forma de pagamento."
      );
      return;
    }

    if (
      totalInformado <
      totalCentavos
    ) {
      setErroPagamento(
        `Ainda faltam ${dinheiroCentavos(
          restanteCentavos
        )}.`
      );
      return;
    }

    if (pagamentoExcedente) {
      setErroPagamento(
        avaliacaoPagamentos.mensagem ?? MENSAGEM_PAGAMENTOS_ULTRAPASSAM
      );
      return;
    }

    const documentoClienteDigitos = somenteDigitosDocumento(
      clienteSelecionado?.cpf_cnpj
    );
    const usarDocumentoCliente =
      Boolean(documentoClienteDigitos) && usarDocumentoClienteNaNota;
    if (cpfNaNotaAtivo && !usarDocumentoCliente) {
      const digitado = somenteDigitosDocumento(cpfNaNota);
      if (digitado && !cpfValido(digitado)) {
        setErroPagamento(MENSAGEM_CPF_INVALIDO);
        return;
      }
    }

    if (
      pagamentosCalculados.some(
        (pagamento) => ehFormaPix(pagamento.forma)
      ) &&
      !pixHabilitado
    ) {
      setErroPagamento(MENSAGEM_CONFIGURE_PIX);
      return;
    }

    if (pixLocalAtivo) {
      const pixPendente = pagamentosCalculados.find((pagamento) =>
        ehFormaPix(pagamento.forma)
      );

      if (pixPendente) {
        if (
          !pixLocal ||
          pixLocal.status !== "confirmado_manual" ||
          pixLocal.valorCentavos !== pixPendente.valorCentavos
        ) {
          setErroPagamento(
            mensagemBloqueioPixPendente(pixPendente.valorCentavos / 100)
          );
          return;
        }
      }
    }

    if (pixGeranetAtivo) {
      const pixPendente = pagamentosCalculados.find((pagamento) =>
        ehFormaPix(pagamento.forma)
      );

      if (pixPendente) {
        if (
          !pixGeranet ||
          pixGeranet.status !== "paga" ||
          pixGeranet.valorCentavos !== pixPendente.valorCentavos
        ) {
          setErroPagamento(
            pixGeranet?.status === "divergencia_valor"
              ? "PIX recebido com valor divergente. Verifique antes de continuar."
              : pixGeranet?.estado === "indeterminado"
                ? "Não foi possível confirmar automaticamente o pagamento."
                : MENSAGEM_PIX_GERANET_AGUARDANDO
          );
          return;
        }
      }
    }

    if (
      !idempotencyRef.current
    ) {
      idempotencyRef.current =
        crypto.randomUUID();
    }

    const idempotencyKey =
      idempotencyRef.current;

    startTransition(
      async () => {
        const resultado =
          await finalizarVendaPdv(
            {
              idempotencyKey,
              clienteId:
                clienteSelecionadoId,
              descontoCentavos:
                descontoAplicado,
              trocoCentavos,
              itens:
                carrinho.map(
                  (item) => ({
                    produtoId:
                      item.produtoId,
                    quantidade:
                      item.quantidade,
                  })
                ),
              pagamentos:
                pagamentosCalculados.map(
                  (pagamento) => ({
                    formaPagamentoId:
                      pagamento.formaPagamentoId,
                    valorCentavos:
                      pagamento.valorCentavos,
                    pixLocalRecebimentoId:
                      pixLocalAtivo &&
                      ehFormaPix(pagamento.forma) &&
                      pixLocal?.status === "confirmado_manual"
                        ? pixLocal.recebimentoId
                        : pixGeranetAtivo &&
                            ehFormaPix(pagamento.forma) &&
                            pixGeranet?.status === "paga"
                          ? pixGeranet.cobrancaId
                          : null,
                  })
                ),
              observacao: pedidoObservacao,
              catalogoPedidoId,
              cpfNaNota:
                cpfNaNotaAtivo &&
                !usarDocumentoCliente
                  ? cpfNaNota
                  : null,
              usarDocumentoClienteNaNota: usarDocumentoCliente,
            }
          );

        if (!resultado.ok) {
          setErroPagamento(
            resultado.erro
          );
          return;
        }

        const pagamentosDaVenda = pagamentosCalculados;
        let avisoGaveta: string | null = null;
        if (
          deveAbrirGavetaAposVenda({
            configAtiva: abrirGavetaAposVendaDinheiro,
            pagamentos: pagamentosDaVenda,
          })
        ) {
          try {
            const gaveta = await executarAberturaGaveta({
              origem: "venda",
              vendaId: resultado.vendaId,
              exigirCaixaAberto: false,
            });
            if (!gaveta.ok) {
              avisoGaveta = MENSAGEM_GAVETA_VENDA_SEM_ABRIR;
            }
          } catch {
            avisoGaveta = MENSAGEM_GAVETA_VENDA_SEM_ABRIR;
          }
        }

        setUltimaVenda({
          vendaId:
            resultado.vendaId,
          numero:
            resultado.numero,
          totalCentavos:
            resultado.valorTotalCentavos,
                fiscal: emitirNfceAutomaticoPdv
            ? {
                emitindo: true,
                kind: null,
                status: null,
                mensagem: "Emitindo NFC-e...",
                emissaoId: null,
                danfeDisponivel: false,
              }
            : null,
          avisoGaveta,
        });
        setImpressaoPos({
          status: "idle",
          erro: null,
          mensagem: null,
          destino: { tipo: "nenhum" },
        });

        setCarrinho([]);
        setCatalogoPedidoId(null);
        setPedidoObservacao(null);
        setClienteSelecionadoId(
          null
        );
        setDescontoCentavos(0);
        setDescontoTexto(
          "0,00"
        );
        setPagamentos([]);
        setPixLocal(null);
        resetarCheckoutPixGeranet();
        setUsarFiado(false);
        setCpfNaNotaAtivo(false);
        setCpfNaNota("");
        setUsarDocumentoClienteNaNota(true);
        setModalPagamento(
          false
        );
        setErroPagamento(
          null
        );

        if (!emitirNfceAutomaticoPdv) {
          await tentarImpressaoPosVenda(
            resultado.vendaId,
            null,
            imprimirApos
          );
        }
        idempotencyRef.current =
          null;

        if (emitirNfceAutomaticoPdv) {
          const fiscal = await chamarEmissaoNfceVenda({
            vendaId: resultado.vendaId,
            ambiente: ambienteFiscal === 1 ? 1 : 2,
          });
          const danfeDisponivel =
            fiscal.kind === "autorizada" && Boolean(fiscal.emissaoId);
          const fiscalAtualizado = {
            emitindo: false as const,
            kind: fiscal.kind,
            status: fiscal.status,
            mensagem: fiscal.mensagem,
            emissaoId: fiscal.emissaoId,
            danfeDisponivel,
          };
          setUltimaVenda((atual) =>
            atual && atual.vendaId === resultado.vendaId
              ? {
                  ...atual,
                  fiscal: fiscalAtualizado,
                }
              : atual
          );
          await tentarImpressaoPosVenda(
            resultado.vendaId,
            fiscalAtualizado,
            imprimirApos
          );
        }

        requestAnimationFrame(
          () =>
            buscaRef.current?.focus()
        );
      }
    );
  }

  useEffect(() => {
    function teclado(
      event: KeyboardEvent
    ) {
      if (!caixaAberto) {
        if (
          event.key === "F2" ||
          event.key === "F3" ||
          event.key === "F4" ||
          event.key === "F5"
        ) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "F4") {
        event.preventDefault();
        void abrirGavetaPdv();
        return;
      }

      if (
        event.key === "F3"
      ) {
        event.preventDefault();

        if (
          carrinho.length >
          0
        ) {
          setDescontoTexto(
            centavosParaInput(
              descontoAplicado
            )
          );
          setModalDesconto(
            true
          );
        }
      }

      if (
        event.key === "F5"
      ) {
        event.preventDefault();
        abrirCliente(
          contextoCliente === "fiado" ? "fiado" : "manual"
        );
      }

      if (
        event.key === "F2"
      ) {
        event.preventDefault();
        if (modalPagamento) {
          finalizar();
        } else {
          abrirPagamento();
        }
      }

      if (
        event.key === "Escape"
      ) {
        event.preventDefault();
        const decisao = decidirAcaoEscPdv({
          "sucesso-venda": Boolean(ultimaVenda),
          "descartar-pix": descartarGeranetAberto,
          preferencias: modalPreferencias,
          cliente: modalCliente,
          desconto: modalDesconto,
          pagamento: modalPagamento,
          "menu-usuario": menuUsuarioAberto,
        });

        if (decisao.acao === "sair-pdv") {
          fecharPdv();
          return;
        }

        if (decisao.overlay === "sucesso-venda") {
          setUltimaVenda(null);
          return;
        }

        if (decisao.overlay === "descartar-pix") {
          setDescartarGeranetAberto(false);
          return;
        }

        if (decisao.overlay === "preferencias") {
          setPreferencias(preferenciasSalvas);
          setPermitirVendaSemEstoque(permitirVendaSemEstoqueSalvo);
          setModalPreferencias(false);
          return;
        }

        if (decisao.overlay === "cliente") {
          fecharModalCliente();
          return;
        }

        if (decisao.overlay === "desconto") {
          setModalDesconto(false);
          return;
        }

        if (decisao.overlay === "pagamento") {
          if (pixGeranetAtivo && pixGeranet?.status === "pendente") {
            setDescartarGeranetAberto(true);
            return;
          }

          setModalPagamento(false);
          return;
        }

        setMenuUsuarioAberto(false);
      }
    }

    window.addEventListener(
      "keydown",
      teclado
    );

    return () =>
      window.removeEventListener(
        "keydown",
        teclado
      );
  });

  const acoesPosVenda = ultimaVenda
    ? resolverAcoesPosVendaPdv({
        emitirNfceAutomatico: emitirNfceAutomaticoPdv,
        vendaId: ultimaVenda.vendaId,
        imprimirApos: false,
        fiscal: ultimaVenda.fiscal,
      })
    : null;

  return (
    <div
      className="pdv-shell flex h-screen flex-col"
      data-pdv-palette={preferencias.paleta}
      style={estiloTokensPdv(preferencias.paleta) as CSSProperties}
    >
      {!caixaAberto ? (
        <PdvCaixaFechado
          podeAbrir={podeAbrirCaixa}
          onSair={fecharPdv}
        />
      ) : null}
      {caixaAberto && caixaReabertoAviso ? (
        <CaixaAvisoReabertoFaixa aviso={caixaReabertoAviso} />
      ) : null}
      {ultimaVenda && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
              ✓
            </div>

            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Venda finalizada
            </p>

            <h2 className="mt-1 text-2xl font-bold text-zinc-950">
              Venda #{ultimaVenda.numero}
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Total da venda
            </p>

            <p className="mt-1 text-3xl font-bold text-zinc-950">
              {dinheiroCentavos(
                ultimaVenda.totalCentavos
              )}
            </p>

            {ultimaVenda.avisoGaveta ? (
              <p className="mt-3 whitespace-pre-line text-sm text-amber-800">
                {ultimaVenda.avisoGaveta}
              </p>
            ) : null}

            {impressaoPos.status === "imprimindo" ? (
              <p className="mt-3 text-sm text-zinc-500">Enviando para impressão...</p>
            ) : null}
            {impressaoPos.status === "ok" ? (
              <p className="mt-3 text-sm text-emerald-700">
                {impressaoPos.mensagem || "Enviado para impressão"}
              </p>
            ) : null}
            {impressaoPos.status === "falha" ? (
              <div className="mt-3 space-y-2">
                <p className="whitespace-pre-line text-sm text-amber-800">
                  {impressaoPos.erro ||
                    "Venda concluída, mas não foi possível imprimir."}
                </p>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                  onClick={() => {
                    if (!ultimaVenda) {
                      return;
                    }
                    void tentarImpressaoPosVenda(
                      ultimaVenda.vendaId,
                      ultimaVenda.fiscal,
                      true
                    );
                  }}
                >
                  Tentar novamente
                </button>
              </div>
            ) : null}

            {acoesPosVenda?.mostrarStatusFiscal ? (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                  ultimaVenda.fiscal?.emitindo
                    ? "border-zinc-200 bg-zinc-50 text-zinc-700"
                    : ultimaVenda.fiscal?.kind === "autorizada"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <p className="font-semibold">{acoesPosVenda.rotuloFiscal}</p>
                {acoesPosVenda.detalheFiscal ? (
                  <p className="mt-1">{acoesPosVenda.detalheFiscal}</p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {acoesPosVenda?.mostrarImprimirNfce && ultimaVenda.fiscal?.emissaoId ? (
                <BotaoImprimirConector
                  pdfUrl={`/api/impressao/danfe/${ultimaVenda.fiscal.emissaoId}`}
                  tipoDocumento="danfe_nfce"
                  papel={configDoTipo(configsImpressao, "danfe_nfce").papel}
                  label="Imprimir NFC-e"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                />
              ) : null}

              {acoesPosVenda?.mostrarImprimirNfce && acoesPosVenda.hrefDanfe ? (
                <a
                  href={acoesPosVenda.hrefDanfe}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                >
                  Visualizar DANFE
                </a>
              ) : null}

              {acoesPosVenda?.mostrarVerSituacaoFiscal ? (
                <a
                  href={acoesPosVenda.hrefSituacaoFiscal}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                >
                  Ver situação fiscal
                </a>
              ) : null}

              {acoesPosVenda?.mostrarImprimirReciboNormal ? (
                <BotaoImprimirConector
                  pdfUrl={`/api/impressao/recibo/${ultimaVenda.vendaId}?papel=${configDoTipo(configsImpressao, "recibo").papel}`}
                  tipoDocumento="recibo"
                  papel={configDoTipo(configsImpressao, "recibo").papel}
                  label={acoesPosVenda.rotuloBotaoRecibo}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                />
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setUltimaVenda(null);
                  setImpressaoPos({
                    status: "idle",
                    erro: null,
                    mensagem: null,
                    destino: { tipo: "nenhum" },
                  });
                  setBusca("");

                  requestAnimationFrame(
                    () =>
                      buscaRef.current?.focus()
                  );
                }}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
              >
                Nova venda
              </button>
            </div>

            {acoesPosVenda?.mostrarImprimirReciboNormal ? (
              <p className="mt-4 text-center text-xs leading-5 text-zinc-400">
                O recibo é comercial e não substitui NF-e, NFC-e ou DANFE.
                Imprimir o recibo não altera a situação fiscal.
              </p>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="pdv-main relative flex min-w-0 flex-1 flex-col px-8 pt-6">
          {deveRenderizarLogoCentro({
            mostrarLogoCentro: preferencias.mostrarLogoCentro,
            logoUrl,
            carrinhoVazio: carrinho.length === 0,
            buscaAtiva: Boolean(busca.trim()),
            resultadosAbertos: Boolean(busca.trim()),
            buscaCarregando: false,
          }) ? (
            <div className="pdv-logo-centro" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl ?? ""}
                alt=""
              />
            </div>
          ) : null}
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
          {pedidoInicial && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">
                Pedido Online {codigoPedidoAmigavel(pedidoInicial.codigo)}
              </p>
              <p className="mt-1 text-amber-800">
                Cliente: {pedidoInicial.clienteNome} · WhatsApp:{" "}
                {formatarWhatsappExibicao(pedidoInicial.clienteWhatsapp)}
              </p>
              <p className="mt-0.5 text-amber-800">
                {pedidoInicial.tipoEntrega === "entrega"
                  ? "Entrega"
                  : "Retirada"}
                {pedidoInicial.endereco
                  ? ` · ${pedidoInicial.endereco}`
                  : ""}
              </p>
              {pedidoInicial.observacao && (
                <p className="mt-1">Obs: {pedidoInicial.observacao}</p>
              )}
              {pedidoInicial.avisos.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {pedidoInicial.avisos.map((aviso) => (
                    <li key={`${aviso.tipo}-${aviso.produtoId}`}>
                      {aviso.detalhe}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs">
                Cliente do catálogo não foi cadastrado automaticamente.
                Vincule um cliente só se quiser. A venda só existe depois de
                Concluir Venda.
              </p>
            </div>
          )}

          <div className="relative grid grid-cols-[1fr_auto] items-start gap-3">
            <h1 className="text-[32px] font-bold leading-none text-zinc-950">
              Venda
            </h1>
            <div className="relative flex items-center justify-end gap-2 text-zinc-400">
              <span className="hidden max-w-[220px] truncate text-right text-xs text-zinc-500 md:inline">
                {empresaNome}
                {usuarioNome ? ` · ${usuarioNome}` : ""}
              </span>
              <div className="relative">
                <button
                  type="button"
                  className="rounded p-1 hover:bg-zinc-100"
                  aria-label="Mais opções"
                  onClick={() => setMenuUsuarioAberto((aberto) => !aberto)}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {menuUsuarioAberto ? (
                  <div className="absolute right-0 top-9 z-20 min-w-[180px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                      onClick={() => {
                        void abrirGavetaPdv();
                      }}
                    >
                      Abrir gaveta
                    </button>
                    <Link
                      href="/logout"
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                      onClick={() => setMenuUsuarioAberto(false)}
                    >
                      <LogOut className="h-4 w-4" />
                      Sair
                    </Link>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded p-1 hover:bg-zinc-100"
                aria-label="Preferências do PDV"
                onClick={() => {
                  setMenuUsuarioAberto(false);
                  setModalPreferencias(true);
                }}
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="relative z-10 mt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 flex-1 items-center rounded-full border border-zinc-200 bg-white px-4">
              <Search className="h-5 w-5 shrink-0 text-zinc-400" />
              <input
                ref={buscaRef}
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                onKeyDown={aoPressionarBusca}
                placeholder="Buscar produto, código ou código de barras"
                className="ml-3 h-full flex-1 border-0 bg-transparent text-sm outline-none"
                autoComplete="off"
              />
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
            </div>
            <div className="flex h-10 items-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700">
              Quant:
              <CampoValor
                value={quantidadeDigitada}
                onChange={(event) =>
                  setQuantidadeDigitada(event.target.value)
                }
                inputMode="decimal"
                className="ml-1 w-10 border-0 bg-transparent p-0 text-center text-sm font-semibold outline-none"
              />
            </div>
          </div>

          {busca.trim() ? (
            <div className="pdv-busca-resultados mt-2 max-h-64 overflow-y-auto rounded-xl border border-zinc-200">
              <PdvBuscaResultados
                produtos={produtosBuscaVisiveis}
                produtoSelecionadoId={
                  indiceSelecionadoBusca == null
                    ? null
                    : produtosBuscaVisiveis[indiceSelecionadoBusca]?.id ?? null
                }
                onEscolher={adicionarProduto}
              />
            </div>
          ) : null}
          </div>

          <div className="relative z-[1] mt-6 min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-[48px_72px_minmax(0,1fr)_160px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              <span>Nº</span>
              <span>Qtd</span>
              <span>Produto</span>
              <span className="text-right">Preço</span>
            </div>
            <div className="mt-2 border-t border-zinc-200">
              {carrinho.length === 0 ? (
                busca.trim() ? null : (
                <p className="py-16 text-center text-sm text-zinc-400">
                  Busque um produto para iniciar a venda.
                </p>
                )
              ) : (
                carrinho.map((item, index) => (
                  <div
                    key={item.produtoId}
                    className="grid grid-cols-[48px_72px_minmax(0,1fr)_160px] items-start gap-2 border-b border-zinc-100 py-4"
                  >
                    <span className="pt-3 text-sm text-zinc-400">
                      #{index + 1}
                    </span>
                    <div className="pt-2">
                      <div className="inline-flex items-center overflow-hidden rounded border border-zinc-200">
                        <button
                          type="button"
                          onClick={() =>
                            alterarQuantidade(item.produtoId, -1)
                          }
                          className="px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-50"
                        >
                          −
                        </button>
                        <span className="min-w-8 border-x border-zinc-200 px-1 text-center text-sm font-bold">
                          {item.quantidade}x
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            alterarQuantidade(item.produtoId, 1)
                          }
                          className="px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-50"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-3">
                      {(() => {
                        const produto = produtos.find(
                          (itemProduto) => itemProduto.id === item.produtoId
                        );
                        const foto =
                          produto &&
                          deveMostrarFotoProduto({
                            mostrarFotosProdutos:
                              preferencias.mostrarFotosProdutos,
                            imagemPath: produto.catalogo_imagem_path,
                            empresaId,
                          })
                            ? urlPublicaCatalogo(produto.catalogo_imagem_path)
                            : null;

                        if (foto) {
                          return (
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={foto}
                                alt=""
                                width={48}
                                height={48}
                                loading="lazy"
                                decoding="async"
                                className="h-12 w-12 object-contain"
                              />
                            </span>
                          );
                        }

                        return (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400">
                        <Package className="h-5 w-5" />
                      </div>
                        );
                      })()}
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-zinc-950">
                          {item.nome}
                        </p>
                        <p className="mt-0.5 text-sm text-zinc-400">
                          Preço:{" "}
                          {dinheiroCentavos(item.valorUnitarioCentavos)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-start justify-end gap-2">
                        <span className="pt-0.5 text-[15px] font-bold text-zinc-950">
                          {dinheiroCentavos(
                            item.quantidade * item.valorUnitarioCentavos
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removerItem(item.produtoId)}
                          className="text-zinc-400 hover:text-red-600"
                          aria-label="Remover"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {podeDesconto && (
                      <button
                        type="button"
                        onClick={() => {
                          setDescontoTexto(
                            centavosParaInput(descontoAplicado)
                          );
                          setModalDesconto(true);
                        }}
                        className="mt-1 text-xs text-zinc-400 hover:text-zinc-700"
                      >
                        Aplicar desconto
                      </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex h-20 shrink-0 items-center justify-between">
            <button
              type="button"
              onClick={abrirPagamento}
              disabled={carrinho.length === 0 || isPending}
              className="pdv-btn-primary h-12 rounded-md px-7 text-sm font-bold uppercase tracking-wide disabled:bg-zinc-300"
            >
              {isPending ? "Finalizando..." : "Concluir venda - F2"}
            </button>
            <p className="text-[28px] font-bold text-zinc-950">
              Total: {dinheiroCentavos(totalCentavos)}
            </p>
          </div>
          </div>
        </section>

        <aside className="pdv-sidebar hidden w-64 shrink-0 flex-col border-l border-zinc-200 lg:flex">
          <div className="flex items-start justify-between px-5 pt-6">
            <div>
              <p className="text-2xl font-bold text-zinc-950">
                {carrinho.length} item{carrinho.length === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Quantidade: {quantidadeTotal}
              </p>
            </div>
            <Link
              href={DESTINO_FECHAR_PDV}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </Link>
          </div>

          <div className="mt-6 divide-y divide-zinc-200 border-y border-zinc-200 text-[15px] font-semibold text-zinc-950">
            <button
              type="button"
              onClick={() =>
                abrirCliente(contextoCliente === "fiado" ? "fiado" : "manual")
              }
              className="block w-full px-5 py-3.5 text-left hover:bg-zinc-50"
            >
              {clienteSelecionado
                ? clienteSelecionado.nome
                : "Cliente"}{" "}
              - F5
            </button>
            <button
              type="button"
              disabled={carrinho.length === 0}
              onClick={() => {
                setDescontoTexto(centavosParaInput(descontoAplicado));
                setModalDesconto(true);
              }}
              className="block w-full px-5 py-3.5 text-left hover:bg-zinc-50 disabled:opacity-40"
            >
              Desconto - F3
            </button>
            <button
              type="button"
              onClick={limparCarrinho}
              disabled={carrinho.length === 0}
              className="block w-full px-5 py-3.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-30"
            >
              Limpar
            </button>
          </div>

          {clienteSelecionado && (
            <button
              type="button"
              onClick={removerCliente}
              className="px-5 pt-2 text-left text-xs font-medium text-red-600"
            >
              Remover cliente
            </button>
          )}

          <div className="mt-auto px-5 py-5 text-xs text-zinc-500">
            <p className="mb-2 font-semibold uppercase tracking-wide text-zinc-400">
              Atalhos
            </p>
            <p>F2 Concluir venda</p>
            <p>F3 Desconto</p>
            <p>F4 Abrir gaveta</p>
            <p>F5 Cliente</p>
            <p>Esc fecha janela / sai do PDV</p>
            {descontoAplicado > 0 && (
              <p className="mt-3 font-medium text-zinc-700">
                Desconto: {dinheiroCentavos(descontoAplicado)}
              </p>
            )}
          </div>
        </aside>
      </div>

      {modalCliente && (
        <Modal
          titulo="Selecionar cliente"
          onClose={fecharModalCliente}
        >
          {contextoCliente === "fiado" ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {MENSAGEM_FIADO_EXIGE_CLIENTE}
            </p>
          ) : null}
          <input
            autoFocus
            value={
              buscaCliente
            }
            onChange={(
              event
            ) =>
              setBuscaCliente(
                event.target.value
              )
            }
            placeholder="Nome, CPF/CNPJ ou telefone"
            className={inputClass}
          />

          <div className="mt-4 max-h-[55vh] overflow-y-auto rounded-xl border border-zinc-200">
            {clientesFiltrados.length ===
            0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                Nenhum cliente encontrado.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {clientesFiltrados.map(
                  (
                    cliente
                  ) => (
                    <button
                      key={
                        cliente.id
                      }
                      type="button"
                      onClick={() =>
                        selecionarCliente(
                          cliente.id
                        )
                      }
                      className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-zinc-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {
                            cliente.nome
                          }
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          {documentoCurto(
                            cliente.cpf_cnpj
                          ) ||
                            "Sem documento"}
                          {cliente.telefone
                            ? ` • ${cliente.telefone}`
                            : ""}
                        </p>
                      </div>

                      {cliente.bloqueado && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                          Fiado bloqueado
                        </span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-between">
            <Link
              href="/clientes"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              Cadastrar cliente
            </Link>

            {clienteSelecionado && contextoCliente !== "fiado" && (
              <button
                type="button"
                onClick={() => {
                  removerCliente();
                  setModalCliente(
                    false
                  );
                }}
                className="text-sm font-medium text-red-600"
              >
                Venda sem cliente
              </button>
            )}
          </div>
        </Modal>
      )}

      {modalDesconto && (
        <Modal
          titulo="Desconto da venda"
          onClose={() =>
            setModalDesconto(
              false
            )
          }
        >
          <label className="text-sm font-medium text-zinc-700">
            Desconto em R$
          </label>

          <CampoValor
            autoFocus
            value={
              descontoTexto
            }
            onChange={(
              event
            ) =>
              setDescontoTexto(
                event.target.value
              )
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "Enter"
              ) {
                event.preventDefault();
                aplicarDesconto();
              }
            }}
            inputMode="decimal"
            className={inputClass}
          />

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                invalidarCheckout();
                setDescontoCentavos(
                  0
                );
                setDescontoTexto(
                  "0,00"
                );
                setModalDesconto(
                  false
                );
              }}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Remover desconto
            </button>

            <button
              type="button"
              onClick={
                aplicarDesconto
              }
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Aplicar
            </button>
          </div>
        </Modal>
      )}

      {modalPagamento && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            disabled={isPending}
            onClick={() => {
              if (isPending) {
                return;
              }

              if (pixGeranetAtivo && pixGeranet?.status === "pendente") {
                setDescartarGeranetAberto(true);
                return;
              }

              setModalPagamento(false);
            }}
            className="absolute inset-0 bg-black/40"
          />
          <div className={`pdv-modal-box relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-xl px-6 pb-6 pt-8 shadow-2xl ${
            pixLocalAtivo || pixGeranetAtivo ? "max-w-lg" : "max-w-[420px]"
          }`}>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (isPending) {
                  return;
                }

                if (pixGeranetAtivo && pixGeranet?.status === "pendente") {
                  setDescartarGeranetAberto(true);
                  return;
                }

                setModalPagamento(false);
              }}
              className="absolute right-4 top-4 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-center text-[28px] font-bold leading-none text-zinc-950">
              Total: {dinheiroCentavos(totalCentavos)}
            </h2>
            <button
              type="button"
              disabled={carrinho.length === 0}
              onClick={() => {
                setDescontoTexto(centavosParaInput(descontoAplicado));
                setModalDesconto(true);
              }}
              className="mt-2 w-full text-center text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-700"
            >
              F3 Desconto
            </button>

            <div className="mt-6 divide-y divide-zinc-200 border-y border-zinc-200">
              {formasPagas.map((forma) => {
                const atual = pagamentos.find(
                  (pagamento) => pagamento.formaPagamentoId === forma.id
                );
                const selecionada = Boolean(atual?.valorTexto);
                const Icone = iconeFormaPagamento(forma);

                return (
                  <div
                    key={forma.id}
                    className={`flex items-center gap-3 px-3 py-3 ${
                      selecionada ? "pdv-row-selected" : "bg-white"
                    }`}
                  >
                    <Icone
                      className={`h-5 w-5 ${
                        selecionada ? "text-emerald-600" : "text-zinc-500"
                      }`}
                    />
                    <span className="flex-1 text-sm font-medium text-zinc-900">
                      {rotuloFormaCheckout(forma)}
                    </span>
                    <CampoValor
                      value={atual?.valorTexto ?? ""}
                      onChange={(event) =>
                        atualizarPagamento(forma.id, event.target.value)
                      }
                      onFocus={() => {
                        if (
                          ehFormaPix(forma) &&
                          !pixHabilitado
                        ) {
                          return;
                        }
                        if (!atual?.valorTexto && restanteCentavos > 0) {
                          usarRestante(forma.id);
                        }
                      }}
                      inputMode="decimal"
                      placeholder="0,00"
                      disabled={ehFormaPix(forma) && !pixHabilitado}
                      readOnly={
                        (pixLocalAtivo &&
                          ehFormaPix(forma) &&
                          pixLocal?.status === "confirmado_manual") ||
                        (pixGeranetAtivo &&
                          ehFormaPix(forma) &&
                          pixGeranet?.status === "paga")
                      }
                      className={`h-8 w-24 rounded border px-2 text-right text-sm outline-none ${
                        ehFormaPix(forma) && !pixHabilitado
                          ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                          : selecionada
                            ? "border-blue-500 bg-white"
                            : "border-zinc-200 bg-white"
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {!pixHabilitado && formaPix && (
              <p className="mt-3 text-sm text-zinc-500">
                {MENSAGEM_CONFIGURE_PIX}
              </p>
            )}

            {pixLocalAtivo &&
              formaPix &&
              (pagamentosCalculados.find(
                (pagamento) => pagamento.formaPagamentoId === formaPix.id
              )?.valorCentavos ?? 0) > 0 && (
              <PixLocalCheckout
                formaPagamentoId={formaPix.id}
                valorCentavos={
                  pagamentosCalculados.find(
                    (pagamento) => pagamento.formaPagamentoId === formaPix.id
                  )?.valorCentavos ?? 0
                }
                saldoRestanteCentavos={saldoRestantePixCentavos}
                state={
                  pixLocal?.formaPagamentoId === formaPix.id ? pixLocal : null
                }
                ocupado={isPending}
                onState={setPixLocal}
                onErro={setErroPagamento}
              />
            )}

            {pixGeranetAtivo &&
              formaPix &&
              (pagamentosCalculados.find(
                (pagamento) => pagamento.formaPagamentoId === formaPix.id
              )?.valorCentavos ?? 0) > 0 && (
              <PixGeranetCheckout
                formaPagamentoId={formaPix.id}
                valorCentavos={
                  pagamentosCalculados.find(
                    (pagamento) => pagamento.formaPagamentoId === formaPix.id
                  )?.valorCentavos ?? 0
                }
                saldoRestanteCentavos={saldoRestantePixCentavos}
                checkoutKey={checkoutKeyPixGeranet()}
                clienteId={clienteSelecionadoId}
                provedorNome={pixProvedorNome}
                state={
                  pixGeranet?.formaPagamentoId === formaPix.id
                    ? pixGeranet
                    : null
                }
                ocupado={isPending}
                onState={setPixGeranet}
                onErro={setErroPagamento}
              />
            )}

            <div
              className={`mt-4 space-y-1 rounded-md border p-3 text-sm ${
                pagamentoExcedente
                  ? "border-red-300 bg-red-50 text-red-800"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
              }`}
            >
              <p>Total da venda: {dinheiroCentavos(totalCentavos)}</p>
              <p>
                Pagamentos informados:{" "}
                {dinheiroCentavos(totalInformado)}
              </p>
              {pagamentoExcedente ? (
                <>
                  <p className="font-semibold">
                    Excedente:{" "}
                    {dinheiroCentavos(avaliacaoPagamentos.excedenteCentavos)}
                  </p>
                  <p className="font-semibold">
                    {MENSAGEM_PAGAMENTOS_ULTRAPASSAM}
                  </p>
                </>
              ) : (
                <p>Restante: {dinheiroCentavos(restanteCentavos)}</p>
              )}
            </div>

            {trocoCentavos > 0 && (
              <p className="mt-4 text-right text-lg font-bold text-zinc-950">
                Troco {dinheiroCentavos(trocoCentavos)}
              </p>
            )}

            <PdvConsumidorNota
              clienteDocumento={clienteSelecionado?.cpf_cnpj ?? null}
              usarDocumentoCliente={usarDocumentoClienteNaNota}
              onUsarDocumentoCliente={setUsarDocumentoClienteNaNota}
              cpfNaNotaAtivo={cpfNaNotaAtivo}
              onCpfNaNotaAtivo={setCpfNaNotaAtivo}
              cpfNaNota={cpfNaNota}
              onCpfNaNota={setCpfNaNota}
            />

            <div className="mt-4 flex items-center justify-between text-sm text-zinc-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={imprimirApos}
                  onChange={(event) =>
                    setImprimirApos(event.target.checked)
                  }
                />
                Imprimir
              </label>
              {formaFiado && podeFiado && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={usarFiado}
                    onChange={(event) =>
                      alternarFiado(event.target.checked)
                    }
                  />
                  Fiado (pagar depois)
                </label>
              )}
            </div>

            {erroPagamento && (
              <div className="mt-3 whitespace-pre-line rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {erroPagamento}
              </div>
            )}

            <button
              type="button"
              onClick={finalizar}
              disabled={isPending || totalCentavos <= 0 || avaliacaoPagamentos.bloqueado}
              className="pdv-btn-primary mt-5 h-12 w-full rounded-md text-sm font-bold uppercase tracking-wide disabled:bg-zinc-300"
            >
              {isPending ? "Finalizando..." : "F2 Concluir"}
            </button>
          </div>
        </div>
      )}

      {toastPdv ? (
        <div className="fixed bottom-6 left-1/2 z-[90] max-w-sm -translate-x-1/2 whitespace-pre-line rounded-2xl bg-zinc-950 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
          {toastPdv}
        </div>
      ) : null}

      {modalPreferencias ? (
        <PdvPreferenciasModal
          inicial={preferencias}
          permitirVendaSemEstoque={permitirVendaSemEstoque}
          salvando={salvandoPreferencias}
          onPreview={setPreferencias}
          onPermitirVendaSemEstoque={setPermitirVendaSemEstoque}
          onCancelar={() => {
            setPreferencias(
              preferenciasAposCancelarPreview(preferenciasSalvas, preferencias)
            );
            setPermitirVendaSemEstoque(permitirVendaSemEstoqueSalvo);
            setModalPreferencias(false);
          }}
          onSalvar={(proxima, permitirSemEstoque) => {
            void salvarPreferencias(proxima, permitirSemEstoque);
          }}
        />
      ) : null}

      {descartarGeranetAberto && pixGeranet && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDescartarGeranetAberto(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-950">
              {MENSAGEM_PIX_GERANET_DESCARTAR}
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              A cobrança pendente será cancelada no banco, se ainda estiver
              aberta.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDescartarGeranetAberto(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                Manter
              </button>
              <button
                type="button"
                onClick={() => {
                  void fetch("/api/pagamentos/pix/geranet/cancelar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      cobranca_id: pixGeranet.cobrancaId,
                    }),
                  });
                  resetarCheckoutPixGeranet();
                  setDescartarGeranetAberto(false);
                  setModalPagamento(false);
                }}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoLinha({
  label,
  valor,
}: {
  label: string;
  valor: number;
}) {
  return (
    <div className="mt-1 flex items-center justify-between text-sm text-zinc-500">
      <span>{label}</span>

      <span>
        {valor < 0
          ? `- ${dinheiroCentavos(
              Math.abs(
                valor
              )
            )}`
          : dinheiroCentavos(
              valor
            )}
      </span>
    </div>
  );
}

function ResumoPagamento({
  label,
  valor,
}: {
  label: string;
  valor: number;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>

      <p className="mt-1 font-bold text-zinc-900">
        {dinheiroCentavos(
          valor
        )}
      </p>
    </div>
  );
}

function Modal({
  titulo,
  children,
  onClose,
  largura = "max-w-xl",
}: {
  titulo: string;
  children: React.ReactNode;
  onClose: () => void;
  largura?: string;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={
          onClose
        }
        className="absolute inset-0 bg-black/40"
      />

      <div
        className={`pdv-modal-box relative z-10 w-full ${largura} rounded-2xl p-5 shadow-2xl md:p-6`}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">
            {titulo}
          </h2>

          <button
            type="button"
            onClick={
              onClose
            }
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          {children}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100";
