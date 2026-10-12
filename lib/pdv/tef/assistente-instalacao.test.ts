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
  etapaInicial,
  interpretarStatusConnector,
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
    executavelEncontrado: true,
    processo: "executando",
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
    }),
    "pinpad"
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
    "validacao"
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
  assert.match(ui, /\/tef\/instalar/);
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
