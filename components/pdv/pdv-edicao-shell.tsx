"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  Smartphone,
  X,
} from "lucide-react";

import { finalizarVendaPdv } from "../../app/pdv/actions";
import { editarVendaPdv } from "../../app/pdv/editar-actions";
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
  vendaItemId?: string | null;
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

type VendaEdicaoPdv = {
  id: string;
  numero: number;
  clienteId: string | null;
  descontoCentavos: number;
  itens: Array<{
    vendaItemId: string;
    produtoId: string;
    codigo: string;
    nome: string;
    unidadeMedida: string;
    quantidade: number;
    valorUnitarioCentavos: number;
  }>;
  pagamentos: Array<{
    formaPagamentoId: string;
    valorCentavos: number;
  }>;
};

type PixConfigPdv = {
  modo: "local_manual" | "geranet";
  provedor?: string | null;
} | null;

type Props = {
  empresaNome: string;
  produtos: Produto[];
  clientes: Cliente[];
  formasPagamento: FormaPagamento[];
  vendaEdicao?: VendaEdicaoPdv | null;
  pixConfig?: PixConfigPdv;
  pixIntegradoLiberado?: boolean;
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

export function PdvEdicaoShell({
  empresaNome,
  produtos,
  clientes,
  formasPagamento,
  vendaEdicao = null,
  pixConfig = null,
  pixIntegradoLiberado = true,
}: Props) {
  const router = useRouter();
  const modoEdicao =
    vendaEdicao !== null;

  const itensOriginaisPorProduto =
    useMemo(
      () =>
        new Map(
          (vendaEdicao?.itens ?? []).map(
            (item) => [
              item.produtoId,
              item,
            ] as const
          )
        ),
      [vendaEdicao]
    );
  const [
    busca,
    setBusca,
  ] = useState("");

  const [
    quantidadeDigitada,
    setQuantidadeDigitada,
  ] = useState("1");

  const [
    carrinho,
    setCarrinho,
  ] = useState<
    ItemCarrinho[]
  >(
    () =>
      vendaEdicao?.itens.map(
        (item) => ({
          vendaItemId:
            item.vendaItemId,
          produtoId:
            item.produtoId,
          codigo: item.codigo,
          nome: item.nome,
          unidadeMedida:
            item.unidadeMedida,
          quantidade:
            item.quantidade,
          valorUnitarioCentavos:
            item.valorUnitarioCentavos,
        })
      ) ?? []
  );

  const [
    clienteSelecionadoId,
    setClienteSelecionadoId,
  ] = useState<
    string | null
  >(
    vendaEdicao?.clienteId ??
      null
  );

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
  ] = useState(
    () =>
      centavosParaInput(
        vendaEdicao?.descontoCentavos ??
          0
      )
  );

  const [
    descontoCentavos,
    setDescontoCentavos,
  ] = useState(
    vendaEdicao?.descontoCentavos ??
      0
  );

  const [
    modalPagamento,
    setModalPagamento,
  ] = useState(false);

  const [
    pagamentos,
    setPagamentos,
  ] = useState<
    PagamentoDigitado[]
  >(
    () =>
      vendaEdicao?.pagamentos.map(
        (pagamento) => ({
          formaPagamentoId:
            pagamento.formaPagamentoId,
          valorTexto:
            centavosParaInput(
              pagamento.valorCentavos
            ),
        })
      ) ?? []
  );

  const [
    erroPagamento,
    setErroPagamento,
  ] = useState<
    string | null
  >(null);

  const [pixLocal, setPixLocal] =
    useState<PixLocalCheckoutState | null>(null);

  const [pixGeranet, setPixGeranet] =
    useState<PixGeranetCheckoutState | null>(null);

  const [descartarGeranetAberto, setDescartarGeranetAberto] =
    useState(false);

  const pixCheckoutKeyRef = useRef<string | null>(null);

  const [
    ultimaVenda,
    setUltimaVenda,
  ] = useState<{
    numero: number;
    totalCentavos: number;
  } | null>(null);

  const [
    isPending,
    startTransition,
  ] = useTransition();

  const buscaRef =
    useRef<HTMLInputElement>(
      null
    );

  const idempotencyRef =
    useRef<string | null>(
      null
    );

  useEffect(() => {
    buscaRef.current?.focus();
  }, []);

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

  const quantidadeTotal = carrinho.reduce(
    (acumulado, item) => acumulado + item.quantidade,
    0
  );

  const formasPagas =
    formasPagamento.filter(
      (forma) =>
        !forma.permite_fiado
    );

  const formaFiado =
    formasPagamento.find((forma) => forma.permite_fiado) ?? null;

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

  const pixLocalAtivo = pixConfig?.modo === "local_manual";
  const pixGeranetAtivo =
    pixConfig?.modo === "geranet" && pixIntegradoLiberado;
  const pixProvedorNome =
    pixGeranetAtivo && pixConfig.provedor
      ? nomeProvedorPix(pixConfig.provedor)
      : "";
  const pixHabilitado = pixLocalAtivo || pixGeranetAtivo;
  const formaPix = escolherFormaPixComercial(formasPagamento);
  const valorPixInformado =
    pagamentosCalculados.find((pagamento) => ehFormaPix(pagamento.forma))
      ?.valorCentavos ?? 0;
  const saldoRestantePixCentavos = saldoRestanteParaParcela({
    totalVendaCentavos: totalCentavos,
    outrosPagamentosCentavos: totalInformado - valorPixInformado,
  });
  const pixOriginalCentavos =
    vendaEdicao?.pagamentos.find(
      (pagamento) => pagamento.formaPagamentoId === formaPix?.id
    )?.valorCentavos ?? 0;
  const pixMantidoDaVenda =
    modoEdicao &&
    valorPixInformado > 0 &&
    valorPixInformado === pixOriginalCentavos;

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

  function invalidarCheckout() {
    idempotencyRef.current =
      null;
    setErroPagamento(null);
  }

  function adicionarProduto(
    produto: Produto
  ) {
    invalidarCheckout();

    const valor =
      paraCentavos(
        produto.preco_venda
      );

    setCarrinho(
      (atual) => {
        const existente =
          atual.find(
            (item) =>
              item.produtoId ===
              produto.id
          );

        const qtd = Math.max(
          1,
          Number(quantidadeDigitada.replace(",", ".")) || 1
        );

        if (existente) {
          return atual.map(
            (item) =>
              item.produtoId ===
              produto.id
                ? {
                    ...item,
                    quantidade:
                      item.quantidade +
                      qtd,
                  }
                : item
          );
        }

        const original =
          itensOriginaisPorProduto.get(
            produto.id
          );

        return [
          ...atual,
          {
            vendaItemId:
              original?.vendaItemId ??
              null,
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
              original?.valorUnitarioCentavos ??
              valor,
          },
        ];
      }
    );

    setBusca("");
    setQuantidadeDigitada("1");

    requestAnimationFrame(
      () =>
        buscaRef.current?.focus()
    );
  }

  function alterarQuantidade(
    produtoId: string,
    delta: number
  ) {
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
    if (
      event.key !== "Enter"
    ) {
      return;
    }

    event.preventDefault();

    const termo =
      busca.trim();

    if (!termo) {
      return;
    }

    const exato =
      produtos.find(
        (produto) =>
          produto.codigo ===
            termo ||
          produto.codigo_barras ===
            termo
      );

    if (exato) {
      adicionarProduto(
        exato
      );
      return;
    }

    if (
      produtosFiltrados.length ===
      1
    ) {
      adicionarProduto(
        produtosFiltrados[0]
      );
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

  function abrirPagamento() {
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
    formaPagamentoId: string
  ) {
    const outros =
      pagamentosCalculados
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

    atualizarPagamento(
      formaPagamentoId,
      centavosParaInput(
        restante
      )
    );
  }

  function selecionarCliente(
    clienteId: string
  ) {
    invalidarCheckout();
    setClienteSelecionadoId(
      clienteId
    );
    setModalCliente(false);
    setBuscaCliente("");
    buscaRef.current?.focus();
  }

  function removerCliente() {
    invalidarCheckout();
    setClienteSelecionadoId(
      null
    );
  }

  function finalizar() {
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

    const temPix = pagamentosCalculados.some((pagamento) =>
      ehFormaPix(pagamento.forma)
    );

    if (temPix && !pixHabilitado) {
      setErroPagamento(MENSAGEM_CONFIGURE_PIX);
      return;
    }

    if (temPix && !pixMantidoDaVenda) {
      if (pixLocalAtivo) {
        const pixPendente = pagamentosCalculados.find((pagamento) =>
          ehFormaPix(pagamento.forma)
        );
        if (
          pixPendente &&
          (!pixLocal ||
            pixLocal.status !== "confirmado_manual" ||
            pixLocal.valorCentavos !== pixPendente.valorCentavos)
        ) {
          setErroPagamento(
            mensagemBloqueioPixPendente(pixPendente.valorCentavos / 100)
          );
          return;
        }
      }

      if (pixGeranetAtivo) {
        const pixPendente = pagamentosCalculados.find((pagamento) =>
          ehFormaPix(pagamento.forma)
        );
        if (
          pixPendente &&
          (!pixGeranet ||
            pixGeranet.status !== "paga" ||
            pixGeranet.valorCentavos !== pixPendente.valorCentavos)
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
          modoEdicao &&
          vendaEdicao
            ? await editarVendaPdv({
                vendaId:
                  vendaEdicao.id,
                clienteId:
                  clienteSelecionadoId,
                descontoCentavos:
                  descontoAplicado,
                trocoCentavos,
                itens:
                  carrinho.map(
                    (item) => ({
                      vendaItemId:
                        item.vendaItemId ??
                        null,
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
                        pixMantidoDaVenda
                          ? null
                          : pixLocalAtivo &&
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
              })
            : await finalizarVendaPdv(
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
                }
              );

        if (!resultado.ok) {
          setErroPagamento(
            resultado.erro
          );
          return;
        }

        if (
          modoEdicao &&
          vendaEdicao
        ) {
          router.refresh();
          window.location.assign(
            `/vendas/${vendaEdicao.id}`
          );
          return;
        }

        setUltimaVenda({
          numero:
            resultado.numero,
          totalCentavos:
            resultado.valorTotalCentavos,
        });

        setCarrinho([]);
        setClienteSelecionadoId(
          null
        );
        setDescontoCentavos(0);
        setDescontoTexto(
          "0,00"
        );
        setPagamentos([]);
        setModalPagamento(
          false
        );
        setErroPagamento(
          null
        );
        idempotencyRef.current =
          null;

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
        setModalCliente(
          true
        );
      }

      if (
        event.key === "F2"
      ) {
        event.preventDefault();
        abrirPagamento();
      }

      if (
        event.key === "Escape"
      ) {
        setModalCliente(
          false
        );
        setModalDesconto(
          false
        );
        setModalPagamento(
          false
        );
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

  const hrefFechar =
    modoEdicao && vendaEdicao
      ? `/vendas/${vendaEdicao.id}`
      : "/vendas";

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900">
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
            <p className="mt-2 text-sm text-zinc-500">Total da venda</p>
            <p className="mt-1 text-3xl font-bold text-zinc-950">
              {dinheiroCentavos(ultimaVenda.totalCentavos)}
            </p>
            <div className="mt-6">
              <Link
                href={hrefFechar}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                Voltar à venda
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col px-8 pt-6">
          <div className="flex items-start justify-between">
            <h1 className="text-[32px] font-bold leading-none text-zinc-950">
              Venda
              {modoEdicao && vendaEdicao ? (
                <span className="ml-3 text-lg font-semibold text-zinc-400">
                  #{vendaEdicao.numero}
                </span>
              ) : null}
            </h1>
            <div className="flex items-center gap-2 text-zinc-400">
              <span className="hidden text-xs text-zinc-400 md:inline">
                {empresaNome}
              </span>
              <button
                type="button"
                className="rounded p-1 hover:bg-zinc-100"
                aria-label="Mais opções"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              <Link
                href={hrefFechar}
                className="rounded p-1 hover:bg-zinc-100"
                aria-label="Fechar"
              >
                <Settings className="h-5 w-5" />
              </Link>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <div className="flex h-12 flex-1 items-center rounded-full border border-zinc-200 bg-white px-4">
              <Search className="h-5 w-5 shrink-0 text-zinc-400" />
              <input
                ref={buscaRef}
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                onKeyDown={aoPressionarBusca}
                placeholder="Buscar produto, código ou código de barras"
                className="ml-3 h-full flex-1 border-0 bg-transparent text-sm outline-none"
              />
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
            </div>
            <div className="flex h-10 items-center rounded-full border border-zinc-200 px-4 text-sm font-medium text-zinc-700">
              Quant:
              <input
                value={quantidadeDigitada}
                onChange={(event) => setQuantidadeDigitada(event.target.value)}
                className="ml-1 w-10 border-0 bg-transparent p-0 text-center text-sm font-semibold outline-none"
              />
            </div>
          </div>

          {busca.trim() && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-zinc-200">
              {produtosFiltrados.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-500">
                  Nenhum produto encontrado.
                </p>
              ) : (
                produtosFiltrados.slice(0, 20).map((produto) => (
                  <button
                    key={produto.id}
                    type="button"
                    onClick={() => adicionarProduto(produto)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-blue-50"
                  >
                    <span className="truncate font-medium">
                      {produto.nome}
                      <span className="ml-2 text-xs text-zinc-400">
                        {produto.codigo}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold">
                      {dinheiroCentavos(paraCentavos(produto.preco_venda))}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="mt-6 min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-[48px_72px_minmax(0,1fr)_160px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              <span>Nº</span>
              <span>Qtd</span>
              <span>Produto</span>
              <span className="text-right">Preço</span>
            </div>
            <div className="mt-2 border-t border-zinc-200">
              {carrinho.length === 0 ? (
                <p className="py-16 text-center text-sm text-zinc-400">
                  Busque um produto para iniciar a venda.
                </p>
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
                          onClick={() => alterarQuantidade(item.produtoId, -1)}
                          className="px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-50"
                        >
                          −
                        </button>
                        <span className="min-w-8 border-x border-zinc-200 px-1 text-center text-sm font-bold">
                          {item.quantidade}x
                        </span>
                        <button
                          type="button"
                          onClick={() => alterarQuantidade(item.produtoId, 1)}
                          className="px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-50"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400">
                        <Package className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-zinc-950">
                          {item.nome}
                        </p>
                        <p className="mt-0.5 text-sm text-zinc-400">
                          Preço: {dinheiroCentavos(item.valorUnitarioCentavos)}
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
                      <button
                        type="button"
                        onClick={() => {
                          setDescontoTexto(centavosParaInput(descontoAplicado));
                          setModalDesconto(true);
                        }}
                        className="mt-1 text-xs text-zinc-400 hover:text-zinc-700"
                      >
                        Aplicar desconto
                      </button>
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
              className="h-12 rounded-md bg-blue-600 px-7 text-sm font-bold uppercase tracking-wide text-white hover:bg-blue-700 disabled:bg-zinc-300"
            >
              {isPending ? "Salvando..." : "Concluir venda - F2"}
            </button>
            <p className="text-[28px] font-bold text-zinc-950">
              Total: {dinheiroCentavos(totalCentavos)}
            </p>
          </div>
        </section>

        <aside className="hidden w-64 shrink-0 flex-col border-l border-zinc-200 bg-white lg:flex">
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
              href={hrefFechar}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </Link>
          </div>

          <div className="mt-6 divide-y divide-zinc-200 border-y border-zinc-200 text-[15px] font-semibold text-zinc-950">
            <button
              type="button"
              onClick={() => setModalCliente(true)}
              className="block w-full px-5 py-3.5 text-left hover:bg-zinc-50"
            >
              {clienteSelecionado ? clienteSelecionado.nome : "Cliente"} - F5
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
            <p>F5 Cliente</p>
            <p>Esc Fechar janela</p>
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
          onClose={() => {
            setModalCliente(
              false
            );
            setBuscaCliente(
              ""
            );
          }}
        >
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

            {clienteSelecionado && (
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

          <input
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
          <div className={`relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white px-6 pb-6 pt-8 shadow-2xl ${
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
                      selecionada ? "bg-blue-50" : "bg-white"
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
                    <input
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
              !pixMantidoDaVenda &&
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
              !pixMantidoDaVenda &&
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

            <div className="mt-4 flex items-center justify-end text-sm text-zinc-700">
              {formaFiado && (
                <label className="flex items-center gap-2 text-zinc-400">
                  <input type="checkbox" disabled className="opacity-50" />
                  Fiado (em breve)
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
              className="mt-5 h-12 w-full rounded-md bg-blue-600 text-sm font-bold uppercase tracking-wide text-white hover:bg-blue-700 disabled:bg-zinc-300"
            >
              {isPending
                ? modoEdicao
                  ? "Salvando..."
                  : "Finalizando..."
                : "F2 Concluir"}
            </button>
          </div>
        </div>
      )}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={
          onClose
        }
        className="absolute inset-0 bg-black/40"
      />

      <div
        className={`relative z-10 w-full ${largura} rounded-2xl bg-white p-5 shadow-2xl md:p-6`}
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
