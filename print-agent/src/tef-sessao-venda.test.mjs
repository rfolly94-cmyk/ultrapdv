import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { PWRET } from "./tef-pgweb.mjs";
import { garantirSessaoVenda } from "./tef-sessao-venda.mjs";

const diretorio = "C:\\UltraPDV\\conector-homologacao\\TEF\\Homologacao\\PGWeb";

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    empresaId: "empresa-a",
    posid: "117473",
    diretorio,
    biblioteca: null,
    pontoInstalado: true,
    portaSalva: 4,
    transacaoAtiva: false,
    pendencia: null,
    ocupacao: null,
    ...extra,
  };
}

function bibliotecaPronta(extra = {}) {
  const chamadas = [];
  const biblioteca = {
    inicializada: false,
    homologacao: true,
    producao: false,
    diretorio,
    chamadas,
    async setEnvironment() {
      chamadas.push("PW_iSetEnvironment");
      return PWRET.OK;
    },
    async init() {
      chamadas.push("PW_iInit");
      this.inicializada = true;
      return PWRET.OK;
    },
    async ppCommTest(porta) {
      chamadas.push(["PW_iPPCommTest", porta]);
      return { codigo: PWRET.OK, porta: porta || 4 };
    },
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      return PWRET.OK;
    },
    ...extra,
  };
  return biblioteca;
}

function depsDe(biblioteca, extra = {}) {
  return {
    arquivoDll: "PGWebLib.dll",
    estadoFila: { fila: Promise.resolve() },
    memoria: { atual: null },
    abrir: async () => biblioteca,
    promover: async (aberta) => {
      aberta.residente = true;
      aberta.origem = "conector";
      aberta.inicializada = true;
      return aberta;
    },
    ...extra,
  };
}

test("sessão inexistente inicializa com PW_iInit e PW_iPPCommTest sem reinstalar o ponto", async () => {
  const biblioteca = bibliotecaPronta();
  let gravada = null;
  const garantia = await garantirSessaoVenda(pedido(), {
    ...depsDe(biblioteca),
    persistirPorta: async (entrada) => {
      gravada = entrada;
    },
  });
  assert.equal(garantia.ok, true);
  assert.equal(garantia.iniciou, true);
  assert.equal(garantia.biblioteca.empresaId, "empresa-a");
  assert.equal(garantia.biblioteca.posid, "117473");
  assert.deepEqual(biblioteca.chamadas, ["PW_iInit", ["PW_iPPCommTest", 4]]);
  assert.equal(gravada.portaDescoberta, 4);
  assert.equal(JSON.stringify(gravada).includes("empresa"), false);
});

test("dois F2 simultâneos inicializam a sessão uma vez", async () => {
  const biblioteca = bibliotecaPronta();
  const deps = depsDe(biblioteca, {
    abrir: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return biblioteca;
    },
  });
  const [primeira, segunda] = await Promise.all([
    garantirSessaoVenda(pedido(), deps),
    garantirSessaoVenda(pedido(), deps),
  ]);
  assert.equal(primeira.ok, true);
  assert.equal(segunda.ok, true);
  assert.equal(primeira.iniciou, true);
  assert.equal(segunda.iniciou, false);
  assert.equal(biblioteca.chamadas.filter((item) => item === "PW_iInit").length, 1);
  assert.equal(biblioteca.chamadas.includes("PW_iNewTransac"), false);
});

test("sessão válida do mesmo perfil é reutilizada sem PW_iInit e sem PW_iSetEnvironment", async () => {
  const biblioteca = bibliotecaPronta({
    inicializada: true,
    residente: true,
    origem: "conector",
    empresaId: "empresa-a",
    posid: "117473",
  });
  let abriu = false;
  const garantia = await garantirSessaoVenda(pedido({ biblioteca }), {
    ...depsDe(biblioteca),
    abrir: async () => {
      abriu = true;
      return biblioteca;
    },
  });
  assert.equal(garantia.ok, true);
  assert.equal(garantia.iniciou, false);
  assert.equal(abriu, false);
  assert.deepEqual(biblioteca.chamadas, []);
});

test("reinício do processo inicializa de novo e o segundo F2 reutiliza a sessão", async () => {
  const primeira = bibliotecaPronta();
  const aberta = await garantirSessaoVenda(pedido(), depsDe(primeira));
  assert.equal(aberta.iniciou, true);
  const repetido = await garantirSessaoVenda(pedido({ biblioteca: aberta.biblioteca }), depsDe(primeira));
  assert.equal(repetido.ok, true);
  assert.equal(repetido.iniciou, false);
  assert.equal(primeira.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(primeira.chamadas.filter((item) => item === "PW_iInit").length, 1);
});

test("PW_iInit INVCALL com ponto instalado segue para a porta automática", async () => {
  const biblioteca = bibliotecaPronta({
    async init() {
      this.chamadas.push("PW_iInit");
      this.inicializada = true;
      return PWRET.INVCALL;
    },
    async ppCommTest(porta) {
      this.chamadas.push(["PW_iPPCommTest", porta]);
      if (porta === 4) return { codigo: PWRET.PPCOMERR, porta: 0 };
      return { codigo: PWRET.OK, porta: 5 };
    },
  });
  let gravada = null;
  const garantia = await garantirSessaoVenda(pedido(), {
    ...depsDe(biblioteca),
    persistirPorta: async (entrada) => {
      gravada = entrada;
    },
  });
  assert.equal(garantia.ok, true);
  assert.equal(garantia.porta, 5);
  assert.equal(gravada.portaDescoberta, 5);
  assert.deepEqual(biblioteca.chamadas, ["PW_iInit", ["PW_iPPCommTest", 4], ["PW_iPPCommTest", 0]]);
  assert.equal(biblioteca.chamadas.includes("PW_iSetEnvironment"), false);
});

test("PinPad desconectado informa o cabo sem iniciar transação", async () => {
  const biblioteca = bibliotecaPronta({
    async ppCommTest(porta) {
      this.chamadas.push(["PW_iPPCommTest", porta]);
      return { codigo: PWRET.PPNOTFOUND, porta: 0 };
    },
  });
  const garantia = await garantirSessaoVenda(pedido({ portaSalva: null }), depsDe(biblioteca));
  assert.equal(garantia.ok, false);
  assert.equal(garantia.codigo, "pinpad");
  assert.match(garantia.mensagem, /não está conectado/);
  assert.match(garantia.mensagem, /cabo/);
  assert.equal(biblioteca.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(biblioteca.chamadas.includes("PW_iSetEnvironment"), false);
});

test("COM ocupada e resultado pendente não carregam a biblioteca", async () => {
  let abriu = false;
  const ocupada = await garantirSessaoVenda(pedido({ ocupacao: { origem: "diagnostico" } }), {
    abrir: async () => {
      abriu = true;
    },
  });
  assert.equal(ocupada.codigo, "ocupada");
  assert.match(ocupada.mensagem, /já está em uso/);
  const pendente = await garantirSessaoVenda(
    pedido({
      pendencia: {
        codigo: "reconciliacao",
        mensagem: "A reconciliação da sessão aberta sem execução ainda não foi comprovada. Nenhuma cobrança foi iniciada.",
      },
    }),
    {
      abrir: async () => {
        abriu = true;
      },
    }
  );
  assert.equal(pendente.codigo, "reconciliacao");
  assert.match(pendente.mensagem, /reconciliação/);
  assert.equal(abriu, false);
});

test("duas empresas não trocam a sessão e produção não reinicia a homologação", async () => {
  const biblioteca = bibliotecaPronta({
    inicializada: true,
    residente: true,
    origem: "conector",
    empresaId: "empresa-a",
    posid: "117473",
  });
  let abriu = false;
  const outra = await garantirSessaoVenda(pedido({ biblioteca, empresaId: "empresa-b" }), {
    abrir: async () => {
      abriu = true;
    },
  });
  assert.equal(outra.codigo, "empresa");
  assert.match(outra.mensagem, /não foi trocada/);
  const producao = await garantirSessaoVenda(pedido({ biblioteca, ambiente: "producao", diretorio: "C:\\UltraPDV\\TEF\\Producao\\PGWeb" }), {
    abrir: async () => {
      abriu = true;
    },
  });
  assert.equal(producao.codigo, "sessao");
  assert.match(producao.mensagem, /homologação/);
  assert.match(producao.mensagem, /não foi trocado/);
  assert.equal(abriu, false);
  assert.equal(biblioteca.empresaId, "empresa-a");
});

test("ponto ausente não chama PW_iSetEnvironment e a rota do F2 não pede Testar Comunicação", async () => {
  let abriu = false;
  const ausente = await garantirSessaoVenda(pedido({ pontoInstalado: false }), {
    abrir: async () => {
      abriu = true;
    },
  });
  assert.equal(ausente.codigo, "ponto");
  assert.match(ausente.mensagem, /não instalou o ponto/);
  assert.match(ausente.mensagem, /PW_iSetEnvironment não foi chamado/);
  assert.equal(abriu, false);
  const servidor = fs.readFileSync(path.join(import.meta.dirname, "server.mjs"), "utf8");
  const modulo = fs.readFileSync(path.join(import.meta.dirname, "tef-sessao-venda.mjs"), "utf8");
  const inicio = servidor.indexOf('url.pathname === "/tef/venda"');
  const bloco = servidor.slice(inicio, servidor.indexOf('url.pathname === "/tef/homologacao/menu"'));
  assert.equal(bloco.includes("decidirPerfilExecucao"), true);
  assert.equal(bloco.indexOf("decidirPerfilExecucao") < bloco.indexOf("garantirSessaoVenda"), true);
  assert.equal(bloco.indexOf("garantirSessaoVenda") < bloco.indexOf("await executarTransacaoHomologacao"), true);
  const menu = fs.readFileSync(path.join(import.meta.dirname, "tef-menu-conector.mjs"), "utf8");
  const iniciar = menu.slice(menu.indexOf('if (acao === "iniciar")'));
  assert.equal(iniciar.indexOf("await transporte.newTransac()") < iniciar.indexOf("marcarExecucaoIniciada"), true);
  assert.equal(servidor.includes("Teste a comunicação deste ambiente"), false);
  assert.equal(modulo.includes("COM7"), false);
  assert.equal(modulo.includes("PW_iNewTransac"), false);
  assert.equal(modulo.includes("setEnvironment"), false);
});
