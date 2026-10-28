import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FUNCOES_BLOQUEADAS_DIAGNOSTICO,
  FUNCOES_DIAGNOSTICO_HOMOLOGACAO,
  combinarDiagnosticoHomologacao,
  planejarDiagnosticoHomologacao,
} from "./diagnostico-homologacao";
import { portasDescobertaConector } from "../../impressao/descobrir";
import { origemDoConnectorUnico } from "../../impressao/conector-homologacao";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./motor";

test("o diagnóstico de homologação separa PW_iInit do bloqueio de PW_GetData", () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  const plano = planejarDiagnosticoHomologacao({ diretorio: "perfil-homologacao" });
  assert.equal(plano.chamaPwInit, true);
  assert.equal(plano.chamaSetEnvironment, true);
  assert.equal(plano.ambienteBiblioteca, 1);
  assert.equal(plano.porta, 0);
  assert.equal(plano.chamaInstalacao, false);
  assert.equal(plano.chamaExecTransac, false);
  assert.equal(plano.chamaAddParam, false);
  assert.equal(plano.chamaConfirmation, false);
  assert.equal(FUNCOES_DIAGNOSTICO_HOMOLOGACAO.includes("PW_iInit"), true);
  assert.equal(FUNCOES_BLOQUEADAS_DIAGNOSTICO.includes("PW_iExecTransac"), true);
  assert.equal(FUNCOES_BLOQUEADAS_DIAGNOSTICO.includes("PW_GetData"), true);
  const producao = planejarDiagnosticoHomologacao({
    diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao\\PGWeb",
  });
  assert.equal(producao.chamaPwInit, false);
});

test("a tela de homologação usa a rota nova e não o Connector de produção", () => {
  const tela = readFileSync(
    fileURLToPath(new URL("../../../components/pdv/tef-pinpad-diagnostico.tsx", import.meta.url)),
    "utf8"
  );
  const inicio = tela.indexOf('props.ambiente === "homologacao" || props.ambiente === "producao"');
  const fim = tela.indexOf("Escolha Homologação ou Produção", inicio);
  const bloco = tela.slice(inicio, fim);
  assert.match(bloco, /\$\{descoberta\.origem\}\/tef\/homologacao\/pinpad/);
  assert.match(bloco, /\/api\/pdv\/tef\/pinpad\/homologacao/);
  assert.match(bloco, /\/tef\/pinpad\/comunicacao/);
  assert.match(bloco, /\/api\/pdv\/tef\/pinpad\/comunicacao/);
  assert.equal(bloco.includes("18281"), false);
  assert.equal(bloco.includes("origemConectorHomologacaoDesenvolvimento"), false);
  assert.equal(bloco.includes("/tef/pinpad/testar-comunicacao"), false);
  assert.equal(bloco.includes("/tef/pinpad/diagnostico"), false);
  assert.match(bloco, /combinarDiagnosticoHomologacao/);
  assert.equal(bloco.includes("planejarDiagnosticoHomologacao"), false);
  assert.equal(tela.includes("PW_iExecTransac"), false);
  assert.equal(tela.includes("PWOPER_INSTALL"), false);
  const motor = readFileSync(fileURLToPath(new URL("./motor.ts", import.meta.url)), "utf8");
  assert.match(motor, /ABI_COMPROVADO = false/);
  assert.match(motor, /LAYOUT_HOMOLOGADO = false/);
  assert.equal(
    existsSync(fileURLToPath(new URL("../../../tef-2/agente/PgWebLib.pas", import.meta.url))),
    false
  );
});

function arquivosOperacionais(diretorio: string, acumulado: string[] = []) {
  for (const nome of readdirSync(diretorio)) {
    const caminho = join(diretorio, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "node_modules" || nome === ".next") continue;
      arquivosOperacionais(caminho, acumulado);
      continue;
    }
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(nome)) continue;
    if (!/\.(tsx?|mjs|js)$/.test(nome)) continue;
    acumulado.push(caminho);
  }
  return acumulado;
}

test("o fluxo operacional não depende do Connector antigo em 127.0.0.1:18281", () => {
  const raiz = fileURLToPath(new URL("../../..", import.meta.url));
  const alvos = [
    join(raiz, "app", "api", "pdv", "tef"),
    join(raiz, "components", "pdv"),
    join(raiz, "lib", "pdv", "tef"),
    join(raiz, "lib", "impressao"),
    join(raiz, "print-agent", "src", "server.mjs"),
  ];
  const proibidos = ["18281", "origemConectorHomologacaoDesenvolvimento", "homologacao-servidor", "PORTA_CONECTOR_HOMOLOGACAO"];
  for (const alvo of alvos) {
    const arquivos = statSync(alvo).isDirectory() ? arquivosOperacionais(alvo) : [alvo];
    for (const arquivo of arquivos) {
      const texto = readFileSync(arquivo, "utf8");
      for (const termo of proibidos) {
        assert.equal(texto.includes(termo), false, `${arquivo} voltou a citar ${termo}`);
      }
    }
  }
  assert.equal(existsSync(join(raiz, "print-agent", "src", "homologacao-servidor.mjs")), false);
  const servidor = readFileSync(join(raiz, "print-agent", "src", "server.mjs"), "utf8");
  assert.match(servidor, /\/tef\/csharp/);
  for (const rota of [
    "/tef/homologacao/pinpad",
    "/tef/homologacao/menu",
    "/tef/homologacao/identidade",
    "/tef/homologacao/instalacao",
  ]) {
    assert.equal(servidor.includes(rota), false, rota);
  }
  const exigeDescoberta = [
    "components/pdv/tef-pinpad-diagnostico.tsx",
    "components/pdv/tef-menu-homologacao.tsx",
    "components/pdv/tef-instalacao-homologacao.tsx",
    "components/pdv/tef-pareamento-form.tsx",
    "components/pdv/pdv-shell.tsx",
  ];
  for (const relativo of exigeDescoberta) {
    const texto = readFileSync(join(raiz, relativo), "utf8");
    assert.match(texto, /descobrirUltraPdvConector/);
  }
});

test("a homologação usa o Connector único nas portas já descobertas", () => {
  assert.equal(origemDoConnectorUnico("http://127.0.0.1:18182"), "http://127.0.0.1:18182");
  assert.equal(origemDoConnectorUnico("http://127.0.0.1:18281"), null);
  assert.equal(origemDoConnectorUnico("https://127.0.0.1:18181"), null);
  assert.equal(portasDescobertaConector().includes(18281), false);
  assert.equal(portasDescobertaConector()[0], 18181);
  assert.equal(portasDescobertaConector().at(-1), 18190);
});

test("testar COM7 e depois identificar preserva a comunicação confirmada", () => {
  const testado = combinarDiagnosticoHomologacao({
    acao: "testar",
    anterior: null,
    retorno: {
      ok: true,
      codigo: "PWRET_OK",
      comunicacao: "confirmada",
      porta: 7,
      portaNome: "COM7",
      mensagem: "Pinpad conectado e comunicação confirmada. Porta utilizada COM7.",
    },
  });
  assert.equal(testado.exibicao.erro, false);
  assert.equal(testado.exibicao.comunicacao, "confirmada");
  assert.equal(testado.memoria?.portaUtilizada, 7);
  assert.equal(testado.memoria?.portaNome, "COM7");

  const identificado = combinarDiagnosticoHomologacao({
    acao: "identificar",
    anterior: testado.memoria,
    retorno: {
      ok: true,
      codigo: "PWRET_OK",
      comunicacao: "nao_executada",
      porta: null,
      mensagem: "A PGWebLib de homologação foi inicializada. A comunicação do pinpad não foi testada.",
    },
  });
  assert.equal(identificado.exibicao.erro, false);
  assert.equal(identificado.exibicao.comunicacao, "confirmada");
  assert.equal(identificado.exibicao.portaUtilizada, 7);
  assert.equal(identificado.exibicao.portaNome, "COM7");
  assert.equal(identificado.memoria?.comunicacao, "confirmada");
  assert.match(identificado.exibicao.identificacao, /não testa a comunicação/);
  assert.match(identificado.exibicao.mensagem, /permanece confirmada em COM7/);
  assert.equal(identificado.exibicao.mensagem.includes("PW_iSetEnvironment"), false);

  const semTeste = combinarDiagnosticoHomologacao({
    acao: "identificar",
    anterior: null,
    retorno: {
      ok: true,
      codigo: "PWRET_OK",
      comunicacao: "nao_executada",
      porta: null,
      mensagem: "A PGWebLib de homologação foi inicializada. A comunicação do pinpad não foi testada.",
    },
  });
  assert.equal(semTeste.exibicao.erro, false);
  assert.equal(semTeste.exibicao.comunicacao, "nao_executada");
  assert.equal(semTeste.memoria, null);
  assert.match(semTeste.exibicao.mensagem, /não foi testada nesta consulta/);
});
