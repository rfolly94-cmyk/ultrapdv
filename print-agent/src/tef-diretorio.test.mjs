import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  avaliarIsolamentoProducao,
  diretorioProducaoPgWeb,
  resolverDiretorioBiblioteca,
  tokenDiretorioBiblioteca,
} from "./tef-diretorio.mjs";

const AMBIENTE = { PROGRAMDATA: "C:\\ProgramData" };

test("produção e homologação resolvem pastas diferentes", () => {
  const raiz = "C:\\Program Files\\UltraPDV Connector\\bin\\tef";
  const sandbox = resolverDiretorioBiblioteca(raiz, tokenDiretorioBiblioteca("homologacao"), AMBIENTE);
  const producao = resolverDiretorioBiblioteca(raiz, tokenDiretorioBiblioteca("producao"), AMBIENTE);
  assert.equal(sandbox.ok, true);
  assert.equal(producao.ok, true);
  assert.equal(sandbox.biblioteca, path.join(raiz, "TEF", "PGWeb"));
  assert.equal(producao.biblioteca, path.join("C:\\ProgramData", "UltraPDV", "TEF", "Producao", "PGWeb"));
  assert.equal(diretorioProducaoPgWeb(AMBIENTE), producao.biblioteca);
  assert.notEqual(sandbox.biblioteca.toLowerCase(), producao.biblioteca.toLowerCase());
  assert.equal(producao.biblioteca.includes(`${path.sep}TEF${path.sep}PGWeb`), false);
  assert.equal(resolverDiretorioBiblioteca(raiz, "C:\\outra\\pasta", AMBIENTE).ok, false);
  assert.equal(resolverDiretorioBiblioteca(raiz, "..\\TEF", AMBIENTE).ok, false);
});

test("estado de homologação na pasta nova bloqueia sem apagar", () => {
  const raiz = "D:\\agente";
  const vazia = avaliarIsolamentoProducao({ raizExecutavel: raiz, nomes: [] });
  assert.equal(vazia.ok, true);
  assert.equal(vazia.situacao, "isolada");
  const copiada = avaliarIsolamentoProducao({
    raizExecutavel: raiz,
    nomes: ["TSTKEY.ini", "leia-me.txt"],
  });
  assert.equal(copiada.ok, false);
  assert.equal(copiada.situacao, "contaminada");
  assert.match(copiada.motivo, /não será reutilizada/);
  assert.match(copiada.motivo, /nenhum arquivo será apagado/);
});
