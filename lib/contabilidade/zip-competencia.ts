import type { SupabaseClient } from "@supabase/supabase-js";

import { csvDocumento } from "@/lib/contabilidade/csv";
import type { Competencia } from "@/lib/contabilidade/competencia";
import { chaveCompetencia, slugArquivo } from "@/lib/contabilidade/competencia";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";
import {
  modeloFiscalRotulo,
  nomeArquivoXml,
  nomeArquivoZip,
  pastaXmlModelo,
} from "@/lib/contabilidade/regras";
import { criarZip } from "@/lib/contabilidade/zip";
import { decodificarArquivoFiscal } from "@/lib/fiscal/documento-fiscal";
import { obterDocumentoFiscal } from "@/lib/fiscal/obter-documento-fiscal";

function pastaEvento(tipo: string) {
  if (tipo === "cancelamento") return "CANCELAMENTOS";
  if (tipo === "carta_correcao") return "CCE";
  if (tipo === "inutilizacao") return "INUTILIZACOES";
  return "OUTROS";
}

export async function montarZipCompetencia({
  supabase,
  admin,
  empresaId,
  empresaNome,
  competencia,
  fuso,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  empresaId: string;
  empresaNome: string;
  competencia: Competencia;
  fuso?: string;
}) {
  const documentos = await carregarDocumentosCompetencia(
    supabase,
    empresaId,
    competencia,
    {},
    fuso
  );

  const ids = documentos.todos.map((item) => item.id);
  const { data: eventos } = ids.length
    ? await supabase
        .from("fiscal_emissao_eventos")
        .select("id, emissao_id, tipo, xml_hex, status")
        .eq("empresa_id", empresaId)
        .in("emissao_id", ids)
    : { data: [] };

  const { data: xmls } = ids.length
    ? await supabase
        .from("fiscal_emissoes")
        .select("id, xml_hex")
        .eq("empresa_id", empresaId)
        .in("id", ids)
    : { data: [] };
  const xmlPorId = new Map((xmls ?? []).map((item) => [item.id, item.xml_hex]));

  const arquivos: Array<{ nome: string; conteudo: Buffer }> = [];
  const pendentes: string[] = [];

  for (const documento of documentos.todos) {
    if (
      documento.status !== "autorizada" &&
      documento.status !== "cancelada" &&
      documento.status !== "inutilizada"
    ) {
      continue;
    }

    let xml: Buffer | null = null;
    const xmlHex = xmlPorId.get(documento.id);
    if (xmlHex) {
      xml = decodificarArquivoFiscal(String(xmlHex), "xml");
    }

    if (!xml && documento.status === "autorizada") {
      try {
        const recuperado = await obterDocumentoFiscal({
          admin,
          empresaId,
          emissaoId: documento.id,
          tipo: "xml",
        });
        xml = recuperado.buffer;
      } catch {
        pendentes.push(
          `${modeloFiscalRotulo(documento.modelo)} ${documento.serie}/${documento.numero} ${documento.chave ?? ""}`.trim()
        );
        continue;
      }
    }

    if (!xml) {
      if (documento.status === "autorizada") {
        pendentes.push(
          `${modeloFiscalRotulo(documento.modelo)} ${documento.serie}/${documento.numero} sem XML`
        );
      }
      continue;
    }

    arquivos.push({
      nome: `XML/${pastaXmlModelo(documento.modelo)}/${nomeArquivoXml(
        documento.modelo,
        documento.serie,
        documento.numero,
        documento.chave
      )}`,
      conteudo: xml,
    });
  }

  for (const evento of eventos ?? []) {
    if (evento.status !== "sucesso" || !evento.xml_hex) {
      continue;
    }

    const xml = decodificarArquivoFiscal(String(evento.xml_hex), "xml");
    if (!xml) {
      continue;
    }

    arquivos.push({
      nome: `XML/${pastaEvento(String(evento.tipo))}/${evento.id}.xml`,
      conteudo: xml,
    });
  }

  const relatorio = csvDocumento([
    [
      "data",
      "modelo",
      "serie",
      "numero",
      "chave",
      "cliente",
      "cpf_cnpj",
      "valor",
      "situacao",
      "cfop",
      "cstat",
      "protocolo",
    ],
    ...documentos.todos.map((documento) => [
      documento.data,
      modeloFiscalRotulo(documento.modelo),
      String(documento.serie),
      documento.numero,
      documento.chave ?? "",
      documento.cliente,
      documento.documento ?? "",
      String(documento.valor),
      documento.status,
      documento.cfop ?? "",
      documento.cstat ?? "",
      documento.protocolo ?? "",
    ]),
  ]);

  arquivos.push({
    nome: "RELATORIOS/documentos-fiscais.csv",
    conteudo: Buffer.from(relatorio, "utf8"),
  });

  arquivos.push({
    nome: "RELATORIOS/xmls-pendentes.txt",
    conteudo: Buffer.from(
      pendentes.length
        ? pendentes.join("\r\n")
        : "Nenhum XML pendente nesta competência.",
      "utf8"
    ),
  });

  const competenciaChave = chaveCompetencia(competencia);
  const nome = nomeArquivoZip(slugArquivo(empresaNome), competenciaChave);

  return {
    nome,
    buffer: criarZip(arquivos),
    pendentes: pendentes.length,
    arquivos: arquivos.length,
  };
}
