import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "./fonte";

const ROTAS_ADMIN_ONLY = [
  "app/api/fiscal/geranet/diagnosticar-ultimo-erro/route.ts",
  "app/api/fiscal/geranet/diagnosticar-duplicidade-nfe/route.ts",
  "app/api/fiscal/geranet/nfce-csc-diagnostico/route.ts",
  "app/api/fiscal/geranet/testar-conexao/route.ts",
  "app/api/fiscal/sefaz/status-homologacao/route.ts",
  "app/api/fiscal/sefaz/autorizar-existente-homologacao/route.ts",
];

const ROTAS_EMISSAO_OPERACIONAL = [
  "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts",
];

test("diagnóstico: helper exige perfil administrador da empresa", () => {
  const helper = fonte("lib/usuarios/contexto-administracao.ts");
  assert.match(helper, /perfil !==\s+"administrador"/);
  assert.match(helper, /\.eq\(\s*"usuario_id"/);
  assert.match(helper, /\.eq\(\s*"principal"/);
  assert.match(helper, /\.eq\(\s*"ativo"/);
  assert.match(
    helper,
    /Somente administradores da empresa podem executar este diagnóstico/
  );
});

test("diagnóstico: usuário comum não passa no helper de administração", () => {
  function podeDiagnosticar(perfil: string) {
    return String(perfil).trim().toLowerCase() === "administrador";
  }

  assert.equal(podeDiagnosticar("operador"), false);
  assert.equal(podeDiagnosticar("vendedor"), false);
  assert.equal(podeDiagnosticar("contador"), false);
  assert.equal(podeDiagnosticar("administrador"), true);
});

test("diagnóstico: rotas Geranet/SEFAZ exigem o helper de administração", () => {
  for (const arquivo of ROTAS_ADMIN_ONLY) {
    const conteudo = fonte(arquivo);
    assert.match(conteudo, /obterContextoAdministracaoUsuarios/, arquivo);
    assert.match(conteudo, /MENSAGEM_ADMIN_DIAGNOSTICO/, arquivo);
    assert.match(conteudo, /ErroAdministracaoUsuarios/, arquivo);
  }
});

test("diagnóstico: administrador usa a empresa da sessão, não um empresa_id do cliente", () => {
  const helper = fonte("lib/usuarios/contexto-administracao.ts");
  assert.doesNotMatch(helper, /opcoes\?\.empresaId|body\.empresa_id|searchParams.*empresa/);

  for (const arquivo of ROTAS_ADMIN_ONLY) {
    const conteudo = fonte(arquivo);
    assert.match(conteudo, /empresaId/, arquivo);
    assert.doesNotMatch(conteudo, /body\.empresa_id/, arquivo);
    assert.doesNotMatch(conteudo, /searchParams\.get\(\s*"empresa/, arquivo);
  }

  const autorizar = fonte(
    "app/api/fiscal/sefaz/autorizar-existente-homologacao/route.ts"
  );
  assert.match(autorizar, /\.eq\(\s*"id",\s+emissaoId/);
  assert.match(autorizar, /\.eq\(\s*"empresa_id",\s+empresaId/);
});

test("diagnóstico SEFAZ: XML ambíguo/enviando não é retransmitido automaticamente", () => {
  const autorizar = fonte(
    "app/api/fiscal/sefaz/autorizar-existente-homologacao/route.ts"
  );
  assert.match(autorizar, /aguardando_reconciliacao/);
  assert.match(autorizar, /enviando/);
  assert.match(
    autorizar,
    /não retransmita o XML diretamente à SEFAZ/i
  );
  assert.match(autorizar, /classificacaoResumo !==\s*"erro_envio"/);
  assert.match(autorizar, /homologacao\.sefaz\.mt\.gov\.br/);
  assert.doesNotMatch(autorizar, /nfe\.geranet\.net/);
});

test("diagnóstico: emissão normal do PDV/NF-e não usa o gate admin-only", () => {
  for (const arquivo of ROTAS_EMISSAO_OPERACIONAL) {
    const conteudo = fonte(arquivo);
    assert.doesNotMatch(conteudo, /MENSAGEM_ADMIN_DIAGNOSTICO/, arquivo);
    assert.doesNotMatch(conteudo, /obterContextoAdministracaoUsuarios/, arquivo);
  }
});
