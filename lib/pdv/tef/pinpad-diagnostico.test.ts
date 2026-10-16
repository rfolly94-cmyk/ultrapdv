import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  mensagemDiagnosticoPinpad,
  observacaoModeloPinpad,
  portaPinpad,
} from "./pinpad-diagnostico";

test("pinpad conectado e comunicação confirmada não vira homologação", () => {
  const resultado = {
    comunicacao: "confirmada",
    fabricante: "GERTEC",
    modelo: "PPC920",
    firmware: "1.0",
    serieMascarada: "********1234",
    ppinfoDisponivel: true,
    limitacaoModelo: "conhecido_sem_homologacao",
    portaConfiguradaDescricao: "busca automatica",
    portaUtilizada: 8,
    paygoInicializado: true,
  };
  assert.equal(
    mensagemDiagnosticoPinpad({ resultado }),
    "Pinpad conectado e comunicação confirmada."
  );
  assert.match(observacaoModeloPinpad(resultado), /não comprova homologação/);
  assert.equal(portaPinpad(resultado), "busca automatica · utilizada porta 8");
});

test("pinpad desconectado, comunicação indisponível e modelo não reconhecido", () => {
  assert.equal(
    mensagemDiagnosticoPinpad({ resultado: { comunicacao: "nao_encontrado" } }),
    "Pinpad não encontrado."
  );
  assert.equal(
    mensagemDiagnosticoPinpad({ resultado: { comunicacao: "indisponivel" } }),
    "Comunicação indisponível."
  );
  assert.equal(
    mensagemDiagnosticoPinpad({
      resultado: { comunicacao: "modelo_nao_reconhecido", limitacaoModelo: "nao_reconhecido" },
    }),
    "Modelo não reconhecido."
  );
  assert.match(
    observacaoModeloPinpad({ limitacaoModelo: "nao_reconhecido" }),
    /não é uma homologação/
  );
});

test("ausência de fabricante não declara compatibilidade pela porta USB", () => {
  const resultado = {
    comunicacao: "nao_executada",
    ppinfoDisponivel: false,
    fabricante: "",
    modelo: "",
  };
  assert.match(
    mensagemDiagnosticoPinpad({ resultado }),
    /não inicia transação/
  );
  assert.match(observacaoModeloPinpad(resultado), /não comprova compatibilidade/);
});

test("timeout, biblioteca parada e terminal ocupado têm mensagens próprias", () => {
  assert.equal(
    mensagemDiagnosticoPinpad({ codigo: "TEF_TIMEOUT" }),
    "O teste de comunicação não retornou no tempo limite. A biblioteca não enviou código. Nenhuma cobrança foi iniciada."
  );
  assert.equal(
    mensagemDiagnosticoPinpad({
      resultado: { comunicacao: "timeout_biblioteca", codigoBiblioteca: -2134 },
    }),
    "A biblioteca informou tempo esgotado aguardando o pinpad."
  );
  assert.equal(
    mensagemDiagnosticoPinpad({
      resultado: { comunicacao: "nao_concluido", codigoBiblioteca: -2493 },
    }),
    "A biblioteca pediu para continuar o teste e não concluiu. Código -2493."
  );
  assert.match(
    mensagemDiagnosticoPinpad({ resultado: { comunicacao: "sem_porta" } }),
    /não foi forçada/
  );
  assert.equal(
    mensagemDiagnosticoPinpad({
      resultado: { comunicacao: "codigo_biblioteca", codigoBiblioteca: -2131 },
    }),
    "A biblioteca devolveu o código -2131."
  );
  assert.match(
    mensagemDiagnosticoPinpad({ codigo: "PINPAD_PAYGO_NAO_INICIALIZADO" }),
    /não será reiniciado/
  );
  assert.equal(
    mensagemDiagnosticoPinpad({ codigo: "TEF_OCUPADO" }),
    "Terminal ocupado com operação financeira."
  );
  assert.match(
    mensagemDiagnosticoPinpad({
      codigo: "TEF_OCUPADO",
      erro: "O teste de comunicação do pinpad ainda está em execução na biblioteca. Nenhuma cobrança foi iniciada.",
    }),
    /ainda está em execução/
  );
  assert.equal(
    mensagemDiagnosticoPinpad({
      resultado: { comunicacao: "aplicacao_indisponivel" },
    }),
    "Aplicação ou chaves necessárias não disponíveis."
  );
});

test("autorização do diagnóstico resolve a empresa na sessão e não aceita empresa do navegador", () => {
  const servico = readFileSync(
    fileURLToPath(new URL("./servico.ts", import.meta.url)),
    "utf8"
  );
  const inicio = servico.indexOf("export async function prepararAcessoPinpad");
  const fim = servico.indexOf("export async function verificarComputadorTefSessao");
  const bloco = servico.slice(inicio, fim);
  assert.equal(bloco.includes("resolverContextoAutorizadoEmpresa"), true);
  assert.equal(bloco.includes("empresa_id"), false);
  assert.equal(bloco.includes("empresaId"), true);
  assert.match(bloco, /financeiro/);
  assert.match(bloco, /temPendencia/);
});
