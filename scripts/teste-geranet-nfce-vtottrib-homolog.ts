/**
 * FERRAMENTA DE DIAGNÓSTICO ISOLADO — NÃO é rota de produção.
 *
 * Objetivo: emitir UMA NFC-e 65 em HOMOLOGAÇÃO (ambiente 2) para auditar
 * ibptAutomatico / vTotTrib da Geranet. Fora de fiscal_emissoes, vendas,
 * estoque, claim e numeração de produção. Não retransmite a NFC-e 32.
 *
 * Caso:
 *   item R$ 55,00 / desconto R$ 50,00 / modelo 65 / ambiente 2
 *
 * Uso:
 *   npx tsx scripts/teste-geranet-nfce-vtottrib-homolog.ts
 *   npx tsx scripts/teste-geranet-nfce-vtottrib-homolog.ts --executar
 *   npx tsx scripts/teste-geranet-nfce-vtottrib-homolog.ts --executar --variante=manual
 *
 * Variantes:
 *   auto     payload de produção (ibptAutomatico=sim + vTotTrib="") — padrão
 *   omitido  sem ibptAutomatico e sem vTotTrib (comportamento anterior)
 *   manual   ibptAutomatico=nao + vTotTrib=1.00
 *
 * Tenant:
 *   DIAGNOSTICO_USUARIO_ID → usuarios_empresas.principal + ativo
 *   ou DIAGNOSTICO_EMPRESA_ID → somente essa empresa
 */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { valorTotalNotaGeranet } from "@/lib/fiscal/distribuir-desconto-itens";
import { decodificarArquivoFiscal } from "@/lib/fiscal/documento-fiscal";
import { sanitizarConsultaGeranet } from "@/lib/fiscal/geranet/classificar-consulta";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { montarItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import {
  montarPayloadNfceGeranet,
  ocultarSegredosPayloadNfce,
} from "@/lib/fiscal/geranet/montar-payload-nfce";
import { parsePerfilIpi } from "@/lib/fiscal/ipi";

const ENDPOINT = "/api/v1/nfe/emitir";
const URL_GERANET = `https://nfe.geranet.net${ENDPOINT}`;
const AMBIENTE = "2" as const;
const MODELO = "65" as const;
const UF_EMITENTE = "MT";
const TIMEOUT_MS = 45_000;
const VALOR_UNITARIO = 55;
const DESCONTO = 50;
const VTOTTRIB_MANUAL = "1.00";

const HEADERS_SENSIVEIS =
  /authorization|api.?key|token|cookie|set-cookie|certificado|senha|csc|secret/i;

type Variante = "omitido" | "manual" | "auto";

function carregarEnvLocal() {
  const caminho = join(process.cwd(), ".env.local");
  const textoEnv = readFileSync(caminho, "utf8");

  for (const linha of textoEnv.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) {
      continue;
    }
    const igual = limpa.indexOf("=");
    if (igual <= 0) {
      continue;
    }
    const chave = limpa.slice(0, igual).trim();
    let valor = limpa.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function mascararCnpj(valor: unknown) {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 14) {
    return "[cnpj inválido]";
  }
  return `********/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function mascararDocumento(valor: unknown) {
  const digitos = somenteDigitos(valor);
  if (digitos.length === 11) {
    return `*******${digitos.slice(-4)}`;
  }
  if (digitos.length === 14) {
    return mascararCnpj(digitos);
  }
  return valor;
}

function sanitizarDiagnostico(valor: unknown): unknown {
  return mascararIdentificadores(sanitizarConsultaGeranet(valor));
}

function mascararIdentificadores(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(mascararIdentificadores);
  }
  if (!valor || typeof valor !== "object") {
    return valor;
  }

  const saida: Record<string, unknown> = {};
  for (const [chave, conteudo] of Object.entries(
    valor as Record<string, unknown>
  )) {
    if (/^(cnpj|cpf)$/i.test(chave)) {
      saida[chave] = mascararDocumento(conteudo);
      continue;
    }
    saida[chave] = mascararIdentificadores(conteudo);
  }
  return saida;
}

function sanitizarHeaders(headers: Headers) {
  const saida: Record<string, string> = {};
  headers.forEach((valor, chave) => {
    if (HEADERS_SENSIVEIS.test(chave)) {
      saida[chave] = "[REDACTED]";
      return;
    }
    saida[chave] = valor.length > 400 ? "[omitido]" : valor;
  });
  return saida;
}

function tagXml(xml: string, nome: string) {
  const matches = [
    ...xml.matchAll(new RegExp(`<${nome}>([^<]*)</${nome}>`, "g")),
  ];
  return matches.map((item) => item[1]);
}

function extrairVtottrib(xml: string) {
  return {
    vProd: tagXml(xml, "vProd")[0] ?? null,
    vDesc: tagXml(xml, "vDesc")[0] ?? null,
    vNF: tagXml(xml, "vNF")[0] ?? null,
    vTotTribItem: tagXml(xml, "vTotTrib")[0] ?? null,
    vTotTribTodos: tagXml(xml, "vTotTrib"),
    ncm: tagXml(xml, "NCM")[0] ?? null,
    cfop: tagXml(xml, "CFOP")[0] ?? null,
    modelo: tagXml(xml, "mod")[0] ?? null,
    tpAmb: tagXml(xml, "tpAmb")[0] ?? null,
  };
}

function resolverVariante(): Variante {
  const bruto = process.argv.find((arg) => arg.startsWith("--variante="));
  const valor = bruto ? bruto.slice("--variante=".length).trim() : "auto";
  if (valor === "omitido" || valor === "manual" || valor === "auto") {
    return valor;
  }
  throw new Error("Variante inválida. Use omitido, manual ou auto.");
}

function resolverVtottribManual() {
  const bruto = process.argv.find((arg) => arg.startsWith("--vtottrib="));
  if (!bruto) {
    return VTOTTRIB_MANUAL;
  }
  const valor = bruto.slice("--vtottrib=".length).trim();
  if (!/^\d+\.\d{2}$/.test(valor)) {
    throw new Error("vTotTrib diagnóstico inválido. Use formato 1.00.");
  }
  return valor;
}

async function resolverEmpresaAtiva(admin: SupabaseClient) {
  const usuarioId = texto(process.env.DIAGNOSTICO_USUARIO_ID);
  const empresaIdInformada = texto(process.env.DIAGNOSTICO_EMPRESA_ID);

  if (usuarioId) {
    const { data, error } = await admin
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", usuarioId)
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (error || !data?.empresa_id) {
      throw new Error(
        "Empresa ativa não encontrada para DIAGNOSTICO_USUARIO_ID."
      );
    }

    return String(data.empresa_id);
  }

  if (empresaIdInformada) {
    const { data, error } = await admin
      .from("empresas")
      .select("id")
      .eq("id", empresaIdInformada)
      .maybeSingle();

    if (error || !data?.id) {
      throw new Error("DIAGNOSTICO_EMPRESA_ID não corresponde a uma empresa.");
    }

    return String(data.id);
  }

  const { data, error } = await admin
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("principal", true)
    .eq("ativo", true);

  if (error) {
    throw new Error(`Falha ao resolver empresa ativa: ${error.message}`);
  }

  const ids = [
    ...new Set((data ?? []).map((item) => String(item.empresa_id))),
  ];

  if (ids.length === 1) {
    return ids[0];
  }

  throw new Error(
    ids.length === 0
      ? "Nenhum vínculo principal+ativo encontrado. Defina DIAGNOSTICO_USUARIO_ID ou DIAGNOSTICO_EMPRESA_ID."
      : `Há ${ids.length} empresas com vínculo principal. Defina DIAGNOSTICO_USUARIO_ID ou DIAGNOSTICO_EMPRESA_ID.`
  );
}

async function main() {
  carregarEnvLocal();

  const executar = process.argv.includes("--executar");
  const variante = resolverVariante();
  const vTotTribManual = resolverVtottribManual();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error("Credenciais administrativas do Supabase ausentes.");
  }

  const admin: SupabaseClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const empresaId = await resolverEmpresaAtiva(admin);

  const [
    { data: empresa, error: empresaError },
    { data: fiscal, error: fiscalError },
    { data: nfceConfigs, error: nfceError },
    segredosResult,
  ] = await Promise.all([
    admin
      .from("empresas")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("id", empresaId)
      .maybeSingle(),
    admin
      .from("empresas_fiscal")
      .select(
        `
        empresa_id,
        inscricao_estadual,
        telefone,
        email,
        logradouro,
        numero,
        complemento,
        bairro,
        cep,
        municipio,
        codigo_municipio_ibge,
        uf,
        tipo_atividade,
        perfil_ipi,
        codigo_regime_tributario,
        indicador_presenca_padrao,
        indicativo_intermediador_padrao,
        fuso_horario,
        ativo
      `
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    admin
      .from("fiscal_nfce_config")
      .select("id, id_csc, ativo")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .limit(2),
    admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
  ]);

  if (empresaError || !empresa) {
    throw new Error("Empresa da emissão diagnóstica não encontrada.");
  }

  if (fiscalError || !fiscal || fiscal.ativo === false) {
    throw new Error("Configuração fiscal da empresa ativa não encontrada.");
  }

  if (nfceError) {
    throw new Error(`Falha ao ler fiscal_nfce_config: ${nfceError.message}`);
  }

  if (!nfceConfigs || nfceConfigs.length !== 1) {
    throw new Error(
      "CSC da NFC-e da empresa ativa está ausente ou duplicado. Diagnóstico abortado."
    );
  }

  if (segredosResult.error) {
    throw new Error(
      "Não foi possível ler os segredos fiscais da empresa ativa."
    );
  }

  const segredos = (segredosResult.data ?? {}) as {
    geranet_api_key?: string | null;
    certificado_a1?: string | null;
    senha_certificado?: string | null;
    csc?: string | null;
  };

  const apiKey = texto(segredos.geranet_api_key);
  const certificado = texto(segredos.certificado_a1);
  const senhaCertificado = texto(segredos.senha_certificado);
  const csc = texto(segredos.csc);
  const idCsc = texto(nfceConfigs[0].id_csc);

  if (!apiKey || !certificado || !senhaCertificado || !csc || !idCsc) {
    throw new Error(
      "API Key/certificado/senha/CSC da empresa ativa estão incompletos."
    );
  }

  const uf = texto(fiscal.uf).toUpperCase();
  if (uf !== UF_EMITENTE) {
    throw new Error(
      `UF da empresa ativa é ${uf || "(vazia)"}, não ${UF_EMITENTE}. Diagnóstico abortado.`
    );
  }

  const crt = Number(fiscal.codigo_regime_tributario);
  if (crt !== 1) {
    throw new Error(
      `CRT da empresa ativa é ${crt}, não 1. Diagnóstico abortado.`
    );
  }

  const fusoHorario = texto(fiscal.fuso_horario);
  const agora = new Date();
  const dataHoraFiscal = formatarDataHoraGeranet(agora, fusoHorario);
  const serieDiagnostico = 99;
  const numeroDiagnostico = 900000 + randomInt(1, 99999);
  const codigoNumerico = String(randomInt(10_000_000, 99_999_999));

  const itemMontado = montarItemGeranet({
    modelo: MODELO,
    ambiente: AMBIENTE,
    codigoRegimeTributario: 1,
    dataEmissao: agora,
    operacao: "interna",
    quantidade: 1,
    valorUnitario: VALOR_UNITARIO,
    desconto: DESCONTO,
    frete: 0,
    seguro: 0,
    outro: 0,
    perfilIpi: parsePerfilIpi(fiscal.perfil_ipi),
    produto: {
      codigo: "1",
      nome: "Frontal A12 C/ Aro Diamond",
      unidadeMedida: "UN",
      precoVenda: VALOR_UNITARIO,
      tipoItem: "00",
    },
    fiscal: {
      ncm: "85299020",
      origemProduto: "0",
    },
    grupo: {
      cfopInterno: "5405",
      cfopInterestadual: "6405",
      icmsCstCsosn: "500",
      pisCst: "07",
      pisAliquota: 0,
      cofinsCst: "07",
      cofinsAliquota: 0,
      cstIbscbs: null,
      classificacaoIbscbs: null,
      aliquotaIbsUf: null,
      aliquotaIbsMunicipio: null,
      aliquotaCbs: null,
      percentualReducaoIbsUf: null,
      percentualReducaoIbsMunicipio: null,
      percentualReducaoCbs: null,
    },
  });

  const item = itemMontado.item as typeof itemMontado.item & {
    vTotTrib?: string;
  };

  if (variante === "manual") {
    item.vTotTrib = vTotTribManual;
  }

  const payload = montarPayloadNfceGeranet({
    emitente: {
      cnpj: empresa.cnpj,
      inscricaoEstadual: fiscal.inscricao_estadual,
      razaoSocial: empresa.razao_social,
      nomeFantasia: empresa.nome_fantasia,
      telefone: fiscal.telefone,
      email: fiscal.email,
      logradouro: fiscal.logradouro,
      numero: fiscal.numero,
      complemento: fiscal.complemento,
      bairro: fiscal.bairro,
      municipio: fiscal.municipio,
      codigoMunicipio: fiscal.codigo_municipio_ibge,
      uf,
      cep: fiscal.cep,
      codigoRegimeTributario: 1,
      tipoAtividade: fiscal.tipo_atividade ?? "3",
    },
    config: {
      ambiente: AMBIENTE,
      serie: serieDiagnostico,
      numeroNota: numeroDiagnostico,
      idCsc,
      indicadorPresenca: texto(fiscal.indicador_presenca_padrao) || "1",
      indicativoIntermediador:
        texto(fiscal.indicativo_intermediador_padrao) || "0",
      naturezaOperacao: "Venda",
      dataEmissao: dataHoraFiscal,
      dataSaida: dataHoraFiscal,
      fusoHorario,
    },
    segredos: {
      certificado_a1: certificado,
      senha_certificado: senhaCertificado,
      csc,
    },
    item,
    pagamento: {
      tipo: "01",
      valor: 5,
      indicadorPagamento: "0",
      troco: 0,
    },
    codigoNumerico,
  });

  const nfe = payload.nfe as {
    valorTotal?: string;
    itens: Array<typeof item>;
    empresa: Omit<typeof payload.nfe.empresa, "ibptAutomatico"> & {
      ibptAutomatico?: string;
    };
  };

  nfe.valorTotal = valorTotalNotaGeranet([
    {
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      desconto: item.desconto,
      valorTotal: item.valorTotal,
    },
  ]);

  if (variante === "omitido") {
    delete item.vTotTrib;
    delete nfe.empresa.ibptAutomatico;
  } else if (variante === "manual") {
    nfe.empresa.ibptAutomatico = "nao";
  }

  const payloadSanitizado = sanitizarDiagnostico(
    ocultarSegredosPayloadNfce(payload)
  );

  const cabecalho = {
    ferramenta: "scripts/teste-geranet-nfce-vtottrib-homolog.ts",
    producao: false,
    ultrapdv_participou_da_emissao: false,
    retransmite_nfce_32: false,
    empresa_id: empresaId,
    empresa: texto(empresa.nome_fantasia) || texto(empresa.razao_social),
    cnpj_mascarado: mascararCnpj(empresa.cnpj),
    ambiente: AMBIENTE,
    modelo: MODELO,
    uf_emitente: UF_EMITENTE,
    serie_diagnostico: serieDiagnostico,
    numero_diagnostico: numeroDiagnostico,
    variante,
    ibptAutomatico_enviado: nfe.empresa.ibptAutomatico ?? null,
    vTotTrib_enviado: item.vTotTrib ?? null,
    valorTotal_item: item.valorTotal,
    desconto_item: item.desconto,
    valorTotal_nota: nfe.valorTotal,
    endpoint: ENDPOINT,
  };

  console.log("=== TESTE ISOLADO GERANET — NFC-e 65 HOMOLOGAÇÃO vTotTrib ===");
  console.log(JSON.stringify(cabecalho, null, 2));
  console.log("=== JSON SANITIZADO (IBPT) ===");
  const nfeSanitizado = (payloadSanitizado as { nfe?: Record<string, unknown> })
    .nfe;
  const empresaSanitizada = nfeSanitizado?.empresa as
    | Record<string, unknown>
    | undefined;
  const itemSanitizado = Array.isArray(nfeSanitizado?.itens)
    ? (nfeSanitizado.itens[0] as Record<string, unknown>)
    : undefined;
  console.log(
    JSON.stringify(
      {
        ibptAutomatico: empresaSanitizada?.ibptAutomatico ?? null,
        vTotTrib: itemSanitizado?.vTotTrib ?? null,
        valorTotal: itemSanitizado?.valorTotal ?? null,
        desconto: itemSanitizado?.desconto ?? null,
        valorTotalNota: nfeSanitizado?.valorTotal ?? null,
        ncmProduto: itemSanitizado?.ncmProduto ?? null,
        cfop: itemSanitizado?.cfop ?? null,
        icmsCsosn: itemSanitizado?.icmsCsosn ?? null,
        pisCst: itemSanitizado?.pisCst ?? null,
        cofinsCst: itemSanitizado?.cofinsCst ?? null,
      },
      null,
      2
    )
  );

  if (!executar) {
    console.log(
      "Dry-run: nenhum POST foi enviado. Passe --executar para UMA emissão de homologação."
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resposta: Response;
  let bodyBruto = "";

  try {
    resposta = await fetch(URL_GERANET, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    bodyBruto = await resposta.text();
  } catch (error) {
    const nome = error instanceof Error ? error.name : "Error";
    const mensagem = error instanceof Error ? error.message : String(error);
    const timeoutOuAbort =
      nome === "AbortError" || /timeout|aborted|etimedout/i.test(mensagem);

    console.log("=== RESULTADO ===");
    console.log(
      JSON.stringify(
        {
          resultado: timeoutOuAbort ? "INDETERMINADO" : "FALHA_DE_REDE",
          mensagem: timeoutOuAbort
            ? "Timeout/aborto ao chamar a Geranet. Não reenviado."
            : mensagem,
          ultrapdv_participou_da_emissao: "NÃO",
        },
        null,
        2
      )
    );
    return;
  } finally {
    clearTimeout(timeout);
  }

  let jsonParseado: unknown = null;
  try {
    jsonParseado = bodyBruto ? JSON.parse(bodyBruto) : null;
  } catch {
    jsonParseado = null;
  }

  const dados =
    jsonParseado && typeof jsonParseado === "object"
      ? (jsonParseado as Record<string, unknown>)
      : {};
  const headers = sanitizarHeaders(resposta.headers);
  const http = resposta.status;
  const xmlBuffer = decodificarArquivoFiscal(texto(dados.xml), "xml");
  const xml = xmlBuffer ? xmlBuffer.toString("utf8") : "";
  const vtottribXml = xml ? extrairVtottrib(xml) : null;

  const resultado =
    http >= 500
      ? "INDETERMINADO"
      : http === 422
        ? "REJEITADO_PELA_GERANET"
        : /autorizad/i.test(texto(dados.situacao) + texto(dados.mensagem)) ||
            texto(dados.cstat) === "100" ||
            texto(dados.cstat) === "150"
          ? "AUTORIZADA"
          : `HTTP_${http}`;

  console.log("=== RESULTADO ===");
  console.log(
    JSON.stringify(
      {
        http,
        content_type: headers["content-type"] ?? null,
        situacao: texto(dados.situacao) || null,
        mensagem: texto(dados.mensagem) || null,
        cstat: texto(dados.cstat) || null,
        chave: texto(dados.chave) || null,
        protocolo: texto(dados.protocolo) || null,
        numero: texto(dados.numero) || null,
        xml_disponivel: Boolean(xml),
        tags_xml: vtottribXml,
        vTotTrib_enviado: item.vTotTrib ?? null,
        vTotTrib_sobre_liquido_5:
          vtottribXml?.vTotTribItem === "1.00",
        vTotTrib_sobre_bruto_55:
          vtottribXml?.vTotTribItem === "11.00",
        vTotTrib_manual_gravado:
          variante === "manual" &&
          vtottribXml?.vTotTribItem === vTotTribManual,
        resultado,
        ultrapdv_participou_da_emissao: "NÃO",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const mensagem = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        resultado: "FALHA_LOCAL",
        mensagem: mensagem.replace(
          /Bearer\s+\S+|certificadoDigital|senhaCertificadoDigital|api[_-]?key/gi,
          "[REDACTED]"
        ),
        ultrapdv_participou_da_emissao: "NÃO",
      },
      null,
      2
    )
  );
  process.exit(1);
});
