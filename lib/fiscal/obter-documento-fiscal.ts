import type { SupabaseClient } from "@supabase/supabase-js";

import { chamarGeranet } from "@/lib/fiscal/geranet/cliente-geranet";
import { recuperarArquivosEmissaoGeranet } from "@/lib/fiscal/geranet/consultar-emissao";
import { objeto, texto } from "@/lib/fiscal/geranet/classificar-consulta";
import {
  bufferParecePdf,
  decodificarArquivoFiscal,
  decidirRecuperacaoPdf,
  documentoPodeSerAberto,
  paraHex,
  xmlParaEnvioGeranet,
  xmlPareceAutorizado,
} from "@/lib/fiscal/documento-fiscal";
import { montarPayloadGerarPdf } from "@/lib/empresa/logo";

export type TipoDocumentoFiscal = "xml" | "pdf";

export type ResultadoDocumentoFiscal = {
  tipo: TipoDocumentoFiscal;
  buffer: Buffer;
  fonte: "local" | "anexo" | "gerar-pdf";
  geranetChamado: boolean;
};

type ArquivosRecuperados = {
  xml: string | null;
  pdf: string | null;
};

const inflight = new Map<string, Promise<ResultadoDocumentoFiscal>>();

function chaveInflight(
  empresaId: string,
  emissaoId: string,
  tipo: TipoDocumentoFiscal
) {
  return `${empresaId}:${emissaoId}:${tipo}`;
}

export function obterDocumentoFiscal({
  admin,
  empresaId,
  emissaoId,
  tipo,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  tipo: TipoDocumentoFiscal;
}): Promise<ResultadoDocumentoFiscal> {
  const chave = chaveInflight(empresaId, emissaoId, tipo);
  const existente = inflight.get(chave);
  if (existente) {
    return existente;
  }

  const trabalho = obterDocumentoFiscalInterno({
    admin,
    empresaId,
    emissaoId,
    tipo,
  }).finally(() => {
    inflight.delete(chave);
  });

  inflight.set(chave, trabalho);
  return trabalho;
}

async function obterDocumentoFiscalInterno({
  admin,
  empresaId,
  emissaoId,
  tipo,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  tipo: TipoDocumentoFiscal;
}): Promise<ResultadoDocumentoFiscal> {
  const { data: emissao, error } = await admin
    .from("fiscal_emissoes")
    .select(
      `
      id,
      modelo,
      serie,
      numero,
      ambiente,
      status,
      chave_acesso,
      codigo_numerico,
      origem_id,
      xml_hex,
      pdf_hex
    `
    )
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !emissao) {
    throw new Error(error?.message ?? "Emissão fiscal não encontrada.");
  }

  return resolverDocumentoFiscal({
    status: texto(emissao.status),
    modelo: texto(emissao.modelo),
    xmlHex: texto(emissao.xml_hex),
    pdfHex: texto(emissao.pdf_hex),
    tipo,
    recuperarAnexos: async () =>
      recuperarArquivosSePossivel({
        admin,
        empresaId,
        emissao,
      }),
    gerarPdf: async (xmlBuffer) =>
      gerarPdfGeranet({
        admin,
        empresaId,
        modelo: texto(emissao.modelo),
        xmlBuffer,
      }),
    persistir: async (patch) => {
      await persistir(admin, empresaId, emissaoId, patch);
    },
  });
}

export async function resolverDocumentoFiscal({
  status,
  modelo,
  xmlHex,
  pdfHex,
  tipo,
  recuperarAnexos,
  gerarPdf,
  persistir,
}: {
  status: string;
  modelo: string;
  xmlHex: string;
  pdfHex: string;
  tipo: TipoDocumentoFiscal;
  recuperarAnexos: () => Promise<ArquivosRecuperados>;
  gerarPdf: (xmlBuffer: Buffer) => Promise<Buffer>;
  persistir: (patch: Record<string, string>) => Promise<void>;
}): Promise<ResultadoDocumentoFiscal> {
  if (!documentoPodeSerAberto(status)) {
    throw new Error(
      status === "rejeitada"
        ? "Não é possível gerar DANFE de documento rejeitado."
        : "Arquivo disponível somente para documento autorizado/cancelado."
    );
  }

  if (modelo !== "55" && modelo !== "65") {
    throw new Error("Modelo fiscal inválido para documento fiscal.");
  }

  const xmlLocal = decodificarArquivoFiscal(xmlHex, "xml");
  const pdfLocal = decodificarArquivoFiscal(pdfHex, "pdf");
  const xmlLocalOk = Boolean(
    xmlLocal && xmlPareceAutorizado(xmlLocal.toString("utf8"))
  );

  if (tipo === "pdf" && pdfLocal) {
    return { tipo, buffer: pdfLocal, fonte: "local", geranetChamado: false };
  }

  if (tipo === "xml" && xmlLocalOk && xmlLocal) {
    return { tipo, buffer: xmlLocal, fonte: "local", geranetChamado: false };
  }

  // Caso B: PDF ausente, XML autorizado local — gerar sem varrer logs.
  if (tipo === "pdf" && xmlLocalOk && xmlLocal) {
    const pdfGerado = await gerarPdf(xmlLocal);
    await persistir({ pdf_hex: paraHex(pdfGerado) });
    return {
      tipo: "pdf",
      buffer: pdfGerado,
      fonte: "gerar-pdf",
      geranetChamado: true,
    };
  }

  const recuperado = await recuperarAnexos();
  const pdfAnexoBuffer = recuperado.pdf
    ? decodificarArquivoFiscal(recuperado.pdf, "pdf")
    : null;
  const xmlAnexoBuffer = recuperado.xml
    ? decodificarArquivoFiscal(recuperado.xml, "xml")
    : null;
  const xmlAnexoOk = Boolean(
    xmlAnexoBuffer && xmlPareceAutorizado(xmlAnexoBuffer.toString("utf8"))
  );

  if (tipo === "xml") {
    if (xmlAnexoOk && xmlAnexoBuffer) {
      await persistir({ xml_hex: paraHex(xmlAnexoBuffer) });
      return {
        tipo,
        buffer: xmlAnexoBuffer,
        fonte: "anexo",
        geranetChamado: true,
      };
    }

    throw new Error(
      "Não foi possível recuperar o XML autorizado desta emissão."
    );
  }

  const plano = decidirRecuperacaoPdf({
    status,
    pdfLocal: false,
    xmlLocal: xmlLocalOk,
    pdfAnexo: Boolean(pdfAnexoBuffer),
    xmlAnexo: xmlAnexoOk,
  });

  if (plano.acao === "usar_anexo_pdf" && pdfAnexoBuffer) {
    await persistir({
      pdf_hex: paraHex(pdfAnexoBuffer),
      ...(xmlAnexoOk && xmlAnexoBuffer
        ? { xml_hex: paraHex(xmlAnexoBuffer) }
        : {}),
    });
    return {
      tipo: "pdf",
      buffer: pdfAnexoBuffer,
      fonte: "anexo",
      geranetChamado: true,
    };
  }

  if (plano.acao === "gerar_pdf") {
    const xmlFonte =
      plano.xml === "local" && xmlLocal ? xmlLocal : xmlAnexoBuffer;

    if (!xmlFonte) {
      throw new Error(
        "Não foi possível recuperar o DANFE. O XML autorizado também não está disponível."
      );
    }

    if (plano.xml === "anexo") {
      await persistir({ xml_hex: paraHex(xmlFonte) });
    }

    const pdfGerado = await gerarPdf(xmlFonte);
    await persistir({ pdf_hex: paraHex(pdfGerado) });

    return {
      tipo: "pdf",
      buffer: pdfGerado,
      fonte: "gerar-pdf",
      geranetChamado: true,
    };
  }

  throw new Error(
    plano.acao === "erro"
      ? plano.motivo
      : "Não foi possível recuperar o DANFE. O XML autorizado também não está disponível."
  );
}

async function recuperarArquivosSePossivel({
  admin,
  empresaId,
  emissao,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissao: {
    id: string;
    modelo: string;
    serie: number;
    numero: number | string;
    ambiente: number;
    status: string;
    chave_acesso: string | null;
    codigo_numerico: string | null;
    origem_id: string | null;
    xml_hex: string | null;
    pdf_hex: string | null;
  };
}) {
  const [{ data: empresa }, segredosResult] = await Promise.all([
    admin.from("empresas").select("cnpj").eq("id", empresaId).maybeSingle(),
    admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
  ]);

  const apiKey = texto(objeto(segredosResult.data).geranet_api_key);
  if (!apiKey || !empresa) {
    return { xml: null, pdf: null };
  }

  return recuperarArquivosEmissaoGeranet({
    apiKey,
    cnpj: texto(empresa.cnpj),
    emissao,
  });
}

function extrairPdfResposta(dados: Record<string, unknown>) {
  const direto = texto(dados.pdf);
  if (direto) {
    return direto;
  }

  const aninhado = objeto(dados.dados);
  return texto(aninhado.pdf);
}

async function gerarPdfGeranet({
  admin,
  empresaId,
  modelo,
  xmlBuffer,
}: {
  admin: SupabaseClient;
  empresaId: string;
  modelo: string;
  xmlBuffer: Buffer;
}) {
  const segredosResult = await admin.rpc("obter_segredos_fiscais", {
    p_empresa_id: empresaId,
  });
  const apiKey = texto(objeto(segredosResult.data).geranet_api_key);

  if (!apiKey) {
    throw new Error("API Key Geranet não configurada.");
  }

  if (modelo !== "55" && modelo !== "65") {
    throw new Error("Modelo fiscal inválido para gerar PDF.");
  }

  const xmlEnvio = xmlParaEnvioGeranet(paraHex(xmlBuffer));
  if (!xmlEnvio) {
    throw new Error(
      "O XML local não é um XML fiscal autorizado adequado para gerar o DANFE."
    );
  }

  const { obterLogomarcaFiscalHex } = await import(
    "@/lib/empresa/obter-logomarca-fiscal-hex"
  );
  const logomarca = await obterLogomarcaFiscalHex(empresaId);

  const resultado = await chamarGeranet({
    apiKey,
    endpoint: "/api/v1/nfe/gerar-pdf",
    payload: montarPayloadGerarPdf({
      xml: xmlEnvio,
      modelo,
      logomarca,
    }),
    timeoutMs: 45_000,
  });

  const pdf = extrairPdfResposta(resultado.dados);
  const buffer = decodificarArquivoFiscal(pdf, "pdf");

  if (
    !resultado.httpOk ||
    texto(resultado.dados.situacao).toLowerCase() === "erro" ||
    !buffer ||
    !bufferParecePdf(buffer)
  ) {
    throw new Error(
      texto(resultado.dados.mensagem) ||
        "A Geranet não devolveu um PDF válido."
    );
  }

  return buffer;
}

async function persistir(
  admin: SupabaseClient,
  empresaId: string,
  emissaoId: string,
  patch: Record<string, string>
) {
  const { error } = await admin
    .from("fiscal_emissoes")
    .update(patch)
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .in("status", ["autorizada", "cancelada"]);

  if (error) {
    throw new Error(
      `O documento foi recuperado, mas falhou ao persistir: ${error.message}`
    );
  }
}
