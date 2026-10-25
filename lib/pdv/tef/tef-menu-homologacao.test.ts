import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLASSE_BACKDROP,
  CLASSE_JANELA,
  CLASSE_OPCAO_SELECIONADA,
  CLASSE_ROLAGEM,
  MENSAGEM_FECHAMENTO_IMPEDIDO,
  criarTravaEnvio,
  decidirFechamentoTeste,
  exibirTesteFinanceiroHomologacao,
  proximoFocoCircular,
  tratarTeclaModal,
} from "./menu-homologacao-interface";

const componente = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../components/pdv/tef-menu-homologacao.tsx"),
  "utf8"
);

test("o modal usa backdrop, altura máxima, rolagem e destaque da opção", () => {
  assert.match(CLASSE_BACKDROP, /bg-black\/70/);
  assert.match(CLASSE_JANELA, /max-h-\[min\(32rem,calc\(100vh-2rem\)\)\]/);
  assert.match(CLASSE_JANELA, /w-full max-w-lg/);
  assert.match(CLASSE_ROLAGEM, /overflow-y-auto/);
  assert.match(CLASSE_OPCAO_SELECIONADA, /ring-2/);
  assert.match(componente, /CLASSE_BACKDROP/);
  assert.match(componente, /CLASSE_JANELA/);
  assert.match(componente, /CLASSE_ROLAGEM/);
  assert.match(componente, /role="dialog"/);
  assert.match(componente, /aria-modal="true"/);
  assert.match(componente, /TEF — Homologação/);
  assert.match(componente, /data-foco-inicial/);
  assert.match(componente, /aria-selected/);
  assert.match(componente, /data-valor=\{opcao\.valor\}/);
  assert.match(componente, /Fechar/);
  assert.match(componente, /Pagamento não recebido/);
});

test("o teclado move o foco, confirma e impede o Esc com sessão ativa", () => {
  assert.deepEqual(tratarTeclaModal({ tecla: "ArrowDown", indice: 0, total: 3, sessaoAtiva: true }), { acao: "mover", indice: 1 });
  assert.deepEqual(tratarTeclaModal({ tecla: "ArrowUp", indice: 0, total: 3, sessaoAtiva: true }), { acao: "mover", indice: 2 });
  assert.deepEqual(tratarTeclaModal({ tecla: "Enter", indice: 0, total: 3, sessaoAtiva: true }), { acao: "confirmar", indice: 0 });
  assert.equal(tratarTeclaModal({ tecla: "Escape", indice: 0, total: 3, sessaoAtiva: true }).acao, "impedir");
  assert.equal(tratarTeclaModal({ tecla: "Escape", indice: 0, total: 0, sessaoAtiva: false }).acao, "fechar");
  assert.equal(proximoFocoCircular(2, 3, false), 0);
  assert.equal(proximoFocoCircular(0, 3, true), 2);
  assert.equal(decidirFechamentoTeste("menu").permitir, false);
  assert.equal(decidirFechamentoTeste("pinpad").mensagem, MENSAGEM_FECHAMENTO_IMPEDIDO);
  assert.equal(decidirFechamentoTeste("idle").permitir, true);
  assert.match(componente, /decidirFechamentoTeste/);
});

test("duplo clique, erro visível e produção fora do teste", () => {
  const trava = criarTravaEnvio();
  assert.equal(trava.tentar(), true);
  assert.equal(trava.tentar(), false);
  trava.liberar();
  assert.match(componente, /role="alert"/);
  assert.match(componente, /Insira ou passe o cartão|pinpad/);
  assert.equal(exibirTesteFinanceiroHomologacao({ habilitado: true, ambiente: "homologacao", cobrancaBloqueada: true }), true);
  assert.equal(exibirTesteFinanceiroHomologacao({ habilitado: true, ambiente: "producao", cobrancaBloqueada: true }), false);
  assert.equal(exibirTesteFinanceiroHomologacao({ habilitado: false, ambiente: "homologacao", cobrancaBloqueada: true }), false);
});
