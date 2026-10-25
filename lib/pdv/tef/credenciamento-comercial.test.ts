import assert from "node:assert/strict";
import test from "node:test";

import { fonte } from "../../multiempresa/fonte";
import {
  ACAO_REGISTRAR_COMPROVACAO,
  decidirRegistroComprovacao,
  validarIdentificacaoCredenciamento,
} from "./credenciamento-comercial";
import { decidirInstalacaoProducao, producaoLiberada, type SinaisTefEmpresa } from "./politica-empresa";

const sinais = (parcial: Partial<SinaisTefEmpresa> = {}): SinaisTefEmpresa => ({
  conectorRespondeu: true,
  pontoInstalado: true,
  pontoProducaoInstalado: false,
  pendenciaFinanceira: false,
  pinpadAprovado: false,
  credenciamentoProducao: false,
  servidorComercialValidado: false,
  ...parcial,
});

test("preencher a referência não comprova o credenciamento", () => {
  const identificacao = validarIdentificacaoCredenciamento("PG-2026-014");
  assert.equal(identificacao.ok, true);
  if (!identificacao.ok) return;
  assert.equal(identificacao.comprovado, false);
  assert.equal(identificacao.provedor, "PayGo");
  assert.equal(identificacao.situacao, "informado");

  const semAcao = decidirRegistroComprovacao({
    administrador: true,
    acao: "salvar",
    referencia: "PG-2026-014",
  });
  assert.equal(semAcao.ok, false);
  assert.equal(semAcao.comprovado, false);
});

test("somente o administrador registra a comprovação da empresa", () => {
  const negado = decidirRegistroComprovacao({
    administrador: false,
    acao: ACAO_REGISTRAR_COMPROVACAO,
    referencia: "PG-2026-014",
  });
  assert.equal(negado.ok, false);

  const vazio = decidirRegistroComprovacao({
    administrador: true,
    acao: ACAO_REGISTRAR_COMPROVACAO,
    referencia: " ",
  });
  assert.equal(vazio.ok, false);

  const segredo = decidirRegistroComprovacao({
    administrador: true,
    acao: ACAO_REGISTRAR_COMPROVACAO,
    referencia: "senha-tecnica",
  });
  assert.equal(segredo.ok, false);

  const comprovado = decidirRegistroComprovacao({
    administrador: true,
    acao: ACAO_REGISTRAR_COMPROVACAO,
    referencia: "PG-2026-014",
  });
  assert.equal(comprovado.ok, true);
  if (!comprovado.ok) return;
  assert.equal(comprovado.comprovado, true);
  assert.equal(comprovado.situacao, "comprovado");
});

test("comprovação habilita a instalação e mantém a cobrança bloqueada", () => {
  assert.equal(
    decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: true, pendenciaFinanceira: false, servidorComercialValidado: false }).pode,
    false
  );
  assert.equal(
    decidirInstalacaoProducao({ administrador: true, credenciamentoProducao: true, pendenciaFinanceira: false, servidorComercialValidado: true }).pode,
    true
  );
  assert.equal(
    producaoLiberada(sinais({ credenciamentoProducao: true }), true),
    false
  );
  const servidor = fonte("lib/pdv/tef/politica-empresa-servidor.ts");
  assert.match(servidor, /comprovacao_registrada/);
  assert.match(servidor, /sessao\.empresaId/);
  assert.doesNotMatch(servidor, /producao_autorizada:\s*true/);
  assert.match(fonte("lib/pdv/tef/motor.ts"), /ABI_COMPROVADO = false/);
});
