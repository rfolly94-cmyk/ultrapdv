import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";

import {
  avaliarProcessoAntesDeGravar,
  concluirSincronizacaoLocal,
  descreverRecusaVincular,
  lerRecusaVincular,
  mensagemVinculoConfirmado,
  montarCorpoVincular,
  planejarSincronizacaoVinculo,
  versaoInformaIdentidadeFiscal,
  type PedidoSincronizacaoVinculo,
  type VinculoAutorizado,
} from "./sincronizar-vinculo";

test("código de pareamento na mensagem de erro não é exibido", () => {
  const recusa = lerRecusaVincular(403, { ok: false, erro: "AB23CD45EF" });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.erro, "");
  const descrita = descreverRecusaVincular(recusa);
  assert.doesNotMatch(descrita, /AB23CD45EF/);
  assert.match(descrita, /HTTP 403/);
});

const EMPRESA = "347878e3-608a-46c4-9f22-7bebb982ff6d";
const TERMINAL = "19080057-44ee-4e1e-95a1-286317b88b03";
const DISPOSITIVO = "d1111111-1111-4111-8111-111111111111";
const CHAVE = "-----BEGIN PUBLIC KEY-----\nchave-ed25519\n-----END PUBLIC KEY-----";
const CNPJ = "11222333000181";

function pedido(
  parcial: Partial<PedidoSincronizacaoVinculo> = {}
): PedidoSincronizacaoVinculo {
  return {
    empresaSessaoId: EMPRESA,
    permissaoEditar: true,
    dispositivoInformado: DISPOSITIVO,
    chavePublicaInformada: CHAVE,
    dispositivoOutraEmpresa: false,
    pendenciaFinanceira: false,
    terminal: {
      id: TERMINAL,
      empresaId: EMPRESA,
      codigo: "117473",
      dispositivoId: DISPOSITIVO,
      chavePublica: CHAVE,
      chaveId: "77c24275-2cac-4be5-b9b2-52d0c6b1072e",
      estabelecimento: "SMARTCELL",
      pontoCaptura: "6696546",
      ativo: true,
      revogada: false,
      ambiente: "producao",
      servidor: "tef.producao.example:31735",
      cnpj: CNPJ,
    },
    config: {
      ambiente: "producao",
      estabelecimento: "SMARTCELL",
      pontoCaptura: "6696546",
      servidor: "tef.producao.example:31735",
    },
    cnpjEmpresa: CNPJ,
    ...parcial,
  };
}

function processoParado() {
  return {
    processo: "parado",
    inicializado: false,
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
  };
}

test("sincronização preserva código lógico, terminal e chave e troca só o ponto local", () => {
  const decisao = planejarSincronizacaoVinculo(pedido());
  assert.equal(decisao.efeito, "sincronizar");
  assert.equal(decisao.gravaBanco, false);
  assert.equal(decisao.revogaChave, false);
  assert.equal(decisao.executaInstalacao, false);
  assert.equal(decisao.ativaEmpresa, false);
  assert.ok(decisao.vinculo);
  assert.equal(decisao.vinculo.terminalId, TERMINAL);
  assert.equal(decisao.vinculo.terminalCodigo, "117473");
  assert.equal(decisao.vinculo.pontoCaptura, "6696546");
  assert.equal(decisao.vinculo.dispositivoId, DISPOSITIVO);
  assert.equal(decisao.vinculo.ambiente, "producao");
  assert.equal("chavePublica" in decisao.vinculo, false);
  const corpo = montarCorpoVincular("AB23CD45EF", decisao.vinculo);
  assert.equal(corpo.terminalCodigo, "117473");
  assert.equal(corpo.pontoCaptura, "6696546");
  assert.equal(corpo.codigo, "AB23CD45EF");
  assert.deepEqual(Object.keys(corpo).filter((chave) => chave !== "codigo").sort(), [
    "dispositivoId",
    "empresaId",
    "estabelecimento",
    "pontoCaptura",
    "terminalCodigo",
  ]);
  assert.equal("terminalId" in corpo, false);
  assert.equal("ambiente" in corpo, false);
  assert.equal("cnpj" in corpo, false);
  assert.equal("servidor" in corpo, false);
  assert.equal("chavePublica" in corpo, false);
  assert.equal("chavePrivada" in corpo, false);
  const antes = avaliarProcessoAntesDeGravar({
    processo: processoParado(),
    vinculoLocal: {
      vinculado: true,
      empresaId: EMPRESA,
      terminalCodigo: "117473",
      pontoCaptura: "117473",
      estabelecimento: "SMARTCELL",
      informaIdentidadeFiscal: false,
      ambiente: "",
      servidor: "",
      cnpjInformado: false,
    },
    vinculoAutorizado: decisao.vinculo,
  });
  assert.equal(antes.efeito, "gravar");
});

test("chave diferente é recusada sem revogação", () => {
  const decisao = planejarSincronizacaoVinculo(
    pedido({ chavePublicaInformada: "-----BEGIN PUBLIC KEY-----\noutra\n-----END PUBLIC KEY-----" })
  );
  assert.equal(decisao.efeito, "recusar");
  assert.equal(decisao.revogaChave, false);
  assert.equal(decisao.vinculo, null);
  assert.match(decisao.motivo, /não revoga/);
});

test("isolamento multiempresa recusa computador de outra empresa", () => {
  const cruzada = planejarSincronizacaoVinculo(
    pedido({
      empresaSessaoId: empresaA,
      dispositivoOutraEmpresa: true,
      terminal: null,
    })
  );
  assert.equal(cruzada.efeito, "recusar");
  assert.match(cruzada.motivo, /outra empresa/);
  const terminalAlheio = planejarSincronizacaoVinculo(
    pedido({
      empresaSessaoId: empresaA,
      terminal: {
        ...pedido().terminal!,
        empresaId: empresaB,
      },
    })
  );
  assert.equal(terminalAlheio.efeito, "recusar");
  assert.match(terminalAlheio.motivo, /não está vinculado/);
});

test("pendência, reconciliação e processo ativo com ponto antigo bloqueiam a gravação", () => {
  const pendente = planejarSincronizacaoVinculo(pedido({ pendenciaFinanceira: true }));
  assert.equal(pendente.efeito, "recusar");
  assert.match(pendente.motivo, /reconciliação|pendente/);
  const autorizado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const reconciliacao = avaliarProcessoAntesDeGravar({
    processo: { ...processoParado(), reconciliacaoNecessaria: true },
    vinculoLocal: null,
    vinculoAutorizado: autorizado,
  });
  assert.equal(reconciliacao.efeito, "recusar");
  const ativo = avaliarProcessoAntesDeGravar({
    processo: { ...processoParado(), processo: "executando", inicializado: true },
    vinculoLocal: {
      vinculado: true,
      empresaId: EMPRESA,
      terminalCodigo: "117473",
      pontoCaptura: "117473",
      estabelecimento: "SMARTCELL",
      informaIdentidadeFiscal: false,
      ambiente: "",
      servidor: "",
      cnpjInformado: false,
    },
    vinculoAutorizado: autorizado,
  });
  assert.equal(ativo.efeito, "recusar");
  assert.match(ativo.motivo, /processo TEF está ativo/);
});

test("falha de gravação pode ser repetida e o status oficial recupera a confirmação", () => {
  const esperado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const falha = concluirSincronizacaoLocal({
    gravacaoOk: false,
    status: {
      vinculo: {
        vinculado: true,
        empresaId: EMPRESA,
        terminalCodigo: "117473",
        pontoCaptura: "117473",
        estabelecimento: "SMARTCELL",
      },
      tef: { processo: "parado" },
    },
    esperado,
  });
  assert.equal(falha.efeito, "falhou");
  if (falha.efeito === "falhou") {
    assert.equal(falha.podeRepetir, true);
    assert.match(falha.motivo, /ponto 117473/);
  }
  const recusa = concluirSincronizacaoLocal({
    gravacaoOk: false,
    recusa: { httpStatus: 400, erro: "Payload recusado." },
    status: {
      vinculo: {
        vinculado: true,
        empresaId: EMPRESA,
        terminalCodigo: "117473",
        pontoCaptura: "117473",
        estabelecimento: "SMARTCELL",
      },
      tef: { processo: "parado" },
    },
    esperado,
  });
  assert.equal(recusa.efeito, "falhou");
  if (recusa.efeito === "falhou") {
    assert.match(recusa.motivo, /\(HTTP 400\): Payload recusado/);
    assert.match(recusa.motivo, /ponto 117473/);
    assert.equal(recusa.podeRepetir, true);
  }
  const recuperado = concluirSincronizacaoLocal({
    gravacaoOk: false,
    status: {
      vinculo: {
        vinculado: true,
        empresaId: EMPRESA,
        terminalCodigo: "117473",
        pontoCaptura: "6696546",
        estabelecimento: "SMARTCELL",
      },
      tef: { processo: "parado" },
    },
    esperado,
  });
  assert.equal(recuperado.efeito, "recuperado");
  if (recuperado.efeito === "recuperado") {
    assert.equal(recuperado.gravado.terminalCodigo, "117473");
    assert.equal(recuperado.gravado.pontoCaptura, "6696546");
    assert.equal(recuperado.gravado.processo, "parado");
  }
});

function localFiscal(parcial: {
  ambiente?: string;
  servidor?: string;
  cnpjInformado?: boolean;
  pontoCaptura?: string;
} = {}) {
  return {
    vinculado: true,
    empresaId: EMPRESA,
    terminalCodigo: "117473",
    pontoCaptura: parcial.pontoCaptura ?? "6696546",
    estabelecimento: "SMARTCELL",
    informaIdentidadeFiscal: true,
    ambiente: parcial.ambiente ?? "",
    servidor: parcial.servidor ?? "",
    cnpjInformado: parcial.cnpjInformado === true,
  };
}

test("vínculo antigo com ponto certo continua incompleto no Connector 1.3.5", () => {
  const autorizado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const antigo = avaliarProcessoAntesDeGravar({
    processo: processoParado(),
    vinculoLocal: localFiscal(),
    vinculoAutorizado: autorizado,
  });
  assert.equal(antigo.efeito, "gravar");
  assert.deepEqual(antigo.divergencias, ["ambiente", "servidor", "cnpj"]);
  const corpo = montarCorpoVincular("AB23CD45EF", autorizado, { identidadeFiscal: true });
  assert.equal(corpo.ambiente, "producao");
  assert.equal(corpo.servidor, "tef.producao.example:31735");
  assert.equal(corpo.cnpj, CNPJ);
  assert.equal(corpo.terminalCodigo, "117473");
  assert.equal(corpo.terminalId, TERMINAL);
  assert.equal("chavePrivada" in corpo, false);
  const confirmado = concluirSincronizacaoLocal({
    gravacaoOk: true,
    status: {
      vinculo: {
        vinculado: true,
        empresaId: EMPRESA,
        terminalCodigo: "117473",
        pontoCaptura: "6696546",
        estabelecimento: "SMARTCELL",
        ambiente: "",
        servidor: "",
        cnpjInformado: false,
      },
      tef: { processo: "parado", agente: { versao: "1.3.5" } },
    },
    esperado: autorizado,
    exigirIdentidadeFiscal: true,
  });
  assert.equal(confirmado.efeito, "falhou");
  if (confirmado.efeito === "falhou") {
    assert.deepEqual(confirmado.divergencias, ["ambiente", "servidor", "cnpj"]);
    assert.match(confirmado.motivo, /Ainda divergem: ambiente, servidor, CNPJ/);
  }
  assert.equal(versaoInformaIdentidadeFiscal("1.3.5"), true);
  assert.equal(versaoInformaIdentidadeFiscal("1.3.4"), false);
  assert.equal(versaoInformaIdentidadeFiscal("1.3.3"), false);
});

test("vínculo completo só é oficial depois que o status confirma ambiente, servidor e CNPJ", () => {
  const autorizado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const completo = avaliarProcessoAntesDeGravar({
    processo: processoParado(),
    vinculoLocal: localFiscal({
      ambiente: "producao",
      servidor: "tef.producao.example:31735",
      cnpjInformado: true,
    }),
    vinculoAutorizado: autorizado,
  });
  assert.equal(completo.efeito, "ja_sincronizado");
  assert.deepEqual(completo.divergencias, []);
  const status = {
    vinculo: {
      vinculado: true,
      empresaId: EMPRESA,
      terminalCodigo: "117473",
      pontoCaptura: "6696546",
      estabelecimento: "SMARTCELL",
      ambiente: "producao",
      servidor: "tef.producao.example:31735",
      cnpjInformado: true,
    },
    tef: { processo: "parado", agente: { versao: "1.3.5" } },
  };
  const confirmado = concluirSincronizacaoLocal({
    gravacaoOk: true,
    status,
    esperado: autorizado,
    exigirIdentidadeFiscal: true,
  });
  assert.equal(confirmado.efeito, "sincronizado");
  if (confirmado.efeito === "sincronizado") {
    assert.equal(confirmado.gravado.identidadeFiscal, true);
    assert.equal(confirmado.gravado.terminalCodigo, "117473");
    assert.equal(
      mensagemVinculoConfirmado("sincronizado", confirmado.gravado.identidadeFiscal),
      "Vínculo oficial sincronizado. Nenhuma venda foi ativada."
    );
  }
});

test("Connector 1.3.3 e 1.3.4 sincronizam o ponto sem receber a identidade fiscal", () => {
  const autorizado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const legado = avaliarProcessoAntesDeGravar({
    processo: processoParado(),
    vinculoLocal: {
      vinculado: true,
      empresaId: EMPRESA,
      terminalCodigo: "117473",
      pontoCaptura: "6696546",
      estabelecimento: "SMARTCELL",
      informaIdentidadeFiscal: false,
      ambiente: "",
      servidor: "",
      cnpjInformado: false,
    },
    vinculoAutorizado: autorizado,
  });
  assert.equal(legado.efeito, "ja_sincronizado");
  const corpo = montarCorpoVincular("AB23CD45EF", autorizado);
  assert.equal("ambiente" in corpo, false);
  assert.equal("cnpj" in corpo, false);
  assert.equal("servidor" in corpo, false);
  const confirmado = concluirSincronizacaoLocal({
    gravacaoOk: true,
    status: {
      vinculo: {
        vinculado: true,
        empresaId: EMPRESA,
        terminalCodigo: "117473",
        pontoCaptura: "6696546",
        estabelecimento: "SMARTCELL",
      },
      tef: { processo: "parado", agente: { versao: "1.3.4" } },
    },
    esperado: autorizado,
  });
  assert.equal(confirmado.efeito, "sincronizado");
  if (confirmado.efeito === "sincronizado") {
    assert.equal(confirmado.gravado.identidadeFiscal, false);
    assert.doesNotMatch(
      mensagemVinculoConfirmado("ja_sincronizado", false),
      /Vínculo oficial sincronizado/
    );
  }
});

test("falha de gravação no Connector 1.3.5 não confirma vínculo incompleto", () => {
  const autorizado = planejarSincronizacaoVinculo(pedido()).vinculo as VinculoAutorizado;
  const semServidor = planejarSincronizacaoVinculo(
    pedido({ config: { ...pedido().config, servidor: "" } })
  );
  assert.equal(semServidor.efeito, "recusar");
  assert.match(semServidor.motivo, /servidor oficial/);
  const falha = concluirSincronizacaoLocal({
    gravacaoOk: false,
    recusa: { httpStatus: 500, erro: "Não foi possível gravar o vínculo." },
    status: {
      vinculo: localFiscal(),
      tef: { processo: "parado", agente: { versao: "1.3.5" } },
    },
    esperado: autorizado,
    exigirIdentidadeFiscal: true,
  });
  assert.equal(falha.efeito, "falhou");
  if (falha.efeito === "falhou") {
    assert.equal(falha.podeRepetir, true);
    assert.match(falha.motivo, /HTTP 500/);
    assert.deepEqual(falha.divergencias, ["ambiente", "servidor", "cnpj"]);
  }
});

test("a ação reutiliza /tef/vincular e não instala, não revoga e não grava o banco", () => {
  const ui = fonte("components/pdv/tef-pareamento-form.tsx");
  const servico = fonte("lib/pdv/tef/servico.ts");
  const persistencia = fonte("lib/pdv/tef/persistencia.ts");
  const sincronizar = ui.slice(ui.indexOf("async function sincronizar"), ui.indexOf("async function revogar"));
  assert.match(ui, /Sincronizar Connector/);
  assert.match(sincronizar, /\/tef\/vincular/);
  assert.match(sincronizar, /lerStatusConnector/);
  assert.match(ui, /async function lerStatusConnector[\s\S]*\/tef\/status/);
  assert.doesNotMatch(sincronizar, /\/tef\/instalar|\/tef\/inicializar|PWOPER_|rotacionar|revogar/);
  assert.match(sincronizar, /montarCorpoVincular\(codigoSincronizacao, preparado\.vinculo/);
  assert.match(sincronizar, /identidadeFiscal: exigeFiscal/);
  assert.match(sincronizar, /mensagemVinculoConfirmado/);
  assert.doesNotMatch(sincronizar, /já está com o vínculo oficial/);
  assert.match(ui, /ainda diverge do cadastro oficial/);
  assert.match(sincronizar, /lerGravacaoVincular/);
  assert.match(sincronizar, /recusa/);
  assert.doesNotMatch(sincronizar, /pontoCaptura: terminal|pontoCaptura: ponto|empresaId: props/);
  const preparar = servico.slice(
    servico.indexOf("export async function prepararSincronizacaoVinculoTefSessao"),
    servico.indexOf("export async function verificarComputadorTefSessao")
  );
  assert.match(preparar, /ctx\.empresaId/);
  assert.doesNotMatch(preparar, /input\.pontoCaptura|input\.ambiente|input\.empresaId|revogarTerminalTef|\.update\(|\.insert\(/);
  const carga = persistencia.slice(
    persistencia.indexOf("export async function carregarFatosSincronizacaoVinculo"),
    persistencia.indexOf("export async function definirTefPlataforma")
  );
  assert.doesNotMatch(carga, /\.update\(|\.insert\(/);
  assert.match(carga, /STATUS_TEF_ABERTOS/);
});
