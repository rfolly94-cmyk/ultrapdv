import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { pagamentoEletronicoTemDadosReais } from "@/lib/fiscal/validar-pagamentos-eletronicos";

import {
  MENSAGEM_CARTAO_MANUAL_BLOQUEADO,
  MENSAGEM_CARTAO_MANUAL_EXIGE_ESCOLHA,
  MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF,
  MENSAGEM_HABILITAR_TEF,
  MENSAGEM_TEF_FALHA_SEM_FALLBACK,
  MENSAGEM_TEF_PLATAFORMA_DESLIGADA,
  avaliarCartaoAntesDaCobranca,
  mensagemCobrancaNaoConcluida,
  avaliarParcelasCartao,
  camposFiscaisDaTransacaoTef,
  mensagemPainelCartao,
  operacaoManualAceita,
} from "./cartao-checkout";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const empresaSemPlataforma = {
  plataformaHabilitada: false,
  empresaHabilitada: true,
  permitirOperacaoManual: false,
};

const debito = {
  modalidade: "debito" as const,
  tefOperacaoId: null,
  operacaoManual: false,
};

test("plataforma desligada e empresa configurada bloqueia cartão manual silencioso", () => {
  const painel = mensagemPainelCartao(empresaSemPlataforma);
  assert.match(painel ?? "", /TEF está indisponível/);
  assert.match(painel ?? "", /pinpad não será acionado/);

  const venda = avaliarParcelasCartao(empresaSemPlataforma, [
    { modalidade: null },
    debito,
  ]);
  assert.equal(venda.ok, false);
  if (!venda.ok) {
    assert.match(venda.erro, new RegExp(MENSAGEM_TEF_PLATAFORMA_DESLIGADA));
    assert.match(venda.erro, new RegExp(MENSAGEM_CARTAO_MANUAL_BLOQUEADO));
  }
});

test("operação manual só passa com autorização da empresa e escolha explícita", () => {
  const politica = { ...empresaSemPlataforma, permitirOperacaoManual: true };
  const semEscolha = avaliarParcelasCartao(politica, [debito]);
  assert.equal(semEscolha.ok, false);
  if (!semEscolha.ok) {
    assert.match(semEscolha.erro, new RegExp(MENSAGEM_CARTAO_MANUAL_EXIGE_ESCOLHA));
  }

  const escolhida = avaliarParcelasCartao(politica, [
    { ...debito, operacaoManual: true },
  ]);
  assert.equal(escolhida.ok, true);
  assert.equal(
    operacaoManualAceita(politica, { ...debito, operacaoManual: true }),
    true
  );
});

test("empresa sem TEF continua vendendo cartão, dinheiro e PIX", () => {
  const politica = {
    plataformaHabilitada: false,
    empresaHabilitada: false,
    permitirOperacaoManual: false,
  };
  assert.equal(mensagemPainelCartao(politica), null);
  assert.equal(
    avaliarParcelasCartao(politica, [
      { modalidade: null },
      debito,
      { modalidade: "credito", operacaoManual: false },
    ]).ok,
    true
  );
});

test("ambiente definido e TEF desligado não converte débito nem crédito em pagamento comum", () => {
  for (const ambiente of ["homologacao", "producao"] as const) {
    for (const modalidade of ["debito", "credito"] as const) {
      const venda = avaliarParcelasCartao(
        {
          plataformaHabilitada: true,
          empresaHabilitada: false,
          permitirOperacaoManual: true,
          ambiente,
        },
        [{ modalidade, operacaoManual: true }]
      );
      assert.equal(venda.ok, false);
      if (!venda.ok) {
        assert.equal(venda.erro, MENSAGEM_HABILITAR_TEF);
      }
    }
    const demais = avaliarParcelasCartao(
      {
        plataformaHabilitada: false,
        empresaHabilitada: false,
        permitirOperacaoManual: false,
        ambiente,
      },
      [{ modalidade: null }]
    );
    assert.equal(demais.ok, true);
  }
});

test("com as duas flags ativas, falta de prova não vira cartão manual", () => {
  const politica = {
    plataformaHabilitada: true,
    empresaHabilitada: true,
    permitirOperacaoManual: true,
  };
  const semProva = avaliarParcelasCartao(politica, [debito]);
  assert.equal(semProva.ok, false);
  if (!semProva.ok) {
    assert.equal(semProva.erro, MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF);
  }

  const manualExplicito = avaliarParcelasCartao(politica, [
    { ...debito, operacaoManual: true },
  ]);
  assert.equal(manualExplicito.ok, true);

  const forjado = avaliarParcelasCartao(
    { ...politica, permitirOperacaoManual: false },
    [{ ...debito, operacaoManual: true }]
  );
  assert.equal(forjado.ok, false);
});

test("dinheiro e PIX não exigem TEF mesmo com a empresa configurada", () => {
  assert.equal(
    avaliarParcelasCartao(empresaSemPlataforma, [
      { modalidade: null, operacaoManual: false },
    ]).ok,
    true
  );
});

test("transação TEF não inventa bandeira, credenciadora nem CNPJ para a NFC-e", () => {
  const campos = camposFiscaisDaTransacaoTef({
    nsu: "123456",
    autorizacao: "ABC999",
    rede: "Visa",
  });
  assert.equal(campos.bandeira, null);
  assert.equal(campos.tipo_integracao, null);
  assert.equal(campos.cnpj_credenciadora, null);
  assert.equal(campos.cnpj_receb, null);
  assert.equal(campos.autorizacao, "ABC999");
  assert.equal(campos.nsu, "123456");
  assert.equal(
    pagamentoEletronicoTemDadosReais({
      codigo_fiscal: "04",
      ...campos,
    }),
    false
  );
});

test("a finalização comercial não grava NSU nem autorização inventados", () => {
  const fonte = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  const inicio = fonte.indexOf("const pagamentos =");
  const fim = fonte.indexOf("const idsFormas", inicio);
  const trecho = fonte.slice(inicio, fim);
  assert.doesNotMatch(trecho, /autorizacao|bandeira|nsu|cnpj_credenciadora|tipo_integracao/);
});

test("com as duas flags ativas, o pinpad começa antes da venda e a autorização ausente ainda bloqueia", () => {
  const politica = {
    plataformaHabilitada: true,
    empresaHabilitada: true,
    permitirOperacaoManual: false,
  };
  const antes = avaliarCartaoAntesDaCobranca(politica, [debito]);
  assert.equal(antes.ok, true);
  if (antes.ok) {
    assert.equal(antes.cobrarNoPinpad, true);
  }

  const venda = avaliarParcelasCartao(politica, [debito]);
  assert.equal(venda.ok, false);
  if (!venda.ok) {
    assert.equal(venda.erro, MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF);
  }

  const autorizada = avaliarParcelasCartao(politica, [
    { ...debito, tefOperacaoId: "op-debito" },
  ]);
  assert.equal(autorizada.ok, true);

  const shell = readFileSync(join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const inicio = shell.indexOf("function concluirVenda(");
  const gravacao = shell.indexOf("finalizarVendaPdv(", inicio);
  const checkout = shell.slice(inicio, gravacao);
  const posPolitica = checkout.indexOf("decidirProximaCobranca");
  const posCobranca = checkout.indexOf("cobrarPeloMotorCsharp");
  assert.ok(posPolitica > 0);
  assert.ok(posCobranca > posPolitica);
  assert.equal(checkout.includes("executarVendaPinpad"), false);
  assert.equal(checkout.includes("avaliarParcelasCartao("), false);

  const finalizacao = readFileSync(join(raiz, "lib/pdv/tef/finalizacao.ts"), "utf8");
  assert.match(finalizacao, /avaliarParcelasCartao\(politica, parcelas\)/);
  assert.equal(finalizacao.includes("avaliarCartaoAntesDaCobranca"), false);
});

test("falha do Connector não marca a venda como cartão manual", () => {
  const fonte = readFileSync(join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const inicio = fonte.indexOf("if (!resultadoMotor.pagamentoRecebido)");
  assert.notEqual(inicio, -1);
  const trecho = fonte.slice(inicio, inicio + 400);
  assert.match(trecho, /setErroPagamento\(resultadoMotor\.erro\)/);
  assert.doesNotMatch(trecho, /setCartaoManualConfirmado\(true\)/);
  assert.match(trecho, /return/);
});

test("a mensagem do host A258 permanece visível e não vira cartão manual", () => {
  const texto = mensagemCobrancaNaoConcluida("erro: [NA A258] ERRO INTERNO");
  assert.equal(texto.includes("[NA A258] ERRO INTERNO"), true);
  assert.equal(texto.includes(MENSAGEM_TEF_FALHA_SEM_FALLBACK), true);
  assert.equal(texto.includes("NFC-e"), false);
  const shell = readFileSync(join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const resposta = shell.indexOf("async function responderCaptura");
  const fim = shell.indexOf("useEffect(", resposta);
  assert.match(shell.slice(resposta, fim), /mensagemCobrancaNaoConcluida/);
});
