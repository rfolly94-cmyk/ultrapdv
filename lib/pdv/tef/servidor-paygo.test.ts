import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { validarCredenciamento } from "@/lib/pdv/tef/assistente-instalacao";
import {
  confirmarServidorPersistido,
  conferirServidorAutorizado,
  decidirGravacaoServidor,
  servidorDoAmbiente,
  validarServidorPayGo,
  type ConfiguracaoServidorPayGo,
} from "@/lib/pdv/tef/servidor-paygo";

const SERVIDOR_A = "tef.loja-a.example:31735";
const SERVIDOR_B = "tef.loja-b.example:443";
const CNPJ = "11222333000181";

const empresas: Record<string, ConfiguracaoServidorPayGo> = {
  [empresaA]: { servidorHomologacao: SERVIDOR_A, servidorProducao: "tef.loja-a-prod.example:443" },
  [empresaB]: { servidorHomologacao: SERVIDOR_B, servidorProducao: "tef.loja-b-prod.example:8443" },
};

function gravacao(parcial: Partial<Parameters<typeof decidirGravacaoServidor>[0]> = {}) {
  return decidirGravacaoServidor({
    perfil: "administrador",
    confirmacaoExplicita: true,
    empresaJaHabilitada: false,
    pendenciaFinanceira: false,
    terminalPareado: false,
    servidorAtual: "",
    servidorNovo: SERVIDOR_A,
    ambienteAtual: "",
    ambienteNovo: "homologacao",
    ...parcial,
  });
}

test("empresas diferentes guardam servidores diferentes e um não autoriza o outro", () => {
  assert.notEqual(
    servidorDoAmbiente(empresas[empresaA], "homologacao"),
    servidorDoAmbiente(empresas[empresaB], "homologacao")
  );
  assert.equal(servidorDoAmbiente(empresas[empresaA], "homologacao"), SERVIDOR_A);
  assert.equal(servidorDoAmbiente(empresas[empresaB], "producao"), "tef.loja-b-prod.example:8443");
  const cruzado = conferirServidorAutorizado({
    servidorInformado: SERVIDOR_B,
    servidorAutorizado: servidorDoAmbiente(empresas[empresaA], "homologacao"),
    ambienteInformado: "homologacao",
    ambienteAutorizado: "homologacao",
  });
  assert.equal(cruzado.ok, false);
  if (!cruzado.ok) {
    assert.match(cruzado.motivo, /não é o servidor autorizado/);
  }
});

test("servidor ausente bloqueia o ambiente e não copia o outro endereço", () => {
  const ausente = validarServidorPayGo("  ");
  assert.equal(ausente.ok, false);
  const config = { servidorHomologacao: SERVIDOR_A, servidorProducao: "" };
  assert.equal(servidorDoAmbiente(config, "producao"), "");
  assert.equal(servidorDoAmbiente(config, "homologacao"), SERVIDOR_A);
  const conferencia = conferirServidorAutorizado({
    servidorInformado: SERVIDOR_A,
    servidorAutorizado: "",
    ambienteInformado: "producao",
    ambienteAutorizado: "producao",
  });
  assert.equal(conferencia.ok, false);
  const credenciamento = validarCredenciamento({
    cnpjEmpresa: CNPJ,
    cnpjConfirmado: CNPJ,
    credenciamentoConfirmado: true,
    ambienteAutorizado: "producao",
    pontoCaptura: "200001",
    estabelecimento: "LOJA NOVA",
    parametrosOficiais: "",
    adquirentes: [],
    servidorHomologacao: SERVIDOR_A,
    servidorProducao: "",
    servidorConfirmado: true,
  });
  assert.equal(credenciamento.ok, false);
  assert.match(credenciamento.pendencias.join(" "), /servidor de produção/);
  assert.equal(credenciamento.servidorProducao, "");
  assert.equal(credenciamento.servidorHomologacao, SERVIDOR_A);
});

test("porta inválida é recusada", () => {
  for (const valor of ["tef.loja.example:0", "tef.loja.example:65536", "tef.loja.example:443a", "tef.loja.example:"]) {
    const resultado = validarServidorPayGo(valor);
    assert.equal(resultado.ok, false, valor);
    if (!resultado.ok) {
      assert.match(resultado.motivo, /porta|formato/);
    }
  }
  const decisao = gravacao({ servidorNovo: "tef.loja.example:70000" });
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /porta/);
});

test("host fora da configuração autorizada é recusado", () => {
  const resultado = conferirServidorAutorizado({
    servidorInformado: "outro.example:31735",
    servidorAutorizado: SERVIDOR_A,
    ambienteInformado: "homologacao",
    ambienteAutorizado: "homologacao",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.motivo, /não é o servidor autorizado/);
  }
  const esquema = validarServidorPayGo("https://tef.loja.example:443");
  assert.equal(esquema.ok, false);
});

test("troca de servidor depois do pareamento é recusada", () => {
  const decisao = gravacao({
    terminalPareado: true,
    servidorAtual: SERVIDOR_A,
    servidorNovo: SERVIDOR_B,
    ambienteAtual: "homologacao",
    ambienteNovo: "homologacao",
  });
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /já foi pareado/);
});

test("ambiente divergente não reaproveita o servidor do outro ambiente", () => {
  const config = { servidorHomologacao: SERVIDOR_A, servidorProducao: SERVIDOR_B };
  assert.equal(servidorDoAmbiente(config, "homologacao"), SERVIDOR_A);
  assert.notEqual(servidorDoAmbiente(config, "producao"), SERVIDOR_A);
  const conferencia = conferirServidorAutorizado({
    servidorInformado: SERVIDOR_A,
    servidorAutorizado: SERVIDOR_B,
    ambienteInformado: "homologacao",
    ambienteAutorizado: "producao",
  });
  assert.equal(conferencia.ok, false);
  if (!conferencia.ok) {
    assert.match(conferencia.motivo, /diverge/);
  }
  const decisao = gravacao({
    terminalPareado: true,
    servidorAtual: SERVIDOR_A,
    servidorNovo: SERVIDOR_B,
    ambienteAtual: "homologacao",
    ambienteNovo: "producao",
  });
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /ambiente do terminal pareado diverge/);
});

test("pendência financeira impede alterar o servidor", () => {
  const decisao = gravacao({
    pendenciaFinanceira: true,
    terminalPareado: true,
    servidorAtual: SERVIDOR_A,
    servidorNovo: SERVIDOR_B,
    ambienteAtual: "homologacao",
  });
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /transação TEF pendente/);
  const mesmo = gravacao({ pendenciaFinanceira: true, servidorAtual: SERVIDOR_A, servidorNovo: SERVIDOR_A });
  assert.equal(mesmo.efeito, "recusar");
});

test("ponto novo com parâmetros completos pode gravar o servidor confirmado", () => {
  const decisao = gravacao({
    perfil: "administrador",
    confirmacaoExplicita: true,
    servidorNovo: SERVIDOR_A,
    ambienteNovo: "homologacao",
  });
  assert.equal(decisao.efeito, "gravar");
  const conferencia = conferirServidorAutorizado({
    servidorInformado: SERVIDOR_A,
    servidorAutorizado: SERVIDOR_A,
    ambienteInformado: "homologacao",
    ambienteAutorizado: "homologacao",
  });
  assert.equal(conferencia.ok, true);
  const credenciamento = validarCredenciamento({
    cnpjEmpresa: CNPJ,
    cnpjConfirmado: CNPJ,
    credenciamentoConfirmado: true,
    ambienteAutorizado: "homologacao",
    pontoCaptura: "200001",
    estabelecimento: "LOJA NOVA",
    parametrosOficiais: "ponto publico",
    adquirentes: ["Rede"],
    servidorHomologacao: SERVIDOR_A,
    servidorProducao: SERVIDOR_B,
    servidorConfirmado: true,
  });
  assert.equal(credenciamento.ok, true);
  assert.equal(credenciamento.servidorHomologacao, SERVIDOR_A);
  assert.equal(credenciamento.servidorProducao, SERVIDOR_B);
  assert.equal(gravacao({ perfil: "operador" }).efeito, "recusar");
  assert.equal(gravacao({ confirmacaoExplicita: false }).efeito, "recusar");
  assert.equal(gravacao({ empresaJaHabilitada: true }).efeito, "gravar");
  assert.equal(gravacao({ empresaJaHabilitada: true, servidorAtual: SERVIDOR_A }).efeito, "preservar");
  assert.equal(
    gravacao({ empresaJaHabilitada: true, servidorAtual: SERVIDOR_B, servidorNovo: SERVIDOR_A }).efeito,
    "recusar"
  );
  const ausente = confirmarServidorPersistido({
    ambiente: "producao",
    informado: SERVIDOR_A,
    gravadoHomologacao: SERVIDOR_B,
    gravadoProducao: "",
  });
  assert.equal(ausente.ok, false);
  const gravado = confirmarServidorPersistido({
    ambiente: "producao",
    informado: SERVIDOR_A,
    gravadoHomologacao: "",
    gravadoProducao: SERVIDOR_A,
  });
  assert.equal(gravado.ok, true);
});

test("migration separa os servidores e o fluxo habilitado não inventa endereço", () => {
  const sql = fonte("supabase/migrations/20261011190000_tef_servidor_paygo.sql");
  const modulo = fonte("lib/pdv/tef/servidor-paygo.ts");
  const persistencia = fonte("lib/pdv/tef/persistencia.ts");
  const sessao = fonte("lib/pdv/tef/assistente-sessao.ts");
  const ui = fonte("components/pdv/tef-assistente.tsx");
  const conector = fonte("print-agent/src/tef.mjs");
  assert.match(sql, /Não aplicar automaticamente/);
  assert.match(sql, /servidor_homologacao text NOT NULL DEFAULT ''/);
  assert.match(sql, /servidor_producao text NOT NULL DEFAULT ''/);
  assert.match(sql, /tef_terminais/);
  assert.match(sql, /tef_pareamentos/);
  assert.doesNotMatch(sql, /117473|pos-transac-sb|42741754000142|password|senha_paygo/i);
  assert.doesNotMatch(modulo, /117473|pos-transac-sb|fetch\(|http\.request|net\.connect/);
  assert.doesNotMatch(conector, /fetch\(|http\.request|net\.connect/);
  assert.match(ui, /Confirmo o servidor PayGoWeb atribuído a este estabelecimento/);
  assert.match(ui, /Somente um administrador pode confirmar o servidor PayGoWeb/);
  assert.doesNotMatch(ui, /Servidor novo/);
  assert.doesNotMatch(ui, /pos-transac-sb|117473/);
  const autorizar = persistencia.slice(persistencia.indexOf("export async function autorizarPareamentoTef"));
  const habilitado = autorizar.indexOf("if (!habilitado)");
  const consultaServidor = autorizar.indexOf('select("ambiente, servidor_homologacao, servidor_producao")');
  assert.ok(habilitado >= 0 && consultaServidor > habilitado);
  const salvar = sessao.slice(sessao.indexOf("export async function salvarRascunhoAssistenteSessao"));
  const decide = salvar.indexOf("decidirGravacaoServidor");
  const confirma = salvar.indexOf("confirmarServidorPersistido");
  assert.ok(decide >= 0 && confirma > decide);
  assert.doesNotMatch(salvar, /etapa: "validacao"/);
  const gravar = persistencia.slice(persistencia.indexOf("export async function gravarServidoresPayGoEmpresa"));
  const ramo = gravar.slice(gravar.indexOf("habilitado === true"), gravar.indexOf("if (!atual.data)"));
  assert.match(ramo, /servidor_producao/);
  assert.doesNotMatch(ramo, /ponto_captura/);
});
