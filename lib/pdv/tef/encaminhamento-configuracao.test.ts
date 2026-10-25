import assert from "node:assert/strict";
import test from "node:test";
import { fonte } from "../../multiempresa/fonte";
import { montarPedidoProducao } from "./encaminhamento-configuracao";

test("o botão Configurar chega ao host como PWOPER_CONFIG e instalar continua PWOPER_INSTALL", () => {
  const ui = fonte("components", "pdv", "tef-instalacao-producao.tsx");
  const indiceConfigurar = ui.lastIndexOf("Configurar ponto de produção");
  const trechoConfigurar = ui.slice(indiceConfigurar - 280, indiceConfigurar);
  assert.match(trechoConfigurar, /iniciar\("configurar"\)/);
  const indiceInstalar = ui.lastIndexOf("Instalar ponto de produção");
  const trechoInstalar = ui.slice(indiceInstalar - 280, indiceInstalar);
  assert.match(trechoInstalar, /iniciar\("instalar"\)/);
  assert.match(ui, /chaveDaOperacao\(comando\)/);

  const configurar = montarPedidoProducao({ comando: "configurar", chave: "cfg:ponto" });
  assert.equal(configurar.ok, true);
  if (configurar.ok) {
    assert.equal(configurar.comando, "configurar");
    assert.equal(configurar.finalidade, "configuracao_producao");
    assert.equal(configurar.operacaoNativa, "PWOPER_CONFIG");
    assert.equal(configurar.chave, "cfg:ponto");
  }

  const instalar = montarPedidoProducao({ comando: "instalar", chave: "ins:ponto" });
  assert.equal(instalar.ok, true);
  if (instalar.ok) {
    assert.equal(instalar.comando, "instalar");
    assert.equal(instalar.operacaoNativa, "PWOPER_INSTALL");
  }

  assert.equal(montarPedidoProducao({ comando: "configurar", chave: "ins:ponto" }).ok, false);
  assert.equal(montarPedidoProducao({ comando: "instalar", chave: "cfg:ponto" }).ok, false);

  const resposta = montarPedidoProducao({ comando: "responder", operacao: "configurar", chave: "cfg:ponto" });
  assert.equal(resposta.ok, true);
  if (resposta.ok) {
    assert.equal(resposta.comando, "responder");
    assert.equal(resposta.operacaoNativa, "PWOPER_CONFIG");
    assert.equal(resposta.finalidade, "configuracao_producao");
  }

  const rota = fonte("app", "api", "pdv", "tef", "motor", "producao", "route.ts");
  assert.match(rota, /montarPedidoProducao/);
  assert.match(rota, /operacaoNativa: pedido\.operacaoNativa/);
  assert.match(rota, /comando === "responder" && pedido\.operacaoNativa === "PWOPER_CONFIG"/);
  assert.match(rota, /comando === "responder" && pedido\.operacaoNativa === "PWOPER_INSTALL"/);
  assert.match(ui, /onInstalacaoConcluida/);
  assert.match(ui, /não confirmou o journal/);
  assert.doesNotMatch(rota, /comando:\s*"instalar"/);
  assert.match(ui, /onServidorConfirmado/);
  assert.match(ui, /emCurso/);
  assert.match(ui, /SESSAO_AUSENTE/);
  const tela = fonte("components", "pdv", "tef-configuracao-empresa.tsx");
  assert.match(tela, /onServidorConfirmado=\{\(\) => \{/);
  assert.match(tela, /setServidorValidado\(true\)/);
});
