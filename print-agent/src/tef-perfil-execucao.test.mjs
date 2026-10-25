import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { decidirPerfilExecucao, journalsDoPerfil, perfilSessaoAtiva } from "./tef-perfil-execucao.mjs";

const raiz = path.resolve(import.meta.dirname, "../..");

test("homologação ignora o vínculo comercial e não troca a sessão", () => {
  const decisao = decidirPerfilExecucao({
    ambiente: "homologacao",
    vinculoAmbiente: "producao",
    sessao: "homologacao",
    producaoHabilitada: false,
  });
  assert.equal(decisao.ok, true);
  assert.equal(decisao.ambiente, "homologacao");
  assert.equal(decisao.vinculoIgnorado, true);
  const journals = journalsDoPerfil("C:\\homologacao", "C:\\producao", decisao.ambiente);
  assert.equal(journals.some((arquivo) => arquivo.includes("producao")), false);
  assert.equal(journals.some((arquivo) => arquivo.endsWith("tef-journal-etapa-venda.json")), true);
});

test("produção fica bloqueada enquanto não está habilitada, mesmo com vínculo comercial", () => {
  const decisao = decidirPerfilExecucao({
    ambiente: "producao",
    vinculoAmbiente: "producao",
    sessao: "",
    producaoHabilitada: false,
  });
  assert.equal(decisao.ok, false);
  assert.equal(decisao.codigo, "producao");
  assert.match(decisao.mensagem, /vínculo comercial/);
  assert.equal(decisao.ambiente, "");
});

test("sessão de outro ambiente bloqueia e não é trocada", () => {
  const ocupada = decidirPerfilExecucao({
    ambiente: "producao",
    vinculoAmbiente: "producao",
    sessao: "homologacao",
    producaoHabilitada: true,
  });
  assert.equal(ocupada.ok, false);
  assert.equal(ocupada.codigo, "sessao");
  assert.equal(ocupada.ambiente, "homologacao");
  assert.match(ocupada.mensagem, /sessão ativa está em homologação/);
  assert.match(ocupada.mensagem, /não foi trocado/);
  const inversa = decidirPerfilExecucao({
    ambiente: "homologacao",
    vinculoAmbiente: "homologacao",
    sessao: "producao",
    producaoHabilitada: false,
  });
  assert.equal(inversa.ok, false);
  assert.equal(inversa.ambiente, "producao");
  assert.match(inversa.mensagem, /sessão ativa está em produção/);
});

test("perfil ambíguo não conta como sessão ocupada", () => {
  assert.equal(perfilSessaoAtiva({ homologacao: true, producao: true }), "");
  assert.equal(perfilSessaoAtiva({ homologacao: true, producao: false }), "homologacao");
  assert.equal(perfilSessaoAtiva({ homologacao: false, producao: true }), "producao");
  const journals = journalsDoPerfil("C:\\homologacao", "C:\\ProgramData\\UltraPDV\\TEF\\Producao\\PGWeb", "producao");
  assert.deepEqual(journals, ["C:\\ProgramData\\UltraPDV\\TEF\\Producao\\PGWeb\\tef-journal-venda.json"]);
});

test("o F2 do PDV assina o ambiente do servidor e o Connector decide o perfil antes da pasta", () => {
  const rota = fs.readFileSync(path.join(raiz, "app/api/pdv/tef/venda/route.ts"), "utf8");
  const fluxo = fs.readFileSync(path.join(raiz, "lib/pdv/tef/fluxo-cliente.ts"), "utf8");
  const servidor = fs.readFileSync(path.join(raiz, "print-agent/src/server.mjs"), "utf8");
  const venda = fluxo.slice(fluxo.indexOf("export async function executarVendaPinpad"));
  assert.equal(venda.includes("ambiente:"), false);
  assert.equal(rota.indexOf("ambienteServidor") < rota.indexOf("provarOperacaoTesteHomologacao"), true);
  assert.equal(rota.includes("ambiente: config.ambiente"), true);
  assert.equal(rota.includes("navegador: texto(corpo.ambiente"), true);
  const inicioVenda = servidor.indexOf('req.method === "POST" && url.pathname === "/tef/venda"');
  const bloco = servidor.slice(inicioVenda, servidor.indexOf("diretorioProducaoPgWeb()", inicioVenda));
  assert.equal(bloco.includes("decidirPerfilExecucao"), true);
  assert.equal(bloco.includes('vinculo.ambiente === "producao"'), false);
  const gravacao = servidor.slice(inicioVenda, servidor.indexOf('url.pathname === "/tef/homologacao/menu"'));
  assert.equal(gravacao.includes('arquivoEtapa: arquivoEtapaVenda'), true);
  assert.equal(gravacao.includes('ambienteVenda === "homologacao" ? arquivoEtapaVenda'), false);
});
