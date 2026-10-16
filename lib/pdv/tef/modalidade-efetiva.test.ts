import assert from "node:assert/strict";
import { test } from "node:test";

import { origemProducaoComprovada } from "@/lib/pdv/tef/ambiente-transacao";
import {
  formaDaModalidadeEfetiva,
  decidirModalidadeOficial,
  modalidadeDoTipoCartaoPayGo,
  tPagDaModalidade,
} from "@/lib/pdv/tef/modalidade-efetiva";
import {
  iniciarOperacao,
  memoriaTefVazia,
  registrarResultado,
  salvarConfigEmpresa,
  type MemoriaTef,
} from "@/lib/pdv/tef/orquestracao";
import { decidirRecuperacao } from "@/lib/pdv/tef/regras";

const EMPRESA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DISPOSITIVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const formas = [
  {
    id: "debito",
    codigo: "DEBITO",
    nome: "Cartão de Débito",
    codigo_fiscal: "04",
  },
  {
    id: "credito",
    codigo: "CREDITO",
    nome: "Cartão de Crédito",
    codigo_fiscal: "03",
  },
  {
    id: "dinheiro",
    codigo: "DINHEIRO",
    nome: "Dinheiro",
    codigo_fiscal: "01",
  },
];

function memoria(): MemoriaTef {
  const base = memoriaTefVazia();
  base.plataformaHabilitada = true;
  salvarConfigEmpresa(base, EMPRESA, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA",
    pontoCaptura: "001",
  });
  return base;
}

function iniciar(base: MemoriaTef, modalidade: "debito" | "credito") {
  return iniciarOperacao(base, {
    empresaId: EMPRESA,
    dispositivoId: DISPOSITIVO,
    terminalCodigo: "117473",
    modalidade,
    valorCentavos: 2500,
    identificador: `op-${modalidade}`,
    idempotencyKey: `idem-${modalidade}`,
  });
}

function autorizar(
  base: MemoriaTef,
  operacaoId: string,
  tipoCartao: unknown,
  extra: { pix?: boolean; provaValida?: boolean } = {}
) {
  return registrarResultado(base, {
    empresaId: EMPRESA,
    operacaoId,
    provaValida: true,
    origem: origemProducaoComprovada({ ponto: "001" }),
    modalidadeOficial: {
      provaValida: extra.provaValida !== false,
      tipoCartao,
    },
    resultado: {
      sucessoTransacao: true,
      nsu: "998877",
      codigoAutorizacao: "AUT01",
      rede: extra.pix ? "PIX C6 BANK" : "C6 PAY",
      instituicao: extra.pix ? "PIX" : "PRODUTO",
      codigoFinalizacao: "FIN01",
      valor: 25,
      confirmar: true,
    },
  });
}

test("PWINFO_CARDTYPE 1 e 2 são crédito e débito; texto não vira modalidade", () => {
  assert.equal(modalidadeDoTipoCartaoPayGo(1), "credito");
  assert.equal(modalidadeDoTipoCartaoPayGo(2), "debito");
  assert.equal(modalidadeDoTipoCartaoPayGo(0), null);
  assert.equal(modalidadeDoTipoCartaoPayGo(3), null);
  assert.equal(modalidadeDoTipoCartaoPayGo(4), null);
  assert.equal(modalidadeDoTipoCartaoPayGo("CREDITO A VISTA"), null);
  assert.equal(modalidadeDoTipoCartaoPayGo("1"), null);
  assert.equal(tPagDaModalidade("credito"), "03");
  assert.equal(tPagDaModalidade("debito"), "04");
});

test("PDV débito e TEF crédito grava a modalidade efetiva", () => {
  const base = memoria();
  const inicio = iniciar(base, "debito");
  assert.equal(inicio.ok, true);
  if (!inicio.ok) return;
  const resultado = autorizar(base, inicio.operacaoId, 1);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.status, "autorizada");
  assert.equal(resultado.modalidadeSolicitada, "debito");
  assert.equal(resultado.modalidadeEfetiva, "credito");
  assert.equal(resultado.modalidade, "credito");
  assert.equal(resultado.avisoModalidade, "Pagamento aprovado no crédito");
  const forma = formaDaModalidadeEfetiva(formas, "credito", "debito");
  assert.equal(forma?.id, "credito");
  assert.equal(forma?.codigo_fiscal, "03");
  assert.match(forma?.nome ?? "", /Crédito/);
});

test("PDV crédito e TEF débito grava débito", () => {
  const base = memoria();
  const inicio = iniciar(base, "credito");
  assert.equal(inicio.ok, true);
  if (!inicio.ok) return;
  const resultado = autorizar(base, inicio.operacaoId, 2);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.modalidadeEfetiva, "debito");
  assert.equal(resultado.avisoModalidade, "Pagamento aprovado no débito");
  assert.equal(formaDaModalidadeEfetiva(formas, "debito", "credito")?.codigo_fiscal, "04");
});

test("PDV e TEF iguais não trocam a forma", () => {
  const debito = decidirModalidadeOficial({
    solicitada: "debito",
    tipoCartao: 2,
    provaValida: true,
    pix: false,
  });
  const credito = decidirModalidadeOficial({
    solicitada: "credito",
    tipoCartao: 1,
    provaValida: true,
    pix: false,
  });
  assert.equal(debito.modalidadeEfetiva, "debito");
  assert.equal(debito.aviso, null);
  assert.equal(credito.modalidadeEfetiva, "credito");
  assert.equal(credito.aviso, null);
  assert.equal(formaDaModalidadeEfetiva(formas, "debito", "debito")?.id, "debito");
});

test("tipo de cartão indeterminado pede conciliação e não outra cobrança", () => {
  const base = memoria();
  const inicio = iniciar(base, "debito");
  assert.equal(inicio.ok, true);
  if (!inicio.ok) return;
  const resultado = autorizar(base, inicio.operacaoId, 4);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.status, "reconciliacao");
  assert.equal(resultado.modalidadeEfetiva, null);
  assert.equal(resultado.proibirDesfazimento, true);
  const operacao = base.operacoes[0];
  const retomada = decidirRecuperacao({
    empresaId: EMPRESA,
    existeVenda: false,
    operacao: operacao
      ? {
          empresaId: operacao.empresaId,
          status: operacao.status,
          vendaId: operacao.vendaId,
          teste: operacao.teste,
          nsu: operacao.nsu,
          rede: operacao.rede,
          finalizacao: operacao.finalizacao,
        }
      : null,
  });
  assert.equal(retomada.acao, "reconciliar");
  assert.equal(retomada.confirmar, false);
  assert.equal(retomada.cobrarDeNovo, false);
});

test("pagamento misto preserva a modalidade efetiva de cada parcela", () => {
  const primeira = decidirModalidadeOficial({
    solicitada: "debito",
    tipoCartao: 1,
    provaValida: true,
    pix: false,
  });
  const segunda = decidirModalidadeOficial({
    solicitada: "credito",
    tipoCartao: 2,
    provaValida: true,
    pix: false,
  });
  assert.equal(primeira.modalidadeEfetiva, "credito");
  assert.equal(segunda.modalidadeEfetiva, "debito");
  assert.equal(formaDaModalidadeEfetiva(formas, primeira.modalidadeEfetiva ?? "credito")?.id, "credito");
  assert.equal(formaDaModalidadeEfetiva(formas, segunda.modalidadeEfetiva ?? "debito")?.id, "debito");
});

test("PIX sem tipo de cartão não vira crédito nem conciliação", () => {
  const base = memoria();
  const inicio = iniciar(base, "debito");
  assert.equal(inicio.ok, true);
  if (!inicio.ok) return;
  const resultado = autorizar(base, inicio.operacaoId, null, { pix: true });
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.status, "autorizada");
  assert.equal(resultado.modalidade, "debito");
  assert.equal(resultado.modalidadeEfetiva, null);
});

test("cobrança aprovada com venda gravada não pede segunda cobrança se a NFC-e falhar depois", () => {
  const retomada = decidirRecuperacao({
    empresaId: EMPRESA,
    existeVenda: true,
    operacao: {
      empresaId: EMPRESA,
      status: "vinculada",
      vendaId: "venda-1",
      teste: false,
      nsu: "998877",
      rede: "C6 PAY",
      finalizacao: "FIN01",
    },
  });
  assert.equal(retomada.acao, "confirmar");
  assert.equal(retomada.confirmar, true);
  assert.equal(retomada.cobrarDeNovo, false);
});
