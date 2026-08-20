import {
  ErroComunicacaoGeranet,
  getGeranetJson,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  array,
  objeto,
  sanitizarConsultaGeranet,
  texto,
} from "@/lib/fiscal/geranet/classificar-consulta";
import {
  anoFiscalDaEmissao,
  classificarLogInutilizacao,
  EmissaoParaInutilizacao,
  logInutilizacaoCompativel,
  LogInutilizacao,
  SituacaoInutilizacao,
} from "@/lib/fiscal/geranet/classificar-inutilizacao";

export const ENDPOINT_LOG_INUTILIZACAO = "nfe/inutilizar-numeracao";

export type ResultadoConsultaInutilizacao = {
  situacao: SituacaoInutilizacao;
  log: LogInutilizacao | null;
  xml: string | null;
  logs_analisados: number;
  endpoint_consultado: string;
  resumo_seguro: Record<string, unknown>;
  erro?: string;
};

function listarPath(params: {
  cnpj: string;
  status: "sucesso" | "erro";
  endpoint?: string;
}) {
  const url = new URL("https://nfe.geranet.net/api/v1/logs");
  if (params.endpoint) {
    url.searchParams.set("endpoint", params.endpoint);
  }
  url.searchParams.set("cnpj", params.cnpj);
  url.searchParams.set("status", params.status);
  url.searchParams.set("por_pagina", "100");
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function extrairLogInutilizacao(
  resumo: Record<string, unknown>,
  detalhe?: Record<string, unknown>
): LogInutilizacao {
  const log = objeto(detalhe?.log);
  const payload = objeto(log.payload);
  const resposta = objeto(log.resposta);

  return {
    id: Number(resumo.id ?? log.id) || null,
    endpoint: texto(resumo.endpoint ?? log.endpoint) || null,
    criado_em: texto(resumo.criado_em ?? log.criado_em) || null,
    http_status: Number(resumo.http_status ?? log.http_status) || null,
    sucesso:
      typeof resumo.sucesso === "boolean"
        ? resumo.sucesso
        : typeof log.sucesso === "boolean"
          ? log.sucesso
          : null,
    situacao: texto(resposta.situacao).toLowerCase() || null,
    mensagem: texto(resposta.mensagem) || null,
    cstat: texto(resposta.cstat) || null,
    protocolo: texto(resposta.protocolo) || null,
    xml: texto(resposta.xml) || null,
    modelo: texto(payload.modelo) || null,
    serie: texto(payload.serie) || null,
    ano: texto(payload.ano) || null,
    numero_inicial: texto(payload.numeroInicial) || null,
    numero_final: texto(payload.numeroFinal) || null,
    ambiente: texto(payload.ambiente) || null,
    acao: texto(payload.acao) || null,
  };
}

async function listar(apiKey: string, path: string) {
  const resultado = await getGeranetJson({ apiKey, path });
  if (!resultado.httpOk) {
    throw new ErroComunicacaoGeranet(
      "comunicacao",
      `Geranet não permitiu listar logs (HTTP ${resultado.httpStatus}).`
    );
  }

  return array(resultado.dados.logs).map((item) => objeto(item));
}

/**
 * Confirma inutilização nos logs oficiais.
 * A OpenAPI filtra GET /api/v1/logs por `endpoint`.
 * O padrão já usado no UltraPDV para emitir é `nfe/emitir`.
 * Para inutilização tentamos primeiro `nfe/inutilizar-numeracao`
 * (path oficial sem /api/v1/). Se a lista vier vazia, cai no
 * filtro sem endpoint e casa pelo payload.
 */
export async function consultarInutilizacaoGeranet({
  apiKey,
  cnpj,
  emissao,
  ano,
}: {
  apiKey: string;
  cnpj: string;
  emissao: EmissaoParaInutilizacao;
  ano?: string;
}): Promise<ResultadoConsultaInutilizacao> {
  const cnpjLimpo = texto(cnpj).replace(/\D/g, "");
  const anoAlvo =
    ano ||
    anoFiscalDaEmissao({
      reservadaAt: emissao.reservada_at,
      createdAt: emissao.created_at,
    });

  try {
    let resumos = [
      ...(await listar(
        apiKey,
        listarPath({
          cnpj: cnpjLimpo,
          status: "sucesso",
          endpoint: ENDPOINT_LOG_INUTILIZACAO,
        })
      )),
      ...(await listar(
        apiKey,
        listarPath({
          cnpj: cnpjLimpo,
          status: "erro",
          endpoint: ENDPOINT_LOG_INUTILIZACAO,
        })
      )),
    ];

    let endpointConsultado = ENDPOINT_LOG_INUTILIZACAO;

    if (resumos.length === 0) {
      endpointConsultado = "(sem filtro de endpoint)";
      resumos = [
        ...(await listar(
          apiKey,
          listarPath({ cnpj: cnpjLimpo, status: "sucesso" })
        )),
        ...(await listar(
          apiKey,
          listarPath({ cnpj: cnpjLimpo, status: "erro" })
        )),
      ];
    }

    const compatíveis: LogInutilizacao[] = [];
    let analisados = 0;

    for (const resumo of resumos) {
      const logId = Number(resumo.id);
      if (!logId) {
        continue;
      }

      const detalhe = await getGeranetJson({
        apiKey,
        path: `/api/v1/logs/${logId}`,
      });

      if (!detalhe.httpOk) {
        continue;
      }

      analisados += 1;
      const campos = extrairLogInutilizacao(resumo, detalhe.dados);

      if (logInutilizacaoCompativel(emissao, anoAlvo, campos)) {
        compatíveis.push(campos);
      }
    }

    if (compatíveis.length === 0) {
      return {
        situacao: "nao_encontrada",
        log: null,
        xml: null,
        logs_analisados: analisados,
        endpoint_consultado: endpointConsultado,
        resumo_seguro: {
          fonte: "GET /api/v1/logs",
          endpoint: endpointConsultado,
          logs_listados: resumos.length,
        },
      };
    }

    const melhor = [...compatíveis].sort((a, b) => {
      const aOk = classificarLogInutilizacao(a) === "inutilizada" ? 1 : 0;
      const bOk = classificarLogInutilizacao(b) === "inutilizada" ? 1 : 0;
      if (bOk !== aOk) {
        return bOk - aOk;
      }

      return texto(b.criado_em).localeCompare(texto(a.criado_em));
    })[0];

    return {
      situacao: classificarLogInutilizacao(melhor),
      log: melhor,
      xml: texto(melhor.xml) || null,
      logs_analisados: analisados,
      endpoint_consultado: endpointConsultado,
      resumo_seguro: {
        fonte: "GET /api/v1/logs",
        endpoint: endpointConsultado,
        log: sanitizarConsultaGeranet(melhor),
      },
    };
  } catch (error) {
    const motivo =
      error instanceof ErroComunicacaoGeranet
        ? error.message
        : "Falha inesperada ao consultar logs de inutilização.";

    return {
      situacao: "falha_consulta",
      log: null,
      xml: null,
      logs_analisados: 0,
      endpoint_consultado: ENDPOINT_LOG_INUTILIZACAO,
      resumo_seguro: { erro: motivo },
      erro: motivo,
    };
  }
}
