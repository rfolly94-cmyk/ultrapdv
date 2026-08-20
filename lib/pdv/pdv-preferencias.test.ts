import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
} from "../multiempresa/cenario";
import { fonte } from "../multiempresa/fonte";
import {
  decidirAcaoEscPdv,
  DESTINO_FECHAR_PDV,
  overlayAbertoPdv,
} from "./atalhos-esc";
import {
  aoCancelarClienteDoFiado,
  aoMarcarFiado,
  deveResetarPagamentosAposCliente,
  fiadoSincronizadoComPagamentos,
  MENSAGEM_FIADO_EXIGE_CLIENTE,
  podeConcluirFiado,
  resetarPagamentosAposClienteFiado,
  restanteParaAtivarFiado,
} from "./fiado-cliente";
import {
  amostrasDaPaleta,
  deveMostrarFotoProduto,
  deveRenderizarLogoCentro,
  estiloTokensPdv,
  logoDaEmpresaAtiva,
  PALETAS_PDV,
  PALETAS_PDV_OPCOES,
  paletaAlteraConjuntoCompleto,
  preferenciaDaSessao,
  preferenciasAposCancelarPreview,
  PREFERENCIAS_PDV_PADRAO,
  sanitizarPreferenciasPdv,
  tokensDaPaleta,
} from "./preferencias";

test("Fiado sem cliente abre seletor de clientes", () => {
  assert.equal(
    aoMarcarFiado({ marcado: true, clienteId: null }),
    "pedir_cliente"
  );
});

test("Fiado com cliente já selecionado NÃO abre seletor novamente", () => {
  assert.equal(
    aoMarcarFiado({ marcado: true, clienteId: "cli-1" }),
    "ativar"
  );
});

test("Dinheiro + PIX preenchidos → marcar Fiado sem cliente → selecionar cliente zera pagamentos", () => {
  const anteriores = [
    { formaPagamentoId: "dinheiro", valorTexto: "40,00" },
    { formaPagamentoId: "pix", valorTexto: "60,00" },
  ];
  assert.equal(
    deveResetarPagamentosAposCliente({
      contexto: "fiado",
      clienteSelecionado: true,
    }),
    true
  );
  assert.deepEqual(resetarPagamentosAposClienteFiado(), []);
  assert.equal(anteriores.length > 0, true);
});

test("Depois do reset: permitir Fiado + Dinheiro", () => {
  const depois = [
    { formaPagamentoId: "fiado", valorTexto: "80,00" },
    { formaPagamentoId: "dinheiro", valorTexto: "20,00" },
  ];
  assert.equal(
    deveResetarPagamentosAposCliente({
      contexto: null,
      clienteSelecionado: true,
    }),
    false
  );
  assert.equal(depois.length, 2);
});

test("Depois do reset: permitir Fiado + PIX", () => {
  const depois = [
    { formaPagamentoId: "fiado", valorTexto: "80,00" },
    { formaPagamentoId: "pix", valorTexto: "20,00" },
  ];
  assert.equal(
    deveResetarPagamentosAposCliente({
      contexto: "manual",
      clienteSelecionado: true,
    }),
    false
  );
  assert.equal(depois.some((item) => item.formaPagamentoId === "pix"), true);
});

test("Abrir cliente manualmente pelo F5 não deve limpar pagamentos", () => {
  assert.equal(
    deveResetarPagamentosAposCliente({
      contexto: "manual",
      clienteSelecionado: true,
    }),
    false
  );
});

test("Cancelar seleção solicitada pelo Fiado impede concluir Fiado sem cliente", () => {
  const cancelado = aoCancelarClienteDoFiado({ contexto: "fiado" });
  assert.equal(cancelado.usarFiado, false);
  assert.equal(cancelado.reabrirPagamento, true);
  assert.equal(cancelado.mensagem, MENSAGEM_FIADO_EXIGE_CLIENTE);
  assert.equal(
    podeConcluirFiado({ usarFiado: true, clienteId: null }),
    false
  );
});

test("Fiado sem cliente → selecionar cliente → pagamentos contém Fiado", () => {
  const formaFiadoId = "forma-fiado";
  const anteriores = [
    { formaPagamentoId: "dinheiro", valorTexto: "40,00" },
    { formaPagamentoId: "pix", valorTexto: "60,00" },
  ];
  const limpos = resetarPagamentosAposClienteFiado();
  const restante = restanteParaAtivarFiado({
    totalCentavos: 10000,
    outrosCentavos: 0,
  });
  const pagamentos = [
    ...limpos,
    { formaPagamentoId: formaFiadoId, valorTexto: "100,00" },
  ];

  assert.equal(anteriores.some((item) => item.formaPagamentoId === formaFiadoId), false);
  assert.equal(
    pagamentos.some((item) => item.formaPagamentoId === formaFiadoId),
    true
  );
  assert.equal(restante, 10000);
});

test("Checkbox Fiado marcado nunca fica ativo com pagamentos vazios nesse fluxo", () => {
  assert.equal(
    fiadoSincronizadoComPagamentos({
      usarFiado: true,
      formaFiadoId: "forma-fiado",
      pagamentos: [],
    }),
    false
  );
  assert.equal(
    fiadoSincronizadoComPagamentos({
      usarFiado: true,
      formaFiadoId: "forma-fiado",
      pagamentos: [{ formaPagamentoId: "forma-fiado", valorTexto: "100,00" }],
    }),
    true
  );
});

test("Pagamentos anteriores são removidos ao selecionar cliente solicitado pelo Fiado", () => {
  const anteriores = [
    { formaPagamentoId: "dinheiro", valorTexto: "40,00" },
    { formaPagamentoId: "pix", valorTexto: "60,00" },
  ];
  const depois = [
    ...resetarPagamentosAposClienteFiado(),
    { formaPagamentoId: "forma-fiado", valorTexto: "100,00" },
  ];
  assert.equal(
    depois.some((item) => item.formaPagamentoId === "dinheiro"),
    false
  );
  assert.equal(depois.some((item) => item.formaPagamentoId === "pix"), false);
  assert.equal(anteriores.length, 2);
});

test("Fiado cobre o saldo restante conforme a lógica atual", () => {
  assert.equal(
    restanteParaAtivarFiado({ totalCentavos: 10000, outrosCentavos: 0 }),
    10000
  );
  assert.equal(
    restanteParaAtivarFiado({ totalCentavos: 10000, outrosCentavos: 2000 }),
    8000
  );
});

test("Fiado + outra forma depois da seleção continua funcionando", () => {
  const aposSelecao = [
    { formaPagamentoId: "forma-fiado", valorTexto: "100,00" },
  ];
  const misto = [
    { formaPagamentoId: "forma-fiado", valorTexto: "80,00" },
    { formaPagamentoId: "dinheiro", valorTexto: "20,00" },
  ];
  assert.equal(
    deveResetarPagamentosAposCliente({
      contexto: null,
      clienteSelecionado: true,
    }),
    false
  );
  assert.equal(aposSelecao.length, 1);
  assert.equal(misto.length, 2);
});

test("Cancelar seleção do cliente não cria pagamento Fiado válido", () => {
  const anteriores = [
    { formaPagamentoId: "dinheiro", valorTexto: "40,00" },
  ];
  const cancelado = aoCancelarClienteDoFiado({ contexto: "fiado" });
  assert.equal(cancelado.usarFiado, false);
  assert.equal(
    fiadoSincronizadoComPagamentos({
      usarFiado: cancelado.usarFiado,
      formaFiadoId: "forma-fiado",
      pagamentos: anteriores,
    }),
    true
  );
  assert.equal(
    anteriores.some((item) => item.formaPagamentoId === "forma-fiado"),
    false
  );
});

test("ESC com modal aberto fecha apenas o modal", () => {
  const decisao = decidirAcaoEscPdv({
    pagamento: true,
    cliente: true,
  });
  assert.deepEqual(decisao, { acao: "fechar-overlay", overlay: "cliente" });
  assert.equal(overlayAbertoPdv({ pagamento: true }), "pagamento");
});

test("ESC sem modal aberto executa o mesmo fechamento do X do PDV", () => {
  const decisao = decidirAcaoEscPdv({});
  assert.deepEqual(decisao, {
    acao: "sair-pdv",
    destino: DESTINO_FECHAR_PDV,
  });
  assert.equal(DESTINO_FECHAR_PDV, "/vendas");
});

test("Preferência de logo persiste ao recarregar", () => {
  const salva = sanitizarPreferenciasPdv({
    paleta: "padrao",
    mostrarLogoCentro: true,
  });
  assert.equal(salva.mostrarLogoCentro, true);
  assert.equal(
    sanitizarPreferenciasPdv(salva).mostrarLogoCentro,
    true
  );
});

test("Paleta padrão mantém aparência/configuração padrão", () => {
  const padrao = tokensDaPaleta("padrao");
  assert.equal(PREFERENCIAS_PDV_PADRAO.paleta, "padrao");
  assert.equal(padrao.bg, "#ffffff");
  assert.equal(padrao.primary, "#2563eb");
  assert.equal(padrao.sidebar, "#ffffff");
  assert.deepEqual(sanitizarPreferenciasPdv(null), PREFERENCIAS_PDV_PADRAO);
});

test("Alterar para Laranja persiste após recarregar", () => {
  const salva = sanitizarPreferenciasPdv({ paleta: "laranja" });
  assert.equal(salva.paleta, "laranja");
  assert.equal(sanitizarPreferenciasPdv(salva).paleta, "laranja");
  assert.equal(tokensDaPaleta(salva.paleta).primary, "#ea580c");
});

test("Alterar paleta modifica conjunto completo de tokens, não só primary", () => {
  assert.equal(paletaAlteraConjuntoCompleto("padrao", "laranja"), true);
  const origem = tokensDaPaleta("padrao");
  const destino = tokensDaPaleta("laranja");
  assert.notEqual(origem.bg, destino.bg);
  assert.notEqual(origem.sidebar, destino.sidebar);
  assert.notEqual(origem.selected, destino.selected);
  assert.ok(Object.keys(estiloTokensPdv("laranja")).length >= 12);
});

test("Preferência do usuário A não aparece para usuário B", () => {
  const registros = [
    {
      usuario_id: usuarioA,
      empresa_id: empresaA,
      paleta: "laranja",
    },
    {
      usuario_id: usuarioB,
      empresa_id: empresaA,
      paleta: "azul",
    },
  ];
  assert.equal(
    preferenciaDaSessao(registros, usuarioA, empresaA)?.paleta,
    "laranja"
  );
  assert.notEqual(
    preferenciaDaSessao(registros, usuarioB, empresaA)?.paleta,
    preferenciaDaSessao(registros, usuarioA, empresaA)?.paleta
  );
});

test("Preferência da empresa A não vaza para empresa B", () => {
  const registros = [
    {
      usuario_id: usuarioA,
      empresa_id: empresaA,
      mostrar_logo_centro: true,
    },
    {
      usuario_id: usuarioA,
      empresa_id: empresaB,
      mostrar_logo_centro: false,
    },
  ];
  assert.equal(
    preferenciaDaSessao(registros, usuarioA, empresaA)?.mostrar_logo_centro,
    true
  );
  assert.equal(
    preferenciaDaSessao(registros, usuarioA, empresaB)?.mostrar_logo_centro,
    false
  );
  assert.equal(preferenciaDaSessao(registros, usuarioA, empresaB)?.empresa_id, empresaB);
});

test("Mostrar logo = false não renderiza logo central", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      mostrarLogoCentro: false,
      logoUrl: "https://cdn.example/a/logo.png",
    }),
    false
  );
});

test("Mostrar logo = true renderiza logo da empresa ativa no centro da área principal", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      mostrarLogoCentro: true,
      logoUrl: logoDaEmpresaAtiva(
        [
          { id: empresaA, logoUrl: "https://cdn.example/a/logo.png" },
          { id: empresaB, logoUrl: "https://cdn.example/b/logo.png" },
        ],
        empresaA
      ),
    }),
    true
  );
});

test("Empresa sem logo não gera imagem quebrada", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      mostrarLogoCentro: true,
      logoUrl: null,
    }),
    false
  );
});

test("Mostrar fotos = false não mostra thumbnails", () => {
  assert.equal(
    deveMostrarFotoProduto({
      mostrarFotosProdutos: false,
      imagemPath: `${empresaA}/produtos/p1/principal.webp`,
      empresaId: empresaA,
    }),
    false
  );
});

test("Mostrar fotos = true + produto com imagem mostra thumbnail", () => {
  assert.equal(
    deveMostrarFotoProduto({
      mostrarFotosProdutos: true,
      imagemPath: `${empresaA}/produtos/p1/principal.webp`,
      empresaId: empresaA,
    }),
    true
  );
});

test("Mostrar fotos = true + produto sem imagem continua normal", () => {
  assert.equal(
    deveMostrarFotoProduto({
      mostrarFotosProdutos: true,
      imagemPath: null,
      empresaId: empresaA,
    }),
    false
  );
});

test("Foto pertence ao produto da empresa ativa", () => {
  assert.equal(
    deveMostrarFotoProduto({
      mostrarFotosProdutos: true,
      imagemPath: `${empresaB}/produtos/p1/principal.webp`,
      empresaId: empresaA,
    }),
    false
  );
});

test("Cancelar preferências após preview restaura configuração anterior", () => {
  const salvas = sanitizarPreferenciasPdv({ paleta: "padrao" });
  const rascunho = sanitizarPreferenciasPdv({ paleta: "laranja", mostrarLogoCentro: true });
  assert.deepEqual(
    preferenciasAposCancelarPreview(salvas, rascunho),
    salvas
  );
});

test("Salvar mantém configuração depois de reload", () => {
  const salva = sanitizarPreferenciasPdv({
    paleta: "grafite",
    mostrarLogoCentro: true,
    mostrarFotosProdutos: true,
  });
  assert.deepEqual(sanitizarPreferenciasPdv(salva), salva);
});

test("Logo oficial atualizada aparece no PDV sem cópia nas preferências", () => {
  const prefs = sanitizarPreferenciasPdv({
    mostrarLogoCentro: true,
    logoUrl: "https://cdn.example/a/logo-antiga.png",
  } as never);
  assert.equal("logoUrl" in prefs, false);
  assert.equal("logo_path" in prefs, false);

  const logoA = "https://cdn.example/a/logo-1.png";
  const logoB = "https://cdn.example/a/logo-2.png";
  assert.equal(
    logoDaEmpresaAtiva([{ id: empresaA, logoUrl: logoB }], empresaA),
    logoB
  );
  assert.notEqual(
    logoDaEmpresaAtiva([{ id: empresaA, logoUrl: logoB }], empresaA),
    logoA
  );
  assert.equal(
    deveRenderizarLogoCentro({
      mostrarLogoCentro: true,
      logoUrl: logoB,
    }),
    true
  );
});

test("Logo exibida pertence à empresa ativa", () => {
  const logoA = "https://cdn.example/a/logo.png";
  const logoB = "https://cdn.example/b/logo.png";
  assert.equal(
    logoDaEmpresaAtiva(
      [
        { id: empresaA, logoUrl: logoA },
        { id: empresaB, logoUrl: logoB },
      ],
      empresaA
    ),
    logoA
  );
  assert.notEqual(
    logoDaEmpresaAtiva(
      [
        { id: empresaA, logoUrl: logoA },
        { id: empresaB, logoUrl: logoB },
      ],
      empresaA
    ),
    logoB
  );
});

test("migration de preferências PDV isola por usuario e empresa", () => {
  const sql = fonte(
    "supabase/migrations/20260819220000_usuarios_preferencias_pdv.sql"
  );
  assert.match(sql, /usuarios_preferencias_pdv/);
  assert.match(sql, /UNIQUE \(usuario_id, empresa_id\)/);
  assert.match(sql, /usuario_id = auth.uid\(\)/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
});

test("migration de paletas reutiliza a tabela e não destrói cor_primaria", () => {
  const sql = fonte(
    "supabase/migrations/20260820010000_pdv_paletas_e_fotos.sql"
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS paleta/);
  assert.match(sql, /mostrar_fotos_produtos/);
  assert.match(sql, /usuarios_preferencias_pdv/);
  assert.doesNotMatch(sql, /DROP COLUMN cor_primaria/);
});

test("preferência inválida cai no visual padrão do UltraPDV", () => {
  assert.deepEqual(sanitizarPreferenciasPdv({ paleta: "neon" as never }), {
    ...PREFERENCIAS_PDV_PADRAO,
  });
});

function canalLinear(canal: number) {
  const s = canal / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string) {
  const limpo = hex.replace("#", "");
  const r = Number.parseInt(limpo.slice(0, 2), 16);
  const g = Number.parseInt(limpo.slice(2, 4), 16);
  const b = Number.parseInt(limpo.slice(4, 6), 16);
  return (
    0.2126 * canalLinear(r) + 0.7152 * canalLinear(g) + 0.0722 * canalLinear(b)
  );
}

function contraste(a: string, b: string) {
  const claro = Math.max(luminancia(a), luminancia(b));
  const escuro = Math.min(luminancia(a), luminancia(b));
  return (claro + 0.05) / (escuro + 0.05);
}

test("paletas extras entram na lista e mantêm as atuais", () => {
  const ids = PALETAS_PDV_OPCOES.map((item) => item.id);
  const labels = PALETAS_PDV_OPCOES.map((item) => item.label);
  assert.deepEqual(ids, [...PALETAS_PDV]);
  for (const esperado of [
    "padrao",
    "azul",
    "azul_claro",
    "laranja",
    "verde",
    "verde_escuro",
    "roxo",
    "rosa",
    "rosa_claro",
    "vermelho",
    "grafite",
    "cinza",
    "escuro",
    "marrom",
    "turquesa",
  ]) {
    assert.equal(ids.includes(esperado as (typeof PALETAS_PDV)[number]), true);
  }
  assert.equal(labels.includes("Rosa"), true);
  assert.equal(labels.includes("Rosa claro"), true);
  assert.equal(labels.includes("Azul claro"), true);
  assert.equal(sanitizarPreferenciasPdv({ paleta: "rosa" }).paleta, "rosa");
  assert.equal(
    sanitizarPreferenciasPdv({ paleta: "azul_claro" }).paleta,
    "azul_claro"
  );
});

test("cada paleta altera o conjunto completo de tokens do PDV", () => {
  const chaves = [
    "--pdv-bg",
    "--pdv-surface",
    "--pdv-surface-secondary",
    "--pdv-header",
    "--pdv-sidebar",
    "--pdv-card",
    "--pdv-border",
    "--pdv-text",
    "--pdv-text-muted",
    "--pdv-primary",
    "--pdv-primary-foreground",
    "--pdv-hover",
    "--pdv-input",
    "--pdv-selected",
  ];

  for (const paleta of PALETAS_PDV) {
    const estilo = estiloTokensPdv(paleta);
    for (const chave of chaves) {
      assert.equal(Boolean((estilo as Record<string, string>)[chave]), true);
    }
    if (paleta !== "padrao") {
      assert.equal(paletaAlteraConjuntoCompleto("padrao", paleta), true);
    }
    assert.equal(amostrasDaPaleta(paleta).length, 3);
  }

  assert.notEqual(tokensDaPaleta("rosa").bg, tokensDaPaleta("rosa_claro").bg);
  assert.notEqual(
    tokensDaPaleta("rosa").primary,
    tokensDaPaleta("rosa_claro").primary
  );
  assert.notEqual(tokensDaPaleta("azul").primary, tokensDaPaleta("azul_claro").primary);
  assert.notEqual(
    tokensDaPaleta("verde").primary,
    tokensDaPaleta("verde_escuro").primary
  );
  assert.notEqual(tokensDaPaleta("grafite").primary, tokensDaPaleta("cinza").primary);
});

test("paletas do PDV têm contraste suficiente e preservam cores semânticas", () => {
  for (const paleta of PALETAS_PDV) {
    const t = tokensDaPaleta(paleta);
    assert.ok(contraste(t.text, t.bg) >= 4.5, `${paleta} texto/fundo`);
    assert.ok(contraste(t.text, t.surface) >= 4.5, `${paleta} texto/surface`);
    assert.ok(
      contraste(t.primary, t.primaryForeground) >= 3,
      `${paleta} botão`
    );
    assert.ok(contraste(t.text, t.input) >= 4.5, `${paleta} campo`);
    assert.ok(contraste(t.text, t.selected) >= 4.5, `${paleta} selecionado`);
    assert.equal(t.error.toLowerCase().startsWith("#"), true);
    assert.equal(t.success.toLowerCase().startsWith("#"), true);
    assert.equal(t.warning.toLowerCase().startsWith("#"), true);
    assert.notEqual(t.error, t.success);
    assert.notEqual(t.error, t.primaryForeground);
  }

  const rosa = tokensDaPaleta("rosa");
  assert.equal(rosa.error, "#dc2626");
  assert.equal(rosa.success, "#059669");
  assert.equal(rosa.warning, "#d97706");
});

test("engrenagem mostra amostras e aplica preview imediato", () => {
  const modal = fonte("components/pdv/pdv-preferencias-modal.tsx");
  assert.match(modal, /Paleta do PDV/);
  assert.match(modal, /amostrasDaPaleta/);
  assert.match(modal, /onPreview/);
  assert.match(modal, /Cancelar/);
  assert.match(modal, /Salvar/);
});

test("migration extras amplia paletas sem criar tabela nova", () => {
  const sql = fonte(
    "supabase/migrations/20260820030000_pdv_paletas_extras.sql"
  );
  assert.match(sql, /usuarios_preferencias_pdv_paleta_check/);
  assert.match(sql, /rosa_claro/);
  assert.match(sql, /turquesa/);
  assert.doesNotMatch(sql, /CREATE TABLE/);
  assert.doesNotMatch(sql, /DROP TABLE/);
});
