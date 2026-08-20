import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avaliarStatusFiscalProduto,
  type GrupoFiscalResumo,
} from "./status-fiscal-produto";

function grupoA(parcial: Partial<GrupoFiscalResumo> = {}): GrupoFiscalResumo {
  return {
    id: "grupo-a",
    nome: "Grupo A",
    ativo: true,
    cfop_interno: "5102",
    cfop_interestadual: "6102",
    icms_cst_csosn: "102",
    icms_aliquota: 0,
    pis_cst: "49",
    pis_aliquota: 0,
    cofins_cst: "49",
    cofins_aliquota: 0,
    ipi_cst: null,
    ipi_aliquota: 0,
    cst_ibscbs: null,
    classificacao_ibscbs: null,
    aliquota_ibs_uf: 0,
    aliquota_ibs_municipio: 0,
    aliquota_cbs: 0,
    ...parcial,
  };
}

test("I. CEST vazio não gera pendência fiscal", () => {
  const status = avaliarStatusFiscalProduto({
    ncm: "12345678",
    grupo: grupoA(),
  });

  assert.equal(status.ok, true);
  assert.equal(status.rotulo, "Fiscal OK");
  assert.equal(
    status.motivos.some((motivo) => /cest/i.test(motivo)),
    false
  );
});

test("status lista NCM, grupo, CFOP, ICMS, PIS e COFINS sem CEST", () => {
  const status = avaliarStatusFiscalProduto({
    ncm: "",
    grupo: null,
  });

  assert.equal(status.ok, false);
  assert.equal(status.rotulo, "Fiscal pendente");
  assert.ok(status.motivos.includes("NCM não informado"));
  assert.ok(status.motivos.includes("Grupo fiscal não informado"));
  assert.equal(
    status.motivos.some((motivo) => /cest/i.test(motivo)),
    false
  );
});

test("grupo incompleto detalha CFOP, ICMS, PIS e COFINS", () => {
  const status = avaliarStatusFiscalProduto({
    ncm: "12345678",
    grupo: grupoA({
      cfop_interno: null,
      icms_cst_csosn: null,
      pis_cst: null,
      cofins_cst: null,
    }),
  });

  assert.equal(status.ok, false);
  assert.ok(status.motivos.includes("Grupo fiscal sem CFOP"));
  assert.ok(status.motivos.includes("ICMS não configurado"));
  assert.ok(status.motivos.includes("PIS não configurado"));
  assert.ok(status.motivos.includes("COFINS não configurado"));
});
