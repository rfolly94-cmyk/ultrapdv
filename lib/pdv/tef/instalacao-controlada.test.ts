import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";

import {
  decidirInstalacaoControlada,
  decidirMigracaoPonto,
  efeitoAposFalhaInstalacao,
} from "./instalacao-controlada";

const CNPJ = "11222333000181";

function base(parcial: Partial<Parameters<typeof decidirInstalacaoControlada>[0]> = {}) {
  return {
    empresaSessaoId: empresaA,
    empresaInformada: "",
    permissaoEditar: true,
    administrador: true,
    plataformaHabilitada: true,
    pendenciaFinanceira: false,
    confirmacaoExplicita: true,
    credencialInformada: true,
    pontoJaInstalado: false,
    procedimentoOficialConfirmado: false,
    autorizacaoExplicitaReset: false,
    pontoAtual: "",
    ambienteAtual: "",
    servidorAtual: "",
    pontoOficial: "200001",
    ambienteOficial: "homologacao",
    servidorOficial: "tef.cliente.example:31735",
    cnpjEmpresa: CNPJ,
    estabelecimentoOficial: "LOJA NOVA",
    pontoVinculado: "200001",
    ambienteVinculado: "homologacao",
    servidorVinculado: "tef.cliente.example:31735",
    dispositivoPareado: true,
    dispositivoOutraEmpresa: false,
    ...parcial,
  };
}

test("instalação nova segue somente com parâmetros oficiais e confirmação", () => {
  const decisao = decidirInstalacaoControlada(base());
  assert.equal(decisao.efeito, "instalar");
  const falha = efeitoAposFalhaInstalacao();
  assert.equal(falha.ativaEmpresa, false);
  assert.equal(falha.repetirAutomaticamente, false);
  assert.equal(falha.preservaPendencia, true);
});

test("migração de ponto instalado permanece bloqueada mesmo com autorização", () => {
  const proposta = {
    pontoAtual: "117473",
    ambienteAtual: "homologacao",
    servidorAtual: "tef.homolog.example:31735",
    pontoNovo: "6696546",
    ambienteNovo: "producao",
    servidorNovo: "pos-transac.pgweb.io:31735",
    procedimentoOficialConfirmado: false,
    autorizacaoExplicitaReset: true,
  };
  const bloqueada = decidirMigracaoPonto(proposta);
  assert.equal(bloqueada.necessario, true);
  assert.equal(bloqueada.efeito, "bloqueada");
  assert.match(bloqueada.motivo, /PWOPER_MAINTENANCE/);

  const comProcedimento = decidirMigracaoPonto({
    ...proposta,
    procedimentoOficialConfirmado: true,
  });
  assert.equal(comProcedimento.efeito, "bloqueada");

  const decisao = decidirInstalacaoControlada(
    base({
      pontoJaInstalado: true,
      pontoAtual: proposta.pontoAtual,
      ambienteAtual: proposta.ambienteAtual,
      servidorAtual: proposta.servidorAtual,
      pontoOficial: proposta.pontoNovo,
      ambienteOficial: "producao",
      servidorOficial: proposta.servidorNovo,
      autorizacaoExplicitaReset: true,
      procedimentoOficialConfirmado: true,
    })
  );
  assert.equal(decisao.efeito, "bloqueada");
});

test("credencial ausente, servidor inválido, ambiente divergente e ponto já instalado recusam", () => {
  assert.equal(
    decidirInstalacaoControlada(base({ credencialInformada: false })).motivo.includes("credencial"),
    true
  );
  assert.match(
    decidirInstalacaoControlada(base({ servidorOficial: "servidor-invalido" })).motivo,
    /host:porta|porta/
  );
  assert.match(
    decidirInstalacaoControlada(base({ ambienteVinculado: "producao" })).motivo,
    /diverge/
  );
  const instalado = decidirInstalacaoControlada(
    base({
      pontoJaInstalado: true,
      pontoAtual: "200001",
      ambienteAtual: "homologacao",
      servidorAtual: "tef.cliente.example:31735",
    })
  );
  assert.equal(instalado.efeito, "recusar");
  assert.match(instalado.motivo, /já está instalado/);
});

test("pendência financeira bloqueia a instalação e a falha não ativa a empresa", () => {
  const pendente = decidirInstalacaoControlada(base({ pendenciaFinanceira: true }));
  assert.equal(pendente.efeito, "recusar");
  assert.match(pendente.motivo, /pendente/);
  assert.equal(efeitoAposFalhaInstalacao().ativaEmpresa, false);
});

test("isolamento multiempresa recusa empresa informada diferente da sessão", () => {
  const cruzada = decidirInstalacaoControlada(
    base({ empresaInformada: empresaB, empresaSessaoId: empresaA })
  );
  assert.equal(cruzada.efeito, "recusar");
  assert.match(cruzada.motivo, /não confere/);
  const propria = decidirInstalacaoControlada(
    base({ empresaInformada: empresaA, empresaSessaoId: empresaA })
  );
  assert.equal(propria.efeito, "instalar");
});

test("o assistente só chama instalar após a decisão e não executa manutenção", () => {
  const ui = fonte("components/pdv/tef-assistente.tsx");
  const sessao = fonte("lib/pdv/tef/assistente-sessao.ts");
  const politica = fonte("lib/pdv/tef/instalacao-controlada.ts");
  const instalar = ui.slice(ui.indexOf("async function instalarPonto"), ui.indexOf("async function ativar"));
  const preparar = sessao.slice(sessao.indexOf("export async function prepararInstalacaoAssistenteSessao"));
  assert.match(instalar, /\/tef\/instalar/);
  assert.match(instalar, /acao: "instalar"/);
  assert.match(instalar, /confirmacao: true/);
  assert.doesNotMatch(instalar, /ativarAssistente|pontoCaptura|empresaId|servidor/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|PW_iInit|PWOPER_MAINTENANCE/);
  assert.match(preparar, /procedimentoOficialConfirmado: false/);
  assert.doesNotMatch(preparar, /input\.empresaId|credencial:/);
  assert.match(preparar, /credencialInformada/);
  assert.doesNotMatch(politica, /PWOPER_MAINTENANCE\s*\(/);
});
