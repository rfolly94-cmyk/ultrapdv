import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("flag NFC-e automática é por empresa em fiscal_nfce_config", () => {
  const migracao = fonte(
    "supabase/migrations/20260819140000_nfce_automatica_pdv.sql"
  );
  assert.match(migracao, /fiscal_nfce_config/);
  assert.match(migracao, /emitir_nfce_automatico_pdv/);
  assert.match(migracao, /boolean NOT NULL DEFAULT false/);

  const actions = fonte("app/configuracoes/fiscal/actions.ts");
  assert.match(actions, /emitir_nfce_automatico_pdv/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.doesNotMatch(actions, /formData\.get\("empresa_id"\).*fiscal_nfce_config/);

  const pagina = fonte("app/configuracoes/fiscal/page.tsx");
  assert.match(
    pagina,
    /Emitir NFC-e automaticamente ao finalizar venda no PDV/
  );
  assert.match(pagina, /registroPertenceAEmpresaAtiva/);
  assert.match(pagina, /vinculo\.empresa_id/);
});

test("PDV reutiliza a rota existente de NFC-e 65 após o sucesso comercial", () => {
  const helper = fonte("lib/fiscal/nfce/chamar-emissao-nfce-venda.ts");
  assert.match(helper, /\/api\/fiscal\/geranet\/nfce-emitir-venda/);
  assert.match(helper, /EMITIR_NFCE_VENDA_PRODUCAO/);
  assert.match(helper, /EMITIR_NFCE_VENDA_HOMOLOGACAO/);
  assert.match(helper, /Idempotency-Key/);
  assert.doesNotMatch(helper, /montarItemGeranet/);

  const shell = fonte("components/pdv/pdv-shell.tsx");
  const posFinalizar = shell.indexOf("await finalizarVendaPdv");
  const posEmitir = shell.indexOf("await chamarEmissaoNfceVenda");
  assert.ok(posFinalizar >= 0, "PDV deve finalizar a venda comercial");
  assert.ok(posEmitir > posFinalizar, "NFC-e só depois do sucesso comercial");
  assert.match(shell, /if \(emitirNfceAutomaticoPdv\)/);
  assert.match(shell, /if \(!emitirNfceAutomaticoPdv\)/);
  assert.match(shell, /imprimirApos/);
  assert.match(shell, /resolverAcoesPosVendaPdv/);
  assert.doesNotMatch(shell, /cancelarVenda|desfazerVenda|estornarVenda/);

  const edicao = fonte("components/pdv/pdv-edicao-shell.tsx");
  assert.doesNotMatch(edicao, /chamarEmissaoNfceVenda/);

  const paginaPdv = fonte("app/pdv/page.tsx");
  assert.match(paginaPdv, /fiscal_nfce_config/);
  assert.match(paginaPdv, /registroPertenceAEmpresaAtiva/);
  assert.match(paginaPdv, /emitirNfceAutomaticoPdv/);
  assert.match(paginaPdv, /planoPermiteRecursoEmpresa/);
  assert.match(paginaPdv, /"nfce"/);
});

test("navegação: PDV, Nova NF-e, Estoque → Nota de Entrada e sem item Fiscal no menu", () => {
  const sidebar = fonte("components/layout/app-sidebar.tsx");
  assert.doesNotMatch(sidebar, /label:\s*"Fiscal"/);
  assert.match(sidebar, /\/fiscal\/entradas/);

  const vendas = fonte("components/vendas/vendas-lista.tsx");
  assert.match(vendas, /href="\/pdv"/);
  assert.match(vendas, />\s*PDV\s*</);
  assert.match(vendas, /href="\/fiscal\/nfe\/nova"/);
  assert.match(vendas, /Nova NF-e/);
  assert.doesNotMatch(vendas, />Nova venda</);

  const estoqueTabs = fonte("components/estoque/estoque-module-tabs.tsx");
  assert.match(estoqueTabs, /Nota de Entrada/);
  assert.match(estoqueTabs, /\/fiscal\/entradas/);
});
