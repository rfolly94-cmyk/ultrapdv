export type StatusDocumentoContabil =
  | "autorizada"
  | "cancelada"
  | "rejeitada"
  | "inutilizada"
  | "aguardando_reconciliacao"
  | "aguardando_inutilizacao"
  | "processando"
  | "enviando"
  | string;

export type FiltroStatusDocumento =
  | "autorizada"
  | "cancelada"
  | "rejeitada"
  | "inutilizada"
  | "pendente";

export function modeloFiscalRotulo(modelo: string | number | null | undefined) {
  const valor = String(modelo ?? "");
  if (valor === "55") return "NF-e";
  if (valor === "65") return "NFC-e";
  return valor || "—";
}

export function pastaXmlModelo(modelo: string | number | null | undefined) {
  return String(modelo ?? "") === "55" ? "NFE" : "NFCE";
}

export function statusPendente(status: string) {
  return (
    status === "aguardando_reconciliacao" ||
    status === "aguardando_inutilizacao" ||
    status === "processando" ||
    status === "enviando"
  );
}

export function documentoCasaComFiltro(
  status: string,
  filtro?: FiltroStatusDocumento | null
) {
  if (!filtro) return true;
  if (filtro === "pendente") return statusPendente(status);
  return status === filtro;
}

export function custoInventario(custoMedio?: number | null, precoCusto?: number | null) {
  const medio = Number(custoMedio ?? 0);
  if (Number.isFinite(medio) && medio > 0) {
    return {
      valor: medio,
      disponivel: true,
      origem: "custo_medio" as const,
    };
  }

  const cadastro = Number(precoCusto ?? 0);
  if (Number.isFinite(cadastro) && cadastro > 0) {
    return {
      valor: cadastro,
      disponivel: true,
      origem: "preco_custo" as const,
    };
  }

  return {
    valor: null,
    disponivel: false,
    origem: "indisponivel" as const,
  };
}

export type EmissaoNumeracao = {
  modelo: string;
  serie: number | string;
  numero: number | string;
  status: string;
};

export function inconsistenciasNumeracao(emissoes: EmissaoNumeracao[]) {
  const grupos = new Map<string, number[]>();

  for (const emissao of emissoes) {
    if (
      !["autorizada", "cancelada", "inutilizada"].includes(emissao.status)
    ) {
      continue;
    }

    const numero = Number(emissao.numero);
    if (!Number.isFinite(numero) || numero <= 0) {
      continue;
    }

    const chave = `${emissao.modelo}:${emissao.serie}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(numero);
    grupos.set(chave, lista);
  }

  const avisos: string[] = [];

  for (const [chave, numeros] of grupos) {
    const [modelo, serie] = chave.split(":");
    const ordenados = [...numeros].sort((a, b) => a - b);
    const vistos = new Set<number>();

    for (const numero of ordenados) {
      if (vistos.has(numero)) {
        avisos.push(
          `${modeloFiscalRotulo(modelo)} série ${serie} com número ${numero} duplicado.`
        );
      }
      vistos.add(numero);
    }

    for (let i = 1; i < ordenados.length; i += 1) {
      const atual = ordenados[i];
      const anterior = ordenados[i - 1];
      if (atual > anterior + 1) {
        avisos.push(
          `${modeloFiscalRotulo(modelo)} série ${serie}: intervalo ${anterior + 1}–${atual - 1} sem documento.`
        );
      }
    }
  }

  return avisos;
}

export function nomeArquivoZip(slug: string, competencia: string) {
  return `${slug}-${competencia}-movimento-fiscal.zip`;
}

export function nomeArquivoXml(
  modelo: string,
  serie: number | string,
  numero: number | string,
  chave?: string | null
) {
  if (chave && chave.length >= 20) {
    return `${chave}.xml`;
  }

  return `${pastaXmlModelo(modelo)}-${serie}-${numero}.xml`;
}

export function pendenciasDeEmissao(emissao: {
  modelo?: string | null;
  serie?: number | string | null;
  numero?: number | string | null;
  status: string;
  chave_acesso?: string | null;
  protocolo?: string | null;
  xml_hex?: string | null;
  origem_id?: string | null;
  temEventoCancelamento?: boolean;
}) {
  const rotulo = `${modeloFiscalRotulo(emissao.modelo)} ${emissao.serie}/${emissao.numero}`;
  const itens: Array<{
    gravidade: "erro" | "atencao" | "info";
    descricao: string;
    href?: string;
  }> = [];

  if (emissao.status === "aguardando_reconciliacao") {
    itens.push({
      gravidade: "atencao",
      descricao: `${rotulo} aguardando reconciliação.`,
      href: emissao.origem_id ? `/vendas/${emissao.origem_id}` : "/fiscal",
    });
  }

  if (emissao.status === "aguardando_inutilizacao") {
    itens.push({
      gravidade: "atencao",
      descricao: `${rotulo} aguardando inutilização.`,
      href: "/fiscal",
    });
  }

  if (emissao.status === "autorizada") {
    if (!emissao.chave_acesso) {
      itens.push({
        gravidade: "erro",
        descricao: `${rotulo} autorizada sem chave.`,
      });
    }
    if (!emissao.protocolo) {
      itens.push({
        gravidade: "atencao",
        descricao: `${rotulo} autorizada sem protocolo.`,
      });
    }
    if (!emissao.xml_hex) {
      itens.push({
        gravidade: "atencao",
        descricao: `${rotulo} autorizada sem XML disponível.`,
      });
    }
  }

  if (emissao.status === "cancelada" && !emissao.temEventoCancelamento) {
    itens.push({
      gravidade: "atencao",
      descricao: `${rotulo} cancelada sem evento salvo.`,
    });
  }

  return itens;
}

export function buscaDocumento(
  termo: string,
  documento: {
    numero: string | number;
    chave?: string | null;
    cliente?: string | null;
    documento?: string | null;
  }
) {
  const normalizado = termo.trim().toLowerCase();
  if (!normalizado) return true;

  const campos = [
    String(documento.numero ?? ""),
    documento.chave ?? "",
    documento.cliente ?? "",
    documento.documento ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return campos.includes(normalizado);
}
