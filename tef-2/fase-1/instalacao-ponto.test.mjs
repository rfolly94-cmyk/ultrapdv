import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PWRET } from "./contrato.mjs";
import {
  classificarDiagnosticoPinPad,
  DESCRICAO_NOTINST,
  executarInstalacaoPonto,
  prepararInstalacaoPonto,
} from "./instalacao-ponto.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const header = readFileSync(
  path.resolve(aqui, "../../20260923-Integracao-PGWebLib_v4.1.50.924/PGWebLib.h"),
  "utf8",
);

test("o retorno -2498 e PWRET_NOTINST e a instalacao permanece bloqueada", () => {
  const enumero = header.slice(header.indexOf("PWRET_INVPARAM = -2499"), header.indexOf("PWRET_MOREDATA"));
  assert.match(enumero, /PWRET_NOTINST/);
  assert.equal(PWRET.NOTINST, -2498);
  assert.equal(DESCRICAO_NOTINST, "É necessário efetuar uma transação de Instalação.");

  const estado = classificarDiagnosticoPinPad({
    init: 0,
    commTest: 0,
    porta: 7,
    evento: -2498,
  });
  assert.equal(estado.comunicacaoFisica, "estabelecida");
  assert.equal(estado.pontoCaptura, "nao-instalado");
  assert.equal(estado.pagamento, "indisponivel");
  assert.equal(estado.retornoNome, "PWRET_NOTINST");
  assert.equal(estado.retornoDescricao, DESCRICAO_NOTINST);

  const plano = prepararInstalacaoPonto();
  assert.equal(plano.executar, false);
  assert.equal(plano.operacao, 0x01);
  assert.equal(plano.operacaoNome, "PWOPER_INSTALL");
  assert.equal(plano.alternativa, 0x20);
  assert.equal(plano.vendaBloqueada, 0x21);
  assert.equal(plano.copiaPerfilProducao, false);
  assert.equal(plano.credencialProducao, false);
  assert.equal(plano.senhaTecnicaArmazenada, false);
  assert.equal(plano.abiComprovado, false);
  assert.equal(plano.layoutHomologado, false);
  assert.equal(executarInstalacaoPonto().executado, false);

  const fonte = readFileSync(path.join(aqui, "instalacao-ponto.mjs"), "utf8");
  assert.equal(fonte.includes("314159"), false);
  assert.equal(fonte.includes("ProgramData"), false);
  assert.equal(fonte.includes("PW_iNewTransac("), false);
  assert.equal(fonte.includes("PW_iExecTransac("), false);
  const agente = readFileSync(path.resolve(aqui, "../agente/PgWebLib.pas"), "utf8");
  assert.match(agente, /ABI_COMPROVADO = False/);
  assert.match(agente, /LAYOUT_HOMOLOGADO = False/);
});
