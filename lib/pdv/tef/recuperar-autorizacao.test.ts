import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { assinarProvaTef, verificarProvaTef } from "@/lib/pdv/tef/prova";

import { fingerprintChavePublicaEd25519 } from "./fingerprint-chave";
import {
  decidirRecuperacaoAutorizacao,
  resultadoAposAutorizacao,
  transicaoRecuperacao,
  type PedidoRecuperacaoAutorizacao,
  type TerminalRecuperacao,
} from "./recuperar-autorizacao";

const EMPRESA = "347878e3-608a-46c4-9f22-7bebb982ff6d";
const TERMINAL = "19080057-44ee-4e1e-95a1-286317b88b03";
const DISPOSITIVO = "5c514a72-0c49-4e5e-a715-f64f8d0b4fae";
const OUTRO_DISPOSITIVO = "d2222222-2222-4222-8222-222222222222";

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const autorizada = par();
const atual = par();

function terminal(parcial: Partial<TerminalRecuperacao> = {}): TerminalRecuperacao {
  return {
    id: TERMINAL,
    empresaId: EMPRESA,
    codigo: "117473",
    dispositivoId: DISPOSITIVO,
    chavePublica: autorizada.publica,
    chaveId: "77c24275-2cac-4be5-b9b2-52d0c6b1072e",
    ativo: true,
    revogada: false,
    ...parcial,
  };
}

function pedido(
  parcial: Partial<PedidoRecuperacaoAutorizacao> = {}
): PedidoRecuperacaoAutorizacao {
  return {
    administrador: true,
    permissaoEditar: true,
    perdaConfirmada: true,
    assinaturaValida: true,
    empresaSessaoId: EMPRESA,
    dispositivoAssinado: DISPOSITIVO,
    chavePublicaComprovada: atual.publica,
    chaveIdInformada: "3c70edff-ac79-4381-9338-841c3e176c9d",
    fingerprintComprovada: fingerprintChavePublicaEd25519(atual.publica),
    dispositivoOutraEmpresa: false,
    pendenciaFinanceira: false,
    reconciliacao: false,
    chaveJaRevogada: false,
    chaveEmOutroTerminal: false,
    terminal: terminal(),
    ...parcial,
  };
}

test("recuperação legítima autoriza a chave atual no mesmo terminal sem gerar outra", () => {
  const decisao = decidirRecuperacaoAutorizacao(pedido());
  assert.equal(decisao.efeito, "autorizar");
  assert.equal(decisao.terminalId, TERMINAL);
  assert.equal(decisao.codigo, "117473");
  assert.equal(decisao.dispositivoId, DISPOSITIVO);
  assert.equal(decisao.alteraCodigo, false);
  assert.equal(decisao.alteraTerminalId, false);
  assert.equal(decisao.alteraDispositivo, false);
  assert.equal(decisao.executaInstalacao, false);
  assert.equal(decisao.gerarChave, false);
  assert.notEqual(fingerprintChavePublicaEd25519(atual.publica), fingerprintChavePublicaEd25519(autorizada.publica));
});

test("prova inválida e chave privada não comprovam posse", () => {
  const campos = {
    acao: "pareamento" as const,
    desafio: "a".repeat(64),
    identificador: DISPOSITIVO,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  };
  const assinatura = assinarProvaTef(atual.privada, campos);
  assert.equal(verificarProvaTef(atual.publica, campos, assinatura), true);
  assert.equal(verificarProvaTef(atual.publica, { ...campos, identificador: OUTRO_DISPOSITIVO }, assinatura), false);
  assert.equal(verificarProvaTef(autorizada.publica, campos, assinatura), false);
  const recusa = decidirRecuperacaoAutorizacao(pedido({ assinaturaValida: false }));
  assert.equal(recusa.efeito, "recusar");
  assert.match(recusa.motivo, /posse/);
  assert.equal(fingerprintChavePublicaEd25519(atual.privada), null);
  assert.equal(
    decidirRecuperacaoAutorizacao(pedido({ fingerprintComprovada: null })).efeito,
    "recusar"
  );
});

test("outro computador e outra empresa são recusados", () => {
  const outroComputador = decidirRecuperacaoAutorizacao(
    pedido({ dispositivoAssinado: OUTRO_DISPOSITIVO })
  );
  assert.equal(outroComputador.efeito, "recusar");
  const outraEmpresa = decidirRecuperacaoAutorizacao(
    pedido({
      empresaSessaoId: empresaB,
      dispositivoOutraEmpresa: true,
      terminal: terminal({ empresaId: empresaA }),
    })
  );
  assert.equal(outraEmpresa.efeito, "recusar");
  assert.match(outraEmpresa.motivo, /outra empresa/);
});

test("usuário sem permissão, chave revogada, pendência e reconciliação bloqueiam", () => {
  assert.equal(decidirRecuperacaoAutorizacao(pedido({ administrador: false })).efeito, "recusar");
  assert.equal(decidirRecuperacaoAutorizacao(pedido({ permissaoEditar: false })).efeito, "recusar");
  const revogada = decidirRecuperacaoAutorizacao(pedido({ chaveJaRevogada: true }));
  assert.equal(revogada.efeito, "recusar");
  assert.match(revogada.motivo, /não gera outra chave/);
  assert.match(decidirRecuperacaoAutorizacao(pedido({ pendenciaFinanceira: true })).motivo, /pendente/);
  assert.match(decidirRecuperacaoAutorizacao(pedido({ reconciliacao: true })).motivo, /reconciliação/);
  assert.equal(decidirRecuperacaoAutorizacao(pedido({ terminal: terminal({ revogada: true }) })).efeito, "recusar");
});

test("repetição da mesma chave não exige nova confirmação nem gera chave", () => {
  const decisao = decidirRecuperacaoAutorizacao(
    pedido({
      perdaConfirmada: false,
      chavePublicaComprovada: autorizada.publica,
      fingerprintComprovada: fingerprintChavePublicaEd25519(autorizada.publica),
    })
  );
  assert.equal(decisao.efeito, "ja_autorizada");
  assert.equal(decisao.terminalId, TERMINAL);
  assert.equal(decisao.codigo, "117473");
  assert.equal(decisao.gerarChave, false);
  assert.match(
    decidirRecuperacaoAutorizacao(pedido({ perdaConfirmada: false })).motivo,
    /perdida/
  );
});

test("falha parcial preserva a autorização e só permite repetir a sincronização", () => {
  const parcial = resultadoAposAutorizacao({
    bancoAutorizado: true,
    gravacaoLocalOk: false,
    statusConfere: false,
  });
  assert.equal(parcial.efeito, "autorizada_sem_vinculo");
  assert.equal(parcial.podeRepetirSincronizacao, true);
  assert.equal(parcial.gerarChave, false);
  const concluida = resultadoAposAutorizacao({
    bancoAutorizado: true,
    gravacaoLocalOk: true,
    statusConfere: true,
  });
  assert.equal(concluida.efeito, "concluida");
  assert.equal(concluida.podeRepetirSincronizacao, false);
  assert.equal(
    resultadoAposAutorizacao({
      bancoAutorizado: false,
      gravacaoLocalOk: false,
      statusConfere: false,
    }).podeRepetirSincronizacao,
    false
  );
});

test("recuperação concorrente não substitui uma chave já trocada", () => {
  const bloqueio = {
    chaveRevogada: false,
    chaveEmOutroTerminal: false,
    chaveAnterior: autorizada.publica,
  };
  const estado = { chavePublica: autorizada.publica, pendente: false };
  const primeira = transicaoRecuperacao(estado, atual.publica, bloqueio);
  assert.equal(primeira.efeito, "autorizada");
  assert.equal(primeira.estado.chavePublica, atual.publica);
  const repetida = transicaoRecuperacao(primeira.estado, atual.publica, bloqueio);
  assert.equal(repetida.efeito, "ja_autorizada");
  assert.equal(repetida.estado.chavePublica, atual.publica);
  const terceira = par();
  const concorrente = transicaoRecuperacao(primeira.estado, terceira.publica, bloqueio);
  assert.equal(concorrente.efeito, "recusar");
  assert.equal(concorrente.motivo, "substituida");
  assert.equal(concorrente.estado.chavePublica, atual.publica);
});

test("a interface, a função e a auditoria não geram chave nem guardam segredo", () => {
  const ui = fonte("components/pdv/tef-pareamento-form.tsx");
  const servico = fonte("lib/pdv/tef/servico.ts");
  const sql = fonte("supabase/migrations/20261012140000_tef_recuperar_autorizacao.sql");
  const recuperacao = ui.slice(
    ui.indexOf("async function gravarVinculoLocal"),
    ui.indexOf('if (situacao === "consultando")')
  );
  assert.match(ui, /Recuperar autorização deste computador/);
  assert.match(ui, /perdaConfirmada/);
  assert.match(ui, /administrador/);
  assert.match(recuperacao, /\/tef\/vincular/);
  assert.match(recuperacao, /lerStatusConnector/);
  assert.doesNotMatch(recuperacao, /\/tef\/instalar|\/tef\/inicializar|PWOPER_|rotacionar/);
  const acao = servico.slice(
    servico.indexOf("export async function recuperarAutorizacaoTefSessao"),
    servico.indexOf("export async function verificarComputadorTefSessao")
  );
  assert.match(acao, /verificarProvaTef/);
  assert.match(acao, /ctx\.empresaId/);
  assert.match(acao, /substituirAutorizacaoTerminalTef/);
  assert.doesNotMatch(acao, /input\.empresaId|input\.pontoCaptura|\/tef\/instalar|gerarChaveTef|rotacionar/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /'reconciliacao'/);
  assert.match(sql, /SET chave_publica = p_chave_publica/);
  assert.match(sql, /chave_id = p_chave_id/);
  assert.match(sql, /substituida/);
  assert.doesNotMatch(sql, /SET codigo|SET dispositivo_id|SET ponto_captura|PRIVATE KEY|chave_privada/);
  assert.match(sql, /fingerprint_anterior/);
  assert.doesNotMatch(sql, /INSERT INTO public\.tef_auditoria \([\s\S]*chave_publica/);
});
