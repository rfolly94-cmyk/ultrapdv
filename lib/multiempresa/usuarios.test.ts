import assert from "node:assert/strict";
import { test } from "node:test";

import { ehContador, podeAcessarContabilidade } from "@/lib/contabilidade/acesso";
import { selecionarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";

import {
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
  usuarioX,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { temAcessoEmpresa } from "./rls-memoria";

test("usuários: admin A só opera vínculos da empresa ativa", () => {
  const rota = fonte("app/api/configuracoes/usuarios/[id]/route.ts");
  const contexto = fonte("lib/usuarios/contexto-administracao.ts");
  assert.match(contexto, /\.eq\(\s*"usuario_id"/);
  assert.match(contexto, /\.eq\(\s*"principal"/);
  assert.match(rota, /\.eq\(\s*"empresa_id",\s+empresaId/);
  assert.match(rota, /\.eq\(\s*"usuario_id",\s+alvoId/);
});

test("usuários: A não edita usuário que só existe em B", () => {
  const vinculos = [
    { usuario_id: usuarioA, empresa_id: empresaA, perfil: "administrador" },
    { usuario_id: usuarioB, empresa_id: empresaB, perfil: "administrador" },
  ];

  function patchUsuario(empresaAtiva: string, alvoId: string) {
    return vinculos.find(
      (vinculo) => vinculo.empresa_id === empresaAtiva && vinculo.usuario_id === alvoId
    ) ?? null;
  }

  assert.ok(patchUsuario(empresaA, usuarioA));
  assert.equal(patchUsuario(empresaA, usuarioB), null);
});

test("usuários: senha de outro tenant não é redefinida sem vínculo na empresa ativa", () => {
  const senha = fonte("app/api/configuracoes/usuarios/[id]/senha/route.ts");
  assert.match(senha, /empresa_id/);
  assert.match(senha, /alvoId|usuario_id/);
});

test("contador: perfil não é acesso global; só empresas com vínculo ativo", () => {
  assert.equal(ehContador("contador"), true);
  assert.equal(podeAcessarContabilidade("contador"), true);
  assert.equal(temAcessoEmpresa(usuarioX, empresaA, vinculosPadrao), true);
  assert.equal(temAcessoEmpresa(usuarioX, empresaB, vinculosPadrao), true);
  assert.equal(temAcessoEmpresa(usuarioA, empresaB, vinculosPadrao), false);
});

test("contador: troca de principal só nas empresas do próprio usuário (já existe na contabilidade)", () => {
  const acao = fonte("app/contabilidade/actions.ts");
  assert.match(acao, /export async function definirEmpresaAtiva/);
  assert.match(acao, /ctx\.empresas\.some/);
  assert.match(acao, /Empresa não autorizada para este usuário/);
});

test("usuário X: principal A não mistura registros na resolução da app", () => {
  const ativo = selecionarVinculoEmpresaAtiva(vinculosPadrao, usuarioX);
  assert.equal(ativo?.empresa_id, empresaA);
  assert.notEqual(ativo?.empresa_id, empresaB);
});
