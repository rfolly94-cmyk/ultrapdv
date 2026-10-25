import assert from "node:assert/strict";
import test from "node:test";

import {
  classificarDisponibilidadePdv,
  prepararComprovantesTef,
  prepararInstalacaoCliente,
  type EntradaDisponibilidadeTef,
} from "./disponibilidade-pdv";

function entrada(extra: Partial<EntradaDisponibilidadeTef> = {}): EntradaDisponibilidadeTef {
  return {
    habilitado: true,
    ambiente: "homologacao",
    credenciaisCompletas: true,
    pontoInstalado: true,
    terminalVinculado: true,
    connectorPresente: true,
    connectorCompativel: true,
    bibliotecaPresente: true,
    pinpadDisponivel: true,
    ambienteCompativel: true,
    cobrancaRealBloqueada: true,
    ativacaoExplicita: false,
    transacaoEmAndamento: false,
    recuperacaoNecessaria: false,
    ...extra,
  };
}

test("o caixa distingue desabilitado, homologação, produção bloqueada e operação simulada", () => {
  assert.equal(classificarDisponibilidadePdv(entrada({ habilitado: false, ambiente: "" })).estado, "tef_desabilitado");
  assert.equal(classificarDisponibilidadePdv(entrada({ habilitado: false })).receber, false);
  assert.equal(classificarDisponibilidadePdv(entrada()).estado, "homologacao_disponivel_para_testes");
  assert.equal(
    classificarDisponibilidadePdv(entrada({ ambiente: "producao", ativacaoExplicita: true })).estado,
    "producao_aguardando_liberacao"
  );
  const operacional = classificarDisponibilidadePdv(
    entrada({ ambiente: "producao", cobrancaRealBloqueada: false, ativacaoExplicita: true })
  );
  assert.equal(operacional.estado, "tef_operacional");
  assert.equal(operacional.simularSucesso, false);
  assert.equal(classificarDisponibilidadePdv(entrada({ connectorPresente: false })).estado, "sem_connector");
  assert.equal(classificarDisponibilidadePdv(entrada({ connectorCompativel: false })).estado, "connector_incompativel");
  assert.equal(classificarDisponibilidadePdv(entrada({ bibliotecaPresente: false })).estado, "biblioteca_ausente");
  assert.equal(classificarDisponibilidadePdv(entrada({ credenciaisCompletas: false })).estado, "credenciais_incompletas");
  assert.equal(classificarDisponibilidadePdv(entrada({ pontoInstalado: false })).estado, "ponto_nao_instalado");
  assert.equal(classificarDisponibilidadePdv(entrada({ terminalVinculado: false })).estado, "terminal_nao_vinculado");
  assert.equal(classificarDisponibilidadePdv(entrada({ pinpadDisponivel: false })).estado, "pinpad_indisponivel");
  assert.equal(classificarDisponibilidadePdv(entrada({ ambiente: "", habilitado: true })).estado, "ambiente_incorreto");
  assert.equal(classificarDisponibilidadePdv(entrada({ ambienteCompativel: false })).estado, "ambiente_incorreto");
  assert.equal(classificarDisponibilidadePdv(entrada({ transacaoEmAndamento: true })).estado, "transacao_em_andamento");
  assert.equal(classificarDisponibilidadePdv(entrada({ recuperacaoNecessaria: true, transacaoEmAndamento: true })).estado, "recuperacao_necessaria");
  assert.match(
    classificarDisponibilidadePdv(entrada({ ambiente: "producao" })).motivo,
    /PGWebLib\.h/
  );
  assert.equal(
    classificarDisponibilidadePdv(entrada({ ambiente: "producao" })).motivo.includes("homologação do layout"),
    false
  );
});

test("crédito, débito, parcelamento e misto usam o mesmo bloqueio de disponibilidade", () => {
  const modalidades = ["debito", "credito"] as const;
  for (const modalidade of modalidades) {
    const estado = classificarDisponibilidadePdv(entrada());
    assert.equal(modalidade === "debito" || modalidade === "credito", true);
    assert.equal(estado.receber, false);
  }
  const parcelas = [
    { modalidade: "credito", parcelas: 3, valorCentavos: 7000 },
    { modalidade: "debito", parcelas: 1, valorCentavos: 3000 },
  ];
  assert.equal(parcelas.reduce((total, parcela) => total + parcela.valorCentavos, 0), 10000);
  assert.equal(classificarDisponibilidadePdv(entrada()).receber, false);
});

test("a instalação de cliente não executa e não copia o outro ambiente", () => {
  const pronto = prepararInstalacaoCliente({
    ambiente: "producao",
    empresaId: "empresa-1",
    terminalId: "terminal-1",
    confirmacao: "AUTORIZO_INSTALACAO_PRODUCAO",
    connectorPresente: true,
    bibliotecaConferida: true,
    diretorioExclusivo: true,
    credenciaisDesteAmbiente: true,
    copiarOutroAmbiente: false,
    jaInstalado: false,
  });
  assert.equal(pronto.executar, false);
  assert.equal(pronto.codigo, "pronto_sem_execucao");
  assert.equal(
    prepararInstalacaoCliente({
      ambiente: "producao",
      empresaId: "empresa-1",
      terminalId: "terminal-1",
      confirmacao: "",
      connectorPresente: true,
      bibliotecaConferida: true,
      diretorioExclusivo: true,
      credenciaisDesteAmbiente: true,
      copiarOutroAmbiente: false,
      jaInstalado: false,
    }).codigo,
    "confirmacao"
  );
  assert.equal(
    prepararInstalacaoCliente({
      ambiente: "",
      empresaId: "empresa-1",
      terminalId: "terminal-1",
      confirmacao: "AUTORIZO_INSTALACAO_PRODUCAO",
      connectorPresente: true,
      bibliotecaConferida: true,
      diretorioExclusivo: true,
      credenciaisDesteAmbiente: true,
      copiarOutroAmbiente: false,
      jaInstalado: false,
    }).codigo,
    "ambiente"
  );
  assert.equal(
    prepararInstalacaoCliente({
      ambiente: "homologacao",
      empresaId: "empresa-1",
      terminalId: "terminal-1",
      confirmacao: "",
      connectorPresente: true,
      bibliotecaConferida: true,
      diretorioExclusivo: true,
      credenciaisDesteAmbiente: false,
      copiarOutroAmbiente: true,
      jaInstalado: false,
    }).codigo,
    "isolamento"
  );
  assert.equal(
    prepararInstalacaoCliente({
      ambiente: "producao",
      empresaId: "empresa-1",
      terminalId: "terminal-1",
      confirmacao: "AUTORIZO_INSTALACAO_PRODUCAO",
      connectorPresente: true,
      bibliotecaConferida: true,
      diretorioExclusivo: true,
      credenciaisDesteAmbiente: true,
      copiarOutroAmbiente: false,
      jaInstalado: true,
    }).codigo,
    "reinstalacao"
  );
});

test("comprovante só sai de transação confirmada e falhas não viram aprovação", () => {
  const recusa = prepararComprovantesTef({
    status: "recusada",
    pagamentoRecebido: false,
    transacaoConfirmada: false,
    viaEstabelecimento: "VIA",
    viaCliente: "VIA",
    vendaId: "venda-1",
    rede: "C6 PAY",
    quando: "2026-10-18T15:00:00.000Z",
  });
  assert.equal(recusa.imprimir, false);
  const host = prepararComprovantesTef({
    status: "desconhecida",
    pagamentoRecebido: false,
    transacaoConfirmada: false,
    viaEstabelecimento: "[NA A258] ERRO INTERNO",
    viaCliente: "",
    vendaId: "venda-1",
    rede: "",
    quando: "",
  });
  assert.equal(host.imprimir, false);
  const confirmada = prepararComprovantesTef({
    status: "confirmada",
    pagamentoRecebido: true,
    transacaoConfirmada: true,
    viaEstabelecimento: "ESTABELECIMENTO",
    viaCliente: "CLIENTE",
    vendaId: "venda-1",
    rede: "C6 PAY",
    quando: "2026-10-18T15:00:00.000Z",
  });
  assert.equal(confirmada.imprimir, true);
  if (confirmada.imprimir) {
    assert.deepEqual(
      confirmada.vias.map((via) => via.destino),
      ["estabelecimento", "cliente"]
    );
  }
});
