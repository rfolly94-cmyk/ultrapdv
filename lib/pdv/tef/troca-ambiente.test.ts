import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decidirTrocaAmbiente, origemLocalDoConector } from "./troca-ambiente";

test("a troca de ambiente da empresa é bloqueada com pendência e liberada quando os dois lados estão ociosos", () => {
  assert.equal(decidirTrocaAmbiente({
    ambienteAtual: "producao",
    ambienteNovo: "homologacao",
    statuses: [],
    motorOcupado: false,
    consultaOk: true,
  }).pode, true);
  assert.equal(decidirTrocaAmbiente({
    ambienteAtual: "homologacao",
    ambienteNovo: "producao",
    statuses: ["aguardando_confirmacao"],
    motorOcupado: false,
    consultaOk: true,
  }).pode, false);
  assert.equal(decidirTrocaAmbiente({
    ambienteAtual: "producao",
    ambienteNovo: "homologacao",
    statuses: ["resultado_desconhecido"],
    motorOcupado: false,
    consultaOk: true,
  }).pode, false);
  assert.equal(decidirTrocaAmbiente({
    ambienteAtual: "homologacao",
    ambienteNovo: "producao",
    statuses: [],
    motorOcupado: true,
    consultaOk: true,
  }).pode, false);
  assert.equal(decidirTrocaAmbiente({
    ambienteAtual: "producao",
    ambienteNovo: "producao",
    statuses: ["executando"],
    motorOcupado: true,
    consultaOk: false,
  }).pode, true);
  assert.match(decidirTrocaAmbiente({
    ambienteAtual: "producao",
    ambienteNovo: "homologacao",
    statuses: [],
    motorOcupado: false,
    consultaOk: false,
  }).motivo, /nenhum journal foi modificado/);
});

test("o conector aceito fica na faixa local e a gravação não reescreve credenciais", () => {
  assert.equal(origemLocalDoConector("http://127.0.0.1:18181"), "http://127.0.0.1:18181");
  assert.equal(origemLocalDoConector("http://127.0.0.1:18281"), null);
  assert.equal(origemLocalDoConector("http://10.0.0.8:18181"), null);
  const servidor = readFileSync(new URL("./politica-empresa-servidor.ts", import.meta.url), "utf8");
  const gravacao = servidor.slice(servidor.indexOf("export async function salvarConfiguracaoMotor"));
  const upsert = gravacao.slice(gravacao.indexOf(".upsert("), gravacao.indexOf("onConflict"));
  assert.match(upsert, /habilitado/);
  assert.match(upsert, /ambiente/);
  assert.doesNotMatch(upsert, /producao_autorizada|credenciamento|servidor_comercial|ponto/);
  assert.match(servidor, /sessao\.empresaId/);
});
