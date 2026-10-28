import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  camposAoSelecionarAmbiente,
  descreverFormularioPayGo,
  descreverStatusConnector,
  descreverTerminaisVinculados,
  montarServidorFormulario,
  autorizarComputadorHomologacao,
  cnpjHomologacaoRepeteProducao,
  credencialPayGoDoAmbiente,
  legendaPontoVinculo,
  persistirConfiguracaoPayGo,
  selecionarPontoDoAmbiente,
  terminalExclusivoHomologacao,
  validarConfiguracaoPayGo,
  type EstadoConfiguracaoPayGo,
  type EnvioConfiguracaoPayGo,
} from "./configuracao-paygo";
import {
  MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF,
  avaliarParcelasCartao,
} from "./cartao-checkout";
import { simularDiagnosticoPinpad } from "./pinpad-diagnostico";

const SERVIDOR_HOMOLOG = "tef.loja.example:31735";
const SERVIDOR_PROD = "tef.loja-prod.example:31736";

function estado(parcial: Partial<EstadoConfiguracaoPayGo> = {}): EstadoConfiguracaoPayGo {
  return {
    habilitado: false,
    ambiente: "homologacao",
    estabelecimento: "",
    cnpjInstalacao: "",
    cnpjProducao: "",
    pontoCaptura: "",
    pontoHomologacao: "",
    servidorHomologacao: "",
    servidorProducao: "",
    permitirOperacaoManual: false,
    instalacaoHomologacaoConfirmada: false,
    instalacaoProducaoConfirmada: false,
    ...parcial,
  };
}

function envio(parcial: Partial<EnvioConfiguracaoPayGo> = {}): EnvioConfiguracaoPayGo {
  return {
    habilitado: false,
    ambiente: "homologacao",
    estabelecimento: "Loja 1",
    cnpjInstalacao: "11222333000181",
    pontoCaptura: "100200",
    servidor: SERVIDOR_HOMOLOG,
    ...parcial,
  };
}

type SessaoSimulada = {
  autenticado: boolean;
  empresaId: string;
  podeEditar: boolean;
} | null;

function aplicarComSessaoSimulada(
  memoria: Map<string, EstadoConfiguracaoPayGo>,
  sessao: SessaoSimulada,
  pedido: EnvioConfiguracaoPayGo
) {
  if (!sessao?.autenticado || !sessao.empresaId) {
    return { ok: false as const, erro: "Não há sessão autenticada." };
  }
  if (!sessao.podeEditar) {
    return { ok: false as const, erro: "Sem permissão para editar o financeiro." };
  }
  const atual = memoria.get(sessao.empresaId);
  if (!atual) {
    return { ok: false as const, erro: "Empresa da sessão não encontrada." };
  }
  const plano = persistirConfiguracaoPayGo(atual, pedido);
  if (!plano.ok) {
    return plano;
  }
  memoria.set(sessao.empresaId, plano.estado);
  return plano;
}

test("formulário PayGo Integrado descreve habilitação, ambientes, ponto e servidor", () => {
  const vazio = descreverFormularioPayGo(estado());
  assert.equal(vazio.habilitado, false);
  assert.equal(vazio.ambiente, "homologacao");
  assert.equal(vazio.associacaoTravada, false);
  assert.equal(vazio.temCampoAutcap, false);
  assert.deepEqual(
    camposAoSelecionarAmbiente(
      estado({ servidorHomologacao: SERVIDOR_HOMOLOG, servidorProducao: SERVIDOR_PROD }),
      "homologacao"
    ),
    { host: "tef.loja.example", porta: "31735" }
  );
  assert.deepEqual(
    camposAoSelecionarAmbiente(
      estado({ servidorHomologacao: SERVIDOR_HOMOLOG, servidorProducao: SERVIDOR_PROD }),
      "producao"
    ),
    { host: "tef.loja-prod.example", porta: "31736" }
  );

  const instalado = descreverFormularioPayGo(
    estado({
      habilitado: true,
      ambiente: "producao",
      estabelecimento: "Loja 1",
      pontoCaptura: "100200",
      servidorProducao: SERVIDOR_PROD,
      instalacaoProducaoConfirmada: true,
    })
  );
  assert.equal(instalado.habilitado, true);
  assert.equal(instalado.ambiente, "producao");
  assert.equal(instalado.host, "tef.loja-prod.example");
  assert.equal(instalado.porta, "31736");
  assert.equal(instalado.associacaoTravada, true);
  assert.equal(instalado.ambienteBiblioteca, "ENVRMNT_PROD");
  assert.match(instalado.avisoAssociacao, /confirmada/);
  const homologacao = descreverFormularioPayGo(
    estado({ ambiente: "homologacao", servidorHomologacao: SERVIDOR_HOMOLOG, pontoHomologacao: "300300" })
  );
  assert.equal(homologacao.associacaoTravada, false);
  assert.equal(homologacao.ambienteCodigo, 1);
  assert.equal(homologacao.ambienteBiblioteca, "ENVRMNT_TEST");
  assert.equal(homologacao.pontoCaptura, "300300");
});

test("ponto instalado recusa troca e a primeira associação grava só o ambiente escolhido", () => {
  const memoria = new Map<string, EstadoConfiguracaoPayGo>([
    ["empresa-a", estado()],
    [
      "empresa-b",
      estado({
        habilitado: true,
        pontoCaptura: "OUTRA",
        servidorHomologacao: "outra.example:1",
      }),
    ],
  ]);
  const sessao = { autenticado: true, empresaId: "empresa-a", podeEditar: true };
  const primeira = aplicarComSessaoSimulada(memoria, sessao, envio({ habilitado: true }));
  assert.equal(primeira.ok, true);
  if (!primeira.ok) return;
  assert.equal(primeira.associacao, "gravar");
  assert.equal(primeira.estado.habilitado, true);
  assert.equal(primeira.estado.ambiente, "homologacao");
  assert.equal(primeira.estado.pontoHomologacao, "100200");
  assert.equal(primeira.estado.pontoCaptura, "");
  assert.equal(primeira.estado.servidorHomologacao, SERVIDOR_HOMOLOG);
  assert.equal(primeira.estado.servidorProducao, "");
  assert.equal(memoria.get("empresa-b")?.pontoCaptura, "OUTRA");

  memoria.set(
    "empresa-a",
    estado({
      habilitado: true,
      ambiente: "producao",
      pontoCaptura: "400400",
      servidorProducao: SERVIDOR_PROD,
      instalacaoProducaoConfirmada: true,
    })
  );
  const troca = aplicarComSessaoSimulada(
    memoria,
    sessao,
    envio({
      habilitado: true,
      ambiente: "producao",
      pontoCaptura: "500500",
      servidor: "tef.outro-prod.example:443",
    })
  );
  assert.equal(troca.ok, false);
  assert.equal(memoria.get("empresa-a")?.pontoCaptura, "400400");
  assert.equal(memoria.get("empresa-a")?.servidorProducao, SERVIDOR_PROD);

  const homologacao = aplicarComSessaoSimulada(
    memoria,
    sessao,
    envio({ habilitado: true, ambiente: "homologacao", pontoCaptura: "300300" })
  );
  assert.equal(homologacao.ok, true);
  if (!homologacao.ok) return;
  assert.equal(homologacao.estado.pontoCaptura, "400400");
  assert.equal(homologacao.estado.pontoHomologacao, "300300");
  assert.equal(homologacao.estado.servidorProducao, SERVIDOR_PROD);
});

test("erros de habilitação, porta e sessão não gravam a configuração", () => {
  const memoria = new Map<string, EstadoConfiguracaoPayGo>([["empresa-a", estado()]]);
  const sessao = { autenticado: true, empresaId: "empresa-a", podeEditar: true };
  const semEstabelecimento = aplicarComSessaoSimulada(
    memoria,
    sessao,
    envio({ habilitado: true, estabelecimento: "  " })
  );
  assert.equal(semEstabelecimento.ok, false);
  const portaInvalida = aplicarComSessaoSimulada(
    memoria,
    sessao,
    envio({ servidor: "tef.loja.example:99999" })
  );
  assert.equal(portaInvalida.ok, false);
  if (portaInvalida.ok) return;
  assert.match(portaInvalida.erro, /porta/i);
  const semSessao = aplicarComSessaoSimulada(memoria, null, envio({ habilitado: true }));
  assert.deepEqual(semSessao, { ok: false, erro: "Não há sessão autenticada." });
  const semPermissao = aplicarComSessaoSimulada(
    memoria,
    { autenticado: true, empresaId: "empresa-a", podeEditar: false },
    envio({ habilitado: true })
  );
  assert.equal(semPermissao.ok, false);
  assert.equal(memoria.get("empresa-a")?.habilitado, false);
  assert.equal(memoria.get("empresa-a")?.pontoCaptura, "");
  assert.equal(montarServidorFormulario("", ""), "");
  assert.equal(montarServidorFormulario(" tef.loja.example ", " 31735 "), SERVIDOR_HOMOLOG);
  assert.equal(montarServidorFormulario(SERVIDOR_HOMOLOG, "31735"), SERVIDOR_HOMOLOG);
  assert.equal(montarServidorFormulario(SERVIDOR_HOMOLOG, ""), SERVIDOR_HOMOLOG);
  assert.equal(montarServidorFormulario("tef.loja.example", "70000"), "tef.loja.example:70000");
});

test("terminal vinculado, status do Connector e pinpad simulado não chamam a biblioteca", () => {
  const terminais = descreverTerminaisVinculados([
    { codigo: "CX-01", dispositivoId: "pc-1" },
    { codigo: "CX-02", dispositivoId: "" },
  ]);
  assert.equal(terminais.vazio, false);
  assert.deepEqual(
    terminais.itens.map((item) => item.texto),
    ["CX-01 · computador vinculado", "CX-02 · sem computador"]
  );
  assert.match(descreverTerminaisVinculados([]).texto, /Nenhum terminal vinculado/);

  const ausente = descreverStatusConnector({
    connectorEncontrado: false,
    terminalVinculado: false,
    credenciamentoNecessario: false,
    credenciamentoOk: false,
    pinpadVerificado: false,
  });
  assert.equal(ausente.find((etapa) => etapa.id === "connector")?.concluida, false);
  assert.match(ausente.find((etapa) => etapa.id === "connector")?.explicacao ?? "", /Connector/);

  const presente = descreverStatusConnector({
    connectorEncontrado: true,
    terminalVinculado: true,
    credenciamentoNecessario: true,
    credenciamentoOk: true,
    pinpadVerificado: false,
  });
  assert.equal(presente.find((etapa) => etapa.id === "connector")?.concluida, true);
  assert.equal(presente.find((etapa) => etapa.id === "vinculo")?.concluida, true);
  assert.equal(presente.find((etapa) => etapa.id === "pinpad")?.concluida, false);

  for (const roteiro of ["confirmado", "ausente", "timeout", "ocupado", "conector_ausente"] as const) {
    const diagnostico = simularDiagnosticoPinpad(roteiro);
    assert.equal(diagnostico.cobrancaIniciada, false);
    assert.equal(diagnostico.dllCarregada, false);
    assert.equal(diagnostico.bibliotecaChamada, false);
    assert.ok(diagnostico.mensagem.length > 0);
  }
  assert.equal(
    simularDiagnosticoPinpad("confirmado").mensagem,
    "Pinpad conectado e comunicação confirmada."
  );
  assert.match(simularDiagnosticoPinpad("conector_ausente").mensagem, /Connector não encontrado/);
});

test("página, ação e motor permanecem sem AUTCAP manual e sem publicar o pgweb-2", () => {
  const pagina = readFileSync(new URL("../../../app/configuracoes/financeiro/tef/page.tsx", import.meta.url), "utf8");
  const acao = readFileSync(new URL("../../../app/configuracoes/financeiro/tef/actions.ts", import.meta.url), "utf8");
  const formulario = readFileSync(
    new URL("../../../components/pdv/tef-paygo-integrado.tsx", import.meta.url),
    "utf8"
  );
  const pinpad = readFileSync(
    new URL("../../../components/pdv/tef-pinpad-diagnostico.tsx", import.meta.url),
    "utf8"
  );
  const status = readFileSync(
    new URL("../../../components/pdv/tef-status-configuracao.tsx", import.meta.url),
    "utf8"
  );
  const servico = readFileSync(new URL("./servico.ts", import.meta.url), "utf8");
  const motor = readFileSync(new URL("./motor.ts", import.meta.url), "utf8");
  assert.equal(existsSync(new URL("../../../tef-2/agente/PgWebLib.pas", import.meta.url)), false);
  const juntos = `${pagina}\n${acao}\n${formulario}`;
  assert.equal(/autcap|name="capacidades"/i.test(juntos), false);
  assert.match(pagina, /Integração operacional desativada/);
  assert.equal(pagina.includes("TefPaygoIntegradoForm"), false);
  assert.equal(pagina.includes("lerServidoresPayGoEmpresa"), false);
  assert.equal(pagina.includes("TefPainelStatus"), false);
  assert.match(status, /TefPinpadDiagnostico/);
  assert.match(status, /Configuração salva/);
  assert.match(status, /Connector conectado/);
  assert.match(status, /PinPad indisponível/);
  assert.match(status, /Instalação PayGo pendente/);
  assert.match(status, /Instalação PayGo concluída/);
  assert.equal(pagina.includes("TefPastaForm"), false);
  assert.equal(pagina.includes("TefAssistente"), false);
  assert.equal(pagina.includes("UltraPDVTef_"), false);
  assert.match(formulario, /Habilitar TEF/);
  assert.match(formulario, /Homologação/);
  assert.match(formulario, /Produção/);
  assert.match(formulario, /camposAoSelecionarAmbiente/);
  assert.match(formulario, /name="servidorHost"/);
  assert.match(formulario, /name="servidorPorta"/);
  assert.match(formulario, /comporServidorPayGo/);
  assert.match(formulario, /name="cnpjInstalacao"/);
  assert.match(formulario, /Validar configuração/);
  assert.match(formulario, /ENVRMNT_TEST/);
  assert.match(acao, /validarConfiguracaoTef/);
  const separacao = validarConfiguracaoPayGo(
    estado({ pontoCaptura: "400400", servidorProducao: SERVIDOR_PROD }),
    envio({ pontoCaptura: "400400", servidor: SERVIDOR_HOMOLOG })
  );
  assert.equal(separacao.ok, true);
  const servidorRepetido = validarConfiguracaoPayGo(
    estado({ pontoCaptura: "400400", servidorProducao: SERVIDOR_HOMOLOG }),
    envio({ pontoCaptura: "ponto-lab", servidor: SERVIDOR_HOMOLOG })
  );
  assert.equal(servidorRepetido.ok, false);
  assert.equal(separacao.executaInstalacao, false);
  assert.equal(separacao.executaTransacao, false);
  assert.equal(separacao.mensagens.join(" ").includes("11222333000181"), false);
  assert.equal(separacao.ambienteBiblioteca, "ENVRMNT_TEST");
  const homologacao = credencialPayGoDoAmbiente({
    ambiente: "homologacao",
    pontoCaptura: "400400",
    pontoHomologacao: "300300",
    servidorHomologacao: SERVIDOR_HOMOLOG,
    servidorProducao: SERVIDOR_PROD,
    cnpjHomologacao: "11222333000181",
    cnpjProducao: "11444777000161",
    cnpjTerminal: "11444777000161",
  });
  assert.equal(homologacao.ok, true);
  if (homologacao.ok) {
    assert.equal(homologacao.ponto, "300300");
    assert.equal(homologacao.cnpj, "11222333000181");
    assert.equal(homologacao.cnpjDoTerminal, false);
  }
  const semHomologacao = credencialPayGoDoAmbiente({
    ambiente: "homologacao",
    pontoCaptura: "400400",
    pontoHomologacao: "",
    servidorHomologacao: "",
    servidorProducao: SERVIDOR_PROD,
    cnpjHomologacao: "",
    cnpjProducao: "",
    cnpjTerminal: "11444777000161",
  });
  assert.equal(semHomologacao.ok, false);
  const producaoHerdada = credencialPayGoDoAmbiente({
    ambiente: "producao",
    pontoCaptura: "400400",
    pontoHomologacao: "300300",
    servidorHomologacao: SERVIDOR_HOMOLOG,
    servidorProducao: SERVIDOR_PROD,
    cnpjHomologacao: "11222333000181",
    cnpjProducao: "",
    cnpjTerminal: "11444777000161",
  });
  assert.equal(producaoHerdada.ok, true);
  if (producaoHerdada.ok) {
    assert.equal(producaoHerdada.ponto, "400400");
    assert.equal(producaoHerdada.cnpj, "11444777000161");
    assert.equal(producaoHerdada.cnpjDoTerminal, true);
  }
  const gravada = persistirConfiguracaoPayGo(
    estado({
      cnpjProducao: "11444777000161",
      pontoCaptura: "400400",
      servidorProducao: SERVIDOR_PROD,
    }),
    envio({ pontoCaptura: "300300" })
  );
  assert.equal(gravada.ok, true);
  if (gravada.ok) {
    assert.equal(gravada.estado.cnpjInstalacao, "11222333000181");
    assert.equal(gravada.estado.cnpjProducao, "11444777000161");
    assert.equal(gravada.estado.pontoCaptura, "400400");
  }
  assert.match(acao, /montarServidorFormulario/);
  const homologacaoSeparada = persistirConfiguracaoPayGo(
    estado({
      cnpjProducao: "11444777000161",
      pontoCaptura: "400400",
      servidorProducao: SERVIDOR_PROD,
    }),
    envio({
      habilitado: true,
      ambiente: "homologacao",
      pontoCaptura: "300300",
      servidor: montarServidorFormulario("tef.loja.example", "31735"),
    })
  );
  assert.equal(homologacaoSeparada.ok, true);
  if (homologacaoSeparada.ok) {
    assert.equal(homologacaoSeparada.estado.servidorHomologacao, SERVIDOR_HOMOLOG);
    assert.equal(homologacaoSeparada.estado.servidorProducao, SERVIDOR_PROD);
    assert.equal(homologacaoSeparada.estado.pontoCaptura, "400400");
    assert.equal(homologacaoSeparada.estado.pontoHomologacao, "300300");
    assert.equal(homologacaoSeparada.estado.cnpjProducao, "11444777000161");
  }
  const producaoCompleta = persistirConfiguracaoPayGo(
    estado({
      cnpjInstalacao: "11222333000181",
      pontoHomologacao: "300300",
      servidorHomologacao: SERVIDOR_HOMOLOG,
    }),
    envio({
      habilitado: true,
      ambiente: "producao",
      cnpjInstalacao: "11444777000161",
      pontoCaptura: "400400",
      servidor: montarServidorFormulario(SERVIDOR_PROD, "31736"),
    })
  );
  assert.equal(producaoCompleta.ok, true);
  if (producaoCompleta.ok) {
    assert.equal(producaoCompleta.estado.servidorProducao, SERVIDOR_PROD);
    assert.equal(producaoCompleta.estado.servidorHomologacao, SERVIDOR_HOMOLOG);
    assert.equal(producaoCompleta.estado.pontoHomologacao, "300300");
    assert.equal(producaoCompleta.estado.cnpjInstalacao, "11222333000181");
  }
  const portaInvalidaSeparada = validarConfiguracaoPayGo(
    estado(),
    envio({ habilitado: true, servidor: montarServidorFormulario("tef.loja.example", "0") })
  );
  assert.equal(portaInvalidaSeparada.ok, false);
  assert.match(portaInvalidaSeparada.mensagens.join(" "), /porta/i);
  assert.match(acao, /erro=\$\{encodeURIComponent/);
  assert.match(acao, /sucesso=1/);
  assert.match(servico, /resolverContextoAutorizadoEmpresa/);
  assert.match(servico, /persistirConfiguracaoPayGo/);
  assert.match(pinpad, /Identificar Pinpad/);
  assert.match(pinpad, /Testar Comunicação/);
  assert.equal(/LoadLibrary|PGWebLib\.dll|PW_iInit/.test(pinpad), false);
  assert.match(motor, /PGWEB2_PRODUCAO = true/);
  assert.match(motor, /ABI_COMPROVADO = false/);
  assert.match(motor, /LAYOUT_HOMOLOGADO = false/);
  assert.equal(existsSync(new URL("../../../tef-2/agente/PgWebLib.pas", import.meta.url)), false);
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20261017000000_tef_motor_pgweb.sql", import.meta.url),
    "utf8"
  );
  assert.equal(/DROP TABLE|TRUNCATE|DELETE FROM/i.test(migration), false);
  assert.match(migration, /motor = 'pgweb'/);
  const pacote = readFileSync(
    new URL("../../../tef-2/conector/pacote-definitivo.json", import.meta.url),
    "utf8"
  );
  assert.match(pacote, /UltraPDVPgWeb\.exe/);
  assert.equal(pacote.includes("UltraPDVTef_1316.exe") && pacote.includes('"agente": "bin/tef/UltraPDVTef_1316.exe"'), false);
  assert.match(pacote, /"publicado": false/);
});

test("homologação não herda ponto de produção nem ponto de outra empresa", () => {
  const perfil = {
    empresaId: "empresa-a",
    empresaOrigem: "empresa-a",
    servidorHomologacao: SERVIDOR_HOMOLOG,
    servidorProducao: SERVIDOR_PROD,
  };
  const homologacao = selecionarPontoDoAmbiente({
    ambiente: "homologacao",
    pontoCapturaProducao: "400400",
    pontoHomologacao: "ponto-lab",
  });
  assert.equal(homologacao.ok, true);
  if (homologacao.ok) assert.equal(homologacao.pontoCapturaAtivo, "ponto-lab");
  const producaoAtiva = selecionarPontoDoAmbiente({
    ambiente: "producao",
    pontoCapturaProducao: "400400",
    pontoHomologacao: "ponto-lab",
  });
  assert.equal(producaoAtiva.ok, true);
  if (producaoAtiva.ok) assert.equal(producaoAtiva.pontoCapturaAtivo, "400400");
  const ausente = selecionarPontoDoAmbiente({
    ambiente: "homologacao",
    pontoCapturaProducao: "400400",
    pontoHomologacao: "",
  });
  assert.equal(ausente.ok, false);
  if (!ausente.ok) assert.equal(ausente.codigo, "ponto-homologacao");
  assert.equal(ausente.pontoCapturaAtivo, "");

  const aceito = terminalExclusivoHomologacao({
    ...perfil,
    identificador: "ponto-lab",
    pontoHomologacao: "ponto-lab",
  });
  assert.equal(aceito.ok, true);
  if (aceito.ok) assert.equal(aceito.posid, "ponto-lab");

  const producao = terminalExclusivoHomologacao({
    ...perfil,
    identificador: "400400",
    pontoHomologacao: "ponto-lab",
  });
  assert.equal(producao.ok, false);
  if (!producao.ok) assert.equal(producao.codigo, "ponto");

  const mesmoNumero = terminalExclusivoHomologacao({
    ...perfil,
    identificador: "400400",
    pontoHomologacao: "400400",
  });
  assert.equal(mesmoNumero.ok, true);
  if (mesmoNumero.ok) assert.equal(mesmoNumero.posid, "400400");

  const outraEmpresa = terminalExclusivoHomologacao({
    ...perfil,
    empresaOrigem: "empresa-b",
    identificador: "ponto-lab",
    pontoHomologacao: "ponto-lab",
  });
  assert.equal(outraEmpresa.ok, false);
  if (!outraEmpresa.ok) assert.equal(outraEmpresa.codigo, "empresa");

  const servidorProducao = terminalExclusivoHomologacao({
    ...perfil,
    identificador: "ponto-lab",
    pontoHomologacao: "ponto-lab",
    servidorHomologacao: SERVIDOR_PROD,
  });
  assert.equal(servidorProducao.ok, false);
  if (!servidorProducao.ok) assert.equal(servidorProducao.codigo, "servidor");

  const dispositivo = "33333333-3333-4333-8333-333333333333";
  const pareado = autorizarComputadorHomologacao({
    empresaId: "empresa-a",
    dispositivoId: dispositivo,
    posid: "ponto-lab",
    terminais: [{ empresaId: "empresa-a", dispositivoId: dispositivo, codigo: "caixa-lab" }],
  });
  assert.equal(pareado.ok, true);
  if (pareado.ok) assert.equal(pareado.terminalCodigo, "caixa-lab");
  const naoPareado = autorizarComputadorHomologacao({
    empresaId: "empresa-a",
    dispositivoId: "44444444-4444-4444-8444-444444444444",
    posid: "ponto-lab",
    terminais: [{ empresaId: "empresa-a", dispositivoId: dispositivo }],
  });
  assert.equal(naoPareado.ok, false);
  if (!naoPareado.ok) assert.equal(naoPareado.codigo, "dispositivo");
  const outraEmpresaDispositivo = autorizarComputadorHomologacao({
    empresaId: "empresa-a",
    dispositivoId: dispositivo,
    posid: "ponto-lab",
    terminais: [{ empresaId: "empresa-b", dispositivoId: dispositivo }],
  });
  assert.equal(outraEmpresaDispositivo.ok, false);
  if (!outraEmpresaDispositivo.ok) assert.equal(outraEmpresaDispositivo.codigo, "empresa");
  const soPosid = autorizarComputadorHomologacao({
    empresaId: "empresa-a",
    dispositivoId: "ponto-lab",
    posid: "ponto-lab",
    terminais: [{ empresaId: "empresa-a", dispositivoId: dispositivo }],
  });
  assert.equal(soPosid.ok, false);

  const manual = avaliarParcelasCartao(
    {
      plataformaHabilitada: true,
      empresaHabilitada: true,
      permitirOperacaoManual: true,
      ambiente: "producao",
    },
    [{ modalidade: "debito", tefOperacaoId: null, operacaoManual: false }]
  );
  assert.equal(manual.ok, false);
  if (!manual.ok) assert.equal(manual.erro, MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF);

  assert.equal(
    legendaPontoVinculo({
      pontoVinculo: "400400",
      pontoProducao: "400400",
      pontoHomologacao: "ponto-lab",
    }),
    "Ponto de produção do vínculo"
  );
  assert.equal(
    legendaPontoVinculo({
      pontoVinculo: "ponto-lab",
      pontoProducao: "400400",
      pontoHomologacao: "ponto-lab",
    }),
    "Ponto de homologação do vínculo"
  );
  assert.equal(cnpjHomologacaoRepeteProducao("11222333000181", "11222333000181"), true);
  assert.equal(cnpjHomologacaoRepeteProducao("11222333000181", "11444777000161"), false);

  const menu = readFileSync(
    new URL("../../../app/api/pdv/tef/homologacao/menu/route.ts", import.meta.url),
    "utf8"
  );
  const simulada = readFileSync(
    new URL("../../../app/api/pdv/tef/venda-simulada/route.ts", import.meta.url),
    "utf8"
  );
  assert.equal(menu.includes("config.pontoCaptura"), false);
  assert.equal(simulada.includes("config.pontoCaptura"), false);
  assert.match(menu, /TEF_DESATIVADO/);
  assert.match(simulada, /TEF_DESATIVADO/);
  assert.equal(menu.includes("lerTerminalHomologacaoSessao"), false);
  assert.equal(simulada.includes("lerTerminalHomologacaoSessao"), false);
});
