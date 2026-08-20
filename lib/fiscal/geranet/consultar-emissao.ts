import {
  ErroComunicacaoGeranet,
  getGeranetBinario,
  getGeranetJson,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  bufferParecePdf,
  decodificarArquivoFiscal,
  extrairChaveAcessoXml,
  xmlPareceAutorizado,
} from "@/lib/fiscal/documento-fiscal";
import {
  array,
  classificarLogCancelar,
  classificarLogEmitir,
  EmissaoParaConsulta,
  extrairCamposLog,
  instanteDentroDaJanelaTransmissao,
  logCompativelComEmissao,
  LogGeranetResumo,
  objeto,
  sanitizarConsultaGeranet,
  SituacaoConsultaFiscal,
  somenteDigitos,
  texto,
} from "@/lib/fiscal/geranet/classificar-consulta";

export type ResultadoConsultaEmissao = {
  situacao: SituacaoConsultaFiscal;
  log: LogGeranetResumo | null;
  xml: string | null;
  pdf: string | null;
  logs_analisados: number;
  resumo_seguro: Record<string, unknown>;
  erro?: string;
};

function xmlAutorizadoHex(valor: unknown) {
  const bruto = texto(valor);
  if (!bruto) {
    return null;
  }

  const buffer = decodificarArquivoFiscal(bruto, "xml");
  if (!buffer || !xmlPareceAutorizado(buffer.toString("utf8"))) {
    return null;
  }

  return buffer.toString("hex");
}

function pdfValidoHex(valor: unknown) {
  const bruto = texto(valor);
  if (!bruto) {
    return null;
  }

  const buffer = decodificarArquivoFiscal(bruto, "pdf");
  return buffer ? buffer.toString("hex") : null;
}

function listarLogsUrl(params: {
  endpoint: string;
  cnpj: string;
  status: "sucesso" | "erro";
  porPagina?: number;
}) {
  const url = new URL("https://nfe.geranet.net/api/v1/logs");
  url.searchParams.set("endpoint", params.endpoint);
  url.searchParams.set("cnpj", params.cnpj);
  url.searchParams.set("status", params.status);
  url.searchParams.set("por_pagina", String(params.porPagina ?? 100));
  return `${url.pathname}?${url.searchParams.toString()}`;
}

async function listarLogs({
  apiKey,
  endpoint,
  cnpj,
  status,
}: {
  apiKey: string;
  endpoint: string;
  cnpj: string;
  status: "sucesso" | "erro";
}) {
  const resultado = await getGeranetJson({
    apiKey,
    path: listarLogsUrl({
      endpoint,
      cnpj,
      status,
    }),
  });

  if (!resultado.httpOk) {
    throw new ErroComunicacaoGeranet(
      "comunicacao",
      `Geranet não permitiu listar logs (HTTP ${resultado.httpStatus}).`
    );
  }

  return array(resultado.dados.logs).map((item) => objeto(item));
}

function resumoNaJanela(
  resumo: Record<string, unknown>,
  emissao: EmissaoParaConsulta
) {
  return instanteDentroDaJanelaTransmissao(
    emissao.enviada_at,
    texto(resumo.criado_em)
  );
}

async function detalharLogCompativel({
  apiKey,
  resumo,
  emissao,
}: {
  apiKey: string;
  resumo: Record<string, unknown>;
  emissao: EmissaoParaConsulta;
}) {
  const logId = Number(resumo.id);
  if (!logId) {
    return null;
  }

  const detalhe = await detalharLog(apiKey, logId);
  if (!detalhe) {
    return null;
  }

  const campos = extrairCamposLog(resumo, detalhe);
  if (!logCompativelComEmissao(emissao, campos)) {
    return null;
  }

  (campos as LogGeranetResumo & { _detalhe?: Record<string, unknown> })._detalhe =
    detalhe;
  return campos;
}

async function detalharLog(apiKey: string, logId: number) {
  const resultado = await getGeranetJson({
    apiKey,
    path: `/api/v1/logs/${logId}`,
  });

  if (!resultado.httpOk) {
    return null;
  }

  return resultado.dados;
}

async function baixarAnexosUteis({
  apiKey,
  detalhe,
  precisaXml,
  precisaPdf,
}: {
  apiKey: string;
  detalhe: Record<string, unknown>;
  precisaXml: boolean;
  precisaPdf: boolean;
}) {
  const log = objeto(detalhe.log);
  const anexos = array(log.anexos_emissao);
  let xml: string | null = null;
  let pdf: string | null = null;

  for (const item of anexos) {
    const anexo = objeto(item);
    const id = Number(anexo.id);
    const nome = texto(anexo.nome).toLowerCase();
    const tipo = texto(anexo.tipo_conteudo).toLowerCase();
    const url = texto(anexo.url_download);
    const logId = Number(objeto(detalhe.log).id ?? log.id);

    if (!id || !logId) {
      continue;
    }

    const ehXml =
      tipo.includes("xml") || nome.endsWith(".xml");
    const ehPdf =
      tipo.includes("pdf") || nome.endsWith(".pdf");

    if ((ehXml && !precisaXml) || (ehPdf && !precisaPdf)) {
      continue;
    }

    if (!ehXml && !ehPdf) {
      continue;
    }

    const path = url.includes("/api/v1/logs/")
      ? url.replace("https://nfe.geranet.net", "")
      : `/api/v1/logs/${logId}/anexos/emissao/${id}`;

    const arquivo = await getGeranetBinario({
      apiKey,
      path,
    });

    if (!arquivo.httpOk || !arquivo.buffer) {
      continue;
    }

    const hex = arquivo.buffer.toString("hex");

    if (ehXml && !xml) {
      const xmlBuffer = decodificarArquivoFiscal(hex, "xml");
      if (
        xmlBuffer &&
        xmlPareceAutorizado(xmlBuffer.toString("utf8"))
      ) {
        xml = hex;
      }
    }

    if (ehPdf && !pdf) {
      if (bufferParecePdf(arquivo.buffer)) {
        pdf = hex;
      }
    }

    if ((!precisaXml || xml) && (!precisaPdf || pdf)) {
      break;
    }
  }

  return { xml, pdf };
}

function escolherMelhorLog(
  candidatos: LogGeranetResumo[],
  emissao: EmissaoParaConsulta
) {
  if (candidatos.length === 0) {
    return null;
  }

  const pontuar = (log: LogGeranetResumo) => {
    const situacao = classificarLogEmitir(log, emissao);
    let pontos = 0;

    if (situacao === "autorizada") pontos += 50;
    if (situacao === "cancelada") pontos += 40;
    if (situacao === "rejeitada") pontos += 30;
    if (somenteDigitos(log.chave).length === 44) pontos += 10;
    if (texto(log.protocolo)) pontos += 5;
    if (texto(log.codigo_numerico) === texto(emissao.codigo_numerico)) {
      pontos += 8;
    }

    return pontos;
  };

  return [...candidatos].sort((a, b) => {
    const delta = pontuar(b) - pontuar(a);
    if (delta !== 0) {
      return delta;
    }

    return texto(b.criado_em).localeCompare(texto(a.criado_em));
  })[0];
}

/**
 * Consulta o estado real da emissão nos logs oficiais da Geranet.
 *
 * A OpenAPI atual (https://nfe.geranet.net/api-v1-openapi.json) não
 * expõe consulta de NF-e/NFC-e emitida por chave/número.
 * POST /api/v1/nfe/consultar-notas é distribuição DF-e de notas
 * destinadas ao CNPJ — não serve para reconciliar emissão própria.
 *
 * O caminho documentado para recuperar o resultado de um emitir é:
 * GET /api/v1/logs e GET /api/v1/logs/{id}.
 */
export async function recuperarArquivosEmissaoGeranet({
  apiKey,
  cnpj,
  emissao,
}: {
  apiKey: string;
  cnpj: string;
  emissao: EmissaoParaConsulta;
}): Promise<{
  xml: string | null;
  pdf: string | null;
  logs_analisados: number;
  erro?: string;
}> {
  const cnpjLimpo = somenteDigitos(cnpj);

  try {
    const logIdConhecido = Number(emissao.geranet_log_id) || 0;
    const resumos = await listarLogs({
      apiKey,
      endpoint: "nfe/emitir",
      cnpj: cnpjLimpo,
      status: "sucesso",
    });

    const compatíveis: Array<
      LogGeranetResumo & { _detalhe?: Record<string, unknown> }
    > = [];
    let analisados = 0;

    const candidatos = logIdConhecido
      ? [{ id: logIdConhecido }, ...resumos.filter((item) => Number(item.id) !== logIdConhecido)]
      : resumos;

    for (const resumo of candidatos) {
      if (!resumoNaJanela(resumo, emissao) && Number(resumo.id) !== logIdConhecido) {
        continue;
      }

      const campos = await detalharLogCompativel({
        apiKey,
        resumo,
        emissao,
      });
      if (!campos) {
        analisados += 1;
        continue;
      }

      analisados += 1;
      if (classificarLogEmitir(campos, emissao) === "autorizada") {
        compatíveis.push(
          campos as LogGeranetResumo & { _detalhe?: Record<string, unknown> }
        );
      }
    }

    const melhor = escolherMelhorLog(compatíveis, emissao);
    if (!melhor) {
      return { xml: null, pdf: null, logs_analisados: analisados };
    }

    const detalhe = (
      melhor as LogGeranetResumo & { _detalhe?: Record<string, unknown> }
    )._detalhe;

    let xml = xmlAutorizadoHex(melhor.xml);
    let pdf = pdfValidoHex(melhor.pdf);

    if (detalhe && (!xml || !pdf)) {
      const anexos = await baixarAnexosUteis({
        apiKey,
        detalhe,
        precisaXml: !xml,
        precisaPdf: !pdf,
      });
      xml = xml || anexos.xml;
      pdf = pdf || anexos.pdf;
    }

    return { xml, pdf, logs_analisados: analisados };
  } catch (error) {
    return {
      xml: null,
      pdf: null,
      logs_analisados: 0,
      erro:
        error instanceof ErroComunicacaoGeranet
          ? error.message
          : "Falha ao recuperar anexos da emissão na Geranet.",
    };
  }
}

export async function consultarEmissaoGeranet({
  apiKey,
  cnpj,
  emissao,
}: {
  apiKey: string;
  cnpj: string;
  emissao: EmissaoParaConsulta;
}): Promise<ResultadoConsultaEmissao> {
  const cnpjLimpo = somenteDigitos(cnpj);
  const chaveXml = extrairChaveAcessoXml(
    texto(emissao.xml_hex) || texto(emissao.xml_contingencia_hex)
  );
  if (somenteDigitos(emissao.chave_acesso).length !== 44 && chaveXml) {
    emissao = {
      ...emissao,
      chave_acesso: chaveXml,
    };
  }

  try {
    const logIdConhecido = Number(emissao.geranet_log_id) || 0;
    const compatíveis: LogGeranetResumo[] = [];
    let analisados = 0;

    if (logIdConhecido) {
      const conhecido = await detalharLogCompativel({
        apiKey,
        resumo: { id: logIdConhecido },
        emissao,
      });
      if (conhecido) {
        analisados += 1;
        compatíveis.push(conhecido);
      }
    }

    const [emitirSucesso, emitirErro] = await Promise.all([
      listarLogs({
        apiKey,
        endpoint: "nfe/emitir",
        cnpj: cnpjLimpo,
        status: "sucesso",
      }),
      listarLogs({
        apiKey,
        endpoint: "nfe/emitir",
        cnpj: cnpjLimpo,
        status: "erro",
      }),
    ]);

    const resumos = [...emitirSucesso, ...emitirErro];

    for (const resumo of resumos) {
      if (Number(resumo.id) === logIdConhecido) {
        continue;
      }

      if (!resumoNaJanela(resumo, emissao)) {
        continue;
      }

      const campos = await detalharLogCompativel({
        apiKey,
        resumo,
        emissao,
      });
      if (!campos) {
        analisados += 1;
        continue;
      }

      analisados += 1;
      compatíveis.push(campos);
    }

    let cancelado: LogGeranetResumo | null = null;
    const chave = somenteDigitos(emissao.chave_acesso);

    if (chave.length === 44) {
      const cancelamentos = await listarLogs({
        apiKey,
        endpoint: "nfe/cancelar",
        cnpj: cnpjLimpo,
        status: "sucesso",
      });

      for (const resumo of cancelamentos) {
        const logId = Number(resumo.id);
        if (!logId) {
          continue;
        }

        const detalhe = await detalharLog(apiKey, logId);
        if (!detalhe) {
          continue;
        }

        analisados += 1;
        const campos = extrairCamposLog(resumo, detalhe);
        const chaveLog = somenteDigitos(campos.chave);

        if (chaveLog === chave && classificarLogCancelar(campos)) {
          cancelado = campos;
          break;
        }
      }
    }

    if (cancelado) {
      return {
        situacao: "cancelada",
        log: cancelado,
        xml: texto(cancelado.xml) || null,
        pdf: texto(cancelado.pdf) || null,
        logs_analisados: analisados,
        resumo_seguro: {
          fonte: "GET /api/v1/logs",
          endpoint: "nfe/cancelar",
          log: sanitizarConsultaGeranet(cancelado),
        },
      };
    }

    const melhor = escolherMelhorLog(compatíveis, emissao);

    if (!melhor) {
      return {
        situacao: "nao_encontrada",
        log: null,
        xml: null,
        pdf: null,
        logs_analisados: analisados,
        resumo_seguro: {
          fonte: "GET /api/v1/logs",
          endpoint: "nfe/emitir",
          logs_listados: resumos.length,
          logs_analisados: analisados,
        },
      };
    }

    const situacao = classificarLogEmitir(melhor, emissao);
    const detalhe = (
      melhor as LogGeranetResumo & {
        _detalhe?: Record<string, unknown>;
      }
    )._detalhe;
    delete (melhor as { _detalhe?: unknown })._detalhe;

    let xml = texto(melhor.xml) || null;
    let pdf = texto(melhor.pdf) || null;

    if (detalhe && ((!xml && !texto(emissao.xml_hex)) || (!pdf && !texto(emissao.pdf_hex)))) {
      const anexos = await baixarAnexosUteis({
        apiKey,
        detalhe,
        precisaXml: !xml && !texto(emissao.xml_hex),
        precisaPdf: !pdf && !texto(emissao.pdf_hex),
      });

      xml = xml || anexos.xml;
      pdf = pdf || anexos.pdf;
    }

    return {
      situacao,
      log: melhor,
      xml,
      pdf,
      logs_analisados: analisados,
      resumo_seguro: {
        fonte: "GET /api/v1/logs",
        endpoint: "nfe/emitir",
        log: sanitizarConsultaGeranet(melhor),
        situacao,
      },
    };
  } catch (error) {
    const motivo =
      error instanceof ErroComunicacaoGeranet
        ? error.message
        : "Falha inesperada ao consultar logs da Geranet.";

    return {
      situacao: "falha_consulta",
      log: null,
      xml: null,
      pdf: null,
      logs_analisados: 0,
      resumo_seguro: {
        fonte: "GET /api/v1/logs",
        erro: motivo,
      },
      erro: motivo,
    };
  }
}
