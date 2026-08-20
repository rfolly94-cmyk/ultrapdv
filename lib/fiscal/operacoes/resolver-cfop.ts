import {
  MENSAGEM_CFOP_NATUREZA_GRUPO_NAO_CONFIGURADO,
} from "./catalogo";
import {
  filtrarRegistrosDaEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";

export type TipoDestinoCfop = "interna" | "interestadual";

export type GrupoFiscalCfopFonte = {
  nome?: string | null;
  cfopInterno?: string | null;
  cfopInterestadual?: string | null;
};

export type RegraCfopNatureza = {
  empresaId: string;
  naturezaId: string;
  grupoFiscalId: string;
  tipoDestino: TipoDestinoCfop;
  cfop: string;
  ativo: boolean;
};

export type ResultadoCfopEfetivo =
  | {
      ok: true;
      cfop: string;
      origem: "grupo_fiscal_venda" | "regra_natureza";
    }
  | {
      ok: false;
      mensagem: string;
    };

export type LinhaRegraCfopBanco = {
  empresa_id?: string | null;
  natureza_id?: string | null;
  grupo_fiscal_id?: string | null;
  tipo_destino?: string | null;
  cfop?: string | null;
  ativo?: boolean | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function cfopValido(valor: string) {
  return /^\d{4}$/.test(valor);
}

export function ehTipoDestinoCfop(
  valor: unknown
): valor is TipoDestinoCfop {
  return valor === "interna" || valor === "interestadual";
}

export function tipoDestinoPorUf(
  ufEmpresa: string | null | undefined,
  ufDestinatario: string | null | undefined
): TipoDestinoCfop | null {
  const empresa = texto(ufEmpresa).toUpperCase();
  const destino = texto(ufDestinatario).toUpperCase();
  if (!/^[A-Z]{2}$/.test(empresa) || !/^[A-Z]{2}$/.test(destino)) {
    return null;
  }
  return empresa === destino ? "interna" : "interestadual";
}

function cfopDoGrupo(
  grupo: GrupoFiscalCfopFonte | null | undefined,
  tipoDestino: TipoDestinoCfop
) {
  const cfop = texto(
    tipoDestino === "interna"
      ? grupo?.cfopInterno
      : grupo?.cfopInterestadual
  );

  return cfopValido(cfop) ? cfop : "";
}

export function rotuloTipoDestinoCfop(tipoDestino: TipoDestinoCfop) {
  return tipoDestino === "interna" ? "Interna" : "Interestadual";
}

export function mensagemCfopNaturezaGrupoNaoConfigurado(params: {
  naturezaDescricao?: string | null;
  grupoFiscalNome?: string | null;
  tipoDestino: TipoDestinoCfop;
  tipoOperacaoInterno?: string | null;
}) {
  const tipo = texto(params.tipoOperacaoInterno);
  const titulo =
    tipo === "devolucao_fornecedor"
      ? "CFOP de devolução não configurado"
      : tipo === "bonificacao" || tipo === "transferencia"
        ? "Não existe regra de CFOP configurada"
        : MENSAGEM_CFOP_NATUREZA_GRUPO_NAO_CONFIGURADO;
  const linhas = [titulo];
  const natureza = texto(params.naturezaDescricao);
  const grupo = texto(params.grupoFiscalNome);

  if (natureza) {
    linhas.push(`Natureza: ${natureza}`);
  }

  linhas.push(`Grupo fiscal: ${grupo || "não identificado"}`);
  linhas.push(`Destino: ${rotuloTipoDestinoCfop(params.tipoDestino)}`);

  if (tipo !== "devolucao_fornecedor") {
    linhas.push("CFOP: não configurado");
  }

  return linhas.join(". ");
}

export function normalizarRegrasCfopDaEmpresaAtiva(
  registros: LinhaRegraCfopBanco[] | null | undefined,
  empresaIdAtiva: string
): RegraCfopNatureza[] {
  return filtrarRegistrosDaEmpresaAtiva(registros, empresaIdAtiva)
    .flatMap((regra) => {
      const naturezaId = texto(regra.natureza_id);
      const grupoFiscalId = texto(regra.grupo_fiscal_id);
      const cfop = texto(regra.cfop);
      const tipoDestino = regra.tipo_destino;

      if (
        !naturezaId ||
        !grupoFiscalId ||
        !ehTipoDestinoCfop(tipoDestino) ||
        !cfopValido(cfop)
      ) {
        return [];
      }

      return [
        {
          empresaId: texto(regra.empresa_id),
          naturezaId,
          grupoFiscalId,
          tipoDestino,
          cfop,
          ativo: regra.ativo !== false,
        },
      ];
    });
}

/**
 * CFOP efetivo da NF-e de venda:
 * 1. regra explícita da matriz (mesma empresa/natureza/grupo/destino);
 * 2. fallback do grupo fiscal somente na natureza padrão de venda;
 * 3. qualquer outra natureza sem regra bloqueia — não herda CFOP da venda padrão.
 */
export function resolverCfopEfetivo(params: {
  tipoOperacaoInterno: string;
  tipoDestino: TipoDestinoCfop;
  grupoFiscal?: GrupoFiscalCfopFonte | null;
  naturezaId?: string | null;
  grupoFiscalId?: string | null;
  regras?: RegraCfopNatureza[];
  empresaIdAtiva?: string | null;
  naturezaPadrao?: boolean;
  naturezaDescricao?: string | null;
}): ResultadoCfopEfetivo {
  const tipo = texto(params.tipoOperacaoInterno);
  const naturezaId = texto(params.naturezaId);
  const grupoFiscalId = texto(params.grupoFiscalId);
  const empresaIdAtiva = texto(params.empresaIdAtiva);

  const regrasAtivas = (params.regras ?? []).filter((regra) => {
    if (!regra.ativo || !cfopValido(texto(regra.cfop))) {
      return false;
    }

    if (empresaIdAtiva && texto(regra.empresaId) !== empresaIdAtiva) {
      return false;
    }

    return (
      regra.naturezaId === naturezaId &&
      regra.tipoDestino === params.tipoDestino &&
      texto(regra.grupoFiscalId) === grupoFiscalId
    );
  });

  const escolhida = regrasAtivas[0];

  if (escolhida) {
    return {
      ok: true,
      cfop: texto(escolhida.cfop),
      origem: "regra_natureza",
    };
  }

  const podeFallbackGrupoFiscal =
    tipo === "venda" && params.naturezaPadrao === true;

  if (podeFallbackGrupoFiscal) {
    const cfop = cfopDoGrupo(params.grupoFiscal, params.tipoDestino);

    if (!cfop) {
      return {
        ok: false,
        mensagem:
          "CFOP de venda não encontrado no grupo fiscal para a operação interna/interestadual.",
      };
    }

    return {
      ok: true,
      cfop,
      origem: "grupo_fiscal_venda",
    };
  }

  return {
    ok: false,
    mensagem: mensagemCfopNaturezaGrupoNaoConfigurado({
      naturezaDescricao: params.naturezaDescricao,
      grupoFiscalNome: params.grupoFiscal?.nome,
      tipoDestino: params.tipoDestino,
      tipoOperacaoInterno: tipo,
    }),
  };
}
