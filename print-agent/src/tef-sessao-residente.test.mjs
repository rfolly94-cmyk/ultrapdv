import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executarDiagnosticoHomologacao } from "./tef-diagnostico-homologacao.mjs";
import {
  ABI_COMPROVADO,
  assinaturaNativa,
  LAYOUT_HOMOLOGADO,
  PGWEB2_PRODUCAO,
} from "./tef-pgweb.mjs";
import {
  assinarAutorizacaoOperacao,
  bibliotecaResidenteElegivel,
  completarInstanciaResidente,
  DETALHES_SESSAO,
  esquecerMenuConector,
  FUNCOES_SESSAO_RESIDENTE,
  prepararTransporteHomologacao,
} from "./tef-menu-conector.mjs";

const par = generateKeyPairSync("ed25519");
const publica = par.publicKey.export({ type: "spki", format: "pem" });
const privada = par.privateKey.export({ type: "pkcs8", format: "pem" });
const agora = 1_800_000_000_000;
const DIRETORIO = "C:\\UltraPDV\\TEF\\Homologacao\\PGWeb";

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    empresaId: "empresa-a",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    terminalCodigo: "caixa-lab",
    posid: "ponto-lab",
    valorCentavos: 5500,
    idempotencyKey: "op-sessao-1",
    expiraEm: agora + 60_000,
    ...extra,
  };
}

function cargaNativa(faltando = "") {
  const carga = {};
  const ponteiros = {};
  const resolucoes = [];
  carga.func = (assinatura) => {
    resolucoes.push(assinatura);
    const nome = FUNCOES_SESSAO_RESIDENTE.find((item) => assinaturaNativa(item) === assinatura);
    if (!nome || nome === faltando) return undefined;
    if (!ponteiros[nome]) {
      const ponteiro = () => {
        ponteiro.invocacoes += 1;
        return 0;
      };
      ponteiro.invocacoes = 0;
      ponteiros[nome] = ponteiro;
    }
    return ponteiros[nome];
  };
  return { carga, ponteiros, resolucoes };
}

function instanciaPronta(carga, extra = {}) {
  const instancia = {
    homologacao: true,
    inicializada: true,
    arquitetura: "x64",
    diretorio: DIRETORIO,
    bibliotecaNativa: carga,
    chamadas: [],
    async init(diretorio) {
      instancia.chamadas.push(["PW_iInit", diretorio]);
      return 0;
    },
    async setEnvironment(codigo) {
      instancia.chamadas.push(["PW_iSetEnvironment", codigo]);
      return 0;
    },
    async ppCommTest(porta) {
      instancia.chamadas.push(["PW_iPPCommTest", porta]);
      return { codigo: 0, porta: 7, mensagem: "" };
    },
    async getResult() {
      instancia.chamadas.push(["PW_iGetResult"]);
      return { codigo: -2496, valor: "" };
    },
    async ppEventLoop() {
      instancia.chamadas.push(["PW_iPPEventLoop"]);
      return { codigo: 0, display: "" };
    },
    ...extra,
  };
  return instancia;
}

function preparar(biblioteca, extra = {}) {
  const base = pedido(extra);
  return prepararTransporteHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    entrada: {
      journal: { seguir: true },
      pontoInstalado: true,
      dllOk: true,
      biblioteca,
    },
  });
}

test("instância válida liga newTransac ao mesmo carregamento sem chamá-la", () => {
  const { carga, ponteiros, resolucoes } = cargaNativa();
  const instancia = instanciaPronta(carga);
  const leituraGetResult = instancia.getResult;
  const ligada = completarInstanciaResidente(instancia);
  assert.equal(ligada, instancia);
  assert.equal(bibliotecaResidenteElegivel(ligada), true);
  assert.equal(ligada.residente, true);
  assert.equal(ligada.origem, "conector");
  assert.equal(ligada.homologacao, true);
  assert.equal(ligada.inicializada, true);
  assert.equal(ligada.arquitetura, "x64");
  assert.equal(ligada.diretorio, DIRETORIO);
  assert.equal(ligada.newTransac.carregamento, carga);
  assert.equal(ligada.newTransac.ponteiro, ponteiros.PW_iNewTransac);
  assert.equal(ligada.newTransac.assinatura, assinaturaNativa("PW_iNewTransac"));
  assert.equal(ligada.vinculoNativo.carregamento, carga);
  assert.equal(ligada.getResult, leituraGetResult);
  for (const nome of FUNCOES_SESSAO_RESIDENTE) {
    assert.equal(ligada.vinculoNativo.funcoes[nome], ponteiros[nome]);
    assert.equal(ponteiros[nome].invocacoes, 0);
  }
  assert.equal(resolucoes.length, FUNCOES_SESSAO_RESIDENTE.length);
  assert.equal(instancia.chamadas.length, 0);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
});

test("instância incompleta e ainda não inicializada não marca a sessão", () => {
  const { carga, resolucoes } = cargaNativa();
  const semInit = instanciaPronta(carga, { inicializada: false, residente: true, origem: "conector" });
  assert.equal(completarInstanciaResidente(semInit), null);
  assert.equal(semInit.causaSessao, "inicializacao");
  assert.equal(semInit.residente, false);
  assert.equal(semInit.origem, undefined);
  assert.equal(resolucoes.length, 0);

  const semPerfil = instanciaPronta(carga, { diretorio: "C:\\UltraPDV\\TEF\\Producao\\PGWeb" });
  assert.equal(completarInstanciaResidente(semPerfil), null);
  assert.equal(semPerfil.causaSessao, "perfil");
  assert.equal(semPerfil.residente, false);
  assert.equal(bibliotecaResidenteElegivel(semPerfil), false);
});

test("instância já inicializada é reutilizada sem novo carregamento", () => {
  const { carga, ponteiros, resolucoes } = cargaNativa();
  const instancia = instanciaPronta(carga);
  const primeira = completarInstanciaResidente(instancia);
  const consultas = resolucoes.length;
  const segunda = completarInstanciaResidente(primeira);
  assert.equal(segunda, primeira);
  assert.equal(resolucoes.length, consultas);
  assert.equal(primeira.inicializada, true);
  assert.equal(ponteiros.PW_iNewTransac.invocacoes, 0);
  assert.equal(instancia.chamadas.some((item) => item[0] === "PW_iInit"), false);
  assert.equal(instancia.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
});

test("função nativa ausente devolve sessao e mantém a execução bloqueada", () => {
  esquecerMenuConector();
  const { carga, ponteiros } = cargaNativa("PW_iNewTransac");
  const instancia = instanciaPronta(carga, { residente: true, origem: "conector" });
  const resultado = preparar(instancia, { idempotencyKey: "op-sessao-funcao" });
  assert.equal(resultado.codigo, "sessao");
  assert.equal(resultado.causa, "funcao");
  assert.equal(resultado.mensagem, `A sessão nativa residente não está disponível. ${DETALHES_SESSAO.funcao}`);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.nativo, false);
  assert.equal(resultado.execucaoFisica, false);
  assert.equal(resultado.comandoDll, false);
  assert.equal(resultado.transacaoIniciada, false);
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(instancia.residente, false);
  assert.equal(instancia.origem, undefined);
  assert.equal(bibliotecaResidenteElegivel(instancia), false);
  for (const ponteiro of Object.values(ponteiros)) assert.equal(ponteiro.invocacoes, 0);
  esquecerMenuConector();
});

test("diagnóstico e preparação reutilizam a mesma instância sem outra DLL", async () => {
  esquecerMenuConector();
  const { carga, ponteiros, resolucoes } = cargaNativa();
  const instancia = instanciaPronta(carga);
  let guardada = null;
  let aberturas = 0;
  const deps = {
    executar: true,
    raiz: "C:\\UltraPDV",
    pontoInstalado: true,
    criarDiretorio: async () => {},
    verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
    get instancia() {
      return guardada;
    },
    guardarInstancia(valor) {
      guardada = valor;
    },
    abrir: async () => {
      aberturas += 1;
      return instancia;
    },
  };
  const primeiro = await executarDiagnosticoHomologacao({ acao: "testar" }, deps);
  assert.equal(primeiro.ok, true);
  assert.equal(primeiro.codigo, "PWRET_OK");
  assert.equal(aberturas, 1);
  assert.equal(guardada, instancia);
  assert.equal(bibliotecaResidenteElegivel(guardada), true);
  assert.equal(guardada.inicializada, true);
  assert.equal(guardada.arquitetura, "x64");
  assert.match(guardada.diretorio, /\\Homologacao\\PGWeb$/i);
  const consultas = resolucoes.length;
  const inits = instancia.chamadas.filter((item) => item[0] === "PW_iInit");
  assert.equal(inits.length, 1);
  assert.equal(instancia.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);

  const segundo = await executarDiagnosticoHomologacao({ acao: "testar" }, deps);
  assert.equal(segundo.ok, true);
  assert.equal(aberturas, 1);
  assert.equal(instancia.chamadas.filter((item) => item[0] === "PW_iInit").length, 1);
  assert.equal(resolucoes.length, consultas);
  assert.equal(ponteiros.PW_iNewTransac.invocacoes, 0);

  const preparada = preparar(guardada, { idempotencyKey: "op-sessao-reuso" });
  assert.equal(preparada.codigo, "preparada");
  assert.equal(preparada.nativo, true);
  assert.equal(preparada.transacaoIniciada, false);
  assert.equal(preparada.execucaoFisica, false);
  assert.equal(preparada.comandoDll, false);
  assert.equal(preparada.reservaTomada, false);
  assert.equal(ponteiros.PW_iNewTransac.invocacoes, 0);
  assert.equal(resolucoes.length, consultas);
  assert.equal(guardada, instancia);

  const servidor = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  const inicio = servidor.indexOf('url.pathname === "/tef/homologacao/menu"');
  const fim = servidor.indexOf('url.pathname === "/tef/homologacao/pinpad"', inicio);
  const menu = servidor.slice(inicio, fim);
  assert.match(menu, /completarInstanciaResidente\(instanciaPinpadHomologacao\)/);
  assert.match(menu, /biblioteca: instanciaPinpadHomologacao/);
  esquecerMenuConector();
});
