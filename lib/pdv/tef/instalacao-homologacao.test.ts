import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { assinarEvidenciaInstalacao, verificarAssinaturaEvidenciaInstalacao } from "./evidencia-instalacao";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./motor";
import {
  classificarInstalacaoHomologacao,
  ESTADOS_INSTALACAO_HOMOLOGACAO,
  executarInstalacaoHomologacao,
  concluirEvidenciaInstalacaoHomologacao,
  gravarEvidenciaInstalacaoHomologacao,
  mascararCnpjInstalacao,
  montarConfirmacaoInstalacaoHomologacao,
  montarPedidoResponderInstalacao,
  planejarEvidenciaInstalacaoHomologacao,
  apresentarConsultaInstalacao,
  atualizarCapturasInstalacao,
  caminhoLogCommsHomologacao,
  recuperarConsultaDoProcessoAnterior,
  validarEncaminhamentoCapturas,
  type EntradaInstalacaoHomologacao,
  type ResultadoInstalacaoHomologacao,
} from "./instalacao-homologacao";

function entrada(parcial: Partial<EntradaInstalacaoHomologacao> = {}): EntradaInstalacaoHomologacao {
  return {
    ambiente: "homologacao",
    empresaAutorizada: true,
    terminalAutorizado: true,
    configuracaoCompleta: true,
    comunicacaoPinpad: true,
    evidenciaBiblioteca: false,
    emAndamento: false,
    pendenciaFinanceira: false,
    diretorio: "C:\\UltraPDV\\TEF\\Homologacao\\PGWeb",
    ...parcial,
  };
}

test("a instalação de homologação prepara o fluxo e não executa a biblioteca", () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  const preparado = classificarInstalacaoHomologacao(entrada());
  assert.equal(preparado.estado, "preparado");
  assert.equal(preparado.executar, false);
  assert.equal(preparado.abiComprovado, false);
  assert.equal(preparado.layoutHomologado, false);
  assert.equal(preparado.operacao, 0x01);
  assert.match(preparado.impedimento, /PW_GetData/);
  assert.match(preparado.impedimento, /confirmação explícita/);
  assert.equal(preparado.abiComprovado, false);
  assert.equal(preparado.etapas.some((etapa) => etapa.includes("PW_iNewTransac(PWOPER_INSTALL)")), true);
  assert.equal(preparado.etapas.some((etapa) => etapa.includes("PWRET_MOREDATA")), true);

  const executado = executarInstalacaoHomologacao(entrada());
  assert.equal(executado.executado, false);
  assert.equal(executado.ok, false);

  const comunicacao = classificarInstalacaoHomologacao(entrada({ evidenciaBiblioteca: false }));
  assert.notEqual(comunicacao.estado, "instalado_confirmado");
  const confirmado = classificarInstalacaoHomologacao(entrada({ evidenciaBiblioteca: true }));
  assert.equal(confirmado.estado, "instalado_confirmado");
  const andamento = classificarInstalacaoHomologacao(entrada({ emAndamento: true }));
  assert.equal(andamento.estado, "em_andamento");
  const falha = classificarInstalacaoHomologacao(entrada({ pendenciaFinanceira: true }));
  assert.equal(falha.estado, "falha_recuperacao");
  const incompleto = classificarInstalacaoHomologacao(entrada({ configuracaoCompleta: false }));
  assert.equal(incompleto.estado, "nao_instalado");
  assert.deepEqual(
    [...ESTADOS_INSTALACAO_HOMOLOGACAO],
    ["nao_instalado", "preparado", "em_andamento", "instalado_confirmado", "falha_recuperacao"]
  );
});

test("empresas e produção permanecem isoladas da instalação de homologação", () => {
  const empresaA = classificarInstalacaoHomologacao(entrada({ empresaAutorizada: true }));
  const empresaB = classificarInstalacaoHomologacao(
    entrada({ empresaAutorizada: false, terminalAutorizado: false, configuracaoCompleta: false })
  );
  assert.equal(empresaA.estado, "preparado");
  assert.equal(empresaB.estado, "nao_instalado");
  const producao = classificarInstalacaoHomologacao(
    entrada({
      ambiente: "producao",
      diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao\\PGWeb",
      evidenciaBiblioteca: true,
    })
  );
  assert.equal(producao.estado, "instalado_confirmado");
  assert.equal(producao.executar, false);

  const fonte = readFileSync(fileURLToPath(new URL("./instalacao-homologacao.ts", import.meta.url)), "utf8");
  const tela = readFileSync(
    fileURLToPath(new URL("../../../components/pdv/tef-instalacao-homologacao.tsx", import.meta.url)),
    "utf8"
  );
  assert.equal(/\d{14}/.test(fonte), false);
  assert.equal(fonte.includes("lerVinculo"), false);
  assert.equal(fonte.includes("print-agent.json"), false);
  assert.equal(tela.includes("18181"), false);
  assert.match(tela, /ROTULOS_INSTALACAO_HOMOLOGACAO/);
  assert.match(fonte, /Não instalado/);
  assert.match(fonte, /Preparado para instalação/);
  assert.match(fonte, /Instalação em andamento/);
  assert.match(fonte, /Instalado e confirmado/);
  assert.match(fonte, /Falha ou recuperação necessária/);

  const confirmacao = montarConfirmacaoInstalacaoHomologacao({
    ambiente: "homologacao",
    ponto: "ponto-lab",
    servidor: "lab.exemplo:31735",
    cnpjMascarado: mascararCnpjInstalacao("11222333000181"),
    dllIntegra: true,
    pinpadOcupado: false,
    portaPinpad: "COM7",
  });
  assert.equal(confirmacao.pronta, true);
  assert.equal(confirmacao.executar, false);
  assert.equal(confirmacao.abiComprovado, false);
  assert.equal(confirmacao.ambienteBiblioteca, "ENVRMNT_TEST");
  assert.equal(confirmacao.cnpj, "11.***.***/****-81");
  assert.equal(confirmacao.ponto, "ponto-lab");
  const confirmacaoProducao = montarConfirmacaoInstalacaoHomologacao({
    ambiente: "producao",
    ponto: "ponto-lab",
    servidor: "lab.exemplo:31735",
    cnpjMascarado: "11.***.***/****-81",
    dllIntegra: true,
    pinpadOcupado: false,
    portaPinpad: "",
  });
  assert.equal(confirmacaoProducao.pronta, true);
  assert.equal(confirmacaoProducao.ambienteBiblioteca, "ENVRMNT_PROD");
  assert.equal(confirmacaoProducao.ponto, "ponto-lab");
  assert.equal(confirmacaoProducao.servidor, "lab.exemplo:31735");
  assert.match(tela, /execucaoId/);
  assert.match(tela, /Confirmar instalação/);
  assert.match(tela, /Desfazer instalação/);
  assert.match(tela, /reinstalacaoAutorizada/);
  assert.match(tela, /PRECONDICOES_OK/);
  assert.match(tela, /Enviar somente os dados pedidos/);
  assert.match(tela, /montarPedidoResponderInstalacao/);
  const inicioEnvio = tela.indexOf('if (acao === "responder")');
  const envio = tela.slice(inicioEnvio, tela.indexOf("} else {", inicioEnvio));
  assert.equal(envio.includes("descobrirDispositivo"), true);
  assert.equal(envio.indexOf("validarEncaminhamentoCapturas") < envio.indexOf("descobrirDispositivo"), true);
});

test("o envio conjunto dos três dados pedidos leva execucaoId e atualiza a resposta", () => {
  const capturas = [
    { identificador: 0x11, prompt: "ponto", valorSugerido: "ponto-lab", sensivel: false },
    { identificador: 0x1c, prompt: "documento", valorSugerido: "", sensivel: false },
    { identificador: 0x1b, prompt: "servidor", valorSugerido: "lab.exemplo:31735", sensivel: false },
  ];
  const pedido = montarPedidoResponderInstalacao({
    dispositivoId,
    execucaoId,
    capturas,
    digitado: { [0x1c]: "documento-lab" },
  });
  assert.equal(pedido.ok, true);
  if (!pedido.ok) return;
  assert.equal(pedido.pedido.acao, "responder");
  assert.equal(pedido.pedido.execucaoId, execucaoId);
  assert.deepEqual(
    pedido.pedido.respostas.map((item) => item.identificador),
    [0x11, 0x1c, 0x1b]
  );
  assert.equal(pedido.pedido.respostas.every((item) => item.valor.length > 0), true);
  assert.equal(JSON.stringify(pedido.pedido).includes("documento-lab"), true);

  const semExecucao = validarEncaminhamentoCapturas({
    execucaoId: "",
    respostas: pedido.pedido.respostas,
  });
  assert.equal(semExecucao.ok, false);
  const vazio = validarEncaminhamentoCapturas({
    execucaoId,
    respostas: [{ identificador: 0x11, valor: "   " }, { identificador: 0x1c, valor: "documento-lab" }, { identificador: 0x1b, valor: "lab.exemplo:31735" }],
  });
  assert.equal(vazio.ok, false);
  const texto = validarEncaminhamentoCapturas({
    execucaoId,
    respostas: [
      { identificador: "17", valor: "ponto-lab" },
      { identificador: "28", valor: "documento-lab" },
      { identificador: "27", valor: "lab.exemplo:31735" },
    ],
  });
  assert.equal(texto.ok, true);
  if (texto.ok) {
    assert.deepEqual(
      texto.respostas.map((item) => item.identificador),
      [0x11, 0x1c, 0x1b]
    );
  }

  const seguintes = [{ identificador: 0xf6, prompt: "Dado sensível solicitado pelo PayGo.", valorSugerido: "", sensivel: true }];
  assert.deepEqual(atualizarCapturasInstalacao(capturas, { capturas: seguintes, codigo: "PWRET_MOREDATA" }), seguintes);
  assert.deepEqual(atualizarCapturasInstalacao(capturas, { codigo: "SESSAO_DIVERGENTE" }), capturas);
  assert.deepEqual(atualizarCapturasInstalacao(capturas, { codigo: "PWRET_OK" }), []);
});

test("a consulta recupera a sessão sem valores e recusa outra empresa", () => {
  const empresaA = "11111111-1111-4111-8111-111111111111";
  const empresaB = "22222222-2222-4222-8222-222222222222";
  const dispositivo = "33333333-3333-4333-8333-333333333333";
  const terminal = "44444444-4444-4444-8444-444444444444";
  const execucao = "55555555-5555-4555-8555-555555555555";
  const consulta = {
    ativa: true,
    execucaoId: execucao,
    capturas: [
      { identificador: 0x11, tipo: 2, prompt: "segredo-no-prompt", sensivel: false },
      { identificador: 0x1c, tipo: 2, prompt: "documento-lab", sensivel: false },
      { identificador: 0x1b, tipo: 2, prompt: "lab.exemplo:31735", sensivel: false },
    ],
  };
  const autorizada = apresentarConsultaInstalacao({
    empresaSessaoId: empresaA,
    empresaAutorizadaId: empresaA,
    dispositivoInformado: dispositivo,
    dispositivoAutorizado: dispositivo,
    terminalInformadoId: terminal,
    terminalAutorizadoId: terminal,
    consulta,
  });
  assert.equal(autorizada.ok, true);
  if (!autorizada.ok) return;
  assert.equal(autorizada.execucaoId, execucao);
  assert.deepEqual(
    autorizada.capturas.map((item) => item.identificador),
    [0x11, 0x1c, 0x1b]
  );
  assert.equal(autorizada.capturas.every((item) => item.valorSugerido === ""), true);
  const publicada = JSON.stringify(autorizada);
  assert.equal(publicada.includes("segredo-no-prompt"), false);
  assert.equal(publicada.includes("documento-lab"), false);
  assert.equal(publicada.includes("lab.exemplo"), false);

  const outraEmpresa = apresentarConsultaInstalacao({
    empresaSessaoId: empresaA,
    empresaAutorizadaId: empresaB,
    dispositivoInformado: dispositivo,
    dispositivoAutorizado: dispositivo,
    terminalInformadoId: terminal,
    terminalAutorizadoId: terminal,
    consulta,
  });
  assert.equal(outraEmpresa.ok, false);
  assert.equal(JSON.stringify(outraEmpresa).includes("segredo-no-prompt"), false);
  assert.equal(JSON.stringify(outraEmpresa).includes(execucao), false);

  const outroComputador = apresentarConsultaInstalacao({
    empresaSessaoId: empresaA,
    empresaAutorizadaId: empresaA,
    dispositivoInformado: "99999999-9999-4999-8999-999999999999",
    dispositivoAutorizado: dispositivo,
    terminalInformadoId: terminal,
    terminalAutorizadoId: terminal,
    consulta,
  });
  assert.equal(outroComputador.ok, false);

  const log = [
    "PW_iNewTransac",
    "PW_iExecTransac [0][2:0x11]",
    "PW_End",
    "PW_iNewTransac",
    "PW_iExecTransac [0][17:0xF6]",
    "PW_iAddParam(0xF6, segredo-teste)",
    "PW_iExecTransac [0][2:0x11]",
    "PW_iExecTransac [1][2:0x1C]",
    "PW_iExecTransac [2][2:0x1B]",
  ].join("\n");
  const recuperada = recuperarConsultaDoProcessoAnterior({
    respostaConector: { codigo: "SESSAO_DIVERGENTE", sessaoAberta: true, execucaoId: execucao },
    textoLog: log,
  });
  assert.equal(recuperada.ativa, true);
  assert.equal(recuperada.execucaoId, execucao);
  assert.deepEqual(
    recuperada.capturas.map((item) => [item.tipo, item.identificador, item.valorSugerido]),
    [
      [2, 0x11, ""],
      [2, 0x1c, ""],
      [2, 0x1b, ""],
    ]
  );
  assert.equal(JSON.stringify(recuperada).includes("segredo-teste"), false);
  const encerrada = recuperarConsultaDoProcessoAnterior({
    respostaConector: { codigo: "SESSAO_AUSENTE", sessaoAberta: false, execucaoId: execucao },
    textoLog: log,
  });
  assert.equal(encerrada.ativa, false);
  assert.equal(encerrada.capturas.length, 0);

  const arquivo = caminhoLogCommsHomologacao(
    { LOCALAPPDATA: "C:\\Users\\lab\\AppData\\Local", NODE_ENV: "development" },
    new Date(2026, 9, 17)
  );
  assert.equal(arquivo?.endsWith("comms_261017.log"), true);
  assert.equal(arquivo?.includes("conector-homologacao"), true);
  assert.equal(arquivo?.includes("Homologacao"), true);
  assert.equal(arquivo?.includes("Producao"), false);
});

const empresaId = "11111111-1111-4111-8111-111111111111";
const dispositivoId = "33333333-3333-4333-8333-333333333333";
const terminalId = "44444444-4444-4444-8444-444444444444";
const execucaoId = "55555555-5555-4555-8555-555555555555";

function resultado(parcial: Partial<ResultadoInstalacaoHomologacao> = {}): ResultadoInstalacaoHomologacao {
  return {
    instalado: true,
    codigo: "PWRET_OK",
    execucaoId,
    cnfreq: "0",
    retornoSetEnvironment: 0,
    sessaoAberta: false,
    interrompida: false,
    ponto: "ponto-lab",
    ...parcial,
  };
}

async function simularTabela(parcial: Partial<ResultadoInstalacaoHomologacao> = {}, assinar = true) {
  const linhas: Array<Record<string, string>> = [];
  const gerado = generateKeyPairSync("ed25519");
  const privada = gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publica = gerado.publicKey.export({ type: "spki", format: "pem" }).toString();
  const plano = planejarEvidenciaInstalacaoHomologacao({
    resultado: resultado(parcial),
    empresaId,
    dispositivoId,
    terminalId,
    estabelecimento: "LAB",
    ponto: "ponto-lab",
  });
  const gravacao = await gravarEvidenciaInstalacaoHomologacao({
    plano,
    assinar: (observacao) => {
      if (!assinar) return null;
      const assinada = assinarEvidenciaInstalacao(privada, observacao);
      if (!assinada) return null;
      return { campos: observacao, assinatura: assinada.assinatura };
    },
    inserir: async (registro) => {
      linhas.push(registro);
    },
  });
  return { gravacao, linhas, publica };
}

test("a evidência só é gravada depois da instalação comprovada", async () => {
  const sucesso = await simularTabela();
  assert.equal(sucesso.gravacao.persistida, true);
  assert.equal(sucesso.linhas.length, 1);
  const linha = sucesso.linhas[0];
  assert.equal(linha.empresa_id, empresaId);
  assert.equal(linha.dispositivo_id, dispositivoId);
  assert.equal(linha.terminal_id, terminalId);
  assert.equal(linha.instalacao_id, execucaoId);
  assert.equal(linha.ponto_captura, "ponto-lab");
  assert.equal(linha.estabelecimento, "LAB");
  assert.equal(linha.ambiente, "homologacao");
  assert.equal(linha.origem, "instalacao_controlada");
  assert.equal(
    verificarAssinaturaEvidenciaInstalacao(
      sucesso.publica,
      {
        empresaId: linha.empresa_id,
        dispositivoId: linha.dispositivo_id,
        terminalId: linha.terminal_id,
        pontoCaptura: linha.ponto_captura,
        estabelecimento: linha.estabelecimento,
        ambiente: "homologacao",
        instalacaoId: linha.instalacao_id,
      },
      linha.assinatura
    ),
    true
  );
  assert.deepEqual(Object.keys(linha).sort(), [
    "ambiente",
    "assinatura",
    "dispositivo_id",
    "empresa_id",
    "estabelecimento",
    "instalacao_id",
    "origem",
    "ponto_captura",
    "terminal_id",
  ]);

  const confirmada = await simularTabela({ codigo: "INSTALADO_CONFIRMADO", cnfreq: "1" });
  assert.equal(confirmada.gravacao.persistida, true);

  const recusas = [
    { codigo: "PWRET_MOREDATA", instalado: false, sessaoAberta: true },
    { codigo: "AGUARDANDO_CONFIRMACAO", instalado: false, sessaoAberta: true, cnfreq: "1" },
    { codigo: "PWRET_OK", instalado: true, cnfreq: "1", sessaoAberta: true },
    { codigo: "PW_iExecTransac", instalado: false },
    { codigo: "PWRET_NOTHING", instalado: false },
    { codigo: "DESFEITA", instalado: false, cnfreq: "1" },
    { codigo: "PWRET_OK", instalado: true, interrompida: true },
    { codigo: "SESSAO_AUSENTE", instalado: false, interrompida: true },
  ];
  for (const parcial of recusas) {
    const recusa = await simularTabela(parcial);
    assert.equal(recusa.gravacao.persistida, false, JSON.stringify(parcial));
    assert.equal(recusa.linhas.length, 0);
  }

  const semAssinatura = await simularTabela({}, false);
  assert.equal(semAssinatura.gravacao.persistida, false);
  assert.equal(semAssinatura.linhas.length, 0);
  if (!semAssinatura.gravacao.persistida) {
    assert.match(semAssinatura.gravacao.motivo, /assinatura do terminal/);
  }
});

test("instalação confirmada grava e interrupção ou chave solta não gravam", async () => {
  const gerado = generateKeyPairSync("ed25519");
  const privada = gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publica = gerado.publicKey.export({ type: "spki", format: "pem" }).toString();
  const base = {
    empresaId,
    dispositivoId,
    terminalId,
    estabelecimento: "LAB",
    pontoHomologacao: "ponto-lab",
    chavePublicaVinculada: publica,
    chavePublicaAssinante: publica,
  };
  const confirmado = resultado({ codigo: "INSTALADO_CONFIRMADO", cnfreq: "1", ponto: "ponto-lab" });
  const assinada = assinarEvidenciaInstalacao(privada, {
    empresaId,
    dispositivoId,
    terminalId,
    pontoCaptura: "ponto-lab",
    pontoInstalado: "ponto-lab",
    estabelecimento: "LAB",
    ambienteSolicitado: "homologacao",
    instalacaoId: execucaoId,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  });
  assert.ok(assinada);
  const gravada = concluirEvidenciaInstalacaoHomologacao({
    ...base,
    resultado: confirmado,
    assinatura: assinada.assinatura,
  });
  assert.equal(gravada.persistir, true);
  if (gravada.persistir) {
    assert.equal(gravada.registro.empresa_id, empresaId);
    assert.equal(gravada.registro.terminal_id, terminalId);
    assert.equal(gravada.registro.ponto_captura, "ponto-lab");
    assert.equal(gravada.registro.ambiente, "homologacao");
    assert.equal(gravada.registro.instalacao_id, execucaoId);
    assert.equal("privada" in gravada.registro, false);
  }
  const interrompida = concluirEvidenciaInstalacaoHomologacao({
    ...base,
    resultado: resultado({ interrompida: true, instalado: false, codigo: "SESSAO_AUSENTE" }),
    assinatura: assinada.assinatura,
  });
  assert.equal(interrompida.persistir, false);
  const solta = concluirEvidenciaInstalacaoHomologacao({
    ...base,
    chavePublicaVinculada: "",
    resultado: confirmado,
    assinatura: assinada.assinatura,
  });
  assert.equal(solta.persistir, false);
  if (!solta.persistir) assert.match(solta.motivo, /não está vinculada/);
  const invalida = concluirEvidenciaInstalacaoHomologacao({
    ...base,
    resultado: confirmado,
    assinatura: assinada.assinatura.replace(/^./, assinada.assinatura.startsWith("A") ? "B" : "A"),
  });
  assert.equal(invalida.persistir, false);
});
