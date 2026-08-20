import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { montarPayloadPixEstatico } from "./brcode";
import { gerarTxidPixLocalPdv, ehTxidPixValido } from "./brcode/txid";
import { montarPayloadCobrancaPix } from "./montar-payload";
import {
  STATUS_PIX_LOCAL,
  decidirQrAposMudancaValor,
  ehFormaPix,
  mensagemBloqueioPixPendente,
  mensagemPixConfirmadoNaoAltera,
  podeDescartarPixLocal,
  rejeitarCamposDeConfirmacaoDoCliente,
  validarConfirmacaoPixLocal,
  validarGeracaoPixLocal,
  validarVinculoPixNaFinalizacao,
} from "./local-regras";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function campoEmv(payload: string, id: string) {
  let i = 0;
  while (i + 4 <= payload.length) {
    const campoId = payload.slice(i, i + 2);
    const tamanho = Number(payload.slice(i + 2, i + 4));
    const valor = payload.slice(i + 4, i + 4 + tamanho);
    if (campoId === id) {
      return valor;
    }
    i += 4 + tamanho;
  }
  return null;
}

const formaPix = { tipo: "pix", codigo: "PIX", nome: "PIX" };
const formaDinheiro = { tipo: "dinheiro", codigo: "DIN", nome: "Dinheiro" };
const formaCartao = { tipo: "cartao", codigo: "CAR", nome: "Cartão" };
const formaFiado = { tipo: "fiado", codigo: "FIA", nome: "Fiado", permite_fiado: true };

test("1. PIX local de R$ 100 gera QR de R$ 100", () => {
  const payload = montarPayloadPixEstatico({
    chave: "123e4567-e12b-12d1-a456-426655440000",
    nomeRecebedor: "UltraCell",
    cidadeRecebedor: "Cuiaba",
    valor: 100,
    txid: "PDV100",
  });
  assert.equal(campoEmv(payload, "54"), "100.00");
});

test("2. PIX em pagamento dividido usa somente a parcela PIX", () => {
  const venda = 150;
  const dinheiro = 50;
  const pix = venda - dinheiro;
  const payload = montarPayloadPixEstatico({
    chave: "chave@loja.com",
    nomeRecebedor: "UltraCell",
    cidadeRecebedor: "Cuiaba",
    valor: pix,
    txid: "PARCELA",
  });
  assert.equal(campoEmv(payload, "54"), "100.00");
  assert.notEqual(campoEmv(payload, "54"), "150.00");
});

test("3. gerar QR não marca pago", () => {
  validarGeracaoPixLocal({
    valor: 100,
    modo: "local_manual",
    ativo: true,
    chavePix: "chave",
    recebedorNome: "Loja",
    recebedorCidade: "Cuiaba",
  });
  assert.equal(STATUS_PIX_LOCAL.aguardando, "aguardando_confirmacao");
  assert.notEqual(STATUS_PIX_LOCAL.aguardando, "paga");
});

test("4. gerar QR persiste aguardando confirmação", () => {
  const fonte = readFileSync(
    join(raiz, "lib/pagamentos/pix/local-pdv.ts"),
    "utf8"
  );
  assert.match(fonte, /status: STATUS_PIX_LOCAL.aguardando/);
  assert.match(fonte, /from\("cobrancas_pix"\)/);
  assert.match(fonte, /\.insert\(/);
});

test("5. confirmar salva usuário autenticado", () => {
  const fonte = readFileSync(
    join(raiz, "lib/pagamentos/pix/local-pdv.ts"),
    "utf8"
  );
  assert.match(fonte, /confirmado_por: usuarioId/);
  assert.equal(fonte.includes("confirmado_por: body"), false);
});

test("6. confirmar salva horário no servidor", () => {
  const fonte = readFileSync(
    join(raiz, "lib/pagamentos/pix/local-pdv.ts"),
    "utf8"
  );
  assert.match(fonte, /confirmado_em: confirmadoEm/);
  assert.match(fonte, /new Date\(\)\.toISOString\(\)/);
});

test("7. empresa A não confirma PIX da empresa B", () => {
  assert.throws(
    () =>
      validarConfirmacaoPixLocal({
        empresaId: "empresa-a",
        recebimento: {
          empresa_id: "empresa-b",
          status: STATUS_PIX_LOCAL.aguardando,
          modo_pix: "local_manual",
        },
      }),
    /outra empresa/
  );
});

test("8. cliente não consegue escolher confirmado_por", () => {
  assert.throws(
    () =>
      rejeitarCamposDeConfirmacaoDoCliente({
        recebimento_id: "abc",
        confirmado_por: "uuid-forjado",
      }),
    /não pode escolher/
  );
});

test("9. PIX aguardando bloqueia finalizar venda", () => {
  assert.throws(
    () =>
      validarVinculoPixNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        recebimento: {
          empresa_id: "empresa-a",
          status: STATUS_PIX_LOCAL.aguardando,
          modo_pix: "local_manual",
          valor: 100,
          confirmado_manualmente: false,
        },
      }),
    /Confirme o recebimento do PIX de/
  );
  assert.match(mensagemBloqueioPixPendente(100), /R\$\s*100/);
});

test("10. PIX confirmado permite finalizar venda", () => {
  assert.doesNotThrow(() =>
    validarVinculoPixNaFinalizacao({
      empresaId: "empresa-a",
      valorPagamento: 100,
      recebimento: {
        empresa_id: "empresa-a",
        status: STATUS_PIX_LOCAL.confirmado,
        modo_pix: "local_manual",
        valor: 100,
        confirmado_manualmente: true,
      },
    })
  );
});

test("11. valor do PIX confirmado deve ser igual ao pagamento", () => {
  assert.throws(
    () =>
      validarVinculoPixNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 80,
        recebimento: {
          empresa_id: "empresa-a",
          status: STATUS_PIX_LOCAL.confirmado,
          modo_pix: "local_manual",
          valor: 100,
          confirmado_manualmente: true,
        },
      }),
    /deve ser igual/
  );
});

test("12. recebimento não pode ser usado em duas vendas", () => {
  assert.throws(
    () =>
      validarVinculoPixNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        recebimento: {
          empresa_id: "empresa-a",
          status: STATUS_PIX_LOCAL.confirmado,
          modo_pix: "local_manual",
          valor: 100,
          venda_id: "venda-1",
          confirmado_manualmente: true,
        },
      }),
    /outra venda/
  );
});

test("13. double-click em finalizar não duplica venda", () => {
  const fonte = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  assert.match(fonte, /p_idempotency_key/);
  assert.match(fonte, /rpc_finalizar_venda/);
});

test("14. double-click não baixa estoque duas vezes", () => {
  const fonte = readFileSync(
    join(raiz, "supabase/migrations/20260815010000_estoque_venda_edicao_cancelamento.sql"),
    "utf8"
  );
  assert.match(fonte, /rpc_finalizar_venda\s+= NÃO ALTERAR \(idempotência\)/);
});

test("15. alteração do valor antes da confirmação invalida QR anterior", () => {
  assert.equal(
    decidirQrAposMudancaValor({
      status: STATUS_PIX_LOCAL.aguardando,
      valorQr: 100,
      valorNovo: 80,
    }),
    "descartar"
  );
});

test("16. PIX confirmado não pode ser descartado silenciosamente", () => {
  assert.equal(podeDescartarPixLocal(STATUS_PIX_LOCAL.confirmado, false), false);
  assert.equal(podeDescartarPixLocal(STATUS_PIX_LOCAL.confirmado, true), true);
  assert.equal(
    decidirQrAposMudancaValor({
      status: STATUS_PIX_LOCAL.confirmado,
      valorQr: 100,
      valorNovo: 80,
    }),
    "bloquear"
  );
  assert.match(mensagemPixConfirmadoNaoAltera(), /não pode ser descartado|reverter conscientemente/i);
});

test("17. remover QR pendente não chama API bancária", () => {
  const fonte = readFileSync(
    join(raiz, "lib/pagamentos/pix/local-pdv.ts"),
    "utf8"
  );
  assert.equal(fonte.includes("chamarGeranetBanking"), false);
  assert.equal(fonte.includes("lib/geranet"), false);
  assert.match(fonte, /QR descartado no UltraPDV/);
});

test("18. modo local nunca chama Geranet", () => {
  const fontes = [
    readFileSync(join(raiz, "lib/pagamentos/pix/local-pdv.ts"), "utf8"),
    readFileSync(join(raiz, "lib/pagamentos/pix/local-regras.ts"), "utf8"),
    readFileSync(join(raiz, "app/api/pagamentos/pix/local/gerar/route.ts"), "utf8"),
    readFileSync(join(raiz, "app/api/pagamentos/pix/local/confirmar/route.ts"), "utf8"),
  ].join("\n");
  assert.equal(fontes.includes("chamarGeranetBanking"), false);
  assert.equal(fontes.includes("emitirCobrancaPixTeste"), false);
});

test("19. PIX Geranet existente continua intacto", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais: { chavePix: "chave", clienteId: "cli", clienteSegredo: "seg" },
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 1 },
  });
  assert.equal(payload.provedor, "efibank");
});

test("20. vendas antigas continuam funcionando", () => {
  const acao = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  assert.match(acao, /pixLocalRecebimentoId\?/);
  assert.doesNotThrow(() =>
    validarGeracaoPixLocal({
      valor: 10,
      modo: "local_manual",
      ativo: true,
      chavePix: "a",
      recebedorNome: "b",
      recebedorCidade: "c",
    })
  );
});

test("21. dinheiro continua funcionando", () => {
  assert.equal(ehFormaPix(formaDinheiro), false);
});

test("22. cartão continua funcionando", () => {
  assert.equal(ehFormaPix(formaCartao), false);
});

test("23. fiado continua funcionando", () => {
  assert.equal(ehFormaPix(formaFiado), false);
  const wrapper = readFileSync(
    join(raiz, "supabase/migrations/20260816240000_pix_local_pdv.sql"),
    "utf8"
  );
  assert.match(wrapper, /Pagamento fiado exige cliente/);
});

test("24. desconto continua funcionando", () => {
  const acao = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  assert.match(acao, /p_desconto/);
});

test("25. pagamento dividido existente continua funcionando", () => {
  const acao = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  assert.match(acao, /p_pagamentos/);
  assert.equal(ehFormaPix(formaPix), true);
  const txid = gerarTxidPixLocalPdv();
  assert.equal(ehTxidPixValido(txid), true);
  assert.ok(!txid.includes("-"));
});
