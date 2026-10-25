import path from "node:path";

import { perfilSessaoAtiva } from "./tef-perfil-execucao.mjs";
import { PWRET } from "./tef-pgweb.mjs";

const PORTA_AUTOMATICA = 0;
const LIMITE_ESPERA_MS = 15000;

const estadoProcesso = { fila: Promise.resolve() };
const memoriaProcesso = { atual: null };

function normalizarDiretorio(diretorio) {
  const texto = String(diretorio ?? "").trim();
  return texto ? path.win32.normalize(texto).toLowerCase() : "";
}

function portaValida(porta) {
  return Number.isInteger(porta) && porta > 0 && porta < 255;
}

function recusa(codigo, mensagem, extra = {}) {
  return {
    ok: false,
    codigo,
    mensagem,
    biblioteca: null,
    iniciou: false,
    comandoDll: false,
    novaCobranca: false,
    pagamentoRecebido: false,
    ...extra,
  };
}

export function classificarSessaoVenda(biblioteca, pedido = {}) {
  const perfil = perfilSessaoAtiva(biblioteca);
  if (!biblioteca || biblioteca.inicializada !== true || !perfil) {
    return { acao: "iniciar", codigo: "ausente" };
  }
  if (perfil !== pedido.ambiente) {
    const ocupada = perfil === "producao" ? "produção" : "homologação";
    return {
      acao: "bloquear",
      codigo: "sessao",
      mensagem: `A sessão ativa está em ${ocupada}. O ambiente não foi trocado. Nenhuma cobrança foi iniciada.`,
    };
  }
  const diretorioSessao = normalizarDiretorio(biblioteca.diretorio);
  const diretorioPedido = normalizarDiretorio(pedido.diretorio);
  if (diretorioSessao && diretorioPedido && diretorioSessao !== diretorioPedido) {
    return {
      acao: "bloquear",
      codigo: "sessao",
      mensagem: "A sessão ativa usa outro diretório. O diretório não foi trocado. Nenhuma cobrança foi iniciada.",
    };
  }
  if (biblioteca.empresaId && biblioteca.empresaId !== pedido.empresaId) {
    return {
      acao: "bloquear",
      codigo: "empresa",
      mensagem: "Outra empresa já ocupa a sessão deste computador. A sessão não foi trocada. Nenhum pagamento foi iniciado.",
    };
  }
  if (biblioteca.posid && pedido.posid && biblioteca.posid !== pedido.posid) {
    return {
      acao: "bloquear",
      codigo: "posid",
      mensagem: "O ponto de captura da sessão ativa é outro. A sessão não foi trocada. Nenhum pagamento foi iniciado.",
    };
  }
  return { acao: "reutilizar", codigo: "valida" };
}

function vincularSessao(biblioteca, pedido) {
  if (!biblioteca.empresaId) biblioteca.empresaId = pedido.empresaId;
  if (!biblioteca.posid && pedido.posid) biblioteca.posid = pedido.posid;
  if (!biblioteca.diretorio) biblioteca.diretorio = pedido.diretorio;
  biblioteca.homologacao = pedido.ambiente === "homologacao";
  biblioteca.producao = pedido.ambiente === "producao";
  return biblioteca;
}

async function verificarPinpad(biblioteca, portaSalva, registrar) {
  const inicial = portaValida(portaSalva) ? portaSalva : PORTA_AUTOMATICA;
  let teste = await biblioteca.ppCommTest(inicial);
  registrar("PW_iPPCommTest");
  if (inicial !== PORTA_AUTOMATICA && (teste?.codigo !== PWRET.OK || !portaValida(teste?.porta))) {
    teste = await biblioteca.ppCommTest(PORTA_AUTOMATICA);
    registrar("PW_iPPCommTest");
  }
  let voltas = 0;
  while ((teste?.codigo === PWRET.NOTHING || teste?.codigo === PWRET.DISPLAY) && voltas < 8) {
    voltas += 1;
    teste = await biblioteca.ppCommTest(PORTA_AUTOMATICA);
    registrar("PW_iPPCommTest");
  }
  return teste;
}

async function executarGarantia(pedido, deps) {
  const ambiente = pedido.ambiente === "producao" || pedido.ambiente === "homologacao" ? pedido.ambiente : "";
  const empresaId = String(pedido.empresaId ?? "").trim();
  const posid = String(pedido.posid ?? "").trim();
  const pedidoSessao = { ...pedido, ambiente, empresaId, posid };
  if (!ambiente || !empresaId) {
    return recusa("perfil", "A venda precisa do ambiente gravado e da empresa autorizada. Nenhum comando foi enviado.");
  }
  const memoria = deps.memoria ?? memoriaProcesso;
  const classe = classificarSessaoVenda(pedido.biblioteca ?? memoria.atual, pedidoSessao);
  if (classe.acao === "bloquear") return recusa(classe.codigo, classe.mensagem);
  if (classe.acao === "reutilizar") {
    let biblioteca = pedido.biblioteca ?? memoria.atual;
    if (biblioteca.residente !== true && typeof deps.promover === "function") {
      biblioteca = (await deps.promover(biblioteca, pedido.diretorio)) ?? biblioteca;
    }
    biblioteca = vincularSessao(biblioteca, pedidoSessao);
    memoria.atual = biblioteca;
    return {
      ok: true,
      codigo: "reutilizada",
      mensagem: "",
      biblioteca,
      iniciou: false,
      comandoDll: false,
      novaCobranca: false,
    };
  }
  if (pedido.transacaoAtiva === true) {
    return recusa(
      "pendencia",
      pedido.pendencia?.mensagem ||
        "Há operação financeira pendente neste computador. Nenhuma nova cobrança foi iniciada."
    );
  }
  if (pedido.pendencia?.mensagem) {
    return recusa(pedido.pendencia.codigo || "pendencia", pedido.pendencia.mensagem);
  }
  if (pedido.ocupacao?.origem) {
    return recusa(
      "ocupada",
      "O PinPad deste computador já está em uso. Aguarde a conclusão. Nenhum pagamento foi iniciado."
    );
  }
  if (pedido.pontoInstalado !== true) {
    return recusa(
      "ponto",
      "O ponto de captura deste ambiente não está instalado. A venda não instalou o ponto. PW_iSetEnvironment não foi chamado."
    );
  }
  if (typeof deps.abrir !== "function") {
    return recusa("sessao", "A PGWebLib não está disponível neste Connector. Nenhum pagamento foi iniciado.");
  }
  const registrar = (nome) => {
    if (typeof deps.registrar === "function") deps.registrar(nome);
  };
  const biblioteca = await deps.abrir(deps.arquivoDll);
  biblioteca.homologacao = ambiente === "homologacao";
  biblioteca.producao = ambiente === "producao";
  biblioteca.diretorio = pedido.diretorio;
  const initCodigo = await biblioteca.init(pedido.diretorio);
  registrar("PW_iInit");
  const initAceito = initCodigo === PWRET.OK || (initCodigo === PWRET.INVCALL && pedido.pontoInstalado === true);
  if (!initAceito) {
    return recusa(
      "sessao",
      `A PGWebLib não iniciou neste ambiente. PW_iInit retornou ${initCodigo}. Nenhum pagamento foi iniciado.`
    );
  }
  biblioteca.inicializada = true;
  const teste = await verificarPinpad(biblioteca, pedido.portaSalva, registrar);
  if (teste?.codigo === PWRET.PPNOTFOUND || teste?.codigo === PWRET.PPCOMERR || teste?.codigo !== PWRET.OK || !portaValida(teste?.porta)) {
    const desconectado = teste?.codigo === PWRET.PPNOTFOUND || teste?.codigo === PWRET.PPCOMERR || !portaValida(teste?.porta);
    return recusa(
      "pinpad",
      desconectado
        ? "O PinPad não está conectado neste computador. Confira o cabo e a energia. Nenhum pagamento foi iniciado."
        : `O PinPad não confirmou a comunicação. PW_iPPCommTest retornou ${teste?.codigo}. Nenhum pagamento foi iniciado.`
    );
  }
  if (typeof deps.persistirPorta === "function") {
    await deps.persistirPorta({
      portaDescoberta: teste.porta,
      portaSalva: portaValida(pedido.portaSalva) ? pedido.portaSalva : null,
      transacaoAtiva: false,
    });
  }
  vincularSessao(biblioteca, pedidoSessao);
  const promovida = typeof deps.promover === "function" ? await deps.promover(biblioteca, pedido.diretorio) : biblioteca;
  if (!promovida) {
    return recusa("sessao", "A PGWebLib iniciou, mas a sessão da venda não ficou disponível. Nenhuma cobrança foi iniciada.");
  }
  memoria.atual = promovida;
  return {
    ok: true,
    codigo: "iniciada",
    mensagem: "",
    biblioteca: promovida,
    iniciou: true,
    porta: teste.porta,
    comandoDll: false,
    novaCobranca: false,
  };
}

export function garantirSessaoVenda(pedido = {}, deps = {}) {
  const limite = Number(deps.limiteEsperaMs) > 0 ? Number(deps.limiteEsperaMs) : LIMITE_ESPERA_MS;
  const estadoFila = deps.estadoFila ?? estadoProcesso;
  const anterior = estadoFila.fila;
  let resolveExecucao = () => {};
  const execucao = new Promise((resolve) => {
    resolveExecucao = resolve;
  });
  estadoFila.fila = anterior.then(() => execucao.then(() => undefined, () => undefined));
  let respondeu = false;
  const responder = (valor) => {
    if (respondeu) return;
    respondeu = true;
    resolveExecucao(valor);
  };
  const timer = setTimeout(() => {
    responder(
      recusa("ocupada", "O PinPad deste computador já está em uso. Aguarde a conclusão. Nenhum pagamento foi iniciado.")
    );
  }, limite);
  anterior
    .then(async () => {
      if (respondeu) return;
      clearTimeout(timer);
      try {
        responder(await executarGarantia(pedido, deps));
      } catch {
        responder(recusa("sessao", "A PGWebLib não iniciou neste ambiente. Nenhum pagamento foi iniciado."));
      }
    })
    .catch(() => {
      clearTimeout(timer);
      responder(recusa("sessao", "A PGWebLib não iniciou neste ambiente. Nenhum pagamento foi iniciado."));
    });
  return execucao;
}
