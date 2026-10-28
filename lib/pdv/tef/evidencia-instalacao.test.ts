import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { empresaA, empresaB } from "@/lib/multiempresa/cenario";

import { assinarProvaTef, verificarProvaTef } from "./prova";
import {
  assinarEvidenciaInstalacao,
  avaliarEmissaoEvidencia,
  classificacaoSemEvidencia,
  consultarEvidenciaArmazenada,
  mensagemEvidenciaInstalacao,
  prepararRegistroEvidencia,
  type ObservacaoInstalacaoControlada,
} from "./evidencia-instalacao";

const dispositivoA = "33333333-3333-4333-8333-333333333333";
const dispositivoB = "34343434-3434-4343-8343-343434343434";
const terminalA = "44444444-4444-4444-8444-444444444444";
const terminalB = "45454545-4545-4454-8454-454545454545";
const instalacaoA = "55555555-5555-4555-8555-555555555555";
const instalacaoB = "56565656-5656-4565-8565-565656565656";

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function observacao(
  parcial: Partial<ObservacaoInstalacaoControlada> = {}
): ObservacaoInstalacaoControlada {
  return {
    empresaId: empresaA,
    dispositivoId: dispositivoA,
    terminalId: terminalA,
    pontoCaptura: "200001",
    pontoInstalado: "200001",
    estabelecimento: "LOJA",
    ambienteSolicitado: "homologacao",
    instalacaoId: instalacaoA,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
    ...parcial,
  };
}

function consultaDe(
  assinatura: string,
  campos: ObservacaoInstalacaoControlada,
  parcial: Partial<Parameters<typeof consultarEvidenciaArmazenada>[0]> = {}
) {
  const emitida = avaliarEmissaoEvidencia(campos);
  if (!emitida.ok) {
    throw new Error(emitida.motivo);
  }
  return consultarEvidenciaArmazenada({
    evidencia: { campos: emitida.campos, assinatura, revogada: false },
    chavePublicaPem: "",
    empresaSessaoId: emitida.campos.empresaId,
    dispositivoAutorizado: emitida.campos.dispositivoId,
    terminalAutorizadoId: emitida.campos.terminalId,
    pontoTerminal: emitida.campos.pontoCaptura,
    estabelecimentoTerminal: emitida.campos.estabelecimento,
    ambienteDeclarado: emitida.campos.ambiente,
    evento: "nenhum",
    ...parcial,
  });
}

test("instalação simulada em homologação e produção assina a mensagem exclusiva", () => {
  const chave = par();
  const homologacao = assinarEvidenciaInstalacao(chave.privada, observacao());
  const producao = assinarEvidenciaInstalacao(
    chave.privada,
    observacao({
      ambienteSolicitado: "producao",
      instalacaoId: instalacaoB,
      pontoCaptura: "300002",
      pontoInstalado: "300002",
    })
  );
  assert.ok(homologacao);
  assert.ok(producao);
  assert.equal(homologacao.campos.ambiente, "homologacao");
  assert.equal(producao.campos.ambiente, "producao");
  assert.notEqual(mensagemEvidenciaInstalacao(homologacao.campos), mensagemEvidenciaInstalacao(producao.campos));
  assert.equal(mensagemEvidenciaInstalacao(homologacao.campos).split("\n")[0], "ultrapdv-tef-instalacao-v1");
  assert.equal(mensagemEvidenciaInstalacao(homologacao.campos).startsWith("ultrapdv-tef-v1\n"), false);

  const conferida = consultaDe(homologacao.assinatura, observacao(), { chavePublicaPem: chave.publica });
  const conferidaProducao = consultaDe(
    producao.assinatura,
    observacao({
      ambienteSolicitado: "producao",
      instalacaoId: instalacaoB,
      pontoCaptura: "300002",
      pontoInstalado: "300002",
    }),
    { chavePublicaPem: chave.publica }
  );
  assert.equal(conferida.situacao, "comprovado");
  assert.equal(conferida.ambienteEfetivo, "homologacao");
  assert.equal(conferida.origem, "instalacao_controlada");
  assert.equal(conferidaProducao.situacao, "comprovado");
  assert.equal(conferidaProducao.ambienteEfetivo, "producao");
  assert.match(conferida.motivo, /instalação controlada/);
});

test("assinatura inválida, prova de pagamento e identidade não viram evidência", () => {
  const chave = par();
  const outra = par();
  const emitida = assinarEvidenciaInstalacao(chave.privada, observacao());
  assert.ok(emitida);
  const invalida = consultaDe(`${emitida.assinatura.slice(0, -2)}aa`, observacao(), {
    chavePublicaPem: chave.publica,
  });
  const outraChave = consultaDe(emitida.assinatura, observacao(), { chavePublicaPem: outra.publica });
  assert.equal(invalida.situacao, "declarado");
  assert.equal(invalida.ambienteEfetivo, null);
  assert.equal(invalida.deveRevogar, true);
  assert.equal(outraChave.deveRevogar, true);

  const identidade = assinarProvaTef(chave.privada, {
    acao: "identidade",
    desafio: "",
    identificador: dispositivoA,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
  const pagamento = assinarProvaTef(chave.privada, {
    acao: "pagamento",
    desafio: "a".repeat(64),
    identificador: instalacaoA,
    valorCentavos: 100,
    nsu: "1",
    autorizacao: "2",
    rede: "CIELO",
    finalizacao: "3",
    sucesso: true,
    codigo: "",
  });
  assert.equal(
    consultaDe(identidade, observacao(), { chavePublicaPem: chave.publica }).situacao,
    "declarado"
  );
  assert.equal(
    consultaDe(pagamento, observacao(), { chavePublicaPem: chave.publica }).ambienteEfetivo,
    null
  );
  assert.equal(
    verificarProvaTef(
      chave.publica,
      {
        acao: "pagamento",
        desafio: "a".repeat(64),
        identificador: instalacaoA,
        valorCentavos: 100,
        nsu: "1",
        autorizacao: "2",
        rede: "CIELO",
        finalizacao: "3",
        sucesso: true,
        codigo: "",
      },
      emitida.assinatura
    ),
    false
  );
});

test("replay, divergência de ponto e vínculo cruzado são recusados", () => {
  const chave = par();
  const emitida = assinarEvidenciaInstalacao(chave.privada, observacao());
  assert.ok(emitida);
  const contexto = {
    campos: emitida.campos,
    assinatura: emitida.assinatura,
    chavePublicaPem: chave.publica,
    empresaSessaoId: empresaA,
    dispositivoAutorizado: dispositivoA,
    terminalAutorizadoId: terminalA,
    pontoAutorizado: "200001",
    estabelecimentoAutorizado: "LOJA",
    instalacaoJaRegistrada: false,
    evidenciaAtivaNoDispositivo: false,
  };
  const primeiro = prepararRegistroEvidencia(contexto);
  const replay = prepararRegistroEvidencia({ ...contexto, instalacaoJaRegistrada: true });
  assert.equal(primeiro.ok, true);
  if (primeiro.ok) {
    assert.equal(primeiro.registro.origem, "instalacao_controlada");
    assert.equal(primeiro.registro.empresa_id, empresaA);
    assert.equal("senha" in primeiro.registro, false);
    assert.equal(primeiro.revogarAtiva, false);
  }
  assert.equal(replay.ok, false);
  if (!replay.ok) {
    assert.match(replay.motivo, /já foi registrada/);
  }

  const substituicao = prepararRegistroEvidencia({
    ...contexto,
    evidenciaAtivaNoDispositivo: true,
  });
  assert.equal(substituicao.ok, true);
  if (substituicao.ok) {
    assert.equal(substituicao.revogarAtiva, true);
  }

  const ponto = consultaDe(emitida.assinatura, observacao(), {
    chavePublicaPem: chave.publica,
    pontoTerminal: "117473",
  });
  assert.equal(ponto.situacao, "declarado");
  assert.equal(ponto.deveRevogar, true);
  assert.match(ponto.motivo, /ponto de captura mudou/);

  const cruzado = consultaDe(emitida.assinatura, observacao(), {
    chavePublicaPem: chave.publica,
    empresaSessaoId: empresaB,
  });
  assert.equal(cruzado.ambienteEfetivo, null);
  assert.match(cruzado.motivo, /outra empresa/);

  const outroComputador = consultaDe(emitida.assinatura, observacao(), {
    chavePublicaPem: chave.publica,
    dispositivoAutorizado: dispositivoB,
  });
  assert.match(outroComputador.motivo, /outro computador/);

  const outroTerminal = consultaDe(emitida.assinatura, observacao(), {
    chavePublicaPem: chave.publica,
    terminalAutorizadoId: terminalB,
  });
  assert.match(outroTerminal.motivo, /terminal autorizado/);
});

test("falha na instalação não produz evidência", () => {
  const chave = par();
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ pontoNaoExistia: false })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ retornoSetEnvironment: 11 })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ instalacaoConcluida: false })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ vinculoAutorizado: false })), null);
  assert.equal(
    assinarEvidenciaInstalacao(chave.privada, observacao({ pontoInstalado: "999999" })),
    null
  );
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ ambienteSolicitado: "producao", pontoNaoExistia: false })), null);
  const semPonto = avaliarEmissaoEvidencia(observacao({ pontoNaoExistia: false }));
  assert.equal(semPonto.ok, false);
});

test("reset, reinstalação e revogação invalidam a evidência antiga", () => {
  const chave = par();
  const emitida = assinarEvidenciaInstalacao(chave.privada, observacao({ ambienteSolicitado: "producao" }));
  assert.ok(emitida);
  const base = { chavePublicaPem: chave.publica };
  const reset = consultaDe(emitida.assinatura, observacao({ ambienteSolicitado: "producao" }), {
    ...base,
    evento: "reset",
  });
  const reinstalacao = consultaDe(emitida.assinatura, observacao({ ambienteSolicitado: "producao" }), {
    ...base,
    evento: "reinstalacao",
  });
  const revogada = consultarEvidenciaArmazenada({
    evidencia: { campos: emitida.campos, assinatura: emitida.assinatura, revogada: true },
    chavePublicaPem: chave.publica,
    empresaSessaoId: empresaA,
    dispositivoAutorizado: dispositivoA,
    terminalAutorizadoId: terminalA,
    pontoTerminal: "200001",
    estabelecimentoTerminal: "LOJA",
    ambienteDeclarado: "producao",
    evento: "nenhum",
  });
  assert.equal(reset.deveRevogar, true);
  assert.equal(reset.ambienteEfetivo, null);
  assert.equal(reinstalacao.deveRevogar, true);
  assert.equal(reinstalacao.situacao, "declarado");
  assert.equal(revogada.deveRevogar, false);
  assert.equal(revogada.situacao, "declarado");
  assert.match(revogada.motivo, /revogada/);
  assert.equal(classificacaoSemEvidencia("").situacao, "desconhecido");
  assert.equal(classificacaoSemEvidencia("homologacao").origem, "declarada");
  assert.equal(classificacaoSemEvidencia("homologacao").ambienteEfetivo, null);
});

test("homologação e produção conferem o ponto do próprio ambiente", () => {
  const chaveHomologacao = par();
  const chaveProducao = par();
  const mesmoPonto = "200001";
  const homologacao = assinarEvidenciaInstalacao(chaveHomologacao.privada, observacao({ pontoCaptura: mesmoPonto, pontoInstalado: mesmoPonto }));
  const producao = assinarEvidenciaInstalacao(
    chaveProducao.privada,
    observacao({ ambienteSolicitado: "producao", pontoCaptura: mesmoPonto, pontoInstalado: mesmoPonto, instalacaoId: instalacaoB })
  );
  assert.ok(homologacao);
  assert.ok(producao);
  const mesmaHomologacao = consultaDe(homologacao.assinatura, observacao({ pontoCaptura: mesmoPonto, pontoInstalado: mesmoPonto }), {
    chavePublicaPem: chaveHomologacao.publica,
    pontoTerminal: mesmoPonto,
    pontoHomologacao: mesmoPonto,
  });
  const mesmaProducao = consultaDe(
    producao.assinatura,
    observacao({ ambienteSolicitado: "producao", pontoCaptura: mesmoPonto, pontoInstalado: mesmoPonto, instalacaoId: instalacaoB }),
    {
      chavePublicaPem: chaveProducao.publica,
      pontoTerminal: mesmoPonto,
      pontoHomologacao: mesmoPonto,
    }
  );
  assert.equal(mesmaHomologacao.situacao, "comprovado");
  assert.equal(mesmaHomologacao.deveRevogar, false);
  assert.equal(mesmaProducao.situacao, "comprovado");
  assert.equal(mesmaProducao.deveRevogar, false);

  const distinta = assinarEvidenciaInstalacao(
    chaveHomologacao.privada,
    observacao({ pontoCaptura: "300001", pontoInstalado: "300001" })
  );
  assert.ok(distinta);
  const pontosDistintos = consultaDe(distinta.assinatura, observacao({ pontoCaptura: "300001", pontoInstalado: "300001" }), {
    chavePublicaPem: chaveHomologacao.publica,
    pontoTerminal: "117473",
    pontoHomologacao: "300001",
  });
  assert.equal(pontosDistintos.situacao, "comprovado");
  assert.equal(pontosDistintos.deveRevogar, false);

  const divergeProducao = consultaDe(distinta.assinatura, observacao({ pontoCaptura: "300001", pontoInstalado: "300001" }), {
    chavePublicaPem: chaveHomologacao.publica,
    pontoTerminal: "300001",
    pontoHomologacao: "400001",
  });
  assert.equal(divergeProducao.deveRevogar, true);
  assert.match(divergeProducao.motivo, /ponto de homologação/);

  const semPar = consultaDe(homologacao.assinatura, observacao(), { chavePublicaPem: "", pontoHomologacao: "200001" });
  assert.equal(semPar.situacao, "declarado");
  assert.equal(semPar.deveRevogar, false);
  assert.match(semPar.motivo, /não está vinculada/);

  const assinaturaInvalida = consultaDe(homologacao.assinatura.replace(/^./, homologacao.assinatura.startsWith("A") ? "B" : "A"), observacao(), {
    chavePublicaPem: chaveHomologacao.publica,
    pontoHomologacao: "200001",
  });
  assert.equal(assinaturaInvalida.situacao, "declarado");
  assert.match(assinaturaInvalida.motivo, /chave/);

  const outraEmpresa = consultaDe(homologacao.assinatura, observacao(), {
    chavePublicaPem: chaveHomologacao.publica,
    empresaSessaoId: empresaB,
    pontoHomologacao: "200001",
  });
  assert.match(outraEmpresa.motivo, /outra empresa/);
  const outroTerminal = consultaDe(homologacao.assinatura, observacao(), {
    chavePublicaPem: chaveHomologacao.publica,
    terminalAutorizadoId: terminalB,
    pontoHomologacao: "200001",
  });
  assert.match(outroTerminal.motivo, /terminal autorizado/);
});

test("migration da evidência isola por empresa e não guarda segredo", () => {
  const sql = fonte("supabase/migrations/20261011180000_tef_evidencia_instalacao.sql");
  assert.match(sql, /Não aplicar automaticamente/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /UNIQUE \(instalacao_id\)/);
  assert.match(sql, /ux_tef_evidencias_instalacao_dispositivo_ativo/);
  assert.match(sql, /GRANT SELECT ON public\.tef_evidencias_instalacao TO authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.tef_evidencias_instalacao TO service_role/);
  assert.doesNotMatch(sql, /GRANT INSERT ON public\.tef_evidencias_instalacao TO authenticated/);
  assert.doesNotMatch(sql, /password|senha_paygo|coluna senha/i);
  assert.match(sql, /origem = 'instalacao_controlada'/);
});
