import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificarFormaCaixa,
  efeitoFisicoMovimento,
  movimentoAfetaSaldoFisico,
} from "@/lib/caixa/formas";
import { MENSAGEM_CAIXA_FECHADO_FINALIZAR } from "@/lib/caixa/mensagens";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { fonte } from "@/lib/multiempresa/fonte";
import { mensagemErroFinalizacaoPublica } from "@/lib/pdv/mensagem-erro-publica";
import {
  MENSAGEM_TROCO_SEM_FORMA,
  avaliarPagamentosPdv,
} from "@/lib/pdv/pagamentos-teto";

const FASE1 = "supabase/migrations/20260824100000_caixa_modulo.sql";
const MIGRATION = "supabase/migrations/20260824120000_caixa_venda_pdv.sql";
const TROCO = "supabase/migrations/20260825120000_caixa_snapshot_troco.sql";
const FISICO = "supabase/migrations/20260825130000_caixa_afeta_fisico.sql";

function linhaVenda(params: {
  entrada: number;
  saida?: number;
  forma_tipo?: string;
  forma_codigo?: string;
  forma_nome?: string;
  permite_troco_snapshot?: boolean;
  afeta_caixa_fisico_snapshot?: boolean;
}) {
  return {
    tipo: "venda" as const,
    entrada: params.entrada,
    saida: params.saida ?? 0,
    forma_tipo: params.forma_tipo ?? null,
    forma_codigo: params.forma_codigo ?? null,
    forma_nome: params.forma_nome ?? null,
    permite_troco_snapshot: params.permite_troco_snapshot ?? false,
    afeta_caixa_fisico_snapshot: params.afeta_caixa_fisico_snapshot ?? false,
  };
}

test("1. dinheiro sem troco entra no livro e no saldo físico", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    linhaVenda({
      entrada: 300,
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      forma_nome: "Dinheiro",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(totais.vendasTotal, 300);
  assert.equal(totais.vendasDinheiro, 300);
  assert.equal(totais.saldoAtual, 380);
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "venda",
      entrada: 300,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
    }),
    300
  );
});

test("2. dinheiro com troco: recebido e troco na mesma linha", () => {
  const movimento = linhaVenda({
    entrada: 50,
    saida: 10,
    forma_tipo: "DINHEIRO",
    permite_troco_snapshot: true,
    afeta_caixa_fisico_snapshot: true,
  });
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    movimento,
  ]);
  assert.equal(movimento.entrada, 50);
  assert.equal(movimento.saida, 10);
  assert.equal(totais.vendasTotal, 40);
  assert.equal(totais.vendasDinheiro, 40);
  assert.equal(totais.saldoAtual, 120);
  assert.match(fonte(TROCO), /tipo = 'venda'/);
  assert.match(fonte(TROCO), /v_troco_linha/);
  assert.match(fonte(FISICO), /v_troco_linha/);
  assert.match(fonte(TROCO), /Troco nunca é sangria/);
});

test("3. R$ 5 / recebido R$ 20 / troco R$ 15 → físico +5", () => {
  const totais = totaisDoLivro([
    linhaVenda({
      entrada: 20,
      saida: 15,
      forma_tipo: "DINHEIRO",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(totais.entradas, 20);
  assert.equal(totais.saidas, 15);
  assert.equal(totais.vendasTotal, 5);
  assert.equal(totais.saldoAtual, 5);
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "venda",
      entrada: 20,
      saida: 15,
      afeta_caixa_fisico_snapshot: true,
    }),
    5
  );
});

test("4. PIX → físico 0", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "PIX",
      forma_codigo: "PIX",
      forma_nome: "PIX",
      permite_troco_snapshot: false,
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(classificarFormaCaixa({ tipo: "PIX", codigo: "PIX", nome: "PIX" }), "pix");
  assert.equal(totais.vendasPix, 100);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.saldoAtual, 80);
});

test("5. débito → físico 0", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "CARTAO_DEBITO",
      forma_codigo: "04",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasDebito, 100);
  assert.equal(totais.saldoAtual, 80);
});

test("6. crédito → físico 0", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "CARTAO_CREDITO",
      forma_codigo: "03",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasCredito, 100);
  assert.equal(totais.saldoAtual, 80);
});

test("7. pagamento misto registra cada forma e só o físico mexe na gaveta", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "DINHEIRO",
      afeta_caixa_fisico_snapshot: true,
      permite_troco_snapshot: true,
    }),
    linhaVenda({
      entrada: 100,
      forma_tipo: "PIX",
      forma_codigo: "PIX",
      forma_nome: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
    linhaVenda({
      entrada: 100,
      forma_tipo: "CARTAO_DEBITO",
      forma_codigo: "04",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasTotal, 300);
  assert.equal(totais.vendasDinheiro, 100);
  assert.equal(totais.vendasPix, 100);
  assert.equal(totais.vendasDebito, 100);
  assert.equal(totais.saldoAtual, 150);
});

test("8. pagamento misto com troco: físico +50, PIX 50, venda líquida 100", () => {
  const totais = totaisDoLivro([
    linhaVenda({
      entrada: 70,
      saida: 20,
      forma_tipo: "DINHEIRO",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
    linhaVenda({
      entrada: 50,
      forma_tipo: "PIX",
      forma_codigo: "PIX",
      forma_nome: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.entradas, 120);
  assert.equal(totais.saidas, 20);
  assert.equal(totais.vendasDinheiro, 50);
  assert.equal(totais.vendasPix, 50);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.saldoAtual, 50);
  const teto = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [
      { valorCentavos: 7000, permiteTroco: true },
      { valorCentavos: 5000, permiteTroco: false },
    ],
  });
  assert.equal(teto.bloqueado, false);
  assert.equal(teto.trocoCentavos, 2000);
});

test("9. forma sem permite_troco + troco → rejeitar", () => {
  const teto = avaliarPagamentosPdv({
    totalVendaCentavos: 500,
    pagamentos: [{ valorCentavos: 2000, permiteTroco: false }],
  });
  assert.equal(teto.bloqueado, true);
  assert.equal(teto.trocoCentavos, 0);
  const sql = fonte(FISICO);
  assert.match(sql, /caixa_movimentacoes_troco_permite_check/);
  assert.match(sql, /Foi informado troco, mas nenhuma forma selecionada permite troco/);
  assert.equal(
    mensagemErroFinalizacaoPublica(
      `function public.rpc_finalizar_venda_com_caixa failed: ${MENSAGEM_TROCO_SEM_FORMA}`
    ),
    MENSAGEM_TROCO_SEM_FORMA
  );
});

test("10. permite_troco=true e afeta_caixa_fisico=false não assume dinheiro físico", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 10, saida: 0 },
    linhaVenda({
      entrada: 20,
      saida: 5,
      forma_tipo: "VALE",
      forma_nome: "Vale",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasTotal, 15);
  assert.equal(totais.vendasDinheiro, 0);
  assert.equal(totais.vendasOutros, 15);
  assert.equal(totais.saldoAtual, 10);
  assert.equal(
    movimentoAfetaSaldoFisico({
      tipo: "venda",
      afeta_caixa_fisico_snapshot: false,
    }),
    false
  );
});

test("11. 12. e 13. alteração posterior da forma não muda o histórico", () => {
  const historico = linhaVenda({
    entrada: 20,
    saida: 15,
    forma_tipo: "DINHEIRO",
    forma_nome: "Dinheiro",
    permite_troco_snapshot: true,
    afeta_caixa_fisico_snapshot: true,
  });
  const depoisDeRenomear = {
    ...historico,
    forma_nome: "Dinheiro",
  };
  const cadastroAtual = {
    nome: "Espécie",
    permite_troco: false,
    afeta_caixa_fisico: false,
  };
  assert.notEqual(depoisDeRenomear.forma_nome, cadastroAtual.nome);
  assert.notEqual(historico.permite_troco_snapshot, cadastroAtual.permite_troco);
  assert.notEqual(
    historico.afeta_caixa_fisico_snapshot,
    cadastroAtual.afeta_caixa_fisico
  );
  assert.equal(totaisDoLivro([historico]).saldoAtual, 5);
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(carregar, /permite_troco_snapshot/);
  assert.match(carregar, /afeta_caixa_fisico_snapshot/);
  assert.doesNotMatch(carregar, /from\("formas_pagamento"\)/);
  assert.doesNotMatch(carregar, /from\("vendas_pagamentos"\)/);
  assert.match(fonte(FISICO), /fp\.nome/);
  assert.match(fonte(FISICO), /fp\.afeta_caixa_fisico/);
  assert.match(fonte(FISICO), /permite_troco_snapshot/);
  assert.match(fonte(FISICO), /afeta_caixa_fisico_snapshot/);
});

test("14. retry não duplica recebido, troco nem efeito físico", () => {
  const sql = [fonte(MIGRATION), fonte(TROCO), fonte(FISICO)].join("\n");
  assert.match(sql, /ux_caixa_movimentacoes_origem_pagamento/);
  assert.match(sql, /origem_id=vendas_pagamentos\.id/);
  assert.match(sql, /ON CONFLICT \(empresa_id, origem_tipo, origem_id\)/);
  assert.match(sql, /DO NOTHING/);
  assert.match(fonte("app/pdv/actions.ts"), /p_idempotency_key/);
});

test("15. isolamento multiempresa: empresa ativa no servidor", () => {
  const sql = fonte(FISICO);
  const actions = fonte("app/pdv/actions.ts");
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(sql, /caixa_empresa_ativa_usuario\(\)/);
  assert.match(sql, /p_empresa_id IS DISTINCT FROM v_empresa_id/);
  assert.match(sql, /vp\.empresa_id = v_empresa_id/);
  assert.match(actions, /p_empresa_id:\s*vinculo\.empresa_id/);
  assert.doesNotMatch(actions, /input\.empresaId|searchParams\.get\("empresa_id"\)/);
  assert.match(carregar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(carregar, /String\(linha\.empresa_id/);
});

test("16. suprimento e sangria continuam no saldo físico, separados da venda", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 100, saida: 0 },
    { tipo: "suprimento", entrada: 50, saida: 0 },
    { tipo: "sangria", entrada: 0, saida: 30 },
    linhaVenda({
      entrada: 20,
      saida: 15,
      afeta_caixa_fisico_snapshot: true,
      permite_troco_snapshot: true,
    }),
  ]);
  assert.equal(totais.saldoInicial, 100);
  assert.equal(totais.suprimentos, 50);
  assert.equal(totais.sangrias, 30);
  assert.equal(totais.vendasTotal, 5);
  assert.equal(totais.saldoAtual, 125);
  assert.match(fonte(FISICO), /m\.tipo IN \('abertura', 'suprimento', 'sangria'\)/);
  assert.doesNotMatch(fonte(FISICO), /CREATE OR REPLACE FUNCTION public\.rpc_abrir_caixa/);
  assert.doesNotMatch(fonte(FISICO), /CREATE OR REPLACE FUNCTION public\.rpc_movimentar_caixa/);
});

test("17. caixas anteriores usam snapshot; saldo físico não relê cadastro nem nome", () => {
  const sql = fonte(FISICO);
  assert.match(sql, /afeta_caixa_fisico_snapshot/);
  assert.match(sql, /COALESCE\(m\.afeta_caixa_fisico_snapshot, false\)/);
  assert.doesNotMatch(
    sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.caixa_saldo_dinheiro")),
    /upper\(btrim\(COALESCE\(m\.forma_tipo/
  );
  assert.doesNotMatch(
    sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.caixa_saldo_dinheiro")),
    /nome ===/
  );
  assert.doesNotMatch(fonte(FASE1), /afeta_caixa_fisico/);
  const anteriores = totaisDoLivro([
    { tipo: "abertura", entrada: 40, saida: 0 },
    linhaVenda({
      entrada: 20,
      saida: 15,
      forma_nome: "Dinheiro antigo",
      afeta_caixa_fisico_snapshot: true,
      permite_troco_snapshot: true,
    }),
  ]);
  assert.equal(anteriores.saldoAtual, 45);
  assert.equal(anteriores.vendasDinheiro, 5);
});

test("wrapper transacional, fiado fora, mobile sem caixa nesta fase", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /permite_fiado/);
  assert.match(sql, /CONTINUE;/);
  assert.doesNotMatch(sql, /carteira_/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /from\("caixa_movimentacoes"\)/);
  const lock = sql.indexOf("FOR UPDATE");
  const finalizar = sql.indexOf("rpc_finalizar_venda(");
  const mensagem = sql.indexOf("O caixa foi fechado. Abra um caixa para continuar.");
  assert.ok(lock > 0 && finalizar > lock);
  assert.ok(mensagem > 0 && mensagem < finalizar);
  assert.equal(
    MENSAGEM_CAIXA_FECHADO_FINALIZAR,
    "O caixa foi fechado. Abra um caixa para continuar."
  );
  const api = fonte("app/api/pdv/finalizar/route.ts");
  const actions = fonte("app/pdv/actions.ts");
  assert.match(api, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(api, /executarFinalizacaoVendaPdv\(corpo,/);
  assert.match(actions, /exigirCaixaAberto:\s*true/);
  assert.doesNotMatch(fonte("app/fiscal/nfe/operacoes-actions.ts"), /rpc_finalizar_venda_com_caixa/);
  assert.match(fonte("app/fiscal/nfe/operacoes-actions.ts"), /exigirCaixaAberto:/);
  assert.doesNotMatch(fonte(MIGRATION), /CREATE OR REPLACE FUNCTION public\.rpc_finalizar_venda\s*\(/);
  assert.doesNotMatch(fonte(FISICO), /CREATE OR REPLACE FUNCTION public\.rpc_finalizar_venda\s*\(/);
});

test("tela /caixa mostra recebido, troco, líquido e saldo físico da gaveta", () => {
  const tabela = fonte("components/caixa/caixa-movimentos-tabela.tsx");
  const resumo = fonte("components/caixa/caixa-resumo-vendas.tsx");
  assert.match(tabela, /Recebido/);
  assert.match(tabela, /Troco/);
  assert.match(tabela, /Líquido/);
  assert.match(tabela, /href=\{`\/vendas\/\$\{movimento\.venda_id\}`\}/);
  assert.match(resumo, /Dinheiro físico/);
  assert.match(resumo, /Total recebido em vendas/);
  assert.match(resumo, /Saldo físico/);
  assert.match(fonte("lib/caixa/carregar.ts"), /bruto === "venda"/);
});
