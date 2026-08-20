import { resolverPoliticaIbscbs } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import type {
  AmbienteGeranet,
  CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import { CSOSN, CST_ICMS, existeCodigo } from "@/lib/fiscal/tabelas-fiscais";
import type { TributosOriginaisNfe } from "./parse-xml-nfe";
import { calcularTotaisItemGeranet } from "@/lib/fiscal/geranet/montar-item";

export function rotuloRegimeTributario(crt: CodigoRegimeTributario | number) {
  if (crt === 1) {
    return "Simples Nacional";
  }
  if (crt === 2) {
    return "Simples Nacional — excesso de sublimite";
  }
  if (crt === 3) {
    return "Regime Normal";
  }
  if (crt === 4) {
    return "MEI";
  }
  return `CRT ${crt}`;
}

export function rotuloTributacaoOriginal(tributos: TributosOriginaisNfe) {
  if (tributos.csosnOriginal) {
    return `CSOSN ${tributos.csosnOriginal}`;
  }
  if (tributos.cstOriginal) {
    return `CST ${tributos.cstOriginal.padStart(2, "0")}`;
  }
  return "CST/CSOSN ausente";
}

export function valoresProporcionaisDevolucao(params: {
  quantidadeOriginal: number;
  quantidadeDevolucao: number;
  valorUnitario: number;
  descontoOriginal?: number;
}) {
  const original = Number(params.quantidadeOriginal ?? 0);
  const devolucao = Number(params.quantidadeDevolucao ?? 0);
  const unitario = Number(params.valorUnitario ?? 0);
  if (!(original > 0) || !(devolucao > 0) || devolucao > original + 1e-9) {
    return {
      ok: false as const,
      mensagem:
        "Não foi possível proporcionalizar a devolução. Informe quantidade original e quantidade a devolver válidas.",
    };
  }

  const fator = devolucao / original;
  const totais = calcularTotaisItemGeranet({
    quantidade: devolucao,
    valorUnitario: unitario,
    desconto: Number(params.descontoOriginal ?? 0) * fator,
  });

  return {
    ok: true as const,
    fator,
    valorBrutoItem: totais.valorBrutoItem,
    valorLiquidoFiscal: totais.valorLiquidoFiscal,
    desconto: totais.desconto,
  };
}

export type ResultadoIcmsDevolucaoFornecedor =
  | {
      ok: true;
      origem: string;
      icmsCst: string;
      origemCodigo: "override" | "grupo_fiscal";
      usaCsosn: boolean;
      tipoGrupoOriginal: string;
      cstOriginal: string;
      csosnOriginal: string;
    }
  | {
      ok: false;
      mensagem: string;
    };

function codigoIcms(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

function codigoIcmsParaCatalogo(digits: string, usaCsosn: boolean) {
  if (!digits) {
    return "";
  }

  if (usaCsosn) {
    return digits.padStart(3, "0");
  }

  if (digits.length <= 2) {
    return digits.padStart(2, "0");
  }

  if (digits.length === 3 && digits.startsWith("0")) {
    return digits.slice(1);
  }

  return digits;
}

function rotuloCodigoIcms(digits: string) {
  return digits.padStart(3, "0");
}

export function resolverIcmsDevolucaoFornecedor(params: {
  empresaIdAtiva?: string | null;
  produtoEmpresaId?: string | null;
  grupoFiscalEmpresaId?: string | null;
  codigoRegimeTributario: CodigoRegimeTributario;
  ambiente: AmbienteGeranet;
  dataEmissao: Date | string;
  tributosOriginais: TributosOriginaisNfe;
  regraIcmsDevolucao?: string | null;
  icmsCstCsosnGrupo?: string | null;
  grupoFiscalNome?: string | null;
  produtoNome?: string | null;
}): ResultadoIcmsDevolucaoFornecedor {
  const tributos = params.tributosOriginais;
  const politica = resolverPoliticaIbscbs({
    codigoRegimeTributario: params.codigoRegimeTributario,
    dataEmissao: params.dataEmissao,
    ambiente: params.ambiente,
  });
  const empresaId = String(params.empresaIdAtiva ?? "").trim();
  const produtoEmpresaId = String(params.produtoEmpresaId ?? "").trim();
  const grupoEmpresaId = String(params.grupoFiscalEmpresaId ?? "").trim();

  if (
    empresaId &&
    ((produtoEmpresaId && produtoEmpresaId !== empresaId) ||
      (grupoEmpresaId && grupoEmpresaId !== empresaId))
  ) {
    return {
      ok: false,
      mensagem:
        "O produto ou o grupo fiscal não pertence à empresa ativa.",
    };
  }

  if (!/^\d$/.test(tributos.origem)) {
    return {
      ok: false,
      mensagem: "Origem da mercadoria ausente no XML original.",
    };
  }

  if (!tributos.csosnOriginal && !tributos.cstOriginal) {
    return {
      ok: false,
      mensagem:
        "A tributação original da NF-e de entrada não possui CST nem CSOSN de ICMS.",
    };
  }

  const catalogo = politica.usaCsosnIcms ? CSOSN : CST_ICMS;
  const tipoEsperado = politica.usaCsosnIcms ? "CSOSN" : "CST";
  const grupoNome = String(params.grupoFiscalNome ?? "").trim();
  const produtoNome = String(params.produtoNome ?? "").trim();
  const override = codigoIcms(params.regraIcmsDevolucao);
  const doGrupo = codigoIcms(params.icmsCstCsosnGrupo);

  const escolhido = override
    ? { bruto: override, origemCodigo: "override" as const }
    : doGrupo
      ? { bruto: doGrupo, origemCodigo: "grupo_fiscal" as const }
      : null;

  if (!escolhido) {
    const rotuloGrupo = grupoNome || "não identificado";
    return {
      ok: false,
      mensagem: [
        "Não foi possível determinar a tributação de ICMS da devolução.",
        `Nota original: ${rotuloTributacaoOriginal(tributos)}`,
        `Empresa emitente: ${rotuloRegimeTributario(params.codigoRegimeTributario)}`,
        produtoNome ? `Produto: ${produtoNome}` : null,
        `Grupo fiscal: ${rotuloGrupo}`,
        grupoNome
          ? `O grupo fiscal ${grupoNome} não possui ${tipoEsperado} de ICMS configurado.`
          : "O produto não possui grupo fiscal vinculado na empresa ativa.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const codigo = codigoIcmsParaCatalogo(
    escolhido.bruto,
    politica.usaCsosnIcms
  );

  if (!existeCodigo(catalogo, codigo)) {
    const origemConfiguracao =
      escolhido.origemCodigo === "override"
        ? "A regra específica de ICMS da devolução ao fornecedor"
        : `O grupo fiscal ${grupoNome || "não identificado"}`;
    return {
      ok: false,
      mensagem: [
        `${origemConfiguracao} possui ICMS ${rotuloCodigoIcms(escolhido.bruto)} configurado,`,
        `mas a empresa emitente utiliza ${rotuloRegimeTributario(params.codigoRegimeTributario)}.`,
        "Revise a configuração fiscal do grupo.",
      ].join(" "),
    };
  }

  return {
    ok: true,
    origem: tributos.origem,
    icmsCst: codigo,
    origemCodigo: escolhido.origemCodigo,
    usaCsosn: politica.usaCsosnIcms,
    tipoGrupoOriginal: tributos.tipoGrupoIcms,
    cstOriginal: tributos.cstOriginal,
    csosnOriginal: tributos.csosnOriginal,
  };
}
