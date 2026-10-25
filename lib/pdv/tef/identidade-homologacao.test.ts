import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { aceitarVinculoIdentidadeHomologacao } from "./identidade-homologacao";
import { assinarProvaTef, hashSegredoVinculo } from "./prova";

const empresa = "11111111-1111-4111-8111-111111111111";
const dispositivo = "33333333-3333-4333-8333-333333333333";
const terminal = "44444444-4444-4444-8444-444444444444";
const outroTerminal = "45454545-4545-4454-8454-454545454545";
const chaveId = "55555555-5555-4555-8555-555555555555";

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

test("chave local só vincula depois da assinatura do Connector de homologação", () => {
  const chave = par();
  const codigo = "ABC2345678";
  const assinatura = assinarProvaTef(chave.privada, {
    acao: "pareamento",
    desafio: hashSegredoVinculo(codigo),
    identificador: dispositivo,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
  const aceita = aceitarVinculoIdentidadeHomologacao({
    empresaSessaoId: empresa,
    dispositivoInformado: dispositivo,
    terminalInformadoId: terminal,
    dispositivoAutorizado: dispositivo,
    terminalAutorizadoId: terminal,
    chavePublica: chave.publica,
    chaveId,
    codigo,
    assinaturaPareamento: assinatura,
  });
  assert.equal(aceita.ok, true);
  if (aceita.ok) {
    assert.equal(aceita.registro.empresa_id, empresa);
    assert.equal(aceita.registro.dispositivo_id, dispositivo);
    assert.equal(aceita.registro.terminal_id, terminal);
    assert.equal("privada" in aceita.registro, false);
    assert.equal(JSON.stringify(aceita.registro).includes("BEGIN PRIVATE"), false);
  }
  const solta = aceitarVinculoIdentidadeHomologacao({
    empresaSessaoId: empresa,
    dispositivoInformado: dispositivo,
    terminalInformadoId: terminal,
    dispositivoAutorizado: dispositivo,
    terminalAutorizadoId: terminal,
    chavePublica: chave.publica,
    chaveId,
    codigo,
    assinaturaPareamento: "",
  });
  assert.equal(solta.ok, false);
  const invalida = aceitarVinculoIdentidadeHomologacao({
    empresaSessaoId: empresa,
    dispositivoInformado: dispositivo,
    terminalInformadoId: terminal,
    dispositivoAutorizado: dispositivo,
    terminalAutorizadoId: terminal,
    chavePublica: chave.publica,
    chaveId,
    codigo,
    assinaturaPareamento: assinatura.replace(/^./, assinatura.startsWith("A") ? "B" : "A"),
  });
  assert.equal(invalida.ok, false);
  const outro = aceitarVinculoIdentidadeHomologacao({
    empresaSessaoId: empresa,
    dispositivoInformado: dispositivo,
    terminalInformadoId: outroTerminal,
    dispositivoAutorizado: dispositivo,
    terminalAutorizadoId: terminal,
    chavePublica: chave.publica,
    chaveId,
    codigo,
    assinaturaPareamento: assinatura,
  });
  assert.equal(outro.ok, false);
  if (!outro.ok) assert.match(outro.motivo, /terminal autorizado/);

  const sql = readFileSync(
    fileURLToPath(new URL("../../../supabase/migrations/20261017200000_tef_identidade_homologacao.sql", import.meta.url)),
    "utf8"
  );
  assert.match(sql, /Não aplicar automaticamente/);
  assert.match(sql, /chave_publica/);
  assert.doesNotMatch(sql, /chave_privada/);
  assert.doesNotMatch(sql, /GRANT INSERT ON public\.tef_identidades_homologacao TO authenticated/);
});
