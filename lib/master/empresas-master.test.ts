import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  detalheEventoAuditoriaEmpresa,
  rotuloUsoComLimite,
} from "@/lib/master/apresentacao-empresa";

test("listagem Master busca no servidor por fantasia, razão e CNPJ", () => {
  const src = fonte("lib/master/empresas.ts");
  assert.match(src, /razao_social\.ilike/);
  assert.match(src, /nome_fantasia\.ilike/);
  assert.match(src, /cnpj\.ilike/);
  assert.doesNotMatch(src, /eq\("empresa_id", vinculo/);
  assert.match(fonte("app/master/empresas/page.tsx"), /listarEmpresasMaster/);
});

test("listagem filtra por plano e status sem carregar o banco no frontend", () => {
  const src = fonte("lib/master/empresas.ts");
  const page = fonte("app/master/empresas/page.tsx");
  assert.match(src, /planoId/);
  assert.match(src, /\.eq\("plano_id", plano\)/);
  assert.match(src, /statusAssinaturaValido/);
  assert.match(page, /Todos os planos/);
  assert.match(page, /name="plano"/);
  assert.match(page, /Ativas/);
  assert.match(page, /Em teste/);
  assert.doesNotMatch(page, /filter\(\(.*linha/);
});

test("contagem de usuários da lista é agregada, não N+1", () => {
  const src = fonte("lib/master/empresas.ts");
  assert.match(src, /\.in\("empresa_id", empresaIds\)/);
  assert.doesNotMatch(src, /for \(const linha of linhas\) \{[\s\S]*usuarios_empresas/);
});

test("cards do topo usam o status real da assinatura", () => {
  const page = fonte("app/master/empresas/page.tsx");
  assert.match(page, /metricasMaster/);
  assert.match(page, /Total de empresas/);
  assert.match(page, /Ativas/);
  assert.match(page, /Em teste/);
  assert.match(page, /Suspensas/);
  assert.match(fonte("lib/master/empresas.ts"), /contar\("trial"\)/);
  assert.match(fonte("lib/master/empresas.ts"), /contar\("suspensa"\)/);
});

test("detalhe consulta somente a empresa administrada", () => {
  const src = fonte("lib/master/empresas.ts");
  const detalhe = src.slice(src.indexOf("export async function detalheEmpresaMaster"));
  assert.match(detalhe, /\.eq\("empresa_id", id\)/);
  assert.match(detalhe, /contarSeguro\(admin, "produtos"/);
  assert.match(detalhe, /contarSeguro\(admin, "clientes"/);
  assert.match(detalhe, /contarSeguro\(admin, "vendas"/);
  assert.match(detalhe, /contarSeguro\(admin, "fiscal_emissoes"/);
  assert.match(detalhe, /from\("usuarios_empresas"\)/);
  assert.match(detalhe, /from\("plataforma_auditoria"\)/);
  assert.doesNotMatch(detalhe, /vinculo\.empresa_id/);
  assert.doesNotMatch(src, /from\("filiais"\)/);
  assert.equal(detalhe.includes(empresaA), false);
  assert.equal(detalhe.includes(empresaB), false);
});

test("limites do plano são informativos e reutilizam obterLimite", () => {
  const src = fonte("lib/master/empresas.ts");
  assert.match(src, /obterLimite/);
  assert.match(src, /chave: "usuarios"/);
  assert.match(src, /chave: "filiais"/);
  assert.match(fonte("components/master/empresa-master-detalhe.tsx"), /informativos/);
  assert.doesNotMatch(
    fonte("components/master/empresa-master-detalhe.tsx"),
    /redirect\(/
  );
  const uso = rotuloUsoComLimite(8, null, "usuário", "usuários");
  assert.equal(uso.principal, "8 usuários");
  assert.equal(uso.complemento, "Ilimitado");
  const limitado = rotuloUsoComLimite(3, 5, "usuário", "usuários");
  assert.equal(limitado.principal, "3 / 5");
});

test("ações de plano, suspensão e reativação reutilizam o fluxo existente", () => {
  const acoes = fonte("lib/master/acoes.ts");
  const ui = fonte("components/master/master-acoes-assinatura.tsx");
  assert.match(acoes, /masterAlterarPlano/);
  assert.match(acoes, /masterSuspenderEmpresa/);
  assert.match(acoes, /masterAtivarEmpresa/);
  assert.match(acoes, /valor_mensal_contratado/);
  assert.match(acoes, /exigirMaster/);
  assert.match(ui, /masterAlterarPlano/);
  assert.match(ui, /masterSuspenderEmpresa/);
  assert.match(ui, /masterAtivarEmpresa/);
  assert.doesNotMatch(ui, /createAdminClient/);
  assert.doesNotMatch(fonte("app/master/empresas/[id]/page.tsx"), /empresas\.ativo/);
});

test("auditoria da empresa fica amigável e reutiliza plataforma_auditoria", () => {
  const src = fonte("lib/master/empresas.ts");
  const ui = fonte("components/master/empresa-master-detalhe.tsx");
  assert.match(src, /from\("plataforma_auditoria"\)/);
  assert.match(src, /admin_usuario_id/);
  assert.match(ui, /Administrador:/);
  assert.match(ui, /ROTULOS_EVENTO_EMPRESA/);
  assert.doesNotMatch(ui, /JSON\.stringify/);
  assert.equal(
    detalheEventoAuditoriaEmpresa({
      plano_de: "Pro",
      plano_para: "Premium",
      motivo: null,
    }),
    "Pro → Premium"
  );
});

test("tela de detalhe tem as abas SaaS sem matriz granular", () => {
  const ui = fonte("components/master/empresa-master-detalhe.tsx");
  for (const aba of ["Resumo", "Assinatura", "Uso", "Usuários", "Auditoria"]) {
    assert.match(ui, new RegExp(aba));
  }
  assert.doesNotMatch(ui, /usuarios_permissoes_empresas/);
  assert.doesNotMatch(ui, /matriz granular/);
});
