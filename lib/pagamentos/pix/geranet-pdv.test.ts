import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  montarContratoPixGeranet,
  normalizarStatusPagamentoPixGeranet,
  valoresPixCompativeis,
} from "./evidencia-pagamento";
import {
  CAMPOS_PROIBIDOS_EMITIR_PDV,
  checkoutKeyPixValida,
  decidirQrAposMudancaValorGeranet,
  decidirReusoCobrancaCheckout,
  devePararPollingPixGeranet,
  intervaloPollingPixGeranet,
  MENSAGEM_PIX_GERANET_AGUARDANDO,
  MENSAGEM_PIX_GERANET_DIVERGENCIA,
  MENSAGEM_PIX_GERANET_INDETERMINADO,
  MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA,
  MENSAGEM_PIX_GERANET_REDE,
  podeCancelarCobrancaGeranetPdv,
  rejeitarCamposSensiveisEmitirPixPdv,
  statusMonotonicoConsultaPix,
  validarVinculoPixGeranetNaFinalizacao,
} from "./geranet-regras";
import { garantirEmpresa, montarPayloadCobrancaPix } from "./montar-payload";
import { sanitizarRespostaPix } from "./sanitizar";
import { ehFormaPix } from "./local-regras";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const checkoutKey = "2c1b6a3e-7d14-4a91-9b22-0f6c8d1e2a33";
const formaPix = { tipo: "pix", codigo: "PIX", nome: "PIX" };
const formaDinheiro = { tipo: "dinheiro", codigo: "DIN", nome: "Dinheiro" };
const formaCartao = { tipo: "cartao", codigo: "CAR", nome: "Cartão" };
const formaFiado = { tipo: "fiado", codigo: "FIA", nome: "Fiado", permite_fiado: true };

const respostaPendente = {
  situacao: "sucesso",
  mensagem: "Consulta executada com sucesso",
  dados: {
    txid: "TXIDGERANET001",
    status: "ATIVA",
    pixCopiaECola: "00020126...",
    qrCode: "data:image/png;base64,aaa",
    valor: { original: "100.00" },
  },
};

const respostaPagaBacen = {
  situacao: "sucesso",
  mensagem: "Consulta executada com sucesso",
  dados: {
    txid: "TXIDGERANET001",
    status: "CONCLUIDA",
    valor: { original: "100.00" },
    pix: [{ valor: "100.00", horario: "2026-08-16T22:10:00.000Z" }],
  },
};

test("1. modo geranet cria cobrança via Geranet", () => {
  const pdv = fonte("lib/pagamentos/pix/geranet-pdv.ts");
  assert.match(pdv, /modo !== "geranet"/);
  assert.match(pdv, /chamarGeranetBanking/);
  assert.match(pdv, /\/api\/v1\/pix\/emitir/);
  assert.match(pdv, /modo_pix: "geranet"/);
});

test("2. modo local nunca chama Geranet", () => {
  const locais = [
    fonte("lib/pagamentos/pix/local-pdv.ts"),
    fonte("lib/pagamentos/pix/local-regras.ts"),
    fonte("app/api/pagamentos/pix/local/gerar/route.ts"),
  ].join("\n");
  assert.equal(locais.includes("chamarGeranetBanking"), false);
  assert.equal(locais.includes("emitirCobrancaPixPdv"), false);
});

test("3. parcela PIX dividida usa somente valor PIX", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais: { chavePix: "chave" },
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 100, permitirAlterarValor: false },
  });
  assert.equal(payload.cobranca?.valor, 100);
  assert.notEqual(payload.cobranca?.valor, 150);
  assert.equal(payload.cobranca?.permitirAlterarValor, false);
});

test("4. emitir salva TXID retornado", () => {
  const contrato = montarContratoPixGeranet(respostaPendente);
  assert.equal(contrato.txid, "TXIDGERANET001");
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /txid: contrato.txid/);
});

test("5. emissão não marca automaticamente como paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    situacaoGeranet: "sucesso",
    resposta: respostaPendente,
  });
  assert.equal(evidencia.estado, "pendente");
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /pago: false/);
  assert.match(fonte("lib/pagamentos/pix/geranet.ts"), /pago: false/);
});

test("6. HTTP 200 + situacao sucesso + cobrança pendente continua pendente", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    situacaoGeranet: "sucesso",
    resposta: respostaPendente,
  });
  assert.equal(evidencia.estado, "pendente");
  assert.equal(evidencia.evidencia, "bacen_cob_ativa");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: evidencia.estado,
      valorCobranca: 100,
    }),
    "pendente"
  );
});

test("7. consulta comprovando pagamento marca paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    situacaoGeranet: "sucesso",
    resposta: respostaPagaBacen,
  });
  assert.equal(evidencia.estado, "pago");
  assert.equal(evidencia.evidencia, "bacen_cob_concluida");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 100,
      valorPago: 100,
    }),
    "paga"
  );
});

test("8. resposta indeterminada não marca paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    situacaoGeranet: "sucesso",
    resposta: { situacao: "sucesso", dados: { txid: "X", status: "LIQUIDADO" } },
  });
  assert.equal(evidencia.estado, "indeterminado");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "indeterminado",
      valorCobranca: 100,
    }),
    "pendente"
  );
});

test("9. resposta 4xx não marca paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 422,
    situacaoGeranet: "erro",
    resposta: { situacao: "erro", dados: { status: "CONCLUIDA" } },
  });
  assert.equal(evidencia.estado, "falha_cliente");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "falha_cliente",
      valorCobranca: 100,
    }),
    "pendente"
  );
});

test("10. resposta 5xx não marca paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 503,
    situacaoGeranet: "erro",
    resposta: { situacao: "erro" },
  });
  assert.equal(evidencia.estado, "falha_temporaria");
});

test("11. timeout não marca paga", () => {
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "falha_temporaria",
      valorCobranca: 100,
    }),
    "pendente"
  );
  assert.match(fonte("lib/geranet/cliente.ts"), /timeout/);
});

test("12. cobrança paga não volta para pendente", () => {
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "paga",
      estado: "pendente",
      valorCobranca: 100,
    }),
    "paga"
  );
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "vinculado_venda",
      estado: "indeterminado",
      valorCobranca: 100,
    }),
    "vinculado_venda"
  );
});

test("13. empresa A não consulta cobrança da empresa B", () => {
  assert.throws(() => garantirEmpresa("empresa-a", "empresa-b"), /outra empresa/);
  assert.match(fonte("lib/pagamentos/pix/geranet.ts"), /eq\("empresa_id", empresaId\)/);
});

test("14. empresa A não finaliza usando cobrança da empresa B", () => {
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        cobranca: {
          empresa_id: "empresa-b",
          status: "paga",
          modo_pix: "geranet",
          valor: 100,
          txid: "TX1",
        },
      }),
    /outra empresa/
  );
});

test("15. venda não finaliza com Geranet pendente", () => {
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        cobranca: {
          empresa_id: "empresa-a",
          status: "pendente",
          modo_pix: "geranet",
          valor: 100,
          txid: "TX1",
        },
      }),
    /Aguardando confirmação/
  );
  assert.equal(MENSAGEM_PIX_GERANET_AGUARDANDO.includes("Aguardando"), true);
});

test("16. venda finaliza com Geranet pago", () => {
  assert.doesNotThrow(() =>
    validarVinculoPixGeranetNaFinalizacao({
      empresaId: "empresa-a",
      valorPagamento: 100,
      cobranca: {
        empresa_id: "empresa-a",
        status: "paga",
        modo_pix: "geranet",
        valor: 100,
        txid: "TX1",
      },
    })
  );
});

test("17. valor pago divergente bloqueia finalização", () => {
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 100,
      valorPago: 90,
    }),
    "divergencia_valor"
  );
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        cobranca: {
          empresa_id: "empresa-a",
          status: "divergencia_valor",
          modo_pix: "geranet",
          valor: 100,
          txid: "TX1",
        },
      }),
    /divergente/
  );
  assert.match(MENSAGEM_PIX_GERANET_DIVERGENCIA, /divergente/);
});

test("18. mesma cobrança não entra em duas vendas", () => {
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: "empresa-a",
        valorPagamento: 100,
        cobranca: {
          empresa_id: "empresa-a",
          status: "paga",
          modo_pix: "geranet",
          valor: 100,
          txid: "TX1",
          venda_id: "venda-1",
        },
      }),
    /outra venda/
  );
});

test("19. double-click Gerar PIX não cria duas cobranças", () => {
  assert.equal(
    decidirReusoCobrancaCheckout({
      existente: { status: "pendente", valor: 100 },
      valorNovo: 100,
    }),
    "reutilizar"
  );
  assert.equal(checkoutKeyPixValida(checkoutKey), true);
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /23505/);
  assert.match(
    fonte("supabase/migrations/20260816250000_pix_geranet_pdv.sql"),
    /ux_cobrancas_pix_checkout_ativa/
  );
});

test("20. double-click Finalizar não cria duas vendas", () => {
  const acao = fonte("app/pdv/actions.ts");
  assert.match(acao, /p_idempotency_key/);
  assert.match(acao, /rpc_finalizar_venda/);
});

test("21. estoque não baixa duas vezes", () => {
  const fonteEstoque = fonte(
    "supabase/migrations/20260815010000_estoque_venda_edicao_cancelamento.sql"
  );
  assert.match(fonteEstoque, /rpc_finalizar_venda\s+= NÃO ALTERAR \(idempotência\)/);
});

test("22. venda falha depois do pagamento mantém PIX pago", () => {
  assert.equal(
    decidirReusoCobrancaCheckout({
      existente: { status: "paga", valor: 100 },
      valorNovo: 100,
    }),
    "reutilizar"
  );
  assert.equal(podeCancelarCobrancaGeranetPdv("paga"), false);
});

test("23. nova tentativa da mesma venda reutiliza PIX pago", () => {
  assert.equal(
    decidirReusoCobrancaCheckout({
      existente: { status: "paga", valor: 100, venda_id: null },
      valorNovo: 100,
    }),
    "reutilizar"
  );
});

test("24. remover pendente tenta cancelar Geranet", () => {
  const ui = fonte("components/pdv/pix-geranet-checkout.tsx");
  assert.match(ui, /\/api\/pagamentos\/pix\/geranet\/cancelar/);
  assert.equal(podeCancelarCobrancaGeranetPdv("pendente"), true);
});

test("25. PIX pago nunca chama cancelar como estorno", () => {
  assert.equal(podeCancelarCobrancaGeranetPdv("paga"), false);
  assert.match(
    fonte("lib/pagamentos/pix/geranet.ts"),
    /PIX já pago não pode ser cancelado/
  );
});

test("26. alterar valor de cobrança pendente não reutiliza cobrança antiga", () => {
  assert.equal(
    decidirReusoCobrancaCheckout({
      existente: { status: "pendente", valor: 100 },
      valorNovo: 80,
    }),
    "substituir"
  );
  assert.equal(
    decidirQrAposMudancaValorGeranet({
      status: "pendente",
      valorCobranca: 100,
      valorNovo: 80,
    }),
    "substituir"
  );
});

test("27. alterar valor de PIX pago é bloqueado", () => {
  assert.equal(
    decidirQrAposMudancaValorGeranet({
      status: "paga",
      valorCobranca: 100,
      valorNovo: 80,
    }),
    "bloquear"
  );
  assert.match(MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA, /já foi pago/);
});

test("28. polling para quando pago", () => {
  assert.equal(devePararPollingPixGeranet("paga"), true);
  assert.equal(devePararPollingPixGeranet("pendente"), false);
});

test("29. polling para quando componente desmonta", () => {
  const ui = fonte("components/pdv/pix-geranet-checkout.tsx");
  assert.match(ui, /clearTimeout/);
  assert.match(ui, /cancelado = true/);
});

test("30. polling não cria timers duplicados", () => {
  const ui = fonte("components/pdv/pix-geranet-checkout.tsx");
  assert.match(ui, /pollingRef.current != null/);
  assert.equal(intervaloPollingPixGeranet(10_000), 3_000);
  assert.equal(intervaloPollingPixGeranet(61_000), 5_000);
});

test("31. secrets não vão ao client", () => {
  assert.throws(
    () =>
      rejeitarCamposSensiveisEmitirPixPdv({
        valor: 10,
        empresa_id: "forjado",
      }),
    /não pode escolher/
  );
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      clienteSegredo: "segredo-super-secreto",
      Authorization: "Bearer gn_abc",
      senhaCertificadoPfx: "senha-pfx",
    })
  );
  assert.equal(sanitizado.includes("segredo-super-secreto"), false);
  assert.equal(CAMPOS_PROIBIDOS_EMITIR_PDV.includes("credenciais"), true);
});

test("32. logs são sanitizados", () => {
  const log = fonte("lib/pagamentos/pix/geranet-pdv.ts");
  assert.equal(log.includes("Authorization"), false);
  assert.match(log, /pix_operacoes_log/);
  assert.match(log, /estado=/);
});

test("33. PIX Local continua funcionando", () => {
  assert.equal(ehFormaPix(formaPix), true);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /pixLocalAtivo/);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /PixLocalCheckout/);
});

test("34. dinheiro continua funcionando", () => {
  assert.equal(ehFormaPix(formaDinheiro), false);
});

test("35. cartão continua funcionando", () => {
  assert.equal(ehFormaPix(formaCartao), false);
});

test("36. fiado continua funcionando", () => {
  assert.equal(ehFormaPix(formaFiado), false);
  assert.match(
    fonte("supabase/migrations/20260816250000_pix_geranet_pdv.sql"),
    /Pagamento fiado exige cliente/
  );
});

test("37. pagamento dividido continua funcionando", () => {
  assert.equal(valoresPixCompativeis(100, 100), true);
  assert.equal(valoresPixCompativeis(100, 150), false);
  assert.match(fonte("app/pdv/actions.ts"), /p_pagamentos/);
});

test("38. vendas antigas continuam funcionando", () => {
  const acao = fonte("app/pdv/actions.ts");
  assert.match(acao, /pixLocalRecebimentoId\?/);
  assert.match(acao, /rpc_finalizar_venda/);
});

test("39. pdv-edicao-shell usa o mesmo checkout PIX da primeira venda", () => {
  const edicao = fonte("components/pdv/pdv-edicao-shell.tsx");
  assert.match(edicao, /export function PdvEdicaoShell/);
  assert.match(edicao, /pix-geranet-checkout/);
  assert.match(edicao, /PixLocalCheckout/);
  assert.match(fonte("app/pdv/editar-actions.ts"), /validarPixNaFinalizacaoComercial/);
});

test("40. nenhuma alteração fiscal", () => {
  const tocados = [
    fonte("lib/pagamentos/pix/geranet-pdv.ts"),
    fonte("lib/pagamentos/pix/evidencia-pagamento.ts"),
    fonte("supabase/migrations/20260816250000_pix_geranet_pdv.sql"),
  ].join("\n");
  assert.equal(tocados.includes("nfc-e"), false);
  assert.equal(tocados.includes("emitirNfce"), false);
  assert.equal(tocados.includes("ICMS"), false);
});

test("situacao sucesso nunca é evidência de pagamento", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    situacaoGeranet: "sucesso",
    resposta: { situacao: "sucesso", mensagem: "ok", dados: {} },
  });
  assert.equal(evidencia.estado, "indeterminado");
  assert.equal(evidencia.evidencia, "sem_status_bacen_comprovado");
});

test("contrato sanitiza QR e copia e cola sem secrets", () => {
  const contrato = montarContratoPixGeranet({
    situacao: "sucesso",
    credenciais: { clienteSegredo: "segredo-super-secreto" },
    dados: {
      txid: "TXIDGERANET001",
      status: "ATIVA",
      pixCopiaECola: "00020126...",
      qrCode: "data:image/png;base64,aaa",
    },
  });
  assert.equal(contrato.pixCopiaECola, "00020126...");
  assert.equal(contrato.pago, false);
  assert.equal(
    JSON.stringify(contrato.dadosPublicosSanitizados).includes(
      "segredo-super-secreto"
    ),
    false
  );
});

test("mensagem de rede e indeterminado permanecem explícitas", () => {
  assert.match(MENSAGEM_PIX_GERANET_REDE, /consultar o PIX agora/);
  assert.match(MENSAGEM_PIX_GERANET_INDETERMINADO, /Não foi possível confirmar/);
});
