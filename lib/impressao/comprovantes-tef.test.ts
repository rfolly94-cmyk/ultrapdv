import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  papelComprovanteTef,
  permitirReciboComercialNaVendaTef,
  preferenciaComprovantesTefAusente,
  preferenciaComprovantesTefDaLinha,
  sanitizarPreferenciaComprovantesTef,
  viasAutomaticasTef,
} from "./comprovantes-tef";
import { TIPOS_DOCUMENTO_IMPRESSAO } from "./tipos";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("sem preferência cadastrada as duas vias e o recibo comercial seguem o fluxo anterior", () => {
  const ausente = preferenciaComprovantesTefAusente();
  assert.equal(ausente.cadastrada, false);
  assert.deepEqual(viasAutomaticasTef(ausente), { cliente: true, estabelecimento: true });
  assert.equal(permitirReciboComercialNaVendaTef(ausente), true);
  assert.equal(preferenciaComprovantesTefDaLinha(null).cadastrada, false);
});

test("cada combinação de checkbox muda só a impressão automática correspondente", () => {
  const combinacoes = [
    { viaCliente: false, viaEstabelecimento: false, reciboComercial: false },
    { viaCliente: true, viaEstabelecimento: false, reciboComercial: false },
    { viaCliente: false, viaEstabelecimento: true, reciboComercial: false },
    { viaCliente: false, viaEstabelecimento: false, reciboComercial: true },
    { viaCliente: true, viaEstabelecimento: true, reciboComercial: false },
    { viaCliente: true, viaEstabelecimento: true, reciboComercial: true },
  ];

  for (const combinacao of combinacoes) {
    const preferencia = sanitizarPreferenciaComprovantesTef({
      ...combinacao,
      papel: "58mm",
      impressoraNome: "Caixa",
    });
    assert.equal(preferencia.cadastrada, true);
    assert.equal(preferencia.viaCliente, combinacao.viaCliente);
    assert.equal(preferencia.viaEstabelecimento, combinacao.viaEstabelecimento);
    assert.equal(preferencia.reciboComercial, combinacao.reciboComercial);
    assert.deepEqual(viasAutomaticasTef(preferencia), {
      cliente: combinacao.viaCliente,
      estabelecimento: combinacao.viaEstabelecimento,
    });
    assert.equal(permitirReciboComercialNaVendaTef(preferencia), combinacao.reciboComercial);
  }
});

test("o papel do comprovante TEF aceita 58 mm e 80 mm", () => {
  assert.equal(papelComprovanteTef("58mm"), "58mm");
  assert.equal(papelComprovanteTef("80mm"), "80mm");
  assert.equal(papelComprovanteTef("a4"), "80mm");
  assert.equal(sanitizarPreferenciaComprovantesTef({ papel: "a4" }).papel, "80mm");
});

test("a preferência fica isolada por empresa, usuário e computador", () => {
  const migration = fonte("supabase/migrations/20261026160000_impressoes_comprovantes_tef.sql");
  const servidor = fonte("lib/impressao/configuracoes-servidor.ts");
  const tela = fonte("components/impressao/impressao-workspace.tsx");
  assert.match(migration, /UNIQUE \(empresa_id, usuario_id, dispositivo_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migration, /usuario_id = auth\.uid\(\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.impressoes_comprovantes_tef FROM PUBLIC, anon/);
  assert.match(migration, /CHECK \(papel IN \('58mm', '80mm'\)\)/);
  assert.match(servidor, /\.from\("impressoes_comprovantes_tef"\)/);
  assert.match(servidor, /\.eq\("empresa_id", ctx\.empresaId\)/);
  assert.doesNotMatch(servidor, /body\.empresa_id|formData\.get\("empresa_id"\)/);
  assert.match(tela, /Comprovantes TEF/);
  assert.match(tela, /Imprimir automaticamente a via do cliente/);
  assert.match(tela, /Imprimir automaticamente a via do estabelecimento/);
  assert.match(tela, /Imprimir automaticamente o recibo comercial da venda/);
  assert.deepEqual([...TIPOS_DOCUMENTO_IMPRESSAO], ["recibo", "danfe_nfce", "danfe_nfe"]);
  assert.doesNotMatch(fonte("app/configuracoes/impressao/recibo/page.tsx"), /impressoes_comprovantes_tef/);
});
