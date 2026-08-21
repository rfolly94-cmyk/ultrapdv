import assert from "node:assert/strict";
import { test } from "node:test";

import { MENSAGEM_RECURSO_NAO_ENCONTRADO } from "@/lib/empresa/assert-registro-empresa-ativa";

import { recusarCruzado } from "./app-layer";
import { empresaA, empresaB } from "./cenario";
import { fonte } from "./fonte";

const ROTAS_ID = [
  "app/api/vendas/[id]/cancelar/route.ts",
  "app/api/vendas/[id]/editar/route.ts",
  "app/api/fiscal/emissoes/[id]/arquivo/route.ts",
  "app/api/fiscal/emissoes/[id]/cancelar/route.ts",
  "app/api/fiscal/emissoes/[id]/reconciliar/route.ts",
  "app/api/fiscal/emissoes/[id]/carta-correcao/route.ts",
  "app/api/fiscal/emissoes/[id]/inutilizar/route.ts",
  "app/api/clientes/[id]/carteira/receber/route.ts",
  "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts",
  "app/api/configuracoes/usuarios/[id]/route.ts",
  "app/api/transportadoras/[id]/route.ts",
];

test("IDOR: rotas [id] combinam o UUID com empresa_id da sessão", () => {
  for (const arquivo of ROTAS_ID) {
    const conteudo = fonte(arquivo);
    assert.match(conteudo, /empresa_id/, arquivo);
    assert.match(conteudo, /vinculo\.empresa_id|empresaId/, arquivo);
  }
});

test("IDOR: UUID da Empresa B autenticado como A vira 404 genérico no helper de app", () => {
  const resposta = recusarCruzado({ empresa_id: empresaB }, empresaA);
  assert.equal(resposta.ok, false);
  assert.equal(resposta.status, 404);
  assert.equal(resposta.erro, "Não encontrado.");
  assert.doesNotMatch(resposta.erro, /Empresa B/);
});

test("P2: mensagens IDOR de UUID em API PIX/usuários são neutras", () => {
  assert.equal(
    MENSAGEM_RECURSO_NAO_ENCONTRADO,
    "Recurso não encontrado."
  );
  assert.match(
    fonte("lib/pagamentos/pix/geranet.ts"),
    /Recurso não encontrado/
  );
  assert.doesNotMatch(
    fonte("lib/pagamentos/pix/geranet.ts"),
    /Cobrança PIX não encontrada nesta empresa/
  );
  assert.match(
    fonte("app/api/configuracoes/usuarios/[id]/route.ts"),
    /Recurso não encontrado/
  );
  assert.doesNotMatch(
    fonte("app/api/configuracoes/usuarios/[id]/route.ts"),
    /Usuário não pertence a esta empresa/
  );
  assert.match(
    fonte("app/api/configuracoes/usuarios/[id]/senha/route.ts"),
    /Recurso não encontrado/
  );
  assert.doesNotMatch(
    fonte("app/api/configuracoes/usuarios/[id]/senha/route.ts"),
    /Usuário não pertence a esta empresa/
  );
});

test("service_role: helpers resolvem tenant da sessão antes do admin", () => {
  const pix = fonte("lib/pagamentos/pix/contexto.ts");
  const usuarios = fonte("lib/usuarios/contexto-administracao.ts");
  const arquivo = fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts");

  assert.match(pix, /buscarVinculoEmpresaAtiva/);
  assert.match(pix, /admin: createAdminClient\(\)/);
  assert.match(usuarios, /createAdminClient/);
  assert.match(arquivo, /vinculo\.empresa_id/);
  assert.match(arquivo, /createAdminClient\(\)/);
});

test("PostgREST: proteção de clientes/produtos/vendas não depende só do Next.js", () => {
  const policies = [
    fonte("supabase/migrations/20260817340000_fiscal_operacoes_nfe.sql"),
    fonte("supabase/migrations/20260813014000_estoque_fundacao.sql"),
    fonte("supabase/migrations/20260813016000_carteira_cliente_fundacao.sql"),
  ];
  assert.ok(policies.some((sql) => sql.includes("tem_acesso_empresa")));
});
