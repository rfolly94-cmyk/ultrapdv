import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  MENSAGEM_SNAPSHOT_TRIBUTARIO_INCOMPLETO,
  ORIGEM_SNAPSHOT_FALLBACK_LEGADO,
  ORIGEM_SNAPSHOT_FINALIZACAO,
  montarSnapshotTributarioDoCadastro,
  resolverTributacaoItemVenda,
  snapshotTributarioItemCompleto,
  vendaTemTributacaoItensCongelada,
} from "./snapshot-tributario-venda";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function grupo(parcial: Record<string, unknown> = {}) {
  return {
    id: "grupo-a",
    nome: "Venda",
    ativo: true,
    cfop_interno: "5102",
    cfop_interestadual: "6102",
    icms_cst_csosn: "102",
    icms_aliquota: 0,
    pis_cst: "49",
    pis_aliquota: 0,
    cofins_cst: "49",
    cofins_aliquota: 0,
    cst_ibscbs: "000",
    classificacao_ibscbs: "000001",
    aliquota_ibs_uf: 0,
    aliquota_ibs_municipio: 0,
    aliquota_cbs: 0,
    percentual_reducao_ibs_uf: 0,
    percentual_reducao_ibs_municipio: 0,
    percentual_reducao_cbs: 0,
    ibscbs_manual: false,
    ipi_aplicavel: false,
    ...parcial,
  };
}

function itemBase(snapshot: unknown = null) {
  return {
    id: "item-1",
    produto_id: "prod-1",
    produto_codigo: "P1",
    produto_nome: "Tela",
    unidade_medida: "UN",
    grupo_fiscal_id: "grupo-a",
    ncm: "85176221",
    cest: "2104700",
    origem_produto: "0",
    snapshot_fiscal: snapshot,
  };
}

function xmlDoResolver(
  resolvido: ReturnType<typeof resolverTributacaoItemVenda>
) {
  if (!resolvido.ok) {
    throw new Error(resolvido.mensagem);
  }
  return montarItemGeranet({
    produto: {
      codigo: "P1",
      nome: "Tela",
      unidadeMedida: "UN",
      precoVenda: 10,
      codigoBarras: resolvido.valor.codigoBarras,
      tipoItem: resolvido.valor.tipoItem,
    },
    fiscal: {
      ncm: resolvido.valor.ncm,
      cest: resolvido.valor.cest,
      origemProduto: resolvido.valor.origemProduto,
    },
    grupo: resolvido.valor.grupoGeranet,
    operacao: "interna",
    quantidade: 1,
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: "2026-08-26",
    modelo: "65",
    perfilIpi: null,
  }).item;
}

test("venda nova congela CFOP A; alterar grupo para B não muda o XML", () => {
  const snap = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo({ cfop_interno: "5102" }),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const grupoAlterado = grupo({
    cfop_interno: "5405",
    cfop_interestadual: "6405",
  });
  const resolvido = resolverTributacaoItemVenda({
    item: itemBase(snap),
    grupo: grupoAlterado,
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  const xml = xmlDoResolver(resolvido);
  assert.equal(xml.cfop, "5102");
  assert.notEqual(xml.cfop, "5405");
});

test("CSOSN/CST, alíquota ICMS, PIS, COFINS e NCM permanecem os da venda", () => {
  const snap = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo({
      icms_cst_csosn: "102",
      icms_aliquota: 0,
      pis_cst: "49",
      pis_aliquota: 0.65,
      cofins_cst: "49",
      cofins_aliquota: 3,
    }),
    fiscalProduto: { ncm: "85176221" },
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const resolvido = resolverTributacaoItemVenda({
    item: itemBase(snap),
    grupo: grupo({
      icms_cst_csosn: "500",
      icms_aliquota: 18,
      pis_cst: "01",
      pis_aliquota: 1.65,
      cofins_cst: "01",
      cofins_aliquota: 7.6,
    }),
    fiscalProduto: { ncm: "99999999" },
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  const xml = xmlDoResolver(resolvido);
  assert.equal(xml.icmsCsosn, "102");
  assert.equal(xml.pisCst, "49");
  assert.equal(xml.pisAliquota, "0.6500");
  assert.equal(xml.cofinsCst, "49");
  assert.equal(xml.cofinsAliquota, "3.0000");
  assert.equal(xml.ncmProduto, "85176221");
});

test("NFC-e e NF-e usam o mesmo snapshot; interestadual escolhe CFOP congelado 6102", () => {
  const snap = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo(),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const nfce = resolverTributacaoItemVenda({
    item: itemBase(snap),
    grupo: grupo({ cfop_interno: "5405" }),
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  const nfe = resolverTributacaoItemVenda({
    item: itemBase(snap),
    grupo: grupo({ cfop_interestadual: "6405" }),
    vendaTributacaoCongelada: true,
    tipoDestino: "interestadual",
    indiceItem: 1,
  });
  assert.equal(nfce.ok && nfce.valor.cfop, "5102");
  assert.equal(nfe.ok && nfe.valor.cfop, "6102");
});

test("destinatário da venda permanece no snapshot da operação após alteração cadastral", () => {
  const nfce = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const nfe = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const paginaNfe = fonte("app/vendas/[id]/nfe/page.tsx");
  assert.match(nfce, /snapshotFiscal: venda\.snapshot_fiscal/);
  assert.match(nfe, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(nfe, /snapshotVenda: venda\.snapshot_fiscal/);
  assert.match(paginaNfe, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(paginaNfe, /resolverTributacaoItemVenda/);
});

test("empresa B não altera snapshot da empresa A", () => {
  const snapA = montarSnapshotTributarioDoCadastro({
    item: { ...itemBase(), grupo_fiscal_id: empresaA },
    grupo: grupo({ id: empresaA, cfop_interno: "5102", pis_aliquota: 0 }),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const grupoB = grupo({
    id: empresaB,
    cfop_interno: "5405",
    pis_aliquota: 1.65,
  });
  const resolvido = resolverTributacaoItemVenda({
    item: { ...itemBase(snapA), grupo_fiscal_id: empresaA },
    grupo: grupoB,
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  assert.equal(resolvido.ok && resolvido.valor.cfop, "5102");
  assert.equal(resolvido.ok && resolvido.valor.grupoGeranet.pisAliquota, 0);
  assert.notEqual(snapA.grupo_fiscal_id, empresaB);
});

test("edição do cadastro antes de finalizar ainda usa o grupo atual", () => {
  const rascunho = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo({ cfop_interno: "5405", icms_cst_csosn: "500" }),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  assert.equal(rascunho.cfop_interno, "5405");
  assert.equal(rascunho.icms_cst_csosn, "500");
});

test("depois da finalização o snapshot é imutável mesmo com item columns vazias", () => {
  const snap = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo({ cfop_interno: "5102" }),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const itemSemColunas = {
    ...itemBase(snap),
    ncm: null,
    cfop: null,
    icms_cst_csosn: null,
    pis_cst: null,
    cofins_cst: null,
  };
  const resolvido = resolverTributacaoItemVenda({
    item: itemSemColunas,
    grupo: grupo({ cfop_interno: "5405" }),
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  assert.equal(resolvido.ok && resolvido.valor.cfop, "5102");
  assert.equal(resolvido.ok && resolvido.valor.ncm, "85176221");
});

test("venda nova com flag congelada e snapshot incompleto não inventa tributo", () => {
  const resolvido = resolverTributacaoItemVenda({
    item: itemBase(null),
    grupo: grupo({ cfop_interno: "5405" }),
    vendaTributacaoCongelada: true,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  assert.equal(resolvido.ok, false);
  if (!resolvido.ok) {
    assert.equal(resolvido.mensagem, MENSAGEM_SNAPSHOT_TRIBUTARIO_INCOMPLETO);
  }
});

test("venda antiga sem snapshot usa fallback legado explícito e não o trata como finalização", () => {
  const resolvido = resolverTributacaoItemVenda({
    item: itemBase(null),
    grupo: grupo({ cfop_interno: "5405", pis_aliquota: 1.65 }),
    fiscalProduto: { ncm: "85176221", origem_produto: "0" },
    vendaTributacaoCongelada: false,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  assert.equal(resolvido.ok, true);
  if (!resolvido.ok) {
    return;
  }
  assert.equal(resolvido.valor.origem, ORIGEM_SNAPSHOT_FALLBACK_LEGADO);
  assert.equal(resolvido.valor.persistirFallback, true);
  assert.equal(resolvido.valor.cfop, "5405");
  assert.notEqual(resolvido.valor.origem, ORIGEM_SNAPSHOT_FINALIZACAO);
});

test("fallback legado não sobrescreve snapshot já congelado na finalização", () => {
  const snap = montarSnapshotTributarioDoCadastro({
    item: itemBase(),
    grupo: grupo({ cfop_interno: "5102" }),
    origem: ORIGEM_SNAPSHOT_FINALIZACAO,
  });
  const resolvido = resolverTributacaoItemVenda({
    item: itemBase(snap),
    grupo: grupo({ cfop_interno: "5405" }),
    vendaTributacaoCongelada: false,
    tipoDestino: "interna",
    indiceItem: 1,
  });
  assert.equal(resolvido.ok && resolvido.valor.persistirFallback, false);
  assert.equal(resolvido.ok && resolvido.valor.origem, ORIGEM_SNAPSHOT_FINALIZACAO);
  assert.equal(resolvido.ok && resolvido.valor.cfop, "5102");
});

test("reconciliação não recalcula tributação a partir do grupo vivo", () => {
  const reconciliar = fonte("lib/fiscal/reconciliar-emissao.ts");
  assert.doesNotMatch(reconciliar, /montarItemGeranet/);
  assert.doesNotMatch(reconciliar, /grupos_fiscais/);
  assert.doesNotMatch(reconciliar, /resolverTributacaoItemVenda/);
  assert.match(reconciliar, /reenviou: false/);
});

test("rotas de venda NFC-e/NF-e usam o resolver único e não o grupo vivo como fonte nova", () => {
  for (const arquivo of [
    "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
    "app/vendas/[id]/nfce/page.tsx",
    "app/vendas/[id]/nfe/page.tsx",
  ]) {
    const rota = fonte(arquivo);
    assert.match(rota, /resolverTributacaoItemVenda/, arquivo);
    assert.match(rota, /vendaTemTributacaoItensCongelada/, arquivo);
    assert.doesNotMatch(rota, /itemVenda\.cfop\s*\?\?\s*grupo/);
    assert.doesNotMatch(rota, /item\.cfop\s*\?\?\s*\n\s*grupo/);
    assert.doesNotMatch(rota, /pisAliquota:\s*\n\s*grupo\.pis_aliquota/);
  }
});

test("migration nova congela no INSERT do item, isolada por empresa_id, sem backfill", () => {
  const sql = fonte(
    "supabase/migrations/20260826120000_vendas_itens_snapshot_tributario.sql"
  );
  assert.match(sql, /vendas_itens/);
  assert.match(sql, /snapshot_fiscal/);
  assert.match(sql, /empresa_id/);
  assert.match(sql, /BEFORE INSERT/i);
  assert.match(sql, /'finalizacao'/);
  assert.doesNotMatch(sql, /update public\.vendas_itens[\s\S]*set snapshot_fiscal/i);
  assert.doesNotMatch(sql, /supabase db reset/);
});

test("flag da venda marca tributação congelada só com origem de finalização/edição", () => {
  assert.equal(
    vendaTemTributacaoItensCongelada({
      tributacao_itens: { origem: ORIGEM_SNAPSHOT_FINALIZACAO, versao: 1 },
    }),
    true
  );
  assert.equal(
    vendaTemTributacaoItensCongelada({
      tributacao_itens: { origem: ORIGEM_SNAPSHOT_FALLBACK_LEGADO },
    }),
    false
  );
  assert.equal(snapshotTributarioItemCompleto(null), false);
});
