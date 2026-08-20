import { tipoDestinoPorUf } from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  resolverCfopEfetivo,
  type RegraCfopNatureza,
  type TipoDestinoCfop,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import { naturezaEstaCompleta } from "@/lib/fiscal/operacoes/resolver-natureza";
import { montarItemDevolucaoFornecedor } from "@/lib/fiscal/entrada/montar-item-devolucao";
import type { EnderecoEmitenteNfe } from "@/lib/fiscal/entrada/parse-xml-nfe";
import type { AmbienteGeranet, CodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

export type PendenciaDevolucao = {
  codigo: string;
  mensagem: string;
};

export type ItemVerificacaoDevolucao = {
  id: string;
  descricao: string;
  quantidade: number;
  ncm?: string | null;
  cest?: string | null;
  ean?: string | null;
  unidade?: string | null;
  codigoProduto?: string | null;
  valorUnitario: number;
  desconto?: number;
  grupoFiscalId?: string | null;
  grupoFiscalNome?: string | null;
  regraIcmsDevolucao?: string | null;
  icmsCstCsosnGrupo?: string | null;
  grupoFiscalEmpresaId?: string | null;
  produtoEmpresaId?: string | null;
  quantidadeOriginal?: number | null;
  dadosFiscaisOriginal?: unknown;
  cfopResolvido?: string | null;
};

function cfopCongelado(valor: string | null | undefined) {
  const cfop = String(valor ?? "").replace(/\D/g, "");
  return /^\d{4}$/.test(cfop) ? cfop : "";
}

export function verificarDevolucaoFornecedor(params: {
  empresaIdAtiva: string;
  natureza: NaturezaOperacaoFiscal | null;
  chaveOrigem: string;
  ufEmpresa?: string | null;
  emitente: EnderecoEmitenteNfe | null;
  itens: ItemVerificacaoDevolucao[];
  regrasCfop: RegraCfopNatureza[];
  codigoRegimeTributario: CodigoRegimeTributario;
  ambiente: AmbienteGeranet;
  dataEmissao: Date | string;
  gruposIbs?: Record<
    string,
    {
      cstIbscbs?: string | null;
      classificacaoIbscbs?: string | null;
      aliquotaIbsUf?: number | string | null;
      aliquotaIbsMunicipio?: number | string | null;
      aliquotaCbs?: number | string | null;
    }
  >;
}): {
  ok: boolean;
  pendencias: PendenciaDevolucao[];
  alertas: string[];
  tipoDestino: TipoDestinoCfop | null;
  itens: Array<ItemVerificacaoDevolucao & { cfop: string | null }>;
} {
  const pendencias: PendenciaDevolucao[] = [];
  const alertas: string[] = [];

  if (
    !params.natureza ||
    !naturezaEstaCompleta(params.natureza, params.empresaIdAtiva)
  ) {
    pendencias.push({
      codigo: "natureza",
      mensagem:
        "Selecione uma natureza de devolução ao fornecedor da empresa ativa, com tpNF e finNFe preenchidos.",
    });
  } else if (params.natureza.tipo_operacao_interno !== "devolucao_fornecedor") {
    pendencias.push({
      codigo: "natureza",
      mensagem:
        "A natureza selecionada não é de devolução ao fornecedor.",
    });
  }

  if (!/^[0-9]{44}$/.test(params.chaveOrigem)) {
    pendencias.push({
      codigo: "referencia",
      mensagem: "A NF-e de entrada não possui chave de acesso válida para referência.",
    });
  }

  const tipoDestino = tipoDestinoPorUf(
    params.ufEmpresa,
    params.emitente?.uf
  );

  if (!tipoDestino) {
    pendencias.push({
      codigo: "uf",
      mensagem:
        "Não foi possível determinar operação interna/interestadual. Confira a UF da empresa e a UF do fornecedor no XML original.",
    });
  }

  if (params.emitente) {
    if (params.emitente.cnpj.length !== 14) {
      pendencias.push({
        codigo: "fornecedor",
        mensagem: "CNPJ do fornecedor original inválido.",
      });
    }
    if (
      !params.emitente.logradouro ||
      !params.emitente.bairro ||
      !params.emitente.municipio ||
      params.emitente.codigoMunicipio.length !== 7 ||
      !/^[A-Z]{2}$/.test(params.emitente.uf) ||
      params.emitente.cep.length !== 8
    ) {
      pendencias.push({
        codigo: "endereco",
        mensagem:
          "O XML original não possui endereço completo do fornecedor para a NF-e de devolução.",
      });
    }
  } else {
    pendencias.push({
      codigo: "xml",
      mensagem: "XML original da NF-e de entrada não está disponível.",
    });
  }

  if (params.itens.length === 0) {
    pendencias.push({
      codigo: "itens",
      mensagem: "Selecione ao menos um item com quantidade a devolver.",
    });
  }

  const itens = params.itens.map((item) => {
    const congelado = cfopCongelado(item.cfopResolvido);
    const cfop = congelado
      ? { ok: true as const, cfop: congelado, origem: "snapshot" as const }
      : tipoDestino
        ? resolverCfopEfetivo({
            tipoOperacaoInterno: "devolucao_fornecedor",
            tipoDestino,
            naturezaId: params.natureza?.id,
            grupoFiscalId: item.grupoFiscalId,
            grupoFiscal: { nome: item.grupoFiscalNome },
            regras: params.regrasCfop,
            empresaIdAtiva: params.empresaIdAtiva,
            naturezaDescricao: params.natureza?.descricao,
          })
        : { ok: false as const, mensagem: "Destino fiscal não determinado." };

    if (!item.grupoFiscalId) {
      pendencias.push({
        codigo: "grupo",
        mensagem: `${item.descricao}: produto sem grupo fiscal para resolver CFOP.`,
      });
    } else if (!cfop.ok) {
      pendencias.push({
        codigo: "cfop",
        mensagem: `${item.descricao}: ${cfop.mensagem}`,
      });
    }

    const montado = montarItemDevolucaoFornecedor({
      descricao: item.descricao,
      codigo: item.codigoProduto || "0",
      ean: item.ean,
      unidade: item.unidade || "UN",
      ncm: item.ncm || "",
      cest: item.cest,
      cfop: cfop.ok ? cfop.cfop : "",
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      desconto: item.desconto,
      dadosFiscaisOriginal: item.dadosFiscaisOriginal,
      regraIcmsDevolucao: item.regraIcmsDevolucao,
      icmsCstCsosnGrupo: item.icmsCstCsosnGrupo,
      grupoFiscalNome: item.grupoFiscalNome,
      grupoFiscalEmpresaId: item.grupoFiscalEmpresaId,
      produtoEmpresaId: item.produtoEmpresaId,
      empresaIdAtiva: params.empresaIdAtiva,
      quantidadeOriginal: item.quantidadeOriginal,
      codigoRegimeTributario: params.codigoRegimeTributario,
      ambiente: params.ambiente,
      dataEmissao: params.dataEmissao,
      ibs: item.grupoFiscalId
        ? params.gruposIbs?.[item.grupoFiscalId]
        : null,
    });

    for (const mensagem of montado.pendencias) {
      pendencias.push({
        codigo: "tributos",
        mensagem: `${item.descricao}: ${mensagem}`,
      });
    }

    return {
      ...item,
      cfop: cfop.ok ? cfop.cfop : null,
    };
  });

  if (params.natureza?.tp_nf && params.natureza.tp_nf !== "1") {
    alertas.push(
      `A natureza está com tpNF ${params.natureza.tp_nf}. A devolução ao fornecedor costuma ser saída (1).`
    );
  }
  if (params.natureza?.fin_nfe && params.natureza.fin_nfe !== "4") {
    alertas.push(
      `A natureza está com finNFe ${params.natureza.fin_nfe}. A devolução costuma usar finalidade 4.`
    );
  }

  return {
    ok: pendencias.length === 0,
    pendencias,
    alertas,
    tipoDestino,
    itens,
  };
}
