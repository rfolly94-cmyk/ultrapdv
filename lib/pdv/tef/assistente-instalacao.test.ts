import assert from "node:assert/strict";
import { test } from "node:test";

import { MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO } from "@/lib/fiscal/tef/ambiente-tef-nfce";
import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";

import {
  adquirentesInformadas,
  ambienteEfetivoComprovado,
  avaliarInstalacao,
  decidirAtivacao,
  classificarFalhaFetchConnector,
  decidirMotivoConsultaConnector,
  diagnosticarConsultaConnector,
  etapaInicial,
  etapasInstalacaoComercial,
  interpretarStatusConnector,
  mensagemConsultaConnector,
  instalacaoTecnicaInformada,
  mensagemAmbienteNaoComprovado,
  observacaoBibliotecaDoStatus,
  painelSituacaoTef,
  situacaoAgenteTef,
  montarGravacaoAtivacao,
  sanitizarAmbienteDoStatus,
  terminalDaSessao,
  validarCredenciamento,
  type CredenciamentoInformado,
  type FatosInstalacao,
  type LeituraConnector,
  type LeituraPinpad,
} from "./assistente-instalacao";
import {
  classificacaoSemEvidencia,
  type ClassificacaoAmbienteInstalacao,
} from "./evidencia-instalacao";

const CNPJ = "42741754000142";

function credenciamento(parcial: Partial<CredenciamentoInformado> = {}): CredenciamentoInformado {
  return {
    cnpjEmpresa: CNPJ,
    cnpjConfirmado: CNPJ,
    credenciamentoConfirmado: true,
    ambienteAutorizado: "producao",
    pontoCaptura: "200001",
    estabelecimento: "LOJA",
    parametrosOficiais: "",
    adquirentes: [],
    servidorHomologacao: "tef.homolog.example:31735",
    servidorProducao: "tef.producao.example:443",
    servidorConfirmado: true,
    ...parcial,
  };
}

function connector(parcial: Partial<LeituraConnector> = {}): LeituraConnector {
  return {
    respondeu: true,
    versao: "1.3.3",
    disponivel: true,
    executavelEncontrado: false,
    processo: null,
    pgwebLibPronta: true,
    pgwebVersao: null,
    paygoInicializado: true,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
    pendenciaLocal: false,
    ...parcial,
  };
}

function pinpad(parcial: Partial<LeituraPinpad> = {}): LeituraPinpad {
  return {
    consultado: true,
    comunicacao: "confirmada",
    fabricante: "Gertec",
    modelo: "PPC930",
    firmware: "1.0",
    porta: "USB",
    paygoInicializado: true,
    ppinfoDisponivel: true,
    limitacaoModelo: null,
    ...parcial,
  };
}

function evidenciaComprovada(
  ambiente: "homologacao" | "producao" = "producao"
): ClassificacaoAmbienteInstalacao {
  return {
    situacao: "comprovado",
    ambienteEfetivo: ambiente,
    origem: "instalacao_controlada",
    deveRevogar: false,
    motivo: `Ambiente comprovado por instalação controlada: ${ambiente}. A assinatura do Connector registra a observação da instalação.`,
  };
}

function fatos(parcial: Partial<FatosInstalacao> = {}): FatosInstalacao {
  const cred = parcial.credenciamento ?? credenciamento();
  return {
    credenciamento: cred,
    connector: connector(),
    pinpad: pinpad(),
    pinpadExigido: true,
    empresaId: empresaA,
    terminais: [
      {
        empresaId: empresaA,
        dispositivoId: "dispositivo-a",
        ativo: true,
        pontoCaptura: "200001",
      },
    ],
    dispositivoId: "dispositivo-a",
    pontoAutorizado: "200001",
    ambienteAutorizado: "producao",
    pendenciasFinanceiras: 0,
    planoPdv: true,
    permissaoEditar: true,
    plataformaHabilitada: true,
    ambienteFiscal: 1,
    evidencia: evidenciaComprovada(),
    ...parcial,
  };
}

function estado(avaliacao: ReturnType<typeof avaliarInstalacao>, id: string) {
  return avaliacao.requisitos.find((item) => item.id === id)?.estado;
}

test("instalação inicial começa no credenciamento e não ativa", () => {
  assert.equal(
    etapaInicial({
      etapaSalva: null,
      credenciamentoCompleto: false,
      empresaJaHabilitada: false,
    }),
    "credenciamento"
  );
  const avaliacao = avaliarInstalacao(
    fatos({
      credenciamento: credenciamento({
        cnpjConfirmado: "",
        credenciamentoConfirmado: false,
        ambienteAutorizado: "",
        pontoCaptura: "",
        estabelecimento: "",
      }),
      connector: connector({
        respondeu: false,
        disponivel: false,
        executavelEncontrado: false,
        paygoInicializado: false,
        ambienteEfetivo: null,
        versao: null,
      }),
      pinpad: pinpad({ consultado: false, comunicacao: null }),
      terminais: [],
      dispositivoId: "",
      pontoAutorizado: "",
      ambienteAutorizado: "",
    })
  );
  assert.equal(avaliacao.podeAtivar, false);
  assert.ok(avaliacao.mensagens.length > 0);
  assert.equal(avaliacao.adquirentes.includes("C6Pay"), false);
});

test("retomada abre a etapa salva quando o credenciamento está completo", () => {
  assert.equal(
    etapaInicial({
      etapaSalva: "pinpad",
      credenciamentoCompleto: true,
      empresaJaHabilitada: false,
      servidorOficial: "tef.loja.example:31735",
    }),
    "connector"
  );
  assert.equal(
    etapaInicial({
      etapaSalva: "pinpad",
      credenciamentoCompleto: true,
      empresaJaHabilitada: false,
    }),
    "credenciamento"
  );
  assert.equal(
    etapaInicial({
      etapaSalva: "ativacao",
      credenciamentoCompleto: false,
      empresaJaHabilitada: false,
    }),
    "credenciamento"
  );
});

test("credenciamento incompleto lista o que falta e não presume adquirente", () => {
  const resultado = validarCredenciamento(
    credenciamento({
      cnpjConfirmado: "00000000000000",
      credenciamentoConfirmado: false,
      pontoCaptura: "",
      adquirentes: [],
    })
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.pendencias.join(" "), /CNPJ/);
  assert.match(resultado.pendencias.join(" "), /credenciamento PayGoWeb/);
  assert.match(resultado.pendencias.join(" "), /ponto de captura/);
  assert.deepEqual(adquirentesInformadas(""), []);
  assert.deepEqual(adquirentesInformadas("Rede"), ["Rede"]);
});

test("parâmetro com senha é recusado", () => {
  const resultado = validarCredenciamento(
    credenciamento({ parametrosOficiais: "senha=segredo" })
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.pendencias.join(" "), /senha ou segredo/);
});

test("connector ausente fica pendente e não dispara instalação", () => {
  const leitura = interpretarStatusConnector({ descobertaOk: false, versao: "1.3.3" });
  assert.equal(leitura.respondeu, false);
  assert.equal(leitura.versao, null);
  const avaliacao = avaliarInstalacao(fatos({ connector: leitura }));
  assert.equal(estado(avaliacao, "connector"), "pendente");
  assert.match(avaliacao.mensagens.join(" "), /não instala nem reinicia/);
  assert.equal(avaliacao.podeAtivar, false);
});

test("pinpad incompatível ou indisponível não é tratado como homologado", () => {
  const incompativel = avaliarInstalacao(
    fatos({
      pinpad: pinpad({
        comunicacao: "modelo_nao_reconhecido",
        limitacaoModelo: "nao_reconhecido",
        modelo: "DESCONHECIDO",
      }),
    })
  );
  assert.equal(estado(incompativel, "pinpad"), "incompativel");
  assert.match(incompativel.mensagens.join(" "), /não é uma homologação/);

  const indisponivel = avaliarInstalacao(
    fatos({ pinpad: pinpad({ comunicacao: "indisponivel", fabricante: null, modelo: null }) })
  );
  assert.equal(estado(indisponivel, "pinpad"), "pendente");
  assert.match(indisponivel.mensagens.join(" "), /indisponível/);

  const foraDeTransacao = avaliarInstalacao(
    fatos({
      pinpad: pinpad({
        comunicacao: "nao_executada",
        ppinfoDisponivel: false,
        fabricante: null,
        modelo: null,
        firmware: null,
        porta: null,
      }),
    })
  );
  assert.equal(estado(foraDeTransacao, "pinpad"), "nao_verificavel");
});

test("terminal vinculado a outra empresa bloqueia a ativação", () => {
  const vinculo = terminalDaSessao(
    [
      {
        empresaId: empresaB,
        dispositivoId: "dispositivo-b",
        ativo: true,
        pontoCaptura: "999",
      },
    ],
    empresaA,
    "dispositivo-b"
  );
  assert.equal(vinculo.outraEmpresa, true);
  assert.equal(vinculo.terminal, null);
  const avaliacao = avaliarInstalacao(
    fatos({
      empresaId: empresaA,
      dispositivoId: "dispositivo-b",
      terminais: [
        {
          empresaId: empresaB,
          dispositivoId: "dispositivo-b",
          ativo: true,
          pontoCaptura: "999",
        },
      ],
    })
  );
  assert.equal(estado(avaliacao, "terminal"), "incompativel");
  assert.equal(avaliacao.podeAtivar, false);
});

test("homologação comprovada confere quando a NFC-e não está em produção", () => {
  const avaliacao = avaliarInstalacao(
    fatos({
      ambienteAutorizado: "homologacao",
      ambienteFiscal: 2,
      credenciamento: credenciamento({ ambienteAutorizado: "homologacao" }),
      evidencia: evidenciaComprovada("homologacao"),
    })
  );
  assert.equal(estado(avaliacao, "ambiente"), "aprovado");
  assert.equal(estado(avaliacao, "financiamento"), "aprovado");
});

test("ambiente comprovado de produção confere com NFC-e de produção", () => {
  const avaliacao = avaliarInstalacao(
    fatos({
      evidencia: evidenciaComprovada("producao"),
      connector: connector({
        ambienteEfetivo: "producao",
        situacaoAmbiente: "comprovado",
      }),
    })
  );
  assert.equal(estado(avaliacao, "ambiente"), "aprovado");
  assert.equal(estado(avaliacao, "financiamento"), "aprovado");
  assert.equal(avaliacao.podeAtivar, true);
});

test("ambiente desconhecido ignora o valor declarado e o enviado no status", () => {
  const status = interpretarStatusConnector({
    descobertaOk: true,
    versao: "1.3.3",
    status: {
      tef: {
        disponivel: true,
        inicializado: true,
        ambiente: "producao",
        situacaoAmbiente: "comprovado",
      },
    },
  });
  assert.deepEqual(sanitizarAmbienteDoStatus(), {
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  });
  assert.equal(status.ambienteEfetivo, null);
  assert.equal(status.situacaoAmbiente, "desconhecido");
  assert.equal(ambienteEfetivoComprovado(status), null);

  const avaliacao = avaliarInstalacao(
    fatos({
      evidencia: classificacaoSemEvidencia("producao"),
      connector: connector({
        ambienteEfetivo: "producao",
        situacaoAmbiente: "comprovado",
      }),
    })
  );
  assert.equal(estado(avaliacao, "ambiente"), "nao_verificavel");
  assert.match(avaliacao.mensagens.join(" "), /não comprova/);
  assert.equal(avaliacao.podeAtivar, false);
});

test("divergência entre ambiente comprovado e autorizado bloqueia a ativação", () => {
  const divergente = avaliarInstalacao(
    fatos({
      ambienteAutorizado: "producao",
      evidencia: evidenciaComprovada("homologacao"),
    })
  );
  assert.equal(estado(divergente, "ambiente"), "incompativel");
  assert.equal(avaliacaoPode(divergente), false);

  const formulario = avaliarInstalacao(
    fatos({ evidencia: classificacaoSemEvidencia("") })
  );
  assert.equal(estado(formulario, "ambiente"), "nao_verificavel");
  assert.match(formulario.mensagens.join(" "), /formulário não comprova/);
  assert.equal(formulario.podeAtivar, false);
});

test("pendência financeira impede a ativação", () => {
  const avaliacao = avaliarInstalacao(fatos({ pendenciasFinanceiras: 1 }));
  assert.equal(estado(avaliacao, "pendencias"), "pendente");
  assert.equal(avaliacao.podeAtivar, false);
});

test("ativação sem permissão é recusada mesmo com requisitos comprovados", () => {
  const avaliacao = avaliarInstalacao(fatos({ permissaoEditar: false }));
  assert.equal(avaliacao.podeAtivar, false);
  const decisao = decidirAtivacao({
    permissaoEditar: false,
    empresaJaHabilitada: false,
    podeAtivar: true,
    pontoAtual: "",
    ambienteAtual: "",
    pontoInformado: "200001",
    ambienteInformado: "producao",
  });
  assert.equal(decisao.efeito, "recusar");
  assert.equal(decisao.motivo, "sem_permissao");
  assert.equal(decisao.alteraChave, false);
  assert.equal(decisao.alteraPlataforma, false);
});

test("reexecução em empresa já configurada preserva ponto, ambiente e chave", () => {
  assert.equal(
    etapaInicial({
      etapaSalva: null,
      credenciamentoCompleto: true,
      empresaJaHabilitada: true,
    }),
    "credenciamento"
  );
  assert.equal(
    etapaInicial({
      etapaSalva: null,
      credenciamentoCompleto: true,
      empresaJaHabilitada: true,
      servidorOficial: "tef.loja.example:31735",
    }),
    "connector"
  );
  const decisao = decidirAtivacao({
    permissaoEditar: true,
    empresaJaHabilitada: true,
    podeAtivar: true,
    pontoAtual: "117473",
    ambienteAtual: "homologacao",
    pontoInformado: "999999",
    ambienteInformado: "producao",
  });
  assert.equal(decisao.efeito, "preservar");
  assert.equal(decisao.alteraPonto, false);
  assert.equal(decisao.alteraAmbiente, false);
  assert.equal(decisao.alteraChave, false);
  if (decisao.efeito === "preservar") {
    assert.equal(decisao.ponto, "117473");
    assert.equal(decisao.ambiente, "homologacao");
  }
});

test("homologação não libera financiamento de NFC-e de produção", () => {
  const avaliacao = avaliarInstalacao(
    fatos({
      ambienteAutorizado: "homologacao",
      ambienteFiscal: 1,
      credenciamento: credenciamento({ ambienteAutorizado: "homologacao" }),
      evidencia: evidenciaComprovada("homologacao"),
    })
  );
  assert.equal(estado(avaliacao, "financiamento"), "incompativel");
  assert.match(avaliacao.mensagens.join(" "), new RegExp(MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO));
  assert.equal(avaliacao.podeAtivar, false);
});

test("isolamento usa a empresa da sessão e ignora o empresa_id informado", () => {
  const gravacao = montarGravacaoAtivacao({
    empresaSessaoId: empresaA,
    empresaInformada: empresaB,
    ambiente: "producao",
    pontoCaptura: "200001",
    estabelecimento: "LOJA",
  });
  assert.equal(gravacao.empresaId, empresaA);
  assert.equal(gravacao.empresaInformadaIgnorada, empresaB);
  assert.equal(gravacao.alteraPlataforma, false);

  const avaliacao = avaliarInstalacao(
    fatos({
      empresaId: empresaA,
      dispositivoId: "dispositivo-a",
      terminais: [
        {
          empresaId: empresaA,
          dispositivoId: "dispositivo-a",
          ativo: true,
          pontoCaptura: "200001",
        },
        {
          empresaId: empresaB,
          dispositivoId: "dispositivo-b",
          ativo: true,
          pontoCaptura: "888",
        },
      ],
    })
  );
  assert.equal(estado(avaliacao, "terminal"), "aprovado");
  assert.equal(avaliacao.podeAtivar, true);
});

test("migration do assistente isola por empresa e não guarda segredo", () => {
  const sql = fonte("supabase/migrations/20261011140000_tef_assistente_instalacao.sql");
  assert.match(sql, /Não aplicar automaticamente/);
  assert.match(sql, /empresa_id uuid PRIMARY KEY/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /GRANT SELECT ON public\.tef_instalacoes TO authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.tef_instalacoes TO service_role/);
  assert.doesNotMatch(sql, /C6Pay/);
  assert.doesNotMatch(sql, /password|senha_paygo|coluna senha/i);
  assert.match(sql, /adquirentes text\[\] NOT NULL DEFAULT '\{\}'/);
});

test("assistente não grava segredo no navegador nem altera a plataforma", () => {
  const ui = fonte("components/pdv/tef-assistente.tsx");
  const sessao = fonte("lib/pdv/tef/assistente-sessao.ts");
  const conector = fonte("print-agent/src/tef.mjs");
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  assert.doesNotMatch(ui, /manutencao|PW_iInit|PWOPER_MAINTENANCE/);
  assert.doesNotMatch(sessao, /definirTefPlataforma|from\("tef_plataforma"\)/);
  assert.match(sessao, /consultarEvidenciaDaEmpresa/);
  assert.doesNotMatch(sessao, /PWOPER_INSTALL|PWOPER_MAINTENANCE/);
  assert.match(conector, /assinarEvidenciaInstalacao/);
  assert.match(conector, /observacaoBiblioteca !== true/);
  const producao = fonte("components/pdv/tef-producao-isolada.tsx");
  assert.match(ui, /TefProducaoIsolada/);
  assert.match(producao, /\/tef\/instalar/);
  assert.doesNotMatch(ui.slice(ui.indexOf("async function persistir"), ui.indexOf("async function verificarConnector")), /\/tef\/instalar/);
  assert.match(ui, /Ativar TEF nesta empresa/);
  assert.match(ui, /não ativa a empresa/);
  assert.match(ui, /evidência assinada/);
});

test("evidência ausente, declarada ou revogada mantém a ativação bloqueada", () => {
  const ausente = avaliarInstalacao(fatos({ evidencia: classificacaoSemEvidencia("") }));
  const declarada = avaliarInstalacao(fatos({ evidencia: classificacaoSemEvidencia("producao") }));
  const revogada = avaliarInstalacao(
    fatos({
      evidencia: {
        ...evidenciaComprovada("producao"),
        situacao: "desconhecido",
        ambienteEfetivo: null,
        origem: "ausente",
        deveRevogar: true,
        motivo: "A evidência de instalação foi revogada.",
      },
    })
  );
  assert.equal(ausente.podeAtivar, false);
  assert.equal(declarada.podeAtivar, false);
  assert.equal(estado(declarada, "ambiente"), "nao_verificavel");
  assert.match(declarada.mensagens.join(" "), /declarado/);
  assert.equal(revogada.podeAtivar, false);
  assert.match(revogada.mensagens.join(" "), /revogada/);
});

test("instalação comprovada pode habilitar sem alterar a plataforma", () => {
  const avaliacao = avaliarInstalacao(fatos());
  assert.equal(avaliacao.podeAtivar, true);
  const decisao = decidirAtivacao({
    permissaoEditar: true,
    empresaJaHabilitada: false,
    podeAtivar: avaliacao.podeAtivar,
    pontoAtual: "",
    ambienteAtual: "",
    pontoInformado: "200001",
    ambienteInformado: "producao",
  });
  assert.equal(decisao.efeito, "habilitar");
  assert.equal(decisao.alteraPlataforma, false);
  assert.equal(decisao.alteraChave, false);
});

function avaliacaoPode(avaliacao: ReturnType<typeof avaliarInstalacao>) {
  return avaliacao.podeAtivar;
}

function itemPainel(
  itens: ReturnType<typeof painelSituacaoTef>,
  id: ReturnType<typeof painelSituacaoTef>[number]["id"]
) {
  const item = itens.find((entrada) => entrada.id === id);
  if (!item) {
    throw new Error(id);
  }
  return item;
}

test("painel separa processo parado, Connector desconectado e biblioteca ausente", () => {
  const parado = painelSituacaoTef({
    credenciamentoOk: true,
    connector: connector({ processo: "parado", paygoInicializado: false, ambienteEfetivo: null }),
    pinpad: pinpad({ consultado: false, comunicacao: null }),
    pinpadExigido: true,
    bibliotecaValidada: false,
    ambienteComprovado: null,
    agenteCompativel: true,
  });
  assert.equal(itemPainel(parado, "connector").situacao, "conectado");
  assert.equal(itemPainel(parado, "connector").pendente, false);
  assert.match(itemPainel(parado, "paygo").explicacao, /não instalada/);
  assert.equal(itemPainel(parado, "ambiente").situacao, "desconhecido");

  const desconectado = painelSituacaoTef({
    credenciamentoOk: false,
    connector: connector({ respondeu: false, disponivel: false, executavelEncontrado: false, paygoInicializado: false, versao: null }),
    pinpad: null,
    pinpadExigido: true,
    bibliotecaValidada: false,
    ambienteComprovado: null,
  });
  assert.equal(itemPainel(desconectado, "connector").situacao, "desconectado");
  assert.equal(itemPainel(desconectado, "credenciamento").situacao, "pendente");
  assert.match(itemPainel(desconectado, "paygo").explicacao, /não respondeu/);
});

test("biblioteca validada comprova produção e biblioteca sem prova permanece desconhecida", () => {
  const instalada = painelSituacaoTef({
    credenciamentoOk: true,
    connector: connector({ processo: "parado", paygoInicializado: true }),
    pinpad: pinpad(),
    pinpadExigido: true,
    bibliotecaValidada: true,
    ambienteComprovado: "producao",
    agenteCompativel: true,
  });
  assert.equal(itemPainel(instalada, "paygo").situacao, "instalado e validado");
  assert.equal(itemPainel(instalada, "ambiente").situacao, "produção comprovada");
  assert.equal(itemPainel(instalada, "pinpad").situacao, "disponível");

  const semProva = painelSituacaoTef({
    credenciamentoOk: true,
    connector: connector({ paygoInicializado: true }),
    pinpad: pinpad(),
    pinpadExigido: false,
    bibliotecaValidada: false,
    ambienteComprovado: null,
  });
  assert.equal(itemPainel(semProva, "paygo").situacao, "inicializado");
  assert.equal(itemPainel(semProva, "pinpad").situacao, "não exigido");
});

test("agente incompatível pede atualização pelo instalador e status antigo não inventa compatibilidade", () => {
  const status = situacaoAgenteTef({
    tef: {
      pgwebLib: { pronta: false, versao: "4.1.50.924" },
      biblioteca: { cobrancaPermitida: false },
    },
  });
  assert.equal(status.compativel, false);
  assert.equal(status.nome, "PGWebLib.dll");
  assert.equal(status.cobrancaPermitida, false);
  assert.equal(status.ambienteEfetivo, null);
  assert.equal(situacaoAgenteTef({ tef: {} }).compativel, null);
  assert.equal(
    situacaoAgenteTef({
      tef: {
        ambienteEfetivo: null,
        biblioteca: { cobrancaPermitida: true, ambienteSolicitado: "producao" },
      },
    }).ambienteEfetivo,
    null
  );
  const painel = painelSituacaoTef({
    credenciamentoOk: true,
    connector: connector(),
    pinpad: null,
    pinpadExigido: false,
    bibliotecaValidada: false,
    ambienteComprovado: null,
    agenteCompativel: false,
  });
  assert.equal(itemPainel(painel, "connector").situacao, "incompatível");
  assert.match(itemPainel(painel, "connector").explicacao, /instalador/);
});

test("terminal de outra empresa não entra na sessão e a ativação preserva o ponto já gravado", () => {
  const sessao = terminalDaSessao(
    [
      { empresaId: empresaA, dispositivoId: "dispositivo-a", ativo: true, pontoCaptura: "200001" },
      { empresaId: empresaB, dispositivoId: "dispositivo-a", ativo: true, pontoCaptura: "300001" },
    ],
    empresaA,
    "dispositivo-a"
  );
  assert.equal(sessao.terminal?.pontoCaptura, "200001");
  assert.equal(sessao.outraEmpresa, true);
  const decisao = decidirAtivacao({
    permissaoEditar: true,
    empresaJaHabilitada: true,
    podeAtivar: true,
    pontoAtual: "200001",
    ambienteAtual: "producao",
    pontoInformado: "300001",
    ambienteInformado: "homologacao",
  });
  assert.equal(decisao.efeito, "preservar");
  assert.equal(decisao.alteraPonto, false);
  assert.equal(decisao.alteraChave, false);
});

function statusConnectorAcessivel() {
  return {
    ok: true,
    tef: {
      ambienteEfetivo: null,
      situacaoAmbiente: "desconhecido",
      pgwebLib: { pronta: true, versao: "4.1.50.924" },
      biblioteca: {
        ambienteSolicitado: "producao",
        setEnvironmentExecutado: true,
        retornoSetEnvironment: 0,
        instalacaoConcluida: true,
        cobrancaPermitida: true,
        codigoAmbiente: 0,
        diretorioBiblioteca: "producao",
        origemComprovacao: "set_environment",
        bibliotecaInstalada: false,
      },
    },
  };
}

test("Connector acessível com resposta válida não vira desconectado nem produção comprovada", () => {
  const consulta = diagnosticarConsultaConnector({
    descobertaOk: true,
    origem: "http://127.0.0.1:18182",
    versao: "1.3.5",
    dispositivoId: "5c514a72-0c49-4e5e-a715-f64f8d0b4fae",
    statusHttp: 200,
    status: statusConnectorAcessivel(),
  });
  assert.equal(consulta.conectado, true);
  assert.equal(consulta.statusLido, true);
  assert.equal(consulta.mensagem, "");
  assert.equal(consulta.leitura.respondeu, true);
  assert.equal(consulta.leitura.disponivel, true);
  assert.equal(consulta.leitura.paygoInicializado, true);
  assert.equal(consulta.leitura.processo, null);
  assert.equal(consulta.leitura.pgwebLibPronta, true);
  assert.equal(consulta.agente.compativel, true);
  assert.equal(consulta.agente.evidenciaInstalacao, false);
  assert.equal(consulta.agente.cobrancaPermitida, true);
  assert.equal(consulta.agente.ambienteBiblioteca, "producao");
  assert.equal(consulta.agente.ambienteEfetivo, null);
  const painel = painelSituacaoTef({
    credenciamentoOk: true,
    connector: consulta.leitura,
    pinpad: null,
    pinpadExigido: false,
    bibliotecaValidada: false,
    ambienteComprovado: consulta.agente.ambienteEfetivo,
    agenteCompativel: consulta.agente.compativel,
    evidenciaInstalacao: consulta.agente.evidenciaInstalacao,
  });
  assert.equal(itemPainel(painel, "connector").situacao, "conectado");
  assert.equal(itemPainel(painel, "paygo").situacao, "inicializado");
  assert.equal(itemPainel(painel, "ambiente").situacao, "desconhecido");
  assert.match(itemPainel(painel, "ambiente").explicacao, /ambiente efetivo continua desconhecido/);
});

test("Connector indisponível, timeout e CORS têm mensagens diferentes", () => {
  const ausente = diagnosticarConsultaConnector({ descobertaOk: false, motivoDescoberta: "ausente" });
  assert.equal(ausente.conectado, false);
  assert.equal(ausente.leitura.respondeu, false);
  assert.match(ausente.mensagem, /18181/);

  const timeout = diagnosticarConsultaConnector({ descobertaOk: false, motivoDescoberta: "timeout" });
  assert.match(timeout.mensagem, /expirou/);

  const cors = diagnosticarConsultaConnector({ descobertaOk: false, motivoDescoberta: "cors" });
  assert.match(cors.mensagem, /CORS/);
  assert.equal(decidirMotivoConsultaConnector({ falha: "indisponivel", noCorsRespondeu: true }), "cors");
  assert.equal(decidirMotivoConsultaConnector({ falha: "ausente", noCorsRespondeu: false }), "indisponivel");
  assert.equal(classificarFalhaFetchConnector(Object.assign(new Error("Failed to fetch"), { name: "TypeError" })), "indisponivel");
  assert.equal(classificarFalhaFetchConnector(new Error("blocked by CORS policy")), "cors");
  assert.equal(classificarFalhaFetchConnector(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })), "timeout");
  assert.match(mensagemConsultaConnector("json"), /JSON/);
});

test("health acessível com falha em /tef/status mantém o Connector conectado", () => {
  const json = diagnosticarConsultaConnector({
    descobertaOk: true,
    versao: "1.3.5",
    statusHttp: 200,
    falhaStatus: "json",
  });
  assert.equal(json.conectado, true);
  assert.equal(json.statusLido, false);
  assert.match(json.mensagem, /JSON/);
  const http = diagnosticarConsultaConnector({
    descobertaOk: true,
    versao: "1.3.5",
    statusHttp: 500,
    status: { ok: false, erro: "falha interna" },
  });
  assert.equal(http.conectado, true);
  assert.match(http.mensagem, /HTTP 500/);
  const painel = painelSituacaoTef({
    credenciamentoOk: true,
    connector: json.leitura,
    pinpad: null,
    pinpadExigido: false,
    bibliotecaValidada: false,
    ambienteComprovado: null,
    falhaConsulta: json.mensagem,
  });
  assert.equal(itemPainel(painel, "connector").situacao, "conectado");
  assert.match(itemPainel(painel, "paygo").explicacao, /inicializada|desconhecido|JSON/);
});

test("validar instalação consulta /tef/status antes de enviar o estado ao servidor", () => {
  const ui = fonte("components/pdv/tef-assistente.tsx");
  const validar = ui.slice(ui.indexOf("async function validar"), ui.indexOf("async function ativar"));
  const consulta = validar.indexOf("consultarConnector");
  const acao = validar.indexOf("validarAssistente");
  assert.ok(consulta >= 0 && acao > consulta);
  assert.match(validar, /consulta\.leitura/);
  assert.match(validar, /consulta\.statusLido/);
  assert.match(ui, /fetchLocalConector\(`\$\{descoberta\.origem\}\/tef\/status`\)/);
  assert.match(validar, /consulta\.biblioteca/);
  assert.doesNotMatch(validar, /descobertaOk: false/);
});

test("instalação técnica informada não vira ambiente comprovado nem libera NFC-e", () => {
  const biblioteca = observacaoBibliotecaDoStatus({
    tef: {
      biblioteca: {
        pontoSolicitado: "200001",
        servidorSolicitado: "tef.loja.example:31735",
        ambienteSolicitado: "producao",
        diretorioBiblioteca: "producao",
        setEnvironmentExecutado: true,
        retornoSetEnvironment: 0,
        instalacaoConcluida: true,
        cobrancaPermitida: true,
        codigoAmbiente: 0,
        origemComprovacao: "set_environment",
      },
    },
  });
  assert.equal(instalacaoTecnicaInformada(biblioteca), true);
  const evidencia = classificacaoSemEvidencia("producao");
  const mensagem = mensagemAmbienteNaoComprovado(evidencia, biblioteca);
  assert.match(mensagem, /Instalação técnica informada pelo Connector/);
  assert.match(mensagem, /ultrapdv-tef-biblioteca-v2/);
  assert.match(mensagem, /ultrapdv-tef-instalacao-v1/);
  assert.match(mensagem, /adquirente continua desconhecido/);
  assert.doesNotMatch(mensagem, /produção comprovada|instalação controlada: producao/);
  const avaliacao = avaliarInstalacao(
    fatos({
      evidencia,
      ambienteFiscal: 1,
      biblioteca,
    })
  );
  assert.equal(estado(avaliacao, "ambiente"), "nao_verificavel");
  assert.equal(estado(avaliacao, "financiamento"), "nao_verificavel");
  assert.equal(avaliacao.podeAtivar, false);
  assert.match(avaliacao.mensagens.join(" "), /ambiente_efetivo = producao/);
  const soCobranca = observacaoBibliotecaDoStatus({
    tef: { biblioteca: { cobrancaPermitida: true, ambienteSolicitado: "producao" } },
  });
  assert.equal(instalacaoTecnicaInformada(soCobranca), false);
  assert.match(mensagemAmbienteNaoComprovado(evidencia, soCobranca), /permissão de cobrança/);
  const sandbox = observacaoBibliotecaDoStatus({
    tef: {
      biblioteca: {
        pontoSolicitado: "200001",
        servidorSolicitado: "pos-transac-sb.tpgweb.io:31735",
        ambienteSolicitado: "producao",
        diretorioBiblioteca: "producao",
        setEnvironmentExecutado: true,
        retornoSetEnvironment: 0,
        instalacaoConcluida: true,
        cobrancaPermitida: true,
        codigoAmbiente: 0,
      },
    },
  });
  assert.equal(instalacaoTecnicaInformada(sandbox), false);
});

test("instalação comprovada com agente parado mantém Connector conectado e a adquirente desconhecida", () => {
  const avaliacao = avaliarInstalacao(
    fatos({
      connector: connector({
        disponivel: false,
        processo: null,
        pgwebLibPronta: false,
        paygoInicializado: false,
        versao: "1.3.6",
      }),
      evidencia: classificacaoSemEvidencia("producao"),
      ambienteFiscal: 1,
      provaTecnica: { instalacaoComprovada: true, ambienteConfigurado: true },
    })
  );
  assert.equal(estado(avaliacao, "connector"), "aprovado");
  assert.match(avaliacao.requisitos.find((item) => item.id === "connector")?.mensagem ?? "", /conectado/);
  assert.equal(estado(avaliacao, "processo"), "pendente");
  assert.match(avaliacao.requisitos.find((item) => item.id === "processo")?.mensagem ?? "", /não está pronta/);
  assert.equal(estado(avaliacao, "paygo"), "aprovado");
  assert.match(avaliacao.requisitos.find((item) => item.id === "paygo")?.mensagem ?? "", /biblioteca-v2/);
  assert.equal(estado(avaliacao, "ambiente"), "nao_verificavel");
  const ambiente = avaliacao.requisitos.find((item) => item.id === "ambiente")?.mensagem ?? "";
  assert.match(ambiente, /instalação técnica/);
  assert.match(ambiente, /ultrapdv-tef-instalacao-v1/);
  assert.doesNotMatch(ambiente, /sem evidência de instalação controlada/);
  assert.equal(estado(avaliacao, "adquirente"), "nao_verificavel");
  assert.match(avaliacao.requisitos.find((item) => item.id === "adquirente")?.mensagem ?? "", /C6 PAY/);
  assert.equal(estado(avaliacao, "financiamento"), "nao_verificavel");
  assert.match(avaliacao.mensagens.join(" "), /ambiente_efetivo = producao/);
  assert.equal(avaliacao.podeAtivar, false);

  const painel = painelSituacaoTef({
    credenciamentoOk: true,
    connector: connector({ pgwebLibPronta: false, disponivel: false, paygoInicializado: false }),
    pinpad: null,
    pinpadExigido: true,
    bibliotecaValidada: false,
    provaTecnica: true,
    ambienteComprovado: null,
    agenteCompativel: true,
  });
  assert.equal(itemPainel(painel, "connector").situacao, "conectado");
  assert.equal(itemPainel(painel, "connector").pendente, false);
  assert.equal(itemPainel(painel, "processo").situacao, "pendente");
  assert.equal(itemPainel(painel, "processo").pendente, true);
  assert.equal(itemPainel(painel, "paygo").situacao, "instalação comprovada");
  assert.equal(itemPainel(painel, "paygo").pendente, false);
  assert.equal(itemPainel(painel, "ambiente").situacao, "desconhecido");
  assert.match(itemPainel(painel, "ambiente").explicacao, /ambiente_efetivo = producao/);

  const ui = fonte("components/pdv/tef-assistente.tsx");
  const ativacao = ui.slice(ui.indexOf('etapa === "ativacao"'), ui.indexOf("function Painel"));
  assert.match(ativacao, /TefInicializacaoBiblioteca/);
  assert.match(ativacao, /TefPinpadDiagnostico/);
  const inicializacao = fonte("components/pdv/tef-inicializacao-biblioteca.tsx");
  assert.match(inicializacao, /\/tef\/inicializar/);
  assert.match(inicializacao, /corpoInicializacaoExplicita/);
  assert.doesNotMatch(inicializacao, /\/tef\/instalar|\/tef\/pagar|PWOPER_/);
  const pagina = fonte("app/configuracoes/financeiro/tef/page.tsx");
  assert.equal(pagina.includes("<TefInicializacaoBiblioteca"), false);
  assert.equal(pagina.includes("TefProducaoIsolada"), false);
  assert.equal(pagina.includes("TefPastaForm"), false);
  assert.equal(pagina.includes("TefAssistente"), false);
  assert.match(pagina, /Download e status do Connector/);
  assert.match(fonte("components/pdv/tef-producao-isolada.tsx"), /Instalar PayGoWeb/);
  assert.match(
    fonte("components/pdv/tef-producao-isolada.tsx"),
    /exige administrador, confirmação explícita e a credencial técnica/
  );
  const corpo = fonte("lib/pdv/tef/inicializacao-biblioteca.ts");
  assert.match(corpo, /acao: "inicializar"/);
  assert.doesNotMatch(corpo, /\/tef\/instalar|\/tef\/pagar|PWOPER_/);
  assert.match(fonte("components/pdv/tef-pinpad-diagnostico.tsx"), /Não inicia/);
  assert.match(fonte("components/pdv/tef-pinpad-diagnostico.tsx"), /pagamento/);
  const sessao = fonte("lib/pdv/tef/assistente-sessao.ts");
  assert.doesNotMatch(sessao, /from\("tef_validacoes_biblioteca"\)/);
  assert.doesNotMatch(sessao, /from\("tef_operacoes"\)\.update|from\("fiscal_emissoes"\)\.update/);
});

test("a instalação comercial só marca TEF pronto depois do ambiente efetivo", () => {
  const base = {
    connectorEncontrado: true,
    terminalVinculado: true,
    credenciamentoNecessario: true,
    credenciamentoOk: true,
    pinpadVerificado: true,
    ambienteEfetivoConfirmado: false,
    pontoConfirmado: true,
    servidorConfirmado: true,
  };
  const pendente = etapasInstalacaoComercial(base);
  assert.equal(pendente.find((item) => item.id === "pronto")?.concluida, false);
  assert.match(pendente.find((item) => item.id === "pronto")?.explicacao ?? "", /cobrança permanece bloqueada/);
  const pronto = etapasInstalacaoComercial({ ...base, ambienteEfetivoConfirmado: true });
  assert.equal(pronto.every((item) => item.concluida), true);
  assert.deepEqual(
    pronto.map((item) => item.rotulo),
    ["Instalar Connector", "Vincular terminal", "Configurar credenciamento", "Verificar PinPad", "TEF pronto"]
  );
});
