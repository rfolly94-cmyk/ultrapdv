import assert from "node:assert/strict";
import test from "node:test";
import { fonte } from "../../multiempresa/fonte";
import {
  avaliarInicioCobranca,
  classificarEstadoTef,
  decidirInstalacaoProducao,
  decidirTestePinPadProducao,
  podeConcluirAvaliacaoProducao,
  producaoLiberada,
  requisitosProducao,
  type ConfiguracaoTefEmpresa,
  type SinaisTefEmpresa,
} from "./politica-empresa";

const sinais = (parcial: Partial<SinaisTefEmpresa> = {}): SinaisTefEmpresa => ({
  conectorRespondeu: true,
  pontoInstalado: true,
  pendenciaFinanceira: false,
  pontoProducaoInstalado: false,
  pinpadAprovado: false,
  credenciamentoProducao: false,
  servidorComercialValidado: false,
  ...parcial,
});

const config = (parcial: Partial<ConfiguracaoTefEmpresa> = {}): ConfiguracaoTefEmpresa => ({
  existe: true,
  habilitado: true,
  ambiente: "homologacao",
  producaoAutorizada: false,
  credenciamentoComprovado: false,
  referenciaCredenciamento: "",
  situacaoCredenciamento: "nao_informado",
  comprovadoEm: null,
  servidorComercial: "",
  servidorComercialValidado: false,
  ...parcial,
});

test("empresas diferentes não herdam habilitação e a produção não abre", () => {
  const empresaA = avaliarInicioCobranca(config({ habilitado: false }), sinais());
  const empresaB = avaliarInicioCobranca(config(), sinais());
  assert.equal(empresaA.pode, false);
  assert.equal(empresaB.pode, true);
  assert.equal(producaoLiberada(sinais({ credenciamentoProducao: true, pinpadAprovado: true }), true), false);
  const completos = requisitosProducao(
    sinais({ credenciamentoProducao: true, pinpadAprovado: true, pontoProducaoInstalado: true, servidorComercialValidado: true }),
    true
  );
  assert.equal(completos.every((item) => item.ok), true);
  assert.equal(completos.some((item) => /ABI|LAYOUT|PWL_Type/i.test(item.texto)), false);
});

test("homologação instalada e produção sem credenciamento têm estados distintos", () => {
  assert.equal(classificarEstadoTef(null, sinais()), "nao_configurado");
  assert.equal(classificarEstadoTef(config(), sinais({ pontoInstalado: false })), "aguardando_instalacao");
  assert.equal(classificarEstadoTef(config(), sinais()), "instalado_homologacao");
  assert.equal(classificarEstadoTef(config({ ambiente: "producao" }), sinais()), "aguardando_credenciamento_producao");
  assert.equal(classificarEstadoTef(config(), sinais({ conectorRespondeu: false })), "erro_comunicacao");
  assert.equal(classificarEstadoTef(config(), sinais({ pendenciaFinanceira: true })), "pendencia_financeira");
});

test("troca para produção não inicia cobrança nem converte o ponto de homologação", () => {
  const inicio = avaliarInicioCobranca(config({ ambiente: "producao", producaoAutorizada: true }), sinais({ pontoInstalado: true }));
  assert.equal(inicio.pode, false);
  assert.match(inicio.mensagem, /produção/i);
});

test("ponto ausente e conector ausente impedem o débito e o crédito", () => {
  assert.equal(avaliarInicioCobranca(config(), sinais({ pontoInstalado: false })).pode, false);
  assert.equal(avaliarInicioCobranca(config(), sinais({ conectorRespondeu: false })).pode, false);
});

test("a consulta ao vivo não marca produção como comprovada", () => {
  const rota = fonte("app/api/pdv/tef/motor/config/route.ts");
  const producao = fonte("app/api/pdv/tef/motor/producao/route.ts");
  const sinais = fonte("lib/pdv/tef/sinais-cobranca.ts");
  assert.match(sinais, /pontoProducaoInstalado: producao\?\.codigo === "ponto_instalado"/);
  assert.match(sinais, /pinpadAprovadoNaCobranca/);
  assert.doesNotMatch(rota, /pinpadAprovado:\s*false/);
  assert.match(rota, /carregarSinaisCobranca/);
  assert.doesNotMatch(producao, /credenciamentoComprovado:\s*true|credenciamentoProducao:\s*true/);
  assert.match(producao, /config\.credenciamentoComprovado/);
  assert.match(fonte("lib/pdv/tef/motor.ts"), /ABI_COMPROVADO = false/);
  assert.match(fonte("lib/pdv/tef/motor.ts"), /LAYOUT_HOMOLOGADO = false/);
});

test("instalação de produção exige administrador e credenciamento", () => {
  assert.equal(decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: false, pendenciaFinanceira: false, servidorComercialValidado: true }).pode, false);
  assert.equal(decidirInstalacaoProducao({ administrador: false, credenciamentoProducao: true, pendenciaFinanceira: false, servidorComercialValidado: true }).pode, false);
  assert.equal(decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: true, pendenciaFinanceira: true, servidorComercialValidado: true }).pode, false);
  assert.equal(decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: true, pendenciaFinanceira: false, servidorComercialValidado: false }).pode, false);
  assert.equal(decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: true, pendenciaFinanceira: false, servidorComercialValidado: true }).pode, true);
  assert.equal(decidirTestePinPadProducao({ administrador: true, autorizacaoExplicita: false, pontoProducaoInstalado: true, pendenciaFinanceira: false }).pode, false);
  assert.equal(decidirTestePinPadProducao({ administrador: true, autorizacaoExplicita: true, pontoProducaoInstalado: true, pendenciaFinanceira: false }).pode, true);
  assert.equal(producaoLiberada(sinais({ credenciamentoProducao: true, pontoProducaoInstalado: true, pinpadAprovado: true, servidorComercialValidado: true }), false), false);
  const prontos = requisitosProducao(sinais({
    credenciamentoProducao: true,
    servidorComercialValidado: true,
    pontoProducaoInstalado: true,
    pinpadAprovado: true,
  }), false);
  assert.equal(podeConcluirAvaliacaoProducao(prontos, true), true);
  assert.equal(podeConcluirAvaliacaoProducao(prontos, false), false);
  assert.equal(podeConcluirAvaliacaoProducao(prontos.map((item) => item.id === "pinpad" ? { ...item, ok: false } : item), true), false);
  const tela = fonte("components", "pdv", "tef-configuracao-empresa.tsx");
  const homologacao = tela.indexOf('ambiente === "homologacao"');
  const botaoHomologacao = tela.indexOf("Testar PinPad de homologação");
  const botaoProducao = tela.indexOf("Testar PinPad de produção");
  assert.ok(homologacao >= 0 && homologacao < botaoHomologacao && botaoHomologacao < botaoProducao);
  assert.match(tela, /comando: "pinpad", autorizarPinPad: true/);
  assert.match(tela, /podeConcluirAvaliacaoProducao/);
  assert.doesNotMatch(tela.slice(botaoProducao - 400, botaoProducao + 120), /iniciar\("instalar"\)|PWOPER_INSTALL/);
});
