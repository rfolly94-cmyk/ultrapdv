import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sanitizarPayloadTentativaFiscal } from "@/lib/fiscal/emissao-tentativas";
import { montarItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import {
  assertIcmsContratoGeranet,
  CSOSN_CONTRATO_GERANET,
  MENSAGEM_CRT_NORMAL_EXIGE_CST,
  MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN,
  resolverCamposIcmsItemGeranet,
} from "@/lib/fiscal/geranet/resolver-icms-geranet";
import { empresaA, empresaB } from "@/lib/multiempresa/cenario";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function grupo(icmsCstCsosn: string) {
  return {
    cfopInterno: "5405",
    cfopInterestadual: "6405",
    icmsCstCsosn,
    pisCst: "49",
    pisAliquota: 0,
    cofinsCst: "49",
    cofinsAliquota: 0,
    cstIbscbs: "000",
    classificacaoIbscbs: "000001",
    aliquotaIbsUf: 0,
    aliquotaIbsMunicipio: 0,
    aliquotaCbs: 0,
    percentualReducaoIbsUf: 0,
    percentualReducaoIbsMunicipio: 0,
    percentualReducaoCbs: 0,
  };
}

function montar(params: {
  empresaId: string;
  crt: 1 | 2 | 3 | 4;
  icms: string;
  ncm?: string;
}) {
  return montarItemGeranet({
    produto: {
      codigo: "5208",
      nome: "PECAS PARA CELULAR",
      unidadeMedida: "UN",
      precoVenda: 10,
    },
    fiscal: {
      ncm: params.ncm ?? "85299020",
      cest: "",
      origemProduto: "0",
    },
    grupo: grupo(params.icms),
    operacao: "interna",
    quantidade: 1,
    codigoRegimeTributario: params.crt,
    ambiente: "2",
    dataEmissao: "2026-08-18",
    modelo: "55",
    perfilIpi: "NAO_CONTRIBUINTE",
  });
}

test("A. CRT1 + CSOSN500 → icmsCsosn 500 sem icmsCst", () => {
  const { item } = montar({ empresaId: empresaA, crt: 1, icms: "500" });
  assert.equal(item.icmsCsosn, "500");
  assert.equal(item.icmsCst, undefined);
  assert.equal("icmsCst" in item, false);
});

test("B. CRT1 + CSOSN102 → icmsCsosn 102", () => {
  const { item } = montar({ empresaId: empresaA, crt: 1, icms: "102" });
  assert.equal(item.icmsCsosn, "102");
  assert.equal(item.icmsCst, undefined);
});

test("C. CRT4 + CSOSN400 → icmsCsosn 400", () => {
  const { item } = montar({ empresaId: empresaA, crt: 4, icms: "400" });
  assert.equal(item.icmsCsosn, "400");
  assert.equal(item.icmsCst, undefined);
});

test("D. CRT3 + CST00 → icmsCst 00 sem icmsCsosn", () => {
  const { item } = montar({ empresaId: empresaB, crt: 3, icms: "00" });
  assert.equal(item.icmsCst, "00");
  assert.equal(item.icmsCsosn, undefined);
  assert.equal("icmsCsosn" in item, false);
});

test("E. CRT3 + CST60 → icmsCst 60", () => {
  const { item } = montar({ empresaId: empresaB, crt: 3, icms: "60" });
  assert.equal(item.icmsCst, "60");
  assert.equal(item.icmsCsosn, undefined);
});

test("F. CRT1 tentando gerar icmsCst500 → preflight bloqueia", () => {
  assert.throws(
    () =>
      assertIcmsContratoGeranet({
        nfe: {
          emitente: { codigoRegimeTributario: "1" },
          itens: [{ icmsCst: "500" }],
        },
      }),
    { message: MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN }
  );
});

test("G. CRT3 tentando usar CSOSN500 → builder e preflight bloqueiam", () => {
  assert.throws(
    () => montar({ empresaId: empresaB, crt: 3, icms: "500" }),
    { message: MENSAGEM_CRT_NORMAL_EXIGE_CST }
  );
  assert.throws(
    () =>
      assertIcmsContratoGeranet({
        nfe: {
          empresa: { codigoRegimeTributario: 3 },
          itens: [{ icmsCsosn: "500" }],
        },
      }),
    { message: MENSAGEM_CRT_NORMAL_EXIGE_CST }
  );
  assert.doesNotMatch(
    JSON.stringify(
      resolverCamposIcmsItemGeranet({
        codigoRegimeTributario: 1,
        codigoIcms: "500",
      })
    ),
    /"icmsCst"/
  );
});

test("H. Empresa A CRT1 × Empresa B CRT3 isoladas no mesmo processo", () => {
  const fiscalA = { empresaId: empresaA, crt: 1 as const, icms: "500" };
  const fiscalB = { empresaId: empresaB, crt: 3 as const, icms: "00" };

  const itemA = montar(fiscalA).item;
  const itemB = montar(fiscalB).item;

  assert.equal(fiscalA.empresaId, empresaA);
  assert.equal(fiscalB.empresaId, empresaB);
  assert.notEqual(fiscalA.empresaId, fiscalB.empresaId);
  assert.equal(itemA.icmsCsosn, "500");
  assert.equal(itemA.icmsCst, undefined);
  assert.equal(itemB.icmsCst, "00");
  assert.equal(itemB.icmsCsosn, undefined);
  assert.notEqual(itemA.icmsCsosn, itemB.icmsCst);
});

test("I. Preview NF-e 102 → CRT1 + icmsCsosn 500 sanitizado", () => {
  const { item } = montar({
    empresaId: empresaA,
    crt: 1,
    icms: "500",
    ncm: "85299020",
  });
  const preview = sanitizarPayloadTentativaFiscal({
    certificadoDigital: "CERT-SECRETO",
    senhaCertificadoDigital: "SENHA-SECRETA",
    nfe: {
      emitente: { codigoRegimeTributario: "1" },
      serie: 1,
      numeroNotaEmitir: "102",
      codigoNumerico: "33620618",
      itens: [item],
    },
  });
  const itemPreview = (
    (preview.nfe as Record<string, unknown>).itens as Array<
      Record<string, unknown>
    >
  )[0];

  assert.equal(preview.certificadoDigital, undefined);
  assert.equal(preview.senhaCertificadoDigital, undefined);
  assert.equal(itemPreview.icmsCsosn, "500");
  assert.equal(itemPreview.icmsCst, undefined);
  assert.doesNotMatch(JSON.stringify(preview), /CERT-SECRETO|SENHA-SECRETA/);
});

test("J. preview/testes não criam fiscal_emissao_tentativas", () => {
  const preview = fonte("app/api/fiscal/geranet/item-preview/route.ts");
  const nfcePreview = fonte("app/api/fiscal/geranet/nfce-preview/route.ts");
  const builder = fonte("lib/fiscal/geranet/montar-item.ts");
  const adapter = fonte("lib/fiscal/geranet/resolver-icms-geranet.ts");

  assert.doesNotMatch(preview, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(nfcePreview, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(builder, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(adapter, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(adapter, /from\("fiscal_emissao_tentativas"\)/);
});

test("CRT2 usa icmsCst, não icmsCsosn", () => {
  const { item } = montar({ empresaId: empresaB, crt: 2, icms: "00" });
  assert.equal(item.icmsCst, "00");
  assert.equal(item.icmsCsosn, undefined);
});

test("CSOSN do contrato Geranet permanece 500, sem converter para CST", () => {
  assert.deepEqual([...CSOSN_CONTRATO_GERANET], [
    "101",
    "102",
    "103",
    "201",
    "202",
    "203",
    "300",
    "400",
    "500",
    "900",
  ]);
  assert.throws(
    () =>
      resolverCamposIcmsItemGeranet({
        codigoRegimeTributario: 1,
        codigoIcms: "50",
      }),
    { message: MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN }
  );
  const campos = resolverCamposIcmsItemGeranet({
    codigoRegimeTributario: 1,
    codigoIcms: "500",
  });
  assert.equal("icmsCsosn" in campos ? campos.icmsCsosn : "", "500");
});

test("payloads NF-e/NFC-e validam ICMS antes do POST e CRT vem da empresa da emissão", () => {
  const nfe = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  const nfce = fonte("lib/fiscal/geranet/montar-payload-nfce.ts");
  const venda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const nfceVenda = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const contingencia = fonte(
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts"
  );
  const operacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const devolucao = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );

  assert.match(nfe, /assertIcmsContratoGeranet/);
  assert.match(nfce, /assertIcmsContratoGeranet/);
  assert.match(venda, /montarPayloadNfeGeranet/);
  assert.match(venda, /codigo_regime_tributario/);
  assert.match(venda, /empresas_fiscal/);
  assert.match(nfceVenda, /montarPayloadNfceGeranet/);
  assert.match(contingencia, /montarPayloadNfceGeranet/);
  assert.match(operacao, /lerCodigoRegimeTributario/);
  assert.match(devolucao, /lerCodigoRegimeTributario/);
  assert.doesNotMatch(operacao, /codigo_regime_tributario \?\? 1/);
  assert.doesNotMatch(devolucao, /codigo_regime_tributario \?\? 1/);
});
