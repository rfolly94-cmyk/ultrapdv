import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";

import { salvarConfigLocal } from "./config-local.mjs";
import {
  CODIGO_SAIDA_REINICIO,
  confirmarDisponibilidade,
  montarDiagnosticoConector,
  planejarAlteracaoPorta,
  planejarEncerramento,
  planejarReinicio,
  planejarRollbackPorta,
  resolverPerfilTef,
} from "./conector-ciclo.mjs";

test("gravação da configuração preserva o vínculo e é atômica", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-config-"));
  const env = { ULTRAPDV_CONFIG_DIR: pasta, PROGRAMDATA: "", LOCALAPPDATA: "", ALLUSERSPROFILE: "" };
  const salva = await salvarConfigLocal(
    { lastPrinter: "ELGIN i9", preferredPort: 18182 },
    { env }
  );
  assert.equal(salva.lastPrinter, "ELGIN i9");
  assert.equal(salva.preferredPort, 18182);
  const bruto = JSON.parse(await readFile(path.join(pasta, "print-agent.json"), "utf8"));
  bruto.dispositivoPreservado = "mantido";
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(pasta, "print-agent.json"), JSON.stringify(bruto));
  await salvarConfigLocal({ lastPaper: "58mm" }, { env });
  const depois = JSON.parse(await readFile(path.join(pasta, "print-agent.json"), "utf8"));
  assert.equal(depois.dispositivoPreservado, "mantido");
  assert.equal(depois.lastPaper, "58mm");
  assert.equal(depois.lastPrinter, "ELGIN i9");
});

test("porta ocupada, faixa inválida e transação pendente recusam a troca", () => {
  const bloqueio = { permitido: false, motivo: "transacao" };
  const pendente = planejarAlteracaoPorta({ porta: 18182, portaAtual: 18181, bloqueio });
  assert.equal(pendente.ok, false);
  assert.equal(pendente.status, 409);
  assert.equal(pendente.preservarDispositivo, true);
  const faixa = planejarAlteracaoPorta({ porta: 19000, portaAtual: 18181 });
  assert.equal(faixa.codigo, "faixa");
  const ocupada = planejarAlteracaoPorta({ porta: 18183, portaAtual: 18181, ocupada: true });
  assert.equal(ocupada.codigo, "ocupada");
  const livre = planejarAlteracaoPorta({ porta: 18184, portaAtual: 18181, ocupada: false });
  assert.equal(livre.ok, true);
  assert.deepEqual(livre.patch, { preferredPort: 18184, activePort: 18184 });
  assert.equal(livre.patch.dispositivoId, undefined);
});

test("falha na escuta devolve a porta anterior", () => {
  const rollback = planejarRollbackPorta({ preferredPort: 18181, activePort: 18181 });
  assert.equal(rollback.activePort, 18181);
  assert.equal(rollback.motivo, "escuta_falhou");
  assert.equal(rollback.preservarDispositivo, true);
});

test("reinício só é confirmado depois da saúde e para em transação pendente", () => {
  const bloqueado = planejarReinicio({ permitido: false, motivo: "desconhecido" });
  assert.equal(bloqueado.ok, false);
  assert.equal(bloqueado.concluido, false);
  assert.equal(bloqueado.preservarJournal, true);
  const plano = planejarReinicio({ permitido: true }, { supervisor: true });
  assert.equal(plano.ok, true);
  assert.equal(plano.concluido, false);
  assert.equal(plano.status, "reiniciando");
  assert.equal(plano.codigoSaida, CODIGO_SAIDA_REINICIO);
  assert.equal(confirmarDisponibilidade({ ok: true, port: 18181 }, { portaEsperada: 18181 }).mensagem, "Reiniciado com sucesso");
  assert.equal(confirmarDisponibilidade(null, { portaEsperada: 18181, prazoEsgotado: true }).status, "falha");
  assert.equal(confirmarDisponibilidade(null, { portaEsperada: 18181 }).status, "aguardando");
});

test("sair do aplicativo recusa transação e fechar a janela não encerra o processo", () => {
  const janela = planejarEncerramento("janela", { permitido: true });
  assert.equal(janela.encerraProcesso, false);
  const bandeja = planejarEncerramento("bandeja", { permitido: true });
  assert.equal(bandeja.encerraProcesso, false);
  const bloqueado = planejarEncerramento("aplicativo", { permitido: false, motivo: "transacao" });
  assert.equal(bloqueado.encerraProcesso, false);
  assert.equal(bloqueado.status, 409);
  const sair = planejarEncerramento("aplicativo", { permitido: true });
  assert.equal(sair.encerraProcesso, true);
  assert.equal(sair.concluido, false);
});

test("homologação e produção não compartilham ponto nem diretório", () => {
  const homologacao = resolverPerfilTef("homologacao");
  const producao = resolverPerfilTef("producao");
  assert.equal(homologacao.ponto, "ponto_homologacao");
  assert.equal(producao.ponto, "ponto_captura");
  assert.equal(homologacao.credencial, "sandbox");
  assert.equal(producao.credencial, "comercial");
  assert.notDeepEqual(homologacao.diretorio, producao.diretorio);
  assert.equal(resolverPerfilTef("outro").ambiente, "");
});

test("diagnóstico separa as versões e oculta segredo", () => {
  const diag = montarDiagnosticoConector({
    nome: "UltraPDV Connector",
    versao: "1.3.19",
    dll: { versao: "4.1.50.924", arquitetura: "x64", ok: true },
    ambiente: "homologacao",
    porta: 18181,
    bibliotecaInicializada: true,
    ultimaFalha: "senhaTecnica=segredo-lab documento 12345678901234",
  });
  assert.equal(diag.conector.versao, "1.3.19");
  assert.equal(diag.tef.modulo, "PGWebLib.dll");
  assert.notEqual(diag.conector.versao, diag.tef.versao);
  assert.equal(diag.pgweb.versao, "4.1.50.924");
  assert.equal(diag.pgweb.estado, "validada");
  assert.equal(diag.biblioteca, "inicializada");
  assert.equal(diag.ambiente, "homologacao");
  assert.equal(diag.ultimaFalha.includes("segredo-lab"), false);
  assert.equal(diag.ultimaFalha.includes("12345678901234"), false);
});

test("o supervisor só relança o processo no código de reinício", () => {
  const script = readFileSync(new URL("../launcher/supervisor.ps1", import.meta.url), "utf8");
  assert.match(script, /ExitCode -ne 75/);
  assert.match(script, /ULTRAPDV_SUPERVISOR = "1"/);
  assert.match(script, /ULTRAPDV_INSTALL_DIR = \$Diretorio/);
  assert.doesNotMatch(script, /taskkill/i);
  assert.doesNotMatch(script, /18182/);
});
