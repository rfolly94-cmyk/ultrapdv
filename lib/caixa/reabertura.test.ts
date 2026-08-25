import assert from "node:assert/strict";
import { test } from "node:test";

import { avisoCaixaReabertoAtual, idCaixaReabrirElegivel, montarHistoricoCiclos, sessaoPodeSerReaberta, validarMotivoReabertura } from "@/lib/caixa/reabertura";
import { MENSAGEM_MOTIVO_REABERTURA, MENSAGEM_REABRIR_COM_ABERTO, MENSAGEM_REABRIR_ULTIMO_FECHADO } from "@/lib/caixa/mensagens";
import { fonte } from "@/lib/multiempresa/fonte";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import type { CaixaCicloFechamento, CaixaReabertura } from "@/lib/caixa/tipos";

const FASE4 = "supabase/migrations/20260825160000_caixa_reabertura_relatorio.sql";
const FASE3 = "supabase/migrations/20260825150000_caixa_fechamento_conferencia.sql";
const FASE1 = "supabase/migrations/20260824100000_caixa_modulo.sql";
const FASE2A = "supabase/migrations/20260824120000_caixa_venda_pdv.sql";
const FASE2B = "supabase/migrations/20260825140000_caixa_carteira_estornos.sql";

function sessao(parcial: {
  id: string;
  status?: string;
  aberto_em?: string;
  numero?: number;
  filial_id?: string | null;
}) {
  return {
    id: parcial.id,
    status: parcial.status ?? "fechado",
    aberto_em: parcial.aberto_em ?? "2026-08-25T08:00:00.000Z",
    numero: parcial.numero ?? 1,
    filial_id: parcial.filial_id ?? null,
  };
}

test("1. reabrir último caixa fechado", () => {
  const ultimo = sessao({ id: "c2", numero: 2, aberto_em: "2026-08-25T18:00:00.000Z" });
  const anterior = sessao({ id: "c1", numero: 1, aberto_em: "2026-08-24T08:00:00.000Z" });
  assert.equal(sessaoPodeSerReaberta({ alvo: ultimo, sessoesEmpresa: [anterior, ultimo] }).ok, true);
  assert.equal(idCaixaReabrirElegivel([anterior, ultimo]), "c2");
  const sql = fonte(FASE4);
  assert.match(sql, /rpc_reabrir_caixa/);
  assert.match(sql, /Só é possível reabrir o último caixa fechado desta empresa/);
  assert.match(sql, /status = 'aberto'/);
  assert.match(sql, /reaberto = true/);
});

test("2. motivo obrigatório", () => {
  assert.equal(validarMotivoReabertura("").ok, false);
  assert.equal(validarMotivoReabertura("   ").ok, false);
  assert.equal(validarMotivoReabertura("abc").ok, false);
  assert.equal(validarMotivoReabertura("!!!!!!!!").ok, false);
  const ok = validarMotivoReabertura("Recebimento não registrado");
  assert.equal(ok.ok, true);
  assert.match(fonte(FASE4), /Informe o motivo da reabertura/);
  assert.match(fonte(FASE4), /char_length\(v_motivo\) < 8/);
  assert.match(fonte("components/caixa/caixa-reabrir-modal.tsx"), /Motivo da reabertura/);
  assert.match(fonte("app/caixa/actions.ts"), /validarMotivoReabertura/);
  assert.equal(MENSAGEM_MOTIVO_REABERTURA.length > 10, true);
});

test("3. usuário sem permissão não reabre", () => {
  assert.equal(temPermissao(presetDoPerfil("caixa"), "caixa", "reabrir"), false);
  assert.equal(temPermissao(presetDoPerfil("operador"), "caixa", "reabrir"), false);
  assert.equal(temPermissao(presetDoPerfil("vendedor"), "caixa", "reabrir"), false);
  assert.equal(temPermissao(presetDoPerfil("contador"), "caixa", "reabrir"), false);
  assert.equal(temPermissao(presetDoPerfil("gerente"), "caixa", "reabrir"), true);
  assert.equal(temPermissao(presetDoPerfil("administrador"), "caixa", "reabrir"), true);
  assert.match(fonte("app/caixa/actions.ts"), /acao: "reabrir"/);
});

test("4. Caixa de outra empresa não reabre", () => {
  const sql = fonte(FASE4);
  const rpc = sql.slice(sql.indexOf("rpc_reabrir_caixa"));
  assert.match(rpc, /caixa_empresa_ativa_usuario\(\)/);
  assert.match(
    rpc,
    /WHERE c\.empresa_id = v_empresa_id\s+AND c\.id = p_caixa_id/
  );
  assert.doesNotMatch(rpc, /p_empresa_id/);
  const actions = fonte("app/caixa/actions.ts");
  assert.match(actions, /eq\("principal", true\)/);
  assert.doesNotMatch(
    actions.slice(actions.indexOf("export async function reabrirCaixa")),
    /input\.empresaId/
  );
});

test("5. tentar reabrir com outro Caixa aberto recusa", () => {
  const fechado = sessao({ id: "c1", status: "fechado" });
  const aberto = sessao({ id: "c2", status: "aberto", numero: 2, aberto_em: "2026-08-26T08:00:00.000Z" });
  const recusa = sessaoPodeSerReaberta({ alvo: fechado, sessoesEmpresa: [fechado, aberto] });
  assert.equal(recusa.ok, false);
  if (!recusa.ok) {
    assert.equal(recusa.erro, MENSAGEM_REABRIR_COM_ABERTO);
  }
  assert.match(fonte(FASE4), /Já existe um caixa aberto para esta empresa/);
});

test("6-7. duplo clique e duas abas: uma única reabertura", () => {
  const sql = fonte(FASE4);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('caixa-abrir:'/);
  assert.match(sql, /AND status = 'fechado'/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(fonte("components/caixa/caixa-reabrir-modal.tsx"), /disabled=\{pending\}/);
  assert.match(fonte(FASE1), /ux_caixas_aberto_empresa_sem_filial/);
});

test("8-11. caixa reaberto volta a aceitar venda, carteira, suprimento e sangria", () => {
  const sql = fonte(FASE4);
  assert.match(sql, /status = 'aberto'/);
  assert.doesNotMatch(sql, /status = 'reaberto'/);
  assert.match(fonte(FASE2A), /status = 'aberto'/);
  assert.match(fonte(FASE2B), /rpc_receber_carteira_com_caixa/);
  assert.match(fonte(FASE1), /Só é possível movimentar um caixa aberto/);
  assert.match(fonte("lib/caixa/sessao-aberta.ts"), /\.eq\("status", "aberto"\)/);
});

test("12-14. primeiro fechamento permanece e o segundo cria novo ciclo", () => {
  const sql = fonte(FASE4);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.caixa_fechamentos/);
  assert.match(sql, /UNIQUE \(empresa_id, caixa_id, versao\)/);
  assert.match(sql, /COALESCE\(MAX\(f\.versao\), 0\) \+ 1/);
  assert.match(sql, /UNIQUE \(empresa_id, caixa_fechamento_id, chave\)/);
  const confirmar = sql.slice(sql.indexOf("rpc_confirmar_fechamento_caixa"));
  const reabrir = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.rpc_reabrir_caixa"));
  assert.doesNotMatch(confirmar, /DELETE FROM public\.caixa_fechamentos/);
  assert.doesNotMatch(reabrir, /DELETE FROM public\.caixa_fechamentos/);
  assert.doesNotMatch(reabrir, /DELETE FROM public\.caixa_fechamentos_meios/);
  const c1: CaixaCicloFechamento = {
    id: "f1",
    versao: 1,
    fechado_em: "2026-08-25T18:00:00.000Z",
    fechado_por_id: "u1",
    fechado_por_nome: "João",
    dinheiro_contado: 990,
    dinheiro_fisico_esperado: 1000,
    diferenca: -10,
    observacao: null,
    fechamento_cego: false,
    meios: [],
  };
  const c2: CaixaCicloFechamento = {
    ...c1,
    id: "f2",
    versao: 2,
    fechado_em: "2026-08-25T18:30:00.000Z",
    fechado_por_nome: "Rafael",
    dinheiro_contado: 1050,
    dinheiro_fisico_esperado: 1050,
    diferenca: 0,
  };
  const r1: CaixaReabertura = {
    id: "r1",
    fechamento_id: "f1",
    reaberto_em: "2026-08-25T18:20:00.000Z",
    reaberto_por_id: "u2",
    reaberto_por_nome: "Rafael",
    motivo: "recebimento esquecido",
  };
  const hist = montarHistoricoCiclos({ ciclos: [c1, c2], reaberturas: [r1] });
  assert.equal(hist.length, 3);
  assert.equal(hist[0]?.tipo, "fechamento");
  if (hist[0]?.tipo === "fechamento") {
    assert.equal(hist[0].diferenca, -10);
  }
  assert.equal(hist[1]?.tipo, "reabertura");
  if (hist[2]?.tipo === "fechamento") {
    assert.equal(hist[2].diferenca, 0);
  }
});

test("15. fechamento cego continua funcionando após reabertura", () => {
  assert.match(fonte(FASE3), /fechamento_caixa_cego/);
  assert.match(fonte(FASE4), /fechamento_cego boolean/);
  assert.match(fonte("lib/caixa/carregar.ts"), /sanitizarCiclosFechamentoCego/);
  assert.match(
    fonte("components/caixa/caixa-reabrir-modal.tsx"),
    /ocultarEsperado/
  );
});

test("16. movimentação durante novo fechamento invalida conferência antiga", () => {
  assert.match(fonte(FASE4), /caixa_versao_livro/);
  assert.match(
    fonte(FASE4),
    /O caixa recebeu novas movimentações\. Atualize a conferência antes de fechar\./
  );
});

test("17. sessão normal posterior não mostra aviso de reabertura", () => {
  assert.equal(
    avisoCaixaReabertoAtual({
      status: "aberto",
      reaberto: false,
      reaberturas: [],
    }),
    null
  );
  assert.equal(
    avisoCaixaReabertoAtual({
      status: "fechado",
      reaberto: true,
      reaberturas: [
        {
          id: "r1",
          fechamento_id: "f1",
          reaberto_em: "2026-08-25T18:20:00.000Z",
          reaberto_por_id: "u2",
          reaberto_por_nome: "Rafael",
          motivo: "x",
        },
      ],
    }),
    null
  );
  const aviso = avisoCaixaReabertoAtual({
    status: "aberto",
    reaberto: true,
    reaberturas: [
      {
        id: "r1",
        fechamento_id: "f1",
        reaberto_em: "2026-08-25T18:20:00.000Z",
        reaberto_por_id: "u2",
        reaberto_por_nome: "Rafael",
        motivo: "Recebimento não registrado",
      },
    ],
  });
  assert.equal(aviso?.motivo, "Recebimento não registrado");
  assert.equal(aviso?.reaberto_por_nome, "Rafael");
});

test("18. tentar reabrir Caixa histórico incompatível recusa", () => {
  const antigo = sessao({ id: "c1", numero: 1, aberto_em: "2026-08-24T08:00:00.000Z" });
  const posterior = sessao({
    id: "c2",
    numero: 2,
    status: "fechado",
    aberto_em: "2026-08-25T08:00:00.000Z",
  });
  const recusa = sessaoPodeSerReaberta({
    alvo: antigo,
    sessoesEmpresa: [antigo, posterior],
  });
  assert.equal(recusa.ok, false);
  if (!recusa.ok) {
    assert.equal(recusa.erro, MENSAGEM_REABRIR_ULTIMO_FECHADO);
  }
  assert.equal(idCaixaReabrirElegivel([antigo, posterior]), "c2");
});

test("19-20. PDV sem aviso no caixa normal e com aviso no reaberto", () => {
  const page = fonte("app/pdv/page.tsx");
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(page, /caixaReabertoAviso=\{/);
  assert.match(page, /controleAtivo \? caixaAbertoRegistro\?\.aviso/);
  assert.match(shell, /CaixaAvisoReabertoFaixa/);
  assert.match(shell, /caixaAberto && caixaReabertoAviso/);
  assert.match(fonte("components/caixa/caixa-aviso-reaberto.tsx"), /data-caixa-aviso-reaberto/);
  assert.doesNotMatch(fonte("components/caixa/caixa-aviso-reaberto.tsx"), /onClose|toast|descart/);
});

test("21-23. NF-e mostra aviso com motivo, usuário e data", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const pagina = fonte("app/fiscal/nfe/nfe-emissao-pagina.tsx");
  const aviso = fonte("components/caixa/caixa-aviso-reaberto.tsx");
  assert.match(pagina, /caixaReabertoAviso=\{formulario\.caixaReabertoAviso/);
  assert.match(form, /CaixaAvisoReabertoFaixa/);
  assert.match(aviso, /Caixa reaberto/);
  assert.match(aviso, /formatarDataHora\(aviso\.reaberto_em\)/);
  assert.match(aviso, /aviso\.reaberto_por_nome/);
  assert.match(aviso, /Motivo: \{aviso\.motivo\}/);
});

test("24-25. aviso some ao fechar e não aparece em sessão nova", () => {
  assert.equal(avisoCaixaReabertoAtual({ status: "fechado", reaberto: true }), null);
  assert.equal(
    avisoCaixaReabertoAtual({ status: "aberto", reaberto: false }),
    null
  );
  assert.match(fonte("lib/caixa/sessao-aberta.ts"), /reaberto === true/);
});

test("26. não vazar reabertura de outra empresa", () => {
  const sessaoAberta = fonte("lib/caixa/sessao-aberta.ts");
  assert.match(sessaoAberta, /\.eq\("empresa_id", id\)/);
  assert.match(sessaoAberta, /registroPertenceAEmpresaAtiva/);
  assert.match(sessaoAberta, /\.eq\("empresa_id", id\)[\s\S]*caixa_reaberturas/);
});
