import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  mascararApiKeyGeranet,
  mesclarApiKeyGeranetEmissao,
} from "./credencial-plataforma";

const ROTAS_EMISSAO = [
  "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfe-emitir/route.ts",
  "app/api/fiscal/geranet/nfce-emitir/route.ts",
  "app/api/fiscal/geranet/nfe55-emitir/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts",
  "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
  "app/api/fiscal/emissoes/[id]/cancelar/route.ts",
  "app/api/fiscal/emissoes/[id]/carta-correcao/route.ts",
  "lib/fiscal/reconciliar-emissao.ts",
  "lib/fiscal/reconciliar-inutilizacao.ts",
  "lib/fiscal/inutilizar-numeracao.ts",
  "lib/fiscal/obter-documento-fiscal.ts",
  "lib/fiscal/contingencia/transmitir-contingencia.ts",
];

test("máscara nunca devolve a API Key completa", () => {
  assert.equal(mascararApiKeyGeranet(""), "");
  assert.equal(mascararApiKeyGeranet("abcd"), "••••");
  assert.equal(mascararApiKeyGeranet("gn_chave-secreta-1234"), "••••1234");
  assert.equal(mascararApiKeyGeranet("gn_chave-secreta-1234").includes("gn_"), false);
});

test("emissão prefere a chave global e cai na da empresa se a global estiver vazia", () => {
  const empresa = {
    geranet_api_key: "empresa-antiga",
    certificado_a1: "cert",
    csc: "csc",
  };

  assert.equal(
    mesclarApiKeyGeranetEmissao(empresa, "global-nova").geranet_api_key,
    "global-nova"
  );
  assert.equal(
    mesclarApiKeyGeranetEmissao(empresa, "").geranet_api_key,
    "empresa-antiga"
  );
  assert.equal(
    mesclarApiKeyGeranetEmissao({ certificado_a1: "cert" }, "").geranet_api_key,
    null
  );
  assert.equal(
    mesclarApiKeyGeranetEmissao(empresa, "global-nova").certificado_a1,
    "cert"
  );
  assert.equal(mesclarApiKeyGeranetEmissao(empresa, "global-nova").csc, "csc");
});

test("Master Geranet exige administradores da plataforma e não devolve a chave completa", () => {
  const page = fonte("app/master/integracoes/geranet/page.tsx");
  const actions = fonte("app/master/integracoes/geranet/actions.ts");
  const layout = fonte("app/master/layout.tsx");
  const chrome = fonte("components/master/master-chrome.tsx");

  assert.match(layout, /exigirMaster/);
  assert.match(chrome, /\/master\/integracoes/);
  assert.match(page, /exigirMaster/);
  assert.match(page, /carregarDiagnosticoApiKeyGeranet/);
  assert.match(page, /diagnostico\.mascara/);
  assert.doesNotMatch(page, /obterApiKeyGeranetPlataforma/);
  assert.match(actions, /exigirMaster/);
  assert.match(actions, /rpc_master_salvar_api_key_geranet/);
  assert.match(actions, /masterTestarConexaoGeranet/);
  assert.doesNotMatch(actions, /console\.(log|error)\([^)]*apiKey/);
  assert.match(actions, /configurada: true/);
});

test("endpoint de teste da Geranet é exclusivo do Master", () => {
  const rota = fonte("app/api/fiscal/geranet/testar-conexao/route.ts");
  assert.match(rota, /exigirMaster/);
  assert.match(rota, /obterApiKeyGeranetPlataforma/);
  assert.doesNotMatch(rota, /obterContextoAdministracaoUsuarios/);
  assert.doesNotMatch(rota, /obter_segredos_fiscais/);
  assert.doesNotMatch(rota, /empresa_id:/);
});

test("empresa não vê nem grava API Key Geranet nas credenciais fiscais", () => {
  const page = fonte("app/configuracoes/fiscal/integracao/page.tsx");
  const actions = fonte("app/configuracoes/fiscal/integracao/actions.ts");
  const tabs = fonte("components/fiscal/fiscal-config-tabs.tsx");

  assert.match(tabs, /Credenciais Fiscais/);
  assert.doesNotMatch(tabs, /Integração Geranet/);
  assert.match(page, /Certificado Digital A1/);
  assert.match(page, /Certificado A1/);
  assert.match(page, /CSC NFC-e/);
  assert.match(page, /salvarCertificadoA1/);
  assert.match(page, /salvarConfiguracaoNfce/);
  assert.doesNotMatch(page, /Geranet/);
  assert.doesNotMatch(page, /API Key/);
  assert.doesNotMatch(page, /Validar e salvar/);
  assert.doesNotMatch(page, /Testar conexão/);
  assert.doesNotMatch(page, /api_key_configurada/);

  assert.match(actions, /p_tipo: "certificado_a1"/);
  assert.match(actions, /p_tipo: "senha_certificado"/);
  assert.match(actions, /p_tipo: "csc"/);
  assert.doesNotMatch(actions, /salvarApiGeranet/);
  assert.doesNotMatch(actions, /testarConexaoGeranet/);
  assert.doesNotMatch(actions, /geranet_api_key/);
  assert.doesNotMatch(actions, /rpc_master_salvar_api_key_geranet/);
});

test("certificado e CSC da empresa usam a empresa da sessão, não um empresa_id do navegador", () => {
  const page = fonte("app/configuracoes/fiscal/integracao/page.tsx");
  const actions = fonte("app/configuracoes/fiscal/integracao/actions.ts");

  assert.match(page, /\.eq\(\s*"principal"/);
  assert.match(page, /\.eq\(\s*"ativo"/);
  assert.match(page, /vinculo\.empresa_id/);
  assert.match(actions, /principal/);
  assert.match(actions, /p_empresa_id: empresaId/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.doesNotMatch(actions, /formData\.get\("empresa_id"\)/);
  assert.doesNotMatch(page, /searchParams.*empresa_id/);
});

test("emissão, consulta, cancelamento e reconciliação leem a credencial global", () => {
  for (const arquivo of ROTAS_EMISSAO) {
    const conteudo = fonte(arquivo);
    assert.match(conteudo, /obterSegredosFiscaisEmissao/, arquivo);
    assert.doesNotMatch(conteudo, /admin\.rpc\(\s*"obter_segredos_fiscais"/, arquivo);
  }

  const pix = fonte("lib/pagamentos/pix/contexto.ts");
  assert.match(pix, /obterApiKeyGeranetPlataforma/);
  assert.match(pix, /A API Geranet da plataforma ainda não está configurada/);
});

test("preview fiscal não envia a API Key crua ao navegador", () => {
  const nfce = fonte("app/api/fiscal/geranet/nfce-preview/route.ts");
  const item = fonte("app/api/fiscal/geranet/item-preview/route.ts");
  assert.match(nfce, /CONFIGURADA/);
  assert.match(item, /CONFIGURADA/);
  assert.match(nfce, /obterSegredosFiscaisEmissao/);
  assert.match(item, /obterSegredosFiscaisEmissao/);
});

test("migration move a chave para o cofre da plataforma sem apagar as chaves das empresas", () => {
  const sql = fonte(
    "supabase/migrations/20260830220000_geranet_api_key_plataforma.sql"
  );

  assert.match(sql, /plataforma_segredos_refs/);
  assert.match(sql, /ultrapdv:plataforma:geranet_api_key/);
  assert.match(sql, /rpc_master_salvar_api_key_geranet/);
  assert.match(sql, /administradores_plataforma/);
  assert.match(sql, /obter_api_key_geranet_plataforma/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.obter_api_key_geranet_plataforma\(\) FROM authenticated/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.obter_api_key_geranet_plataforma\(\) TO service_role/
  );
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.obter_api_key_geranet_plataforma\(\) TO authenticated/
  );
  assert.match(sql, /migracao_chaves_empresa = 'divergente'/);
  assert.match(sql, /migracao_chaves_empresa = 'copiada'/);
  assert.match(sql, /Chaves por empresa foram preservadas/);
  assert.doesNotMatch(sql, /DELETE FROM public\.fiscal_segredos_refs/);
  assert.doesNotMatch(sql, /DELETE FROM vault\.secrets/);
  assert.match(sql, /api_key_geranet_somente_plataforma/);
});
