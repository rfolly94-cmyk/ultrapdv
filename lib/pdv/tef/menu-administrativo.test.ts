import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decidirTeclaMenuAdministrativo,
  estadoDoPontoAposOperacao,
  mensagemMenuAdministrativo,
  campoDigitadoAdministrativo,
  capturaDeValor,
  pedidoCancelamentoMenu,
  promptTemMascaraDeValor,
  promptValorVisivel,
  valorSemCaracteresEspeciais,
} from "./menu-administrativo";

const componente = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../components/pdv/tef-menu-administrativo.tsx"),
  "utf8"
);

test("Esc no menu aberto pede cancelamento e não escolhe uma opção", () => {
  assert.equal(decidirTeclaMenuAdministrativo({ tecla: "Escape", menuAberto: true, resultadoAberto: false, aguardando: false }).acao, "cancelar-menu");
  assert.equal(decidirTeclaMenuAdministrativo({ tecla: "Escape", menuAberto: true, resultadoAberto: false, aguardando: true }).acao, "ignorar");
  assert.equal(decidirTeclaMenuAdministrativo({ tecla: "Enter", menuAberto: true, resultadoAberto: false, aguardando: false }).acao, "ignorar");
  assert.equal(decidirTeclaMenuAdministrativo({ tecla: "Escape", menuAberto: false, resultadoAberto: true, aguardando: false }).acao, "sair");
  assert.deepEqual(pedidoCancelamentoMenu(), { comando: "responder", valor: "", cancelar: true });
  assert.match(componente, /decidirTeclaMenuAdministrativo/);
  assert.match(componente, /pedidoCancelamentoMenu/);
  assert.match(componente, /event\.key === "Escape"|tecla: event\.key/);
  assert.match(componente, /Cancelar menu/);
  assert.match(componente, />\s*Sair\s*</);
  assert.match(componente, /role="dialog"/);
  assert.match(componente, /aria-modal="true"/);
  assert.doesNotMatch(componente, /onKeyDown=\{?\(\) => setEtapa\(null\)/);
});

test("a mensagem de cancelamento só aparece depois do motor", () => {
  assert.equal(mensagemMenuAdministrativo(null), "");
  assert.equal(mensagemMenuAdministrativo({ codigo: "captura", erro: "OPERAÇÃO CANCELADA" }), "");
  assert.equal(mensagemMenuAdministrativo({ codigo: "interrompida", erro: "OPERAÇÃO CANCELADA" }), "OPERAÇÃO CANCELADA");
  assert.equal(mensagemMenuAdministrativo({ codigo: "interrompida", erro: "  " }), "");
  assert.match(componente, /mensagemMenuAdministrativo/);
  assert.doesNotMatch(componente, /setConsulta\("OPERAÇÃO CANCELADA"\)/);
  assert.doesNotMatch(componente, /opcao\.texto === "CANCELAMENTO"/);
  assert.equal(estadoDoPontoAposOperacao("ponto_nao_instalado"), "ausente");
  assert.equal(estadoDoPontoAposOperacao("administrativa"), "inalterado");
  assert.equal(estadoDoPontoAposOperacao("instalada"), "instalado");
  assert.match(componente, /estadoDoPontoAposOperacao/);
});

test("valor original aparece sem a máscara da biblioteca", () => {
  const original = "VALOR TRANS. ORIG. @.@@@.@@@.@@@,@@ DADO NAO CONFERE!";
  const venda = "VALOR DA VENDA: R$@.@@@.@@@.@@@,@@ VALOR NAO PODE SER VAZIO";
  assert.equal(capturaDeValor(0x60), true);
  assert.equal(capturaDeValor(0x25), true);
  assert.equal(capturaDeValor(0x36), false);
  assert.equal(promptTemMascaraDeValor(venda), true);
  assert.equal(promptValorVisivel(original), "VALOR TRANS. ORIG. DADO NAO CONFERE!");
  assert.equal(promptValorVisivel(venda), "VALOR DA VENDA: VALOR NAO PODE SER VAZIO");
  assert.equal(valorSemCaracteresEspeciais("12.345,67"), "1234567");
  assert.equal(valorSemCaracteresEspeciais("R$@.@@@.@@@.@@@,@@"), "");
  assert.match(componente, /promptTemMascaraDeValor/);
  assert.match(componente, /promptValorVisivel/);
  assert.match(componente, /valorSemCaracteresEspeciais/);
});

test("campo digitado e pinpad usam o mesmo diálogo", () => {
  assert.equal(campoDigitadoAdministrativo(2), true);
  assert.equal(campoDigitadoAdministrativo(12), true);
  assert.equal(campoDigitadoAdministrativo(17), true);
  assert.equal(campoDigitadoAdministrativo(1), false);
  assert.equal(campoDigitadoAdministrativo(3), false);
  assert.match(componente, /campoDigitadoAdministrativo/);
  assert.match(componente, /data-tef-captura="digitada"/);
  assert.match(componente, /Aguardando o pinpad/);
  assert.match(componente, /whitespace-pre-wrap/);
});
