import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_FISCAL_OUTRA_EMPRESA_EMISSAO,
  MENSAGEM_FUSO_NAO_CONFIGURADO,
  MENSAGEM_FUSO_OUTRA_EMPRESA,
  carregarFusoHorarioFiscal,
  checkFusoHorarioProntidao,
  checkNaturezaProntidao,
  exigirFusoHorarioFiscalDaEmissao,
  fusoHorarioParaGravacao,
  montarUpdateFusoHorarioDaEmpresaAtiva,
  normalizarFusoHorarioFiscal,
} from "./fuso-horario-empresa";

type FiscalMemoria = {
  empresa_id: string;
  fuso_horario: string | null;
};

function storeVazio() {
  return new Map<string, FiscalMemoria>();
}

function novaEmpresa(
  store: Map<string, FiscalMemoria>,
  empresaId: string
) {
  store.set(empresaId, {
    empresa_id: empresaId,
    fuso_horario: null,
  });
}

function carregar(
  store: Map<string, FiscalMemoria>,
  empresaIdAtiva: string
) {
  return carregarFusoHorarioFiscal(
    store.get(empresaIdAtiva) ?? null,
    empresaIdAtiva
  );
}

function gravar(
  store: Map<string, FiscalMemoria>,
  args: {
    empresaIdAtiva: string;
    empresaIdSolicitada?: string;
    fusoHorario: string | null;
  }
) {
  const update = montarUpdateFusoHorarioDaEmpresaAtiva(args);
  const atual = store.get(update.empresaId);

  if (!atual || atual.empresa_id !== update.empresaId) {
    throw new Error("Configuração fiscal não encontrada.");
  }

  store.set(update.empresaId, {
    empresa_id: update.empresaId,
    fuso_horario: update.fuso_horario,
  });
}

function emitir(
  store: Map<string, FiscalMemoria>,
  empresaIdDaEmissao: string,
  fusoDoFrontend?: string
) {
  void fusoDoFrontend;
  return exigirFusoHorarioFiscalDaEmissao({
    empresaIdDaEmissao,
    fiscal: store.get(empresaIdDaEmissao) ?? null,
  });
}

test("nova empresa nasce com fuso NULL e não herda a anterior", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });

  novaEmpresa(store, empresaB);

  assert.equal(carregar(store, empresaA), "America/Cuiaba");
  assert.equal(carregar(store, empresaB), null);
});

test("A lê Cuiaba e B lê Sao_Paulo", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });
  gravar(store, {
    empresaIdAtiva: empresaB,
    fusoHorario: "America/Sao_Paulo",
  });

  assert.equal(carregar(store, empresaA), "America/Cuiaba");
  assert.equal(carregar(store, empresaB), "America/Sao_Paulo");
});

test("A altera para Manaus e B continua Sao_Paulo", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });
  gravar(store, {
    empresaIdAtiva: empresaB,
    fusoHorario: "America/Sao_Paulo",
  });
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Manaus",
  });

  assert.equal(carregar(store, empresaA), "America/Manaus");
  assert.equal(carregar(store, empresaB), "America/Sao_Paulo");
});

test("admin A tentando gravar B é rejeitado", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });
  gravar(store, {
    empresaIdAtiva: empresaB,
    fusoHorario: "America/Sao_Paulo",
  });

  assert.throws(
    () =>
      gravar(store, {
        empresaIdAtiva: empresaA,
        empresaIdSolicitada: empresaB,
        fusoHorario: "America/Manaus",
      }),
    { message: MENSAGEM_FUSO_OUTRA_EMPRESA }
  );

  assert.equal(carregar(store, empresaA), "America/Cuiaba");
  assert.equal(carregar(store, empresaB), "America/Sao_Paulo");
});

test("prontidão A usa A e prontidão B usa B", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });

  const prontidaoA = checkFusoHorarioProntidao(
    store.get(empresaA),
    empresaA
  );
  const prontidaoB = checkFusoHorarioProntidao(
    store.get(empresaB),
    empresaB
  );
  const prontidaoAComFiscalB = checkFusoHorarioProntidao(
    store.get(empresaB),
    empresaA
  );

  assert.equal(prontidaoA.ok, true);
  assert.equal(prontidaoA.detalhe, "Fuso: America/Cuiaba");
  assert.equal(prontidaoB.ok, false);
  assert.equal(prontidaoB.detalhe, MENSAGEM_FUSO_NAO_CONFIGURADO);
  assert.equal(prontidaoAComFiscalB.ok, false);
});

test("emissão A usa A e emissão B usa B; fuso do frontend é ignorado", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });
  gravar(store, {
    empresaIdAtiva: empresaB,
    fusoHorario: "America/Sao_Paulo",
  });

  assert.equal(
    emitir(store, empresaA, "America/Manaus"),
    "America/Cuiaba"
  );
  assert.equal(
    emitir(store, empresaB, "America/Cuiaba"),
    "America/Sao_Paulo"
  );
});

test("emissão recusa fiscal de outra empresa", () => {
  const store = storeVazio();
  novaEmpresa(store, empresaA);
  novaEmpresa(store, empresaB);
  gravar(store, {
    empresaIdAtiva: empresaA,
    fusoHorario: "America/Cuiaba",
  });

  assert.throws(
    () =>
      exigirFusoHorarioFiscalDaEmissao({
        empresaIdDaEmissao: empresaB,
        fiscal: store.get(empresaA) ?? null,
      }),
    { message: MENSAGEM_FISCAL_OUTRA_EMPRESA_EMISSAO }
  );
});

test("natureza e fuso são checks independentes", () => {
  const naturezaA = {
    empresa_id: empresaA,
    descricao: "Venda",
    tp_nf: "1",
    fin_nfe: "1",
  };

  const natureza = checkNaturezaProntidao(naturezaA, empresaA);
  const fuso = checkFusoHorarioProntidao(
    { empresa_id: empresaA, fuso_horario: null },
    empresaA
  );

  assert.equal(natureza.ok, true);
  assert.equal(fuso.ok, false);
  assert.equal(natureza.codigo, "natureza");
  assert.equal(fuso.codigo, "fuso");
});

test("offset -03:00/-04:00 não é fuso válido", () => {
  assert.equal(normalizarFusoHorarioFiscal("-03:00"), null);
  assert.equal(normalizarFusoHorarioFiscal("-04:00"), null);
  assert.throws(
    () => fusoHorarioParaGravacao("-03:00"),
    { message: "Fuso horário fiscal inválido." }
  );
});

test("500 empresas não compartilham fuso", () => {
  const store = storeVazio();

  for (let i = 0; i < 500; i += 1) {
    const id = `emp-${String(i).padStart(3, "0")}`;
    novaEmpresa(store, id);
    gravar(store, {
      empresaIdAtiva: id,
      fusoHorario:
        i % 2 === 0 ? "America/Cuiaba" : "America/Sao_Paulo",
    });
  }

  gravar(store, {
    empresaIdAtiva: "emp-007",
    fusoHorario: "America/Manaus",
  });

  assert.equal(carregar(store, "emp-007"), "America/Manaus");
  assert.equal(carregar(store, "emp-000"), "America/Cuiaba");
  assert.equal(carregar(store, "emp-001"), "America/Sao_Paulo");
  assert.equal(carregar(store, "emp-499"), "America/Sao_Paulo");
  assert.equal(store.size, 500);
});

test("Geral, prontidão e emissão isolam fuso por empresa_id da sessão/emissão", () => {
  const actions = fonte("app/configuracoes/fiscal/actions.ts");
  const geral = fonte("app/configuracoes/fiscal/page.tsx");
  const prontidao = fonte("app/configuracoes/fiscal/prontidao/page.tsx");
  const inicial = fonte(
    "supabase/migrations/20260818120000_criar_configuracao_fiscal_inicial_numeracao_ambiente.sql"
  );
  const operacao = fonte(
    "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts"
  );
  const devolucao = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );

  assert.match(actions, /montarUpdateFusoHorarioDaEmpresaAtiva/);
  assert.match(actions, /\.eq\(\s*"empresa_id",\s*empresaId/);
  assert.match(actions, /formData\.get\("empresa_id"\)/);
  assert.doesNotMatch(
    actions,
    /\.eq\(\s*"empresa_id",\s*campo\("empresa_id"\)/
  );

  assert.match(geral, /name="fuso_horario"/);
  assert.match(geral, /\.eq\("empresa_id", vinculo\.empresa_id\)/);
  assert.doesNotMatch(geral, /name="empresa_id"/);

  assert.match(prontidao, /checkFusoHorarioProntidao/);
  assert.match(prontidao, /checkNaturezaProntidao/);
  assert.doesNotMatch(prontidao, /Natureza e fuso horário/);

  assert.match(inicial, /insert into public\.empresas_fiscal/);
  assert.doesNotMatch(inicial, /fuso_horario/);

  assert.match(operacao, /exigirFusoHorarioFiscalDaEmissao/);
  assert.doesNotMatch(
    operacao,
    /texto\(fiscal\.fuso_horario\) \|\| "America\/Cuiaba"/
  );
  assert.match(devolucao, /exigirFusoHorarioFiscalDaEmissao/);
  assert.doesNotMatch(
    devolucao,
    /texto\(fiscal\.fuso_horario\) \|\| "America\/Cuiaba"/
  );
});
