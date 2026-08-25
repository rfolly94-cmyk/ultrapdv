import assert from "node:assert/strict";
import { test } from "node:test";

import { totalContadoDinheiro } from "@/lib/caixa/contador-dinheiro";
import {
  conferenciaAbertaParaCliente,
  conferenciaRevelaEsperado,
  conferirMeios,
  deveOcultarEsperadoCaixaAberto,
  diferencaFechamentoCaixa,
  dinheiroFisicoDaConferencia,
  mapearConferenciaCaixa,
  meiosEsperadosDoLivro,
  podeRevelarEsperadoCaixaCego,
  sanitizarConferenciaCega,
  sanitizarMovimentosCaixaAbertoCego,
  sanitizarSessaoCaixaAbertoCego,
  sanitizarTotaisCaixaAbertoCego,
  statusDiferencaCaixa,
} from "@/lib/caixa/conferencia";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { fonte } from "@/lib/multiempresa/fonte";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

const FASE3 = "supabase/migrations/20260825150000_caixa_fechamento_conferencia.sql";
const FASE2A = "supabase/migrations/20260825130000_caixa_afeta_fisico.sql";
const FASE2B = "supabase/migrations/20260825140000_caixa_carteira_estornos.sql";
const FASE1 = "supabase/migrations/20260824100000_caixa_modulo.sql";

const DINHEIRO_ID = "11111111-1111-4111-8111-111111111111";
const PIX_ID = "22222222-2222-4222-8222-222222222222";
const DEBITO_ID = "33333333-3333-4333-8333-333333333333";
const CREDITO_ID = "44444444-4444-4444-8444-444444444444";

function abertura(entrada = 100) {
  return {
    tipo: "abertura" as const,
    forma_pagamento_id: DINHEIRO_ID,
    forma_tipo: "DINHEIRO",
    forma_codigo: "01",
    forma_nome: "Dinheiro",
    afeta_caixa_fisico_snapshot: true,
    entrada,
    saida: 0,
  };
}

function dinheiro(entrada: number, saida = 0) {
  return {
    tipo: "venda" as const,
    forma_pagamento_id: DINHEIRO_ID,
    forma_tipo: "DINHEIRO",
    forma_codigo: "01",
    forma_nome: "Dinheiro",
    permite_troco_snapshot: true,
    afeta_caixa_fisico_snapshot: true,
    entrada,
    saida,
  };
}

function pix(entrada: number, tipo: "venda" | "recebimento_carteira" | "estorno_recebimento" = "venda") {
  const estorno = tipo === "estorno_recebimento";
  return {
    tipo,
    forma_pagamento_id: PIX_ID,
    forma_tipo: "PIX",
    forma_codigo: "17",
    forma_nome: "PIX",
    afeta_caixa_fisico_snapshot: false,
    entrada: estorno ? 0 : entrada,
    saida: estorno ? entrada : 0,
  };
}

function debito(entrada: number) {
  return {
    tipo: "venda" as const,
    forma_pagamento_id: DEBITO_ID,
    forma_tipo: "CARTAO_DEBITO",
    forma_codigo: "04",
    forma_nome: "Débito",
    afeta_caixa_fisico_snapshot: false,
    entrada,
    saida: 0,
  };
}

function credito(entrada: number) {
  return {
    tipo: "venda" as const,
    forma_pagamento_id: CREDITO_ID,
    forma_tipo: "CARTAO_CREDITO",
    forma_codigo: "03",
    forma_nome: "Crédito",
    afeta_caixa_fisico_snapshot: false,
    entrada,
    saida: 0,
  };
}

function conferir(movimentos: Parameters<typeof meiosEsperadosDoLivro>[0], informados: Record<string, number>) {
  const esperados = meiosEsperadosDoLivro(movimentos);
  return conferirMeios({
    esperados,
    informados: esperados.map((meio) => ({
      chave: meio.chave,
      valor_informado: informados[meio.chave] ?? 0,
    })),
  });
}

test("1. fechamento sem diferença", () => {
  const movimentos = [abertura(100), dinheiro(850)];
  const meios = conferir(movimentos, { [DINHEIRO_ID]: 950 });
  const dinheiroMeio = meios.find((meio) => meio.chave === DINHEIRO_ID);
  assert.equal(dinheiroMeio?.valor_esperado, 950);
  assert.equal(dinheiroMeio?.diferenca, 0);
  assert.equal(dinheiroMeio?.status, "conferido");
  assert.equal(diferencaFechamentoCaixa(950, 950), 0);
  assert.equal(statusDiferencaCaixa(0), "conferido");
});

test("2. falta de dinheiro", () => {
  const meios = conferir([abertura(100), dinheiro(850)], { [DINHEIRO_ID]: 940 });
  assert.equal(meios[0]?.diferenca, -10);
  assert.equal(meios[0]?.status, "falta");
  assert.equal(diferencaFechamentoCaixa(940, 950), -10);
});

test("3. sobra de dinheiro", () => {
  const meios = conferir([abertura(100), dinheiro(850)], { [DINHEIRO_ID]: 960 });
  assert.equal(meios[0]?.diferenca, 10);
  assert.equal(meios[0]?.status, "sobra");
  assert.equal(diferencaFechamentoCaixa(960, 950), 10);
});

test("4. PIX conferido", () => {
  const meios = conferir([abertura(0), pix(1420)], {
    [DINHEIRO_ID]: 0,
    [PIX_ID]: 1420,
  });
  const pixMeio = meios.find((meio) => meio.chave === PIX_ID);
  assert.equal(pixMeio?.valor_esperado, 1420);
  assert.equal(pixMeio?.diferenca, 0);
  assert.equal(pixMeio?.afeta_caixa_fisico, false);
  assert.equal(totaisDoLivro([abertura(0), pix(1420)]).saldoAtual, 0);
});

test("5. débito conferido", () => {
  const meios = conferir([abertura(0), debito(800)], {
    [DINHEIRO_ID]: 0,
    [DEBITO_ID]: 800,
  });
  assert.equal(meios.find((meio) => meio.chave === DEBITO_ID)?.valor_esperado, 800);
});

test("6. crédito conferido", () => {
  const meios = conferir([abertura(0), credito(1200)], {
    [DINHEIRO_ID]: 0,
    [CREDITO_ID]: 1200,
  });
  assert.equal(meios.find((meio) => meio.chave === CREDITO_ID)?.valor_esperado, 1200);
});

test("7. múltiplos meios", () => {
  const movimentos = [
    abertura(50),
    dinheiro(900),
    pix(1420),
    debito(800),
    credito(1200),
  ];
  const meios = conferir(movimentos, {
    [DINHEIRO_ID]: 950,
    [PIX_ID]: 1420,
    [DEBITO_ID]: 800,
    [CREDITO_ID]: 1200,
  });
  assert.equal(meios.length, 4);
  assert.equal(dinheiroFisicoDaConferencia(meios).esperado, 950);
  assert.equal(dinheiroFisicoDaConferencia(meios).informado, 950);
  assert.equal(totaisDoLivro(movimentos).meiosPix, 1420);
  assert.equal(totaisDoLivro(movimentos).meiosDebito, 800);
  assert.equal(totaisDoLivro(movimentos).meiosCredito, 1200);
});

test("8. venda com troco entra como recebido menos troco", () => {
  const movimentos = [abertura(80), dinheiro(50, 10)];
  const meios = meiosEsperadosDoLivro(movimentos);
  const dinheiroMeio = meios.find((meio) => meio.chave === DINHEIRO_ID);
  assert.equal(dinheiroMeio?.valor_esperado, 120);
  assert.equal(totaisDoLivro(movimentos).saldoAtual, 120);
  assert.equal(totaisDoLivro(movimentos).vendasDinheiro, 40);
});

test("9. recebimento Carteira em dinheiro soma na gaveta", () => {
  const movimentos = [
    abertura(50),
    {
      tipo: "recebimento_carteira" as const,
      forma_pagamento_id: DINHEIRO_ID,
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      afeta_caixa_fisico_snapshot: true,
      entrada: 100,
      saida: 0,
    },
  ];
  assert.equal(meiosEsperadosDoLivro(movimentos)[0]?.valor_esperado, 150);
  assert.equal(totaisDoLivro(movimentos).recebimentosCarteira, 100);
  assert.equal(totaisDoLivro(movimentos).saldoAtual, 150);
});

test("10. recebimento Carteira PIX não entra na gaveta", () => {
  const movimentos = [
    abertura(50),
    {
      tipo: "recebimento_carteira" as const,
      forma_pagamento_id: PIX_ID,
      forma_nome: "PIX",
      forma_tipo: "PIX",
      afeta_caixa_fisico_snapshot: false,
      entrada: 200,
      saida: 0,
    },
  ];
  const meios = meiosEsperadosDoLivro(movimentos);
  assert.equal(meios.find((meio) => meio.chave === PIX_ID)?.valor_esperado, 200);
  assert.equal(totaisDoLivro(movimentos).saldoAtual, 50);
  assert.equal(totaisDoLivro(movimentos).meiosPix, 200);
});

test("11. suprimento entra no esperado físico", () => {
  const movimentos = [
    abertura(100),
    { tipo: "suprimento" as const, forma_pagamento_id: DINHEIRO_ID, entrada: 50, saida: 0 },
  ];
  assert.equal(meiosEsperadosDoLivro(movimentos)[0]?.valor_esperado, 150);
  assert.equal(totaisDoLivro(movimentos).suprimentos, 50);
});

test("12. sangria sai do esperado físico", () => {
  const movimentos = [
    abertura(100),
    { tipo: "sangria" as const, forma_pagamento_id: DINHEIRO_ID, entrada: 0, saida: 30 },
  ];
  assert.equal(meiosEsperadosDoLivro(movimentos)[0]?.valor_esperado, 70);
  assert.equal(totaisDoLivro(movimentos).sangrias, 30);
});

test("13. estorno Carteira inverte o meio sem apagar o original", () => {
  const movimentos = [
    abertura(0),
    {
      tipo: "recebimento_carteira" as const,
      forma_pagamento_id: PIX_ID,
      forma_nome: "PIX",
      forma_tipo: "PIX",
      afeta_caixa_fisico_snapshot: false,
      entrada: 200,
      saida: 0,
    },
    pix(200, "estorno_recebimento"),
  ];
  const pixMeio = meiosEsperadosDoLivro(movimentos).find((meio) => meio.chave === PIX_ID);
  assert.equal(pixMeio?.valor_esperado, 0);
  assert.equal(totaisDoLivro(movimentos).estornos, 200);
  assert.equal(totaisDoLivro(movimentos).saldoAtual, 0);
  assert.match(fonte(FASE3), /INSERT INTO public\.caixa_fechamentos_meios/);
  assert.doesNotMatch(fonte(FASE3), /DELETE FROM public\.caixa_movimentacoes/);
});

test("14. fechamento cego não revela esperado antes da confirmação", () => {
  const sql = fonte(FASE3);
  const action = fonte("app/caixa/actions.ts");
  const modal = fonte("components/caixa/caixa-fechamento-modal.tsx");
  const crua = {
    fechamento_cego: true,
    dinheiro_fisico_esperado: 950,
    meios: [
      {
        chave: DINHEIRO_ID,
        forma_pagamento_id: DINHEIRO_ID,
        forma_nome: "Dinheiro",
        forma_tipo: "DINHEIRO",
        forma_codigo: "01",
        afeta_caixa_fisico: true,
        valor_esperado: 950,
        diferenca: -10,
        status: "falta" as const,
      },
    ],
  };
  const limpa = sanitizarConferenciaCega(crua);
  assert.equal("dinheiro_fisico_esperado" in limpa, false);
  assert.equal(limpa.dinheiro_fisico_esperado, undefined);
  assert.equal(limpa.meios[0]?.valor_esperado, undefined);
  assert.equal(limpa.meios[0]?.diferenca, undefined);
  assert.equal(conferenciaRevelaEsperado(limpa), false);
  assert.match(sql, /IF NOT v_cego THEN/);
  assert.match(sql, /valor_esperado/);
  assert.match(action, /conferenciaAbertaParaCliente/);
  assert.match(action, /carregarFechamentoCego/);
  assert.match(action, /mapearConferenciaCaixa/);
  assert.match(modal, /fechamento_cego &&[\s\S]*conferenciaRevelaEsperado/);
  assert.doesNotMatch(
    fonte("components/caixa/caixa-fechamento-modal.tsx"),
    /saldoEsperado/
  );
});

test("15. fechamento normal revela esperado", () => {
  const meios = meiosEsperadosDoLivro([abertura(100), dinheiro(850)]);
  const conferencia = {
    fechamento_cego: false,
    dinheiro_fisico_esperado: 950,
    meios,
  };
  assert.equal(conferenciaRevelaEsperado(conferencia), true);
  assert.match(fonte(FASE3), /fechamento_caixa_cego/);
  assert.match(
    fonte("components/caixa/caixa-conferencia-meios.tsx"),
    /cego \|\| esperado == null \? "—" : formatarMoeda\(esperado\)/
  );
});

test("16. contador de dinheiro preenche o meio físico", () => {
  assert.equal(
    totalContadoDinheiro({ "200": 1, "100": 2, "0.5": 3, "0.05": 2 }),
    401.6
  );
  const ui = fonte("components/caixa/caixa-contador-dinheiro.tsx");
  assert.match(ui, /Contar dinheiro/);
  assert.match(ui, /Total contado/);
  assert.match(ui, /Usar no fechamento/);
  assert.match(fonte("components/caixa/caixa-conferencia-meios.tsx"), /Contar dinheiro/);
  assert.doesNotMatch(fonte(FASE3), /cedulas|cédulas|quantidade_moeda/);
});

test("17. snapshot do fechamento permanece após renomear forma", () => {
  const sql = fonte(FASE3);
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(sql, /forma_nome_snapshot/);
  assert.match(sql, /forma_tipo_snapshot/);
  assert.match(sql, /forma_codigo_snapshot/);
  assert.match(sql, /afeta_caixa_fisico_snapshot/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.caixa_fechamentos_meios/);
  assert.match(carregar, /from\("caixa_fechamentos_meios"\)/);
  assert.doesNotMatch(
    carregar.slice(carregar.indexOf("caixa_fechamentos_meios")),
    /from\("formas_pagamento"\)/
  );
});

test("18. caixa fechado rejeita novos movimentos (reabertura é a Fase 4)", () => {
  const sql = fonte(FASE3);
  assert.match(sql, /Este caixa já está fechado/);
  assert.match(fonte(FASE1), /Só é possível movimentar um caixa aberto/);
  assert.doesNotMatch(sql, /rpc_reabrir_caixa|reabrir/);
});

test("19. dupla tentativa de fechamento", () => {
  const sql = fonte(FASE3);
  assert.match(sql, /AND status = 'aberto'/);
  assert.match(sql, /caixa_fechamentos_meios_unico/);
  assert.match(sql, /Este caixa já está fechado/);
});

test("20. nova movimentação durante conferência invalida totais antigos", () => {
  const sql = fonte(FASE3);
  const mensagens = fonte("lib/caixa/mensagens.ts");
  assert.match(sql, /caixa_versao_livro/);
  assert.match(sql, /v_versao IS DISTINCT FROM btrim\(p_versao_livro\)/);
  assert.match(
    sql,
    /O caixa recebeu novas movimentações\. Atualize a conferência antes de fechar\./
  );
  assert.match(mensagens, /MENSAGEM_CONFERENCIA_DESATUALIZADA/);
  assert.match(
    fonte("components/caixa/caixa-fechamento-modal.tsx"),
    /Atualizar conferência/
  );
});

test("21. isolamento multiempresa no fechamento", () => {
  const sql = fonte(FASE3);
  const actions = fonte("app/caixa/actions.ts");
  assert.match(sql, /caixa_empresa_ativa_usuario\(\)/);
  assert.doesNotMatch(
    sql,
    /rpc_iniciar_fechamento_caixa\(\s*p_caixa_id uuid,\s*p_empresa_id/
  );
  assert.doesNotMatch(actions, /input\.empresaId|searchParams\.get\("empresa_id"\)/);
  assert.match(actions, /eq\("principal", true\)/);
  assert.match(actions, /eq\("ativo", true\)/);
});

test("22. caixa de outra empresa nunca entra na conferência", () => {
  const sql = fonte(FASE3);
  assert.match(
    sql,
    /WHERE c\.empresa_id = v_empresa_id\s+AND c\.id = p_caixa_id/
  );
  assert.match(fonte("lib/caixa/carregar.ts"), /\.eq\("empresa_id", id\)/);
  assert.match(fonte("lib/caixa/carregar.ts"), /String\(linha\.empresa_id\) === id/);
});

test("23. histórico continua correto e somente leitura", () => {
  const workspace = fonte("components/caixa/caixa-workspace.tsx");
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(workspace, /Conferência por meio/);
  assert.match(workspace, /CaixaResumoSessao/);
  assert.match(carregar, /conferencia: historico\.conferencias\.get/);
  assert.match(fonte("components/caixa/caixa-resumo-sessao.tsx"), /Dinheiro físico esperado/);
});

test("24. Fase 2A continua funcionando", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    {
      tipo: "venda",
      entrada: 50,
      saida: 10,
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
    {
      tipo: "venda",
      entrada: 100,
      saida: 0,
      afeta_caixa_fisico_snapshot: false,
      forma_tipo: "PIX",
      forma_nome: "PIX",
    },
  ]);
  assert.equal(totais.vendasTotal, 140);
  assert.equal(totais.vendasDinheiro, 40);
  assert.equal(totais.vendasPix, 100);
  assert.equal(totais.saldoAtual, 120);
  assert.doesNotMatch(fonte(FASE3), /CREATE OR REPLACE FUNCTION public\.rpc_finalizar_venda_com_caixa/);
  assert.match(fonte(FASE2A), /afeta_caixa_fisico_snapshot/);
});

test("25. Fase 2B continua funcionando", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    {
      tipo: "recebimento_carteira",
      entrada: 100,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
    {
      tipo: "recebimento_carteira",
      entrada: 200,
      afeta_caixa_fisico_snapshot: false,
      forma_tipo: "PIX",
      forma_nome: "PIX",
    },
  ]);
  assert.equal(totais.saldoAtual, 150);
  assert.equal(totais.recebimentosCarteira, 300);
  assert.equal(totais.meiosPix, 200);
  assert.match(fonte(FASE2B), /rpc_receber_carteira_com_caixa/);
  assert.doesNotMatch(fonte(FASE3), /CREATE OR REPLACE FUNCTION public\.rpc_receber_carteira_cliente/);
  assert.doesNotMatch(fonte(FASE3), /CREATE OR REPLACE FUNCTION public\.rpc_estornar_recebimento_carteira\s*\(/);
});

test("permissões: só caixa.fechar confirma; cego não cria permissão nova", () => {
  assert.equal(temPermissao(presetDoPerfil("caixa"), "caixa", "fechar"), true);
  assert.equal(temPermissao(presetDoPerfil("contador"), "caixa", "fechar"), false);
  assert.equal(temPermissao(presetDoPerfil("caixa"), "configuracoes", "editar_empresa"), false);
  const actions = fonte("app/caixa/actions.ts");
  assert.match(actions, /acao: "fechar"/);
  assert.match(actions, /origem: "confirmarFechamentoCaixa"/);
  assert.match(actions, /acao: "editar_empresa"/);
  assert.doesNotMatch(fonte("lib/permissoes/tipos.ts"), /visualizar_esperado|caixa\.cego/);
  assert.match(fonte(FASE3), /O fechamento exige conferência por meio de pagamento/);
  assert.match(actions, /rpc_iniciar_fechamento_caixa/);
  assert.match(actions, /rpc_confirmar_fechamento_caixa/);
  assert.doesNotMatch(actions, /rpc_fechar_caixa/);
});

test("cego + operador não recebe dinheiro esperado no caixa aberto", () => {
  const totais = sanitizarTotaisCaixaAbertoCego(
    totaisDoLivro([
      { tipo: "abertura", entrada: 100, saida: 0 },
      {
        tipo: "venda",
        entrada: 850,
        saida: 0,
        afeta_caixa_fisico_snapshot: true,
        forma_tipo: "DINHEIRO",
      },
    ])
  );
  assert.equal(totais.saldoAtual, null);
  assert.equal(totais.vendasDinheiro, null);
  assert.equal(totais.saldoInicial, 100);
  assert.equal(totais.vendasTotal, 850);
  assert.equal(
    deveOcultarEsperadoCaixaAberto({
      fechamentoCego: true,
      caixaAberto: true,
      podeRevelarEsperado: podeRevelarEsperadoCaixaCego(presetDoPerfil("caixa")),
    }),
    true
  );
  assert.equal(podeRevelarEsperadoCaixaCego(presetDoPerfil("operador")), false);

  const linhas = sanitizarMovimentosCaixaAbertoCego([
    {
      id: "1",
      caixa_id: "c",
      tipo: "venda",
      origem_tipo: null,
      origem_id: null,
      forma_pagamento_id: DINHEIRO_ID,
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      venda_id: null,
      venda_numero: 1,
      cliente_nome: null,
      entrada: 850,
      saida: 0,
      valor_liquido: 850,
      descricao: null,
      usuario_id: "u",
      usuario_nome: null,
      estorno_de_id: null,
      created_at: "2026-08-25T12:00:00.000Z",
    },
    {
      id: "2",
      caixa_id: "c",
      tipo: "venda",
      origem_tipo: null,
      origem_id: null,
      forma_pagamento_id: PIX_ID,
      forma_nome: "PIX",
      forma_tipo: "PIX",
      forma_codigo: "17",
      permite_troco_snapshot: false,
      afeta_caixa_fisico_snapshot: false,
      venda_id: null,
      venda_numero: 2,
      cliente_nome: null,
      entrada: 200,
      saida: 0,
      valor_liquido: 200,
      descricao: null,
      usuario_id: "u",
      usuario_nome: null,
      estorno_de_id: null,
      created_at: "2026-08-25T12:01:00.000Z",
    },
  ]);
  assert.equal(linhas[0]?.valores_ocultos, true);
  assert.equal(linhas[0]?.entrada, 0);
  assert.equal(linhas[0]?.valor_liquido, 0);
  assert.equal(linhas[1]?.valores_ocultos, undefined);
  assert.equal(linhas[1]?.entrada, 200);

  const page = fonte("app/caixa/page.tsx");
  const resumo = fonte("components/caixa/caixa-resumo-sessao.tsx");
  assert.match(page, /podeRevelarEsperadoCaixaCego\(sessao\.permissoes\)/);
  assert.match(resumo, /totais\[card\.chave\] != null/);
  assert.doesNotMatch(fonte("lib/caixa/conferencia.ts"), /perfil === ["']caixa["']/);
  assert.doesNotMatch(fonte("lib/caixa/carregar.ts"), /perfil ===/);
});

test("cego + usuário administrativo autorizado continua vendo o esperado", () => {
  assert.equal(podeRevelarEsperadoCaixaCego(presetDoPerfil("administrador")), true);
  assert.equal(podeRevelarEsperadoCaixaCego(presetDoPerfil("gerente")), true);
  assert.equal(
    deveOcultarEsperadoCaixaAberto({
      fechamentoCego: true,
      caixaAberto: true,
      podeRevelarEsperado: podeRevelarEsperadoCaixaCego(presetDoPerfil("gerente")),
    }),
    false
  );
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 100, saida: 0 },
    {
      tipo: "venda",
      entrada: 850,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
  ]);
  assert.equal(totais.saldoAtual, 950);
  assert.match(fonte("lib/caixa/conferencia.ts"), /editar_empresa/);
  assert.doesNotMatch(
    fonte("lib/caixa/conferencia.ts"),
    /perfil === ["']administrador["']|perfil === ["']gerente["']/
  );
});

test("cego desligado: esperado permanece disponível para o operador", () => {
  assert.equal(
    deveOcultarEsperadoCaixaAberto({
      fechamentoCego: false,
      caixaAberto: true,
      podeRevelarEsperado: false,
    }),
    false
  );
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    {
      tipo: "venda",
      entrada: 20,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
  ]);
  assert.equal(totais.saldoAtual, 100);
  assert.equal(totais.vendasDinheiro, 20);
});

test("caixa fechado: histórico continua mostrando esperado", () => {
  assert.equal(
    deveOcultarEsperadoCaixaAberto({
      fechamentoCego: true,
      caixaAberto: false,
      podeRevelarEsperado: false,
    }),
    false
  );
  const carregar = fonte("lib/caixa/carregar.ts");
  const sanitizarAberto = carregar.indexOf("sanitizarSessaoCaixaAbertoCego(atualBruto)");
  const anteriores = carregar.indexOf("const anteriores:");
  assert.ok(sanitizarAberto > 0);
  assert.ok(anteriores > 0);
  assert.match(
    fonte("components/caixa/caixa-workspace.tsx"),
    /rotuloSaldoAtual="Dinheiro físico esperado"/
  );
});

test("action de resumo não vaza esperado para quem não pode revelar", () => {
  const actions = fonte("app/caixa/actions.ts");
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(actions, /podeRevelarEsperadoCaixaCego\(sessao\.permissoes\)/);
  assert.match(actions, /carregarDetalheCaixa\(\{/);
  assert.match(actions, /podeRevelarEsperadoCego/);
  assert.match(carregar, /podeRevelarEsperadoCego === true/);
  assert.match(carregar, /sanitizarSessaoCaixaAbertoCego\(detalhe\)/);
  assert.doesNotMatch(actions, /perfil ===/);
});

const RPC_VAZAMENTO_CEGO = {
  caixa_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  numero: 7,
  aberto_em: "2026-08-25T12:00:00.000Z",
  usuario_abertura_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  versao_livro: "v1",
  movimentos_qtd: 3,
  fechamento_cego: true,
  saldo_inicial: 100,
  vendas_liquidas: 850,
  recebimentos_carteira: 0,
  suprimentos: 0,
  sangrias: 0,
  estornos: 0,
  dinheiro_fisico_esperado: 950,
  meios: [
    {
      chave: DINHEIRO_ID,
      forma_pagamento_id: DINHEIRO_ID,
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      afeta_caixa_fisico: true,
      valor_esperado: 950,
      diferenca: -10,
    },
  ],
};

test("action iniciarFechamento: cego não entrega dinheiro_fisico_esperado ao operador", () => {
  const mapeada = mapearConferenciaCaixa(RPC_VAZAMENTO_CEGO);
  assert.equal(mapeada?.dinheiro_fisico_esperado, 950);
  const cliente = conferenciaAbertaParaCliente({
    conferencia: mapeada!,
    fechamentoCegoEmpresa: true,
  });
  const json = JSON.stringify(cliente);
  assert.equal("dinheiro_fisico_esperado" in cliente, false);
  assert.equal(cliente.meios[0]?.valor_esperado, undefined);
  assert.equal(conferenciaRevelaEsperado(cliente), false);
  assert.doesNotMatch(json, /"dinheiro_fisico_esperado"/);
  assert.doesNotMatch(json, /"valor_esperado"/);
  assert.equal(podeRevelarEsperadoCaixaCego(presetDoPerfil("caixa")), false);
  assert.match(fonte("app/caixa/actions.ts"), /conferenciaAbertaParaCliente/);
  assert.match(fonte("app/caixa/actions.ts"), /carregarFechamentoCego\(supabase, empresaId\)/);
  assert.match(
    fonte("app/caixa/actions.ts"),
    /!podeRevelarEsperadoCego &&\s*conferenciaRevelaEsperado\(conferenciaCliente\)/
  );
});

test("action iniciarFechamento: config cego sanitiza mesmo se a RPC omitir a flag", () => {
  const mapeada = mapearConferenciaCaixa({
    ...RPC_VAZAMENTO_CEGO,
    fechamento_cego: false,
  });
  assert.equal(mapeada?.fechamento_cego, false);
  assert.equal(mapeada?.dinheiro_fisico_esperado, 950);
  const cliente = conferenciaAbertaParaCliente({
    conferencia: mapeada!,
    fechamentoCegoEmpresa: true,
  });
  assert.equal(cliente.fechamento_cego, true);
  assert.equal("dinheiro_fisico_esperado" in cliente, false);
  assert.equal(conferenciaRevelaEsperado(cliente), false);
});

test("loader caixa aberto cego: saldoAtual/vendasDinheiro não vazam no JSON", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 100, saida: 0 },
    {
      tipo: "venda",
      entrada: 850,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
  ]);
  const sessao = sanitizarSessaoCaixaAbertoCego({
    status: "aberto",
    ...totais,
    movimentos: [
      {
        id: "1",
        caixa_id: "c",
        tipo: "venda" as const,
        origem_tipo: null,
        origem_id: null,
        forma_pagamento_id: DINHEIRO_ID,
        forma_nome: "Dinheiro",
        forma_tipo: "DINHEIRO",
        forma_codigo: "01",
        permite_troco_snapshot: true,
        afeta_caixa_fisico_snapshot: true,
        venda_id: null,
        venda_numero: 1,
        cliente_nome: null,
        entrada: 850,
        saida: 0,
        valor_liquido: 850,
        descricao: null,
        usuario_id: "u",
        usuario_nome: null,
        estorno_de_id: null,
        created_at: "2026-08-25T12:00:00.000Z",
      },
    ],
  });
  const json = JSON.stringify(sessao);
  assert.equal(sessao.saldoAtual, null);
  assert.equal(sessao.vendasDinheiro, null);
  assert.equal(JSON.parse(json).saldoAtual, null);
  assert.doesNotMatch(json, /"saldoAtual":950/);
  assert.doesNotMatch(json, /"vendasDinheiro":850/);
  assert.doesNotMatch(json, /dinheiro_fisico_esperado/);
  assert.match(fonte("lib/caixa/carregar.ts"), /sanitizarSessaoCaixaAbertoCego\(atualBruto\)/);
  assert.match(fonte("app/caixa/page.tsx"), /podeRevelarEsperadoCaixaCego\(sessao\.permissoes\)/);
});

test("cego desligado: action entrega esperado; histórico fechado também", () => {
  const mapeada = mapearConferenciaCaixa({
    ...RPC_VAZAMENTO_CEGO,
    fechamento_cego: false,
  });
  const cliente = conferenciaAbertaParaCliente({
    conferencia: mapeada!,
    fechamentoCegoEmpresa: false,
  });
  assert.equal(cliente.dinheiro_fisico_esperado, 950);
  assert.equal(cliente.meios[0]?.valor_esperado, 950);
  assert.equal(conferenciaRevelaEsperado(cliente), true);
  assert.equal(
    deveOcultarEsperadoCaixaAberto({
      fechamentoCego: true,
      caixaAberto: false,
      podeRevelarEsperado: false,
    }),
    false
  );
});
