import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { resolverEstadoOperacionalFiscal } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  classificarLogEmitir,
  reconciliacaoMaterialmenteIgual,
  type EmissaoParaConsulta,
  type LogGeranetResumo,
} from "@/lib/fiscal/geranet/classificar-consulta";
import { motivoBloqueioInutilizacao } from "@/lib/fiscal/geranet/classificar-inutilizacao";
import { endpointConsultaProtocoloMt } from "@/lib/fiscal/sefaz/endpoints-mt";
import {
  classificarFalhaConsultaSefaz,
  envelopeSoapConsultaProtocolo,
  interpretarRetConsSitNFe,
  MENSAGEM_CERTIFICADO_A1_AUSENTE,
  MENSAGEM_NFE_217_QUEBRA,
  MENSAGEM_NFE_AUTORIZADA_SEFAZ,
  MENSAGEM_NFE_AUTORIZADA_SEM_XML,
  montarAtualizacaoConsultaSefaz,
  montarNfeProcSeCompativel,
  resolverFonteReconciliacao,
  validarEntradaConsultaProtocolo,
  xmlConsSitNFe,
  type RetornoConsSitNFe,
} from "@/lib/fiscal/sefaz/consulta-protocolo";
import { mensagemReconciliacaoInconclusiva } from "@/lib/fiscal/geranet/classificar-emissao";

const CHAVE = "51260812345678000155550010000000111234567890";
const OUTRA_CHAVE = "51260812345678000155550010000000221234567890";

function emissao(parcial: Partial<EmissaoParaConsulta> = {}): EmissaoParaConsulta {
  return {
    id: "e-pendente",
    modelo: "55",
    serie: 1,
    numero: 10,
    ambiente: 1,
    status: "aguardando_reconciliacao",
    codigo_numerico: "12345678",
    chave_acesso: CHAVE,
    ...parcial,
  };
}

function log(parcial: Partial<LogGeranetResumo> = {}): LogGeranetResumo {
  return {
    id: 90,
    endpoint: "nfe/emitir",
    criado_em: "2026-09-28T15:04:00.000Z",
    http_status: 200,
    sucesso: true,
    chave: CHAVE,
    protocolo: "151260000000010",
    cstat: "100",
    numero: "10",
    situacao: "sucesso",
    mensagem: "Autorizado o uso da NF-e",
    xml: null,
    pdf: null,
    modelo: "55",
    serie: "1",
    ambiente: "1",
    codigo_numerico: "12345678",
    numero_venda: null,
    contingencia: "nao",
    ...parcial,
  };
}

function retorno(parcial: Partial<RetornoConsSitNFe> = {}): RetornoConsSitNFe {
  return {
    tpAmb: "1",
    verAplic: "MT_2026",
    cStat: "100",
    xMotivo: "Autorizado o uso da NF-e",
    chNFe: CHAVE,
    nProt: "151260000000777",
    dhRecbto: "2026-09-29T10:00:00-04:00",
    digVal: "abc123",
    cStatProtocolo: "100",
    xMotivoProtocolo: "Autorizado o uso da NF-e",
    protNFe:
      `<protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe>` +
      "<nProt>151260000000777</nProt><digVal>abc123</digVal>" +
      "<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>",
    ...parcial,
  };
}

function xmlNfe(chave: string) {
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}"></infNFe></NFe>`;
}

const HOST_NOT_FOUND = [
  "HTTP 500",
  "URL: https://nfe.sefaz.mt.gov.br/nfews/v4/services/NfeAutorizacao4",
  "Host not found",
].join("\n");

test("1. Geranet autorizada não consulta a SEFAZ", async () => {
  const atual = emissao();
  const situacao = classificarLogEmitir(log(), atual);
  let chamadas = 0;
  const fonte = await resolverFonteReconciliacao({
    modelo: "55",
    situacaoGeranet: situacao,
    consultarSefaz: async () => {
      chamadas += 1;
    },
  });
  assert.equal(situacao, "autorizada");
  assert.equal(fonte, "geranet");
  assert.equal(chamadas, 0);
});

test("2. Geranet rejeitada definitiva não consulta a SEFAZ", async () => {
  const atual = emissao();
  const situacao = classificarLogEmitir(
    log({
      sucesso: false,
      situacao: "erro",
      http_status: 422,
      protocolo: null,
      cstat: "225",
      mensagem: "Rejeição 225: Falha no Schema XML do documento",
      xml: null,
    }),
    atual
  );
  let chamadas = 0;
  const fonte = await resolverFonteReconciliacao({
    modelo: "55",
    situacaoGeranet: situacao,
    consultarSefaz: async () => {
      chamadas += 1;
    },
  });
  assert.equal(situacao, "rejeitada");
  assert.equal(fonte, "geranet");
  assert.equal(chamadas, 0);
});

test("3 e 4. HTTP 500 e Host not found consultam NfeConsulta4", async () => {
  for (const mensagem of ["HTTP 500", HOST_NOT_FOUND]) {
    const atual = emissao();
    const situacao = classificarLogEmitir(
      log({
        sucesso: false,
        situacao: "erro",
        http_status: 500,
        protocolo: null,
        cstat: null,
        mensagem,
        xml: null,
      }),
      atual
    );
    let chamadas = 0;
    const fonte = await resolverFonteReconciliacao({
      modelo: "55",
      situacaoGeranet: situacao,
      consultarSefaz: async () => {
        chamadas += 1;
      },
    });
    assert.equal(situacao, "inconclusiva");
    assert.equal(fonte, "sefaz_direta");
    assert.equal(chamadas, 1);
  }
});

test("5 e 6. cStat 100 e 150 autorizam sem mudar chave, número ou série", () => {
  for (const cStat of ["100", "150"]) {
    const resultado = montarAtualizacaoConsultaSefaz({
      emissao: emissao(),
      retorno: retorno({ cStat, cStatProtocolo: cStat }),
      origem: "manual",
    });
    assert.equal(resultado.atualizacao.status_local, "autorizada");
    assert.equal(resultado.atualizacao.patch.protocolo, "151260000000777");
    assert.equal(resultado.atualizacao.patch.cstat, cStat);
    assert.equal(resultado.atualizacao.patch.chave_acesso, CHAVE);
    assert.equal(resultado.atualizacao.patch.serie, undefined);
    assert.equal(resultado.atualizacao.patch.numero, undefined);
    assert.equal(
      (resultado.atualizacao.patch.resposta_resumo as { fonte_resultado?: string })
        .fonte_resultado,
      "sefaz_direta"
    );
  }
});

test("7. cStat 217 com NF-e posterior pede inutilização e não inutiliza", () => {
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao(),
    retorno: retorno({
      cStat: "217",
      xMotivo: "Rejeicao: NF-e nao consta na base de dados da SEFAZ",
      nProt: null,
      protNFe: null,
      cStatProtocolo: null,
    }),
    origem: "manual",
    posteriorAutorizada: true,
  });
  const resumo = resultado.atualizacao.patch.resposta_resumo as {
    inexistencia_confirmada?: boolean;
    quebra_sequencia?: boolean;
  };
  assert.equal(resultado.atualizacao.status_local, "aguardando_inutilizacao");
  assert.equal(resultado.atualizacao.mensagem, MENSAGEM_NFE_217_QUEBRA);
  assert.equal(resumo.inexistencia_confirmada, true);
  assert.equal(resumo.quebra_sequencia, true);
  assert.equal(
    motivoBloqueioInutilizacao({
      id: "e-pendente",
      modelo: "55",
      serie: 1,
      numero: 10,
      ambiente: 1,
      status: resultado.atualizacao.status_local,
    }),
    null
  );
  assert.equal(
    JSON.stringify(resultado.atualizacao.patch).includes("inutilizarNumeracao"),
    false
  );
});

test("8. cStat 217 sem NF-e posterior não inutiliza", () => {
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao(),
    retorno: retorno({
      cStat: "217",
      xMotivo: "Rejeicao: NF-e nao consta na base de dados da SEFAZ",
      nProt: null,
      protNFe: null,
    }),
    origem: "manual",
    posteriorAutorizada: false,
  });
  assert.notEqual(resultado.atualizacao.status_local, "aguardando_inutilizacao");
  assert.notEqual(resultado.atualizacao.status_local, "inutilizada");
  assert.equal(
    (resultado.atualizacao.patch.resposta_resumo as { quebra_sequencia?: boolean })
      .quebra_sequencia,
    false
  );
  assert.ok(
    motivoBloqueioInutilizacao({
      id: "e-pendente",
      modelo: "55",
      serie: 1,
      numero: 10,
      ambiente: 1,
      status: resultado.atualizacao.status_local,
    })
  );
});

test("9. cStat 101 marca cancelada", () => {
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao(),
    retorno: retorno({
      cStat: "101",
      xMotivo: "Cancelamento de NF-e homologado",
      nProt: "151260000000888",
    }),
    origem: "manual",
  });
  assert.equal(resultado.atualizacao.status_local, "cancelada");
  assert.equal(resultado.atualizacao.patch.cstat, "101");
  assert.equal(resultado.atualizacao.patch.protocolo, "151260000000888");
  assert.equal(resultado.atualizacao.patch.serie, undefined);
  assert.equal(resultado.atualizacao.patch.numero, undefined);
});

test("10. cStat 110, 301 e 302 bloqueiam retransmissão", () => {
  for (const cStat of ["110", "301", "302"]) {
    const resultado = montarAtualizacaoConsultaSefaz({
      emissao: emissao(),
      retorno: retorno({
        cStat,
        xMotivo: "Uso Denegado",
        nProt: null,
        protNFe: null,
      }),
      origem: "manual",
    });
    const estado = resolverEstadoOperacionalFiscal({
      modelo: "55",
      status: resultado.atualizacao.status_local,
      resposta_resumo: resultado.atualizacao.patch.resposta_resumo,
      cstat: cStat,
      motivo: String(resultado.atualizacao.patch.motivo),
      chave_acesso: CHAVE,
    });
    assert.equal(resultado.atualizacao.status_local, "rejeitada");
    assert.equal(
      (resultado.atualizacao.patch.resposta_resumo as { estado_fiscal_definitivo?: boolean })
        .estado_fiscal_definitivo,
      true
    );
    assert.equal(estado.podeRetry, false);
    assert.equal(estado.bloqueiaRetransmissao, true);
    assert.notEqual(estado.acaoPrincipal, "tentar_novamente");
  }
});

test("11. timeout da SEFAZ permanece inconclusivo", () => {
  const falha = classificarFalhaConsultaSefaz(new Error("Timeout ao consultar a SEFAZ."));
  assert.equal(falha.falha, "transporte");
  assert.equal(falha.mensagem, mensagemReconciliacaoInconclusiva("55"));
  assert.equal(falha.erroTecnico, "sefaz_direta:timeout");
  assert.equal(falha.mensagem.includes("PRIVATE"), false);
});

test("12. certificado A1 ausente não emite", () => {
  const validacao = validarEntradaConsultaProtocolo({
    chaveAcesso: CHAVE,
    ambiente: 1,
    modelo: "55",
    certificadoHex: "",
    senha: "",
  });
  assert.equal(validacao.ok, false);
  if (!validacao.ok) {
    assert.equal(validacao.falha, "certificado");
    assert.equal(validacao.mensagem, MENSAGEM_CERTIFICADO_A1_AUSENTE);
    assert.equal(validacao.mensagem.includes("emitida"), true);
  }
});

test("13 e 14. ambiente escolhe produção ou homologação", () => {
  const producao = validarEntradaConsultaProtocolo({
    chaveAcesso: CHAVE,
    ambiente: "1",
    modelo: "55",
    certificadoHex: "aabb",
    senha: "senha-teste",
  });
  const homologacao = validarEntradaConsultaProtocolo({
    chaveAcesso: CHAVE,
    ambiente: "2",
    modelo: "55",
    certificadoHex: "aabb",
    senha: "senha-teste",
  });
  assert.equal(producao.ok, true);
  assert.equal(homologacao.ok, true);
  if (producao.ok && homologacao.ok) {
    assert.equal(
      producao.entrada.endpoint,
      "https://nfe.sefaz.mt.gov.br/nfews/v4/services/NfeConsulta4"
    );
    assert.equal(
      homologacao.entrada.endpoint,
      "https://homologacao.sefaz.mt.gov.br/nfews/v4/services/NfeConsulta4"
    );
    assert.equal(producao.entrada.soap.includes("senha-teste"), false);
    assert.equal(producao.entrada.soap.includes("aabb"), false);
  }
});

test("15. modelo 55 nunca usa nfcews", () => {
  const nfe = endpointConsultaProtocoloMt({ modelo: "55", ambiente: "1" });
  const nfce = endpointConsultaProtocoloMt({ modelo: "65", ambiente: "1" });
  assert.equal(nfe?.includes("nfcews"), false);
  assert.equal(nfe?.includes("/nfews/v4/services/NfeConsulta4"), true);
  assert.equal(nfce?.includes("nfcews"), true);
  assert.notEqual(nfe, nfce);
});

test("16. segundo clique autorizado é idempotente", () => {
  const xml = Buffer.from(xmlNfe(CHAVE), "utf8").toString("hex");
  const primeiro = montarAtualizacaoConsultaSefaz({
    emissao: emissao({ xml_hex: xml }),
    retorno: retorno(),
    origem: "manual",
  });
  const segundo = montarAtualizacaoConsultaSefaz({
    emissao: emissao({
      status: "autorizada",
      protocolo: "151260000000777",
      xml_hex: String(primeiro.atualizacao.patch.xml_hex ?? xml),
    }),
    retorno: retorno(),
    origem: "manual",
  });
  assert.equal(segundo.atualizacao.status_local, "autorizada");
  assert.equal(segundo.atualizacao.patch.protocolo, "151260000000777");
  assert.equal(segundo.atualizacao.patch.chave_acesso, CHAVE);
  assert.equal(segundo.atualizacao.patch.xml_hex, undefined);
  assert.equal(segundo.atualizacao.patch.serie, undefined);
  assert.equal(segundo.atualizacao.patch.numero, undefined);
  assert.equal(
    reconciliacaoMaterialmenteIgual(
      {
        status: "autorizada",
        cstat: "100",
        protocolo: "151260000000777",
        situacao: "autorizada",
      },
      {
        status: segundo.atualizacao.status_local,
        cstat: segundo.atualizacao.cstat,
        protocolo: segundo.atualizacao.protocolo,
        situacao: segundo.situacao,
      }
    ),
    true
  );
});

test("17. XML de outra chave não vira nfeProc", () => {
  const xml = xmlNfe(OUTRA_CHAVE);
  const proc = montarNfeProcSeCompativel({
    xmlArmazenado: xml,
    chave: CHAVE,
    protNFe: retorno().protNFe,
    protocolo: "151260000000777",
  });
  assert.equal(proc.chaveDivergente, true);
  assert.equal(proc.xml, null);
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao({ xml_hex: Buffer.from(xml, "utf8").toString("hex") }),
    retorno: retorno(),
    origem: "manual",
  });
  assert.equal(resultado.chaveDivergente, true);
  assert.equal(resultado.atualizacao.patch.xml_hex, undefined);
  assert.equal(
    JSON.stringify(resultado.atualizacao.patch).includes(OUTRA_CHAVE),
    false
  );
});

test("18. autorização sem XML grava protocolo e não inventa documento", () => {
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao({ xml_hex: null }),
    retorno: retorno(),
    origem: "manual",
  });
  const resumo = resultado.atualizacao.patch.resposta_resumo as {
    documento_autorizado_sem_xml?: boolean;
    xml_processado_disponivel?: boolean;
  };
  assert.equal(resultado.atualizacao.status_local, "autorizada");
  assert.equal(resultado.atualizacao.patch.protocolo, "151260000000777");
  assert.equal(resultado.atualizacao.patch.xml_hex, undefined);
  assert.equal(resultado.atualizacao.patch.pdf_hex, undefined);
  assert.equal(resultado.semXmlProcessado, true);
  assert.equal(resumo.documento_autorizado_sem_xml, true);
  assert.equal(resumo.xml_processado_disponivel, false);
  assert.equal(resultado.atualizacao.mensagem, MENSAGEM_NFE_AUTORIZADA_SEM_XML);
});

test("XML da mesma chave recebe o protocolo e o SOAP não é assinado", () => {
  const xml = xmlNfe(CHAVE);
  const resultado = montarAtualizacaoConsultaSefaz({
    emissao: emissao({ xml_hex: Buffer.from(xml, "utf8").toString("hex") }),
    retorno: retorno(),
    origem: "manual",
  });
  const gravado = Buffer.from(String(resultado.atualizacao.patch.xml_hex), "hex").toString(
    "utf8"
  );
  assert.equal(gravado.includes("<nfeProc"), true);
  assert.equal(gravado.includes(CHAVE), true);
  assert.equal(gravado.includes("<nProt>151260000000777</nProt>"), true);
  assert.equal(resultado.atualizacao.mensagem, MENSAGEM_NFE_AUTORIZADA_SEFAZ);
  const soap = envelopeSoapConsultaProtocolo(
    xmlConsSitNFe({ tpAmb: "1", chave: CHAVE })
  );
  assert.equal(soap.includes("<xServ>CONSULTAR</xServ>"), true);
  assert.equal(soap.includes(`<chNFe>${CHAVE}</chNFe>`), true);
  assert.equal(soap.includes("<Signature"), false);
  const lido = interpretarRetConsSitNFe(
    `<retConsSitNFe><tpAmb>1</tpAmb><cStat>100</cStat><xMotivo>Autorizado</xMotivo><chNFe>${CHAVE}</chNFe>${retorno().protNFe}</retConsSitNFe>`
  );
  assert.equal(lido?.cStat, "100");
  assert.equal(lido?.nProt, "151260000000777");
  assert.equal(lido?.digVal, "abc123");
});

test("reconciliação não retransmite pela Geranet", () => {
  const fonte = readFileSync(
    join(process.cwd(), "lib/fiscal/reconciliar-emissao.ts"),
    "utf8"
  );
  assert.match(fonte, /deveConsultarSefazDireta/);
  assert.match(fonte, /consultarSefazParaReconciliacao/);
  assert.doesNotMatch(fonte, /\/api\/v1\/nfe\/emitir/);
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "lib/fiscal/sefaz/consultar-protocolo-nfe.ts"), "utf8"),
    /console\.log/
  );
});
