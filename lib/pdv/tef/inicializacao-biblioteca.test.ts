import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  corpoInicializacaoExplicita,
  mensagemInicializacaoBiblioteca,
} from "./inicializacao-biblioteca";

test("a inicialização explícita envia somente a ação inicializar", () => {
  assert.deepEqual(corpoInicializacaoExplicita(), { acao: "inicializar" });
  const componente = readFileSync(
    new URL("../../../components/pdv/tef-inicializacao-biblioteca.tsx", import.meta.url),
    "utf8"
  );
  assert.match(componente, /corpoInicializacaoExplicita\(\)/);
  assert.doesNotMatch(componente, /\/tef\/instalar|\/tef\/pagar|PWOPER_|confirmar|desfazer/);
  const rota = readFileSync(
    new URL("../../../app/api/pdv/tef/biblioteca/inicializar/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(rota, /prepararInicializacaoBiblioteca/);
  assert.doesNotMatch(rota, /instalar|pagar|PWOPER_/);
});

test("falha de gravação e sucesso de produção têm mensagens distintas", () => {
  assert.match(
    mensagemInicializacaoBiblioteca({
      ok: false,
      erro: "TEF_INICIALIZACAO_FALHOU: Falha de gravação no diretório C:\\Program Files\\UltraPDV Connector\\bin\\tef\\producao\\PGWeb\\",
    }),
    /permanecem intactos/
  );
  assert.match(
    mensagemInicializacaoBiblioteca({
      ok: true,
      inicializado: true,
      diretorioSelecionado: "producao",
    }),
    /pasta de produção/
  );
  assert.match(
    mensagemInicializacaoBiblioteca({
      ok: true,
      inicializado: true,
      diretorioSelecionado: "producao",
    }),
    /não cobrou|não iniciou|Nenhum pagamento/
  );
  assert.match(
    mensagemInicializacaoBiblioteca({
      ok: false,
      erro: "A PGWebLib recusou a gravação na inicialização. Código -2485 PWRET_WRITERR. Pasta utilizada: C:\\UltraPDV-TEF\\Producao\\PGWeb\\.",
    }),
    /Código -2485 PWRET_WRITERR/
  );
  assert.match(
    mensagemInicializacaoBiblioteca({
      ok: false,
      erro: "A validação do Connector não encontrou PGWeb\\Data. A PGWebLib não foi chamada.",
    }),
    /validação do Connector/
  );
});
