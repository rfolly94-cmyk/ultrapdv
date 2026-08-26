import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";
import {
  alinhamentoLogoRecibo,
  fonteLogoRecibo,
  tamanhoLogoRecibo,
  type AlinhamentoLogoRecibo,
  type FonteLogoRecibo,
  type TamanhoLogoRecibo,
} from "./logo-recibo-personalizada";

export const RECIBO_LAYOUT_VERSAO = 1;
export const TEXTO_LIVRE_RECIBO_MAX = 800;
export const TEXTO_CURTO_RECIBO_MAX = 240;

export const PAPEIS_RECIBO = ["80mm", "58mm"] as const;
export type PapelRecibo = (typeof PAPEIS_RECIBO)[number];

export const ALINHAMENTOS_RECIBO = ["centro", "esquerda"] as const;
export type AlinhamentoRecibo = (typeof ALINHAMENTOS_RECIBO)[number];

export const PRESETS_RECIBO = ["compacto", "padrao", "completo"] as const;
export type PresetRecibo = (typeof PRESETS_RECIBO)[number];

export const MENSAGEM_LAYOUT_RECIBO_INVALIDO =
  "A configuração do recibo é inválida.";

const LARGURA_CHARS: Record<PapelRecibo, number> = {
  "80mm": 42,
  "58mm": 32,
};

export type ReciboLayoutConfig = {
  versao: number;
  papel: PapelRecibo;
  cabecalho: {
    logo: boolean;
    logoFonte: FonteLogoRecibo;
    logoTamanho: TamanhoLogoRecibo;
    logoAlinhamento: AlinhamentoLogoRecibo;
    logoPersonalizadaPath: string | null;
    nomeFantasia: boolean;
    razaoSocial: boolean;
    documento: boolean;
    inscricaoEstadual: boolean;
    endereco: boolean;
    telefone: boolean;
    whatsapp: boolean;
    email: boolean;
    textoAcima: string;
    alinhamento: AlinhamentoRecibo;
  };
  venda: {
    numero: boolean;
    data: boolean;
    hora: boolean;
    vendedor: boolean;
    cliente: boolean;
    documentoCliente: boolean;
    telefoneCliente: boolean;
    observacao: boolean;
  };
  itens: {
    codigo: boolean;
    quantidade: boolean;
    valorUnitario: boolean;
    descontoItem: boolean;
    totalItem: boolean;
  };
  totais: {
    subtotal: boolean;
    desconto: boolean;
    acrescimo: boolean;
    totalFinal: boolean;
  };
  pagamentos: {
    formas: boolean;
    valorForma: boolean;
    valorRecebido: boolean;
    troco: boolean;
    parcelas: boolean;
    pix: boolean;
  };
  carteira: {
    mostrar: boolean;
    valorFiado: boolean;
    saldoAnterior: boolean;
    novoSaldo: boolean;
    vencimento: boolean;
    limite: boolean;
  };
  rodape: {
    textoPersonalizado: string;
    mostrarTextoPersonalizado: boolean;
    alinhamentoTexto: AlinhamentoRecibo;
    politicaTroca: string;
    garantia: string;
    telefone: boolean;
    whatsapp: boolean;
    instagram: string;
    site: string;
    qrUrl: string;
    mostrarQr: boolean;
    emitidoUltraPdv: boolean;
    dataHoraImpressao: boolean;
  };
};

export type ReciboItemDados = {
  codigo: string;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total: number;
};

export type ReciboPagamentoDados = {
  nome: string;
  valor: number;
  parcelas: number | null;
  bandeira: string | null;
  pix: boolean;
  fiado: boolean;
};

export type ReciboCarteiraDados = {
  temFiado: boolean;
  valorFiado: number;
  vencimento: string | null;
  saldoDevedor: number | null;
  saldoAnterior: number | null;
  limiteCredito: number | null;
  creditoDisponivel: number | null;
};

export type ReciboVendaCompleto = {
  vendaId: string;
  numero: string;
  dataIso: string | null;
  observacao: string | null;
  clienteNome: string;
  clienteDocumento: string;
  clienteTelefone: string;
  vendedorNome: string;
  empresa: {
    nomeFantasia: string;
    razaoSocial: string;
    documento: string;
    ie: string;
    endereco: string;
    telefone: string;
    email: string;
    whatsapp: string;
    logoUrl: string | null;
    logoEmpresaUrl?: string | null;
    logoPersonalizadaUrl?: string | null;
  };
  itens: ReciboItemDados[];
  pagamentos: ReciboPagamentoDados[];
  valorProdutos: number;
  desconto: number;
  acrescimo: number;
  total: number;
  troco: number;
  carteira: ReciboCarteiraDados | null;
};

export type BlocoRecibo =
  | {
      tipo: "logo";
      alinhamento: AlinhamentoLogoRecibo;
      tamanho: TamanhoLogoRecibo;
    }
  | { tipo: "qr"; url: string }
  | { tipo: "sep" }
  | {
      tipo: "linha";
      texto: string;
      alinhamento: AlinhamentoRecibo;
      destaque?: boolean;
    };

function objeto(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Record<string, unknown>;
}

function bool(valor: unknown, padrao: boolean) {
  return typeof valor === "boolean" ? valor : padrao;
}

function papelRecibo(valor: unknown): PapelRecibo {
  return valor === "58mm" ? "58mm" : "80mm";
}

function alinhamento(valor: unknown, padrao: AlinhamentoRecibo): AlinhamentoRecibo {
  return valor === "esquerda" || valor === "centro" ? valor : padrao;
}

export function urlHttpValida(valor: unknown) {
  const texto = String(valor ?? "").trim();
  if (!texto || texto.length > 500) {
    return "";
  }
  try {
    const url = new URL(texto);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function pathLogoReciboSanitizado(valor: unknown) {
  const arquivo = String(valor ?? "").trim();
  if (!arquivo || arquivo.startsWith("http://") || arquivo.startsWith("https://")) {
    return null;
  }
  if (arquivo.includes("..") || arquivo.includes("\\")) {
    return null;
  }
  return /^[0-9a-f-]{36}\/logo-[a-zA-Z0-9-]+\.(png|jpg|jpeg|webp)$/i.test(arquivo)
    ? arquivo
    : null;
}

export function urlLogoReciboEfetiva(
  layout: ReciboLayoutConfig,
  empresa: ReciboVendaCompleto["empresa"]
) {
  if (!layout.cabecalho.logo) {
    return null;
  }
  if (layout.cabecalho.logoFonte === "personalizada") {
    const personalizada = String(empresa.logoPersonalizadaUrl ?? "").trim();
    if (personalizada.startsWith("blob:")) {
      return personalizada;
    }
    return logoUrlUtilizavel(personalizada);
  }
  return logoUrlUtilizavel(empresa.logoEmpresaUrl ?? empresa.logoUrl);
}

export function textoPuroRecibo(valor: unknown, max: number) {
  return String(valor ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, max);
}

export function layoutReciboPadrao(): ReciboLayoutConfig {
  return {
    versao: RECIBO_LAYOUT_VERSAO,
    papel: "80mm",
    cabecalho: {
      logo: true,
      logoFonte: "empresa",
      logoTamanho: "media",
      logoAlinhamento: "centro",
      logoPersonalizadaPath: null,
      nomeFantasia: true,
      razaoSocial: false,
      documento: true,
      inscricaoEstadual: false,
      endereco: true,
      telefone: true,
      whatsapp: false,
      email: false,
      textoAcima: "",
      alinhamento: "centro",
    },
    venda: {
      numero: true,
      data: true,
      hora: true,
      vendedor: false,
      cliente: true,
      documentoCliente: false,
      telefoneCliente: false,
      observacao: true,
    },
    itens: {
      codigo: false,
      quantidade: true,
      valorUnitario: true,
      descontoItem: true,
      totalItem: true,
    },
    totais: {
      subtotal: true,
      desconto: true,
      acrescimo: true,
      totalFinal: true,
    },
    pagamentos: {
      formas: true,
      valorForma: true,
      valorRecebido: true,
      troco: true,
      parcelas: true,
      pix: true,
    },
    carteira: {
      mostrar: true,
      valorFiado: true,
      saldoAnterior: false,
      novoSaldo: false,
      vencimento: true,
      limite: false,
    },
    rodape: {
      textoPersonalizado: "",
      mostrarTextoPersonalizado: true,
      alinhamentoTexto: "centro",
      politicaTroca: "",
      garantia: "",
      telefone: false,
      whatsapp: false,
      instagram: "",
      site: "",
      qrUrl: "",
      mostrarQr: false,
      emitidoUltraPdv: true,
      dataHoraImpressao: false,
    },
  };
}

export function layoutReciboPreset(nome: PresetRecibo): ReciboLayoutConfig {
  const base = layoutReciboPadrao();
  if (nome === "compacto") {
    return {
      ...base,
      papel: "80mm",
      cabecalho: {
        ...base.cabecalho,
        logo: false,
        razaoSocial: false,
        inscricaoEstadual: false,
        endereco: false,
        telefone: false,
        whatsapp: false,
        email: false,
      },
      venda: {
        ...base.venda,
        hora: false,
        vendedor: false,
        cliente: false,
        documentoCliente: false,
        telefoneCliente: false,
        observacao: false,
      },
      itens: {
        ...base.itens,
        codigo: false,
        valorUnitario: false,
        descontoItem: false,
      },
      totais: {
        ...base.totais,
        subtotal: false,
        desconto: true,
        acrescimo: false,
      },
      pagamentos: {
        ...base.pagamentos,
        valorRecebido: false,
        parcelas: false,
        pix: true,
      },
      carteira: {
        ...base.carteira,
        mostrar: true,
        valorFiado: true,
        vencimento: false,
      },
      rodape: {
        ...base.rodape,
        emitidoUltraPdv: false,
        dataHoraImpressao: false,
      },
    };
  }

  if (nome === "completo") {
    return {
      ...base,
      cabecalho: {
        ...base.cabecalho,
        razaoSocial: true,
        inscricaoEstadual: true,
        whatsapp: true,
        email: true,
      },
      venda: {
        ...base.venda,
        vendedor: true,
        documentoCliente: true,
        telefoneCliente: true,
      },
      itens: {
        ...base.itens,
        codigo: true,
      },
      rodape: {
        ...base.rodape,
        telefone: true,
        whatsapp: true,
        dataHoraImpressao: true,
      },
    };
  }

  return base;
}

export function sanitizarLayoutRecibo(
  valor: unknown
): { ok: true; valor: ReciboLayoutConfig } | { ok: false; erro: string } {
  const raiz = objeto(valor);
  if (!raiz) {
    return { ok: false, erro: MENSAGEM_LAYOUT_RECIBO_INVALIDO };
  }

  const cabecalho = objeto(raiz.cabecalho) ?? {};
  const venda = objeto(raiz.venda) ?? {};
  const itens = objeto(raiz.itens) ?? {};
  const totais = objeto(raiz.totais) ?? {};
  const pagamentos = objeto(raiz.pagamentos) ?? {};
  const carteira = objeto(raiz.carteira) ?? {};
  const rodape = objeto(raiz.rodape) ?? {};
  const padrao = layoutReciboPadrao();

  const versao = Number(raiz.versao ?? 0);
  if (!Number.isFinite(versao) || versao < 1 || versao > RECIBO_LAYOUT_VERSAO) {
    return { ok: false, erro: MENSAGEM_LAYOUT_RECIBO_INVALIDO };
  }

  if (raiz.html || raiz.javascript || cabecalho.html || rodape.html) {
    return { ok: false, erro: MENSAGEM_LAYOUT_RECIBO_INVALIDO };
  }

  return {
    ok: true,
    valor: {
      versao: RECIBO_LAYOUT_VERSAO,
      papel: papelRecibo(raiz.papel),
      cabecalho: {
        logo: bool(cabecalho.logo, padrao.cabecalho.logo),
        logoFonte: fonteLogoRecibo(cabecalho.logoFonte),
        logoTamanho: tamanhoLogoRecibo(cabecalho.logoTamanho),
        logoAlinhamento: alinhamentoLogoRecibo(cabecalho.logoAlinhamento),
        logoPersonalizadaPath: pathLogoReciboSanitizado(
          cabecalho.logoPersonalizadaPath
        ),
        nomeFantasia: bool(cabecalho.nomeFantasia, padrao.cabecalho.nomeFantasia),
        razaoSocial: bool(cabecalho.razaoSocial, padrao.cabecalho.razaoSocial),
        documento: bool(cabecalho.documento, padrao.cabecalho.documento),
        inscricaoEstadual: bool(
          cabecalho.inscricaoEstadual,
          padrao.cabecalho.inscricaoEstadual
        ),
        endereco: bool(cabecalho.endereco, padrao.cabecalho.endereco),
        telefone: bool(cabecalho.telefone, padrao.cabecalho.telefone),
        whatsapp: bool(cabecalho.whatsapp, padrao.cabecalho.whatsapp),
        email: bool(cabecalho.email, padrao.cabecalho.email),
        textoAcima: textoPuroRecibo(cabecalho.textoAcima, TEXTO_CURTO_RECIBO_MAX),
        alinhamento: alinhamento(
          cabecalho.alinhamento,
          padrao.cabecalho.alinhamento
        ),
      },
      venda: {
        numero: bool(venda.numero, padrao.venda.numero),
        data: bool(venda.data, padrao.venda.data),
        hora: bool(venda.hora, padrao.venda.hora),
        vendedor: bool(venda.vendedor, padrao.venda.vendedor),
        cliente: bool(venda.cliente, padrao.venda.cliente),
        documentoCliente: bool(
          venda.documentoCliente,
          padrao.venda.documentoCliente
        ),
        telefoneCliente: bool(
          venda.telefoneCliente,
          padrao.venda.telefoneCliente
        ),
        observacao: bool(venda.observacao, padrao.venda.observacao),
      },
      itens: {
        codigo: bool(itens.codigo, padrao.itens.codigo),
        quantidade: bool(itens.quantidade, padrao.itens.quantidade),
        valorUnitario: bool(itens.valorUnitario, padrao.itens.valorUnitario),
        descontoItem: bool(itens.descontoItem, padrao.itens.descontoItem),
        totalItem: bool(itens.totalItem, padrao.itens.totalItem),
      },
      totais: {
        subtotal: bool(totais.subtotal, padrao.totais.subtotal),
        desconto: bool(totais.desconto, padrao.totais.desconto),
        acrescimo: bool(totais.acrescimo, padrao.totais.acrescimo),
        totalFinal: bool(totais.totalFinal, padrao.totais.totalFinal),
      },
      pagamentos: {
        formas: bool(pagamentos.formas, padrao.pagamentos.formas),
        valorForma: bool(pagamentos.valorForma, padrao.pagamentos.valorForma),
        valorRecebido: bool(
          pagamentos.valorRecebido,
          padrao.pagamentos.valorRecebido
        ),
        troco: bool(pagamentos.troco, padrao.pagamentos.troco),
        parcelas: bool(pagamentos.parcelas, padrao.pagamentos.parcelas),
        pix: bool(pagamentos.pix, padrao.pagamentos.pix),
      },
      carteira: {
        mostrar: bool(carteira.mostrar, padrao.carteira.mostrar),
        valorFiado: bool(carteira.valorFiado, padrao.carteira.valorFiado),
        saldoAnterior: bool(
          carteira.saldoAnterior,
          padrao.carteira.saldoAnterior
        ),
        novoSaldo: bool(carteira.novoSaldo, padrao.carteira.novoSaldo),
        vencimento: bool(carteira.vencimento, padrao.carteira.vencimento),
        limite: bool(carteira.limite, padrao.carteira.limite),
      },
      rodape: {
        textoPersonalizado: textoPuroRecibo(
          rodape.textoPersonalizado,
          TEXTO_LIVRE_RECIBO_MAX
        ),
        mostrarTextoPersonalizado: bool(
          rodape.mostrarTextoPersonalizado,
          padrao.rodape.mostrarTextoPersonalizado
        ),
        alinhamentoTexto: alinhamento(
          rodape.alinhamentoTexto,
          padrao.rodape.alinhamentoTexto
        ),
        politicaTroca: textoPuroRecibo(
          rodape.politicaTroca,
          TEXTO_CURTO_RECIBO_MAX
        ),
        garantia: textoPuroRecibo(rodape.garantia, TEXTO_CURTO_RECIBO_MAX),
        telefone: bool(rodape.telefone, padrao.rodape.telefone),
        whatsapp: bool(rodape.whatsapp, padrao.rodape.whatsapp),
        instagram: textoPuroRecibo(rodape.instagram, 80),
        site: urlHttpValida(rodape.site) || textoPuroRecibo(rodape.site, 120),
        qrUrl: urlHttpValida(rodape.qrUrl),
        mostrarQr: bool(rodape.mostrarQr, padrao.rodape.mostrarQr),
        emitidoUltraPdv: bool(
          rodape.emitidoUltraPdv,
          padrao.rodape.emitidoUltraPdv
        ),
        dataHoraImpressao: bool(
          rodape.dataHoraImpressao,
          padrao.rodape.dataHoraImpressao
        ),
      },
    },
  };
}

export function larguraCharsRecibo(papel: unknown): number {
  const chave = papel === "58mm" ? "58mm" : "80mm";
  return LARGURA_CHARS[chave];
}

export function quebrarLinhaRecibo(texto: string, largura: number) {
  const bruto = String(texto ?? "").replace(/\s+$/g, "");
  if (!bruto) {
    return [""];
  }
  const linhas: string[] = [];
  for (const paragrafo of bruto.split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (palavras.length === 0) {
      linhas.push("");
      continue;
    }
    let atual = "";
    for (const palavra of palavras) {
      const candidato = atual ? `${atual} ${palavra}` : palavra;
      if (candidato.length <= largura) {
        atual = candidato;
        continue;
      }
      if (atual) {
        linhas.push(atual);
      }
      if (palavra.length <= largura) {
        atual = palavra;
        continue;
      }
      for (let i = 0; i < palavra.length; i += largura) {
        const fatia = palavra.slice(i, i + largura);
        if (i + largura < palavra.length) {
          linhas.push(fatia);
        } else {
          atual = fatia;
        }
      }
    }
    if (atual) {
      linhas.push(atual);
    }
  }
  return linhas.length > 0 ? linhas : [""];
}

export function centralizarLinhaRecibo(texto: string, largura: number) {
  const t = texto.slice(0, largura);
  const pad = Math.max(0, Math.floor((largura - t.length) / 2));
  return `${" ".repeat(pad)}${t}`;
}

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function dinheiro(valor: number) {
  return moeda.format(Number.isFinite(valor) ? valor : 0);
}

function formatarDocumento(valor: string) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return String(valor ?? "").trim();
}

function sep(largura: number) {
  return "-".repeat(Math.min(largura, 42));
}

function empurrar(
  blocos: BlocoRecibo[],
  texto: string,
  largura: number,
  alinhamentoLinha: AlinhamentoRecibo,
  destaque = false
) {
  for (const linha of quebrarLinhaRecibo(texto, largura)) {
    blocos.push({
      tipo: "linha",
      texto: linha,
      alinhamento: alinhamentoLinha,
      destaque,
    });
  }
}

export function montarReciboVenda(
  dados: ReciboVendaCompleto,
  layoutBruto: ReciboLayoutConfig,
  opcoes?: { papel?: PapelRecibo | "a4"; agora?: Date }
) {
  const sanitizado = sanitizarLayoutRecibo(layoutBruto);
  const layout = sanitizado.ok ? sanitizado.valor : layoutReciboPadrao();
  const papel: PapelRecibo =
    opcoes?.papel === "58mm" || opcoes?.papel === "80mm"
      ? opcoes.papel
      : layout.papel;
  const largura = larguraCharsRecibo(papel);
  const alinhamentoCab = layout.cabecalho.alinhamento;
  const blocos: BlocoRecibo[] = [];
  const empresa = dados.empresa;

  if (layout.cabecalho.textoAcima.trim()) {
    empurrar(
      blocos,
      layout.cabecalho.textoAcima,
      largura,
      alinhamentoCab
    );
  }

  if (layout.cabecalho.logo && urlLogoReciboEfetiva(layout, empresa)) {
    blocos.push({
      tipo: "logo",
      alinhamento: layout.cabecalho.logoAlinhamento,
      tamanho: layout.cabecalho.logoTamanho,
    });
  }

  if (layout.cabecalho.nomeFantasia && empresa.nomeFantasia) {
    empurrar(blocos, empresa.nomeFantasia, largura, alinhamentoCab, true);
  }
  if (
    layout.cabecalho.razaoSocial &&
    empresa.razaoSocial &&
    empresa.razaoSocial !== empresa.nomeFantasia
  ) {
    empurrar(blocos, empresa.razaoSocial, largura, alinhamentoCab);
  }
  if (layout.cabecalho.documento && empresa.documento) {
    const doc = formatarDocumento(empresa.documento);
    empurrar(
      blocos,
      doc.length === 14 || empresa.documento.replace(/\D/g, "").length === 14
        ? `CNPJ ${doc}`
        : `CNPJ/CPF ${doc}`,
      largura,
      alinhamentoCab
    );
  }
  if (layout.cabecalho.inscricaoEstadual && empresa.ie) {
    empurrar(blocos, `IE ${empresa.ie}`, largura, alinhamentoCab);
  }
  if (layout.cabecalho.endereco && empresa.endereco) {
    empurrar(blocos, empresa.endereco, largura, alinhamentoCab);
  }
  if (layout.cabecalho.telefone && empresa.telefone) {
    empurrar(blocos, `Tel. ${empresa.telefone}`, largura, alinhamentoCab);
  }
  if (layout.cabecalho.whatsapp && empresa.whatsapp) {
    empurrar(blocos, `WhatsApp ${empresa.whatsapp}`, largura, alinhamentoCab);
  }
  if (layout.cabecalho.email && empresa.email) {
    empurrar(blocos, empresa.email, largura, alinhamentoCab);
  }

  blocos.push({ tipo: "sep" });
  empurrar(blocos, "RECIBO DE VENDA", largura, "centro", true);

  const dataVenda = dados.dataIso ? new Date(dados.dataIso) : null;
  const dataOk = dataVenda && !Number.isNaN(dataVenda.getTime()) ? dataVenda : null;
  if (layout.venda.numero) {
    empurrar(blocos, `Venda nº ${dados.numero || "—"}`, largura, "centro");
  }
  if (dataOk && (layout.venda.data || layout.venda.hora)) {
    const partes: string[] = [];
    if (layout.venda.data) {
      partes.push(
        new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(dataOk)
      );
    }
    if (layout.venda.hora) {
      partes.push(
        new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(dataOk)
      );
    }
    empurrar(blocos, partes.join(" "), largura, "centro");
  }
  if (layout.venda.vendedor && dados.vendedorNome) {
    empurrar(blocos, `Vendedor: ${dados.vendedorNome}`, largura, "esquerda");
  }
  if (layout.venda.cliente && dados.clienteNome) {
    empurrar(blocos, `Cliente: ${dados.clienteNome}`, largura, "esquerda");
  }
  if (layout.venda.documentoCliente && dados.clienteDocumento) {
    empurrar(
      blocos,
      `CPF/CNPJ ${formatarDocumento(dados.clienteDocumento)}`,
      largura,
      "esquerda"
    );
  }
  if (layout.venda.telefoneCliente && dados.clienteTelefone) {
    empurrar(blocos, `Tel. ${dados.clienteTelefone}`, largura, "esquerda");
  }
  if (layout.venda.observacao && dados.observacao) {
    empurrar(blocos, dados.observacao, largura, "esquerda");
  }

  blocos.push({ tipo: "sep" });

  for (const item of dados.itens) {
    const titulo = layout.itens.codigo && item.codigo
      ? `${item.codigo} ${item.nome}`
      : item.nome;
    empurrar(blocos, titulo, largura, "esquerda", true);

    const qtd = layout.itens.quantidade
      ? `${item.quantidade}`
      : "";
    const unit = layout.itens.valorUnitario ? dinheiro(item.valorUnitario) : "";
    const total = layout.itens.totalItem ? dinheiro(item.total) : "";
    const meio =
      qtd && unit ? `${qtd} x ${unit}` : qtd || unit;
    if (meio && total) {
      const espaco = Math.max(1, largura - meio.length - total.length);
      empurrar(
        blocos,
        `${meio}${" ".repeat(espaco)}${total}`.slice(0, largura),
        largura,
        "esquerda"
      );
    } else if (meio || total) {
      empurrar(blocos, meio || total, largura, "esquerda");
    }
    if (layout.itens.descontoItem && item.desconto > 0) {
      empurrar(
        blocos,
        `Desc. item ${dinheiro(item.desconto)}`,
        largura,
        "esquerda"
      );
    }
  }

  blocos.push({ tipo: "sep" });

  if (layout.totais.subtotal) {
    empurrar(
      blocos,
      `Subtotal ${dinheiro(dados.valorProdutos)}`,
      largura,
      "esquerda"
    );
  }
  if (layout.totais.desconto && dados.desconto > 0) {
    empurrar(
      blocos,
      `Desconto ${dinheiro(dados.desconto)}`,
      largura,
      "esquerda"
    );
  }
  if (layout.totais.acrescimo && dados.acrescimo > 0) {
    empurrar(
      blocos,
      `Acrescimo ${dinheiro(dados.acrescimo)}`,
      largura,
      "esquerda"
    );
  }
  if (layout.totais.totalFinal) {
    empurrar(blocos, `TOTAL ${dinheiro(dados.total)}`, largura, "esquerda", true);
  }

  const pagamentos = dados.pagamentos;
  const fiados = pagamentos.filter((item) => item.fiado);
  const pagos = pagamentos.filter((item) => !item.fiado);
  const temPagamentoVisivel =
    layout.pagamentos.formas ||
    layout.pagamentos.valorRecebido ||
    layout.pagamentos.troco;

  if (temPagamentoVisivel && pagamentos.length > 0) {
    blocos.push({ tipo: "sep" });
    if (layout.pagamentos.formas) {
      for (const pagamento of pagamentos) {
        if (pagamento.fiado && layout.carteira.mostrar) {
          continue;
        }
        const extras: string[] = [];
        if (layout.pagamentos.pix && pagamento.pix) {
          extras.push("PIX");
        }
        if (layout.pagamentos.parcelas && (pagamento.parcelas ?? 0) > 1) {
          extras.push(`${pagamento.parcelas}x`);
        }
        if (layout.pagamentos.parcelas && pagamento.bandeira) {
          extras.push(pagamento.bandeira);
        }
        const nome = extras.length
          ? `${pagamento.nome} (${extras.join(" ")})`
          : pagamento.nome;
        const valor = layout.pagamentos.valorForma
          ? dinheiro(pagamento.valor)
          : "";
        empurrar(
          blocos,
          valor ? `${nome} ${valor}` : nome,
          largura,
          "esquerda"
        );
      }
    }
    if (layout.pagamentos.valorRecebido) {
      const recebido =
        pagos.reduce((soma, item) => soma + item.valor, 0) +
        (dados.troco > 0 ? dados.troco : 0);
      if (recebido > 0) {
        empurrar(
          blocos,
          `Recebido ${dinheiro(recebido)}`,
          largura,
          "esquerda"
        );
      }
    }
    if (layout.pagamentos.troco && dados.troco > 0) {
      empurrar(blocos, `Troco ${dinheiro(dados.troco)}`, largura, "esquerda");
    }
  }

  const carteira = dados.carteira;
  const temFiado =
    Boolean(carteira?.temFiado) ||
    fiados.reduce((soma, item) => soma + item.valor, 0) > 0;
  if (layout.carteira.mostrar && temFiado) {
    blocos.push({ tipo: "sep" });
    empurrar(blocos, "Carteira / Fiado", largura, "esquerda", true);
    const valorFiado =
      carteira?.valorFiado && carteira.valorFiado > 0
        ? carteira.valorFiado
        : fiados.reduce((soma, item) => soma + item.valor, 0);
    if (layout.carteira.valorFiado && valorFiado > 0) {
      empurrar(
        blocos,
        `Fiado desta venda ${dinheiro(valorFiado)}`,
        largura,
        "esquerda"
      );
    }
    if (layout.carteira.vencimento && carteira?.vencimento) {
      const venc = new Date(`${carteira.vencimento}T12:00:00`);
      const vencTxt = Number.isNaN(venc.getTime())
        ? carteira.vencimento
        : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(venc);
      empurrar(blocos, `Vencimento ${vencTxt}`, largura, "esquerda");
    }
    if (
      layout.carteira.saldoAnterior &&
      carteira?.saldoAnterior != null
    ) {
      empurrar(
        blocos,
        `Saldo anterior ${dinheiro(carteira.saldoAnterior)}`,
        largura,
        "esquerda"
      );
    }
    if (layout.carteira.novoSaldo && carteira?.saldoDevedor != null) {
      empurrar(
        blocos,
        `Saldo devedor ${dinheiro(carteira.saldoDevedor)}`,
        largura,
        "esquerda"
      );
    }
    if (layout.carteira.limite && carteira?.creditoDisponivel != null) {
      empurrar(
        blocos,
        `Limite disponivel ${dinheiro(carteira.creditoDisponivel)}`,
        largura,
        "esquerda"
      );
    }
  }

  blocos.push({ tipo: "sep" });

  const alinhamentoRodape = layout.rodape.alinhamentoTexto;
  if (
    layout.rodape.mostrarTextoPersonalizado &&
    layout.rodape.textoPersonalizado.trim()
  ) {
    empurrar(
      blocos,
      layout.rodape.textoPersonalizado,
      largura,
      alinhamentoRodape
    );
  }
  if (layout.rodape.politicaTroca.trim()) {
    empurrar(blocos, layout.rodape.politicaTroca, largura, alinhamentoRodape);
  }
  if (layout.rodape.garantia.trim()) {
    empurrar(blocos, layout.rodape.garantia, largura, alinhamentoRodape);
  }
  if (layout.rodape.telefone && empresa.telefone) {
    empurrar(blocos, `Tel. ${empresa.telefone}`, largura, alinhamentoRodape);
  }
  if (layout.rodape.whatsapp && empresa.whatsapp) {
    empurrar(
      blocos,
      `WhatsApp ${empresa.whatsapp}`,
      largura,
      alinhamentoRodape
    );
  }
  if (layout.rodape.instagram.trim()) {
    empurrar(
      blocos,
      layout.rodape.instagram.trim().startsWith("@")
        ? layout.rodape.instagram.trim()
        : `Instagram ${layout.rodape.instagram.trim()}`,
      largura,
      alinhamentoRodape
    );
  }
  if (layout.rodape.site.trim()) {
    empurrar(blocos, layout.rodape.site.trim(), largura, alinhamentoRodape);
  }

  const qrUrl =
    layout.rodape.mostrarQr && layout.rodape.qrUrl
      ? layout.rodape.qrUrl
      : "";
  if (qrUrl) {
    blocos.push({ tipo: "qr", url: qrUrl });
    empurrar(blocos, qrUrl, largura, "centro");
  }

  if (layout.rodape.emitidoUltraPdv) {
    empurrar(blocos, "Emitido pelo UltraPDV", largura, "centro");
  }
  if (layout.rodape.dataHoraImpressao) {
    const agora = opcoes?.agora ?? new Date();
    empurrar(
      blocos,
      `Impresso em ${new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(agora)}`,
      largura,
      "centro"
    );
  }

  empurrar(blocos, "Sem valor fiscal", largura, "centro");

  const linhasPdf = blocos.flatMap((bloco) => {
    if (bloco.tipo === "sep") {
      return [sep(largura)];
    }
    if (bloco.tipo === "logo" || bloco.tipo === "qr") {
      return [];
    }
    return [
      bloco.alinhamento === "centro"
        ? centralizarLinhaRecibo(bloco.texto, largura)
        : bloco.texto,
    ];
  });

  return { blocos, linhasPdf, papel, largura, layout };
}

export function reciboVendaExemplo(empresa?: ReciboVendaCompleto["empresa"]): ReciboVendaCompleto {
  return {
    vendaId: "exemplo",
    numero: "128",
    dataIso: "2026-08-26T15:30:00-04:00",
    observacao: "Entregar no balcão.",
    clienteNome: "Maria Silva",
    clienteDocumento: "39053344705",
    clienteTelefone: "(65) 99999-0000",
    vendedorNome: "Ana",
    empresa: empresa ?? {
      nomeFantasia: "Minha Loja",
      razaoSocial: "Minha Loja LTDA",
      documento: "04252011000110",
      ie: "13.885.672-9",
      endereco: "Rua das Flores, 100 - Centro",
      telefone: "(65) 3333-0000",
      email: "contato@loja.com",
      whatsapp: "(65) 99999-1111",
      logoUrl: null,
      logoEmpresaUrl: null,
      logoPersonalizadaUrl: null,
    },
    itens: [
      {
        codigo: "001",
        nome: "Pelicula 3D",
        quantidade: 1,
        valorUnitario: 45,
        desconto: 5,
        total: 40,
      },
      {
        codigo: "002",
        nome: "Capa silicone",
        quantidade: 2,
        valorUnitario: 25,
        desconto: 0,
        total: 50,
      },
    ],
    pagamentos: [
      {
        nome: "Dinheiro",
        valor: 60,
        parcelas: 1,
        bandeira: null,
        pix: false,
        fiado: false,
      },
      {
        nome: "PIX",
        valor: 20,
        parcelas: 1,
        bandeira: null,
        pix: true,
        fiado: false,
      },
      {
        nome: "Fiado",
        valor: 10,
        parcelas: null,
        bandeira: null,
        pix: false,
        fiado: true,
      },
    ],
    valorProdutos: 95,
    desconto: 5,
    acrescimo: 0,
    total: 90,
    troco: 0,
    carteira: {
      temFiado: true,
      valorFiado: 10,
      vencimento: "2026-09-10",
      saldoDevedor: 85,
      saldoAnterior: 75,
      limiteCredito: 300,
      creditoDisponivel: 215,
    },
  };
}
