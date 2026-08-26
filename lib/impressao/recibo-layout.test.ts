import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_LAYOUT_RECIBO_INVALIDO,
  TEXTO_LIVRE_RECIBO_MAX,
  layoutReciboPadrao,
  layoutReciboPreset,
  montarReciboVenda,
  quebrarLinhaRecibo,
  reciboVendaExemplo,
  sanitizarLayoutRecibo,
  textoPuroRecibo,
  urlHttpValida,
} from "./recibo-layout";

test("empresa A não acessa configuração da empresa B", () => {
  const sql = fonte(
    "supabase/migrations/20260826140000_recibos_layout_config.sql"
  );
  assert.match(sql, /empresa_id uuid primary key/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /supabase db reset/);
  const servidor = fonte("lib/impressao/recibo-layout-servidor.ts");
  assert.match(servidor, /\.eq\("empresa_id", args\.empresaId\)/);
  assert.match(servidor, /vinculo\.empresa_id !== sessao\.empresaId/);
  assert.doesNotMatch(servidor, /createAdminClient|SERVICE_ROLE/);
  assert.notEqual(empresaA, empresaB);
});

test("salvar/carregar e defaults", () => {
  const padrao = layoutReciboPadrao();
  assert.equal(padrao.venda.numero, true);
  assert.equal(padrao.venda.data, true);
  assert.equal(padrao.totais.totalFinal, true);
  assert.equal(padrao.carteira.valorFiado, true);
  assert.equal(padrao.carteira.vencimento, true);
  assert.equal(padrao.carteira.saldoAnterior, false);
  assert.equal(padrao.carteira.novoSaldo, false);
  assert.equal(padrao.carteira.limite, false);
  const sanitizado = sanitizarLayoutRecibo(padrao);
  assert.equal(sanitizado.ok, true);
  if (!sanitizado.ok) {
    return;
  }
  assert.equal(sanitizado.valor.papel, "80mm");
});

test("presets compacto, padrão e completo só mudam a apresentação", () => {
  const compacto = layoutReciboPreset("compacto");
  const completo = layoutReciboPreset("completo");
  const dados = reciboVendaExemplo();
  const total = dados.total;
  assert.equal(compacto.cabecalho.endereco, false);
  assert.equal(completo.cabecalho.razaoSocial, true);
  assert.equal(completo.venda.documentoCliente, true);
  assert.equal(montarReciboVenda(dados, compacto).layout.totais.totalFinal, true);
  assert.equal(dados.total, total);
  assert.equal(completo.carteira.saldoAnterior, false);
  assert.equal(completo.carteira.limite, false);
});

test("campos ligados e desligados", () => {
  const layout = layoutReciboPadrao();
  layout.venda.cliente = false;
  layout.cabecalho.telefone = false;
  const texto = montarReciboVenda(reciboVendaExemplo(), layout).linhasPdf.join("\n");
  assert.doesNotMatch(texto, /Cliente:/);
  assert.doesNotMatch(texto, /Tel\. \(65\) 3333-0000/);
  assert.match(texto, /Venda nº 128/);
  assert.match(texto, /TOTAL/);
});

test("recibo com fiado usa dados da Carteira e esconde saldo por padrão", () => {
  const texto = montarReciboVenda(
    reciboVendaExemplo(),
    layoutReciboPadrao()
  ).linhasPdf.join("\n");
  assert.match(texto, /Fiado desta venda/);
  assert.match(texto, /Vencimento/);
  assert.doesNotMatch(texto, /Saldo anterior/);
  assert.doesNotMatch(texto, /Saldo devedor/);
  assert.doesNotMatch(texto, /Limite disponivel/);
});

test("recibo sem fiado omite bloco da Carteira", () => {
  const dados = reciboVendaExemplo();
  dados.pagamentos = dados.pagamentos.filter((item) => !item.fiado);
  dados.carteira = null;
  const texto = montarReciboVenda(dados, layoutReciboPadrao()).linhasPdf.join(
    "\n"
  );
  assert.doesNotMatch(texto, /Carteira \/ Fiado/);
  assert.doesNotMatch(texto, /Fiado desta venda/);
});

test("pagamento combinado, troco e desconto", () => {
  const dados = reciboVendaExemplo();
  dados.troco = 10;
  dados.pagamentos = [
    {
      nome: "Dinheiro",
      valor: 50,
      parcelas: 1,
      bandeira: null,
      pix: false,
      fiado: false,
    },
    {
      nome: "Cartão",
      valor: 40,
      parcelas: 2,
      bandeira: "Visa",
      pix: false,
      fiado: false,
    },
  ];
  dados.carteira = null;
  const texto = montarReciboVenda(dados, layoutReciboPadrao()).linhasPdf.join(
    "\n"
  );
  assert.match(texto, /Dinheiro/);
  assert.match(texto, /Cartão/);
  assert.match(texto, /2x/);
  assert.match(texto, /Visa/);
  assert.match(texto, /Troco/);
  assert.match(texto, /Desconto/);
  assert.match(texto, /Desc\. item/);
});

test("reimpressão usa os dados reais da venda, não o cadastro vivo do produto", () => {
  const dados = reciboVendaExemplo();
  dados.itens[0].nome = "Nome congelado da venda";
  dados.total = 90;
  const texto = montarReciboVenda(dados, layoutReciboPadrao()).linhasPdf.join(
    "\n"
  );
  assert.match(texto, /Nome congelado da venda/);
  assert.match(texto, /TOTAL .+90/);
  const loader = fonte("lib/impressao/carregar-recibo.ts");
  assert.match(loader, /vendas_itens/);
  assert.match(loader, /produto_nome/);
  assert.doesNotMatch(loader, /from\("produtos"\)/);
});

test("texto personalizado do rodapé, múltiplas linhas e alinhamento", () => {
  const layout = layoutReciboPadrao();
  layout.rodape.textoPersonalizado =
    "Obrigado pela preferência!\nNão fazemos troca de películas.";
  layout.rodape.mostrarTextoPersonalizado = true;
  layout.rodape.alinhamentoTexto = "esquerda";
  const montado = montarReciboVenda(reciboVendaExemplo(), layout);
  const texto = montado.linhasPdf.join("\n");
  assert.match(texto, /Obrigado pela preferência!/);
  assert.match(texto, /Não fazemos troca de películas./);
  const bloco = montado.blocos.find(
    (item) =>
      item.tipo === "linha" && item.texto.includes("Obrigado pela preferência!")
  );
  assert.equal(bloco && bloco.tipo === "linha" && bloco.alinhamento, "esquerda");
  layout.rodape.mostrarTextoPersonalizado = false;
  const oculto = montarReciboVenda(reciboVendaExemplo(), layout).linhasPdf.join(
    "\n"
  );
  assert.doesNotMatch(oculto, /Obrigado pela preferência!/);
});

test("configuração inválida é rejeitada e HTML/JS são removidos", () => {
  assert.equal(sanitizarLayoutRecibo(null).ok, false);
  assert.equal(sanitizarLayoutRecibo("x").ok, false);
  const html = sanitizarLayoutRecibo({
    versao: 1,
    rodape: {
      textoPersonalizado: "<script>alert(1)</script>Obrigado",
    },
  });
  assert.equal(html.ok, true);
  if (!html.ok) {
    return;
  }
  assert.equal(html.valor.rodape.textoPersonalizado.includes("<script>"), false);
  assert.match(html.valor.rodape.textoPersonalizado, /Obrigado/);
  assert.equal(textoPuroRecibo("<b>x</b>", 10), "x");
  assert.equal(urlHttpValida("javascript:alert(1)"), "");
  assert.ok(urlHttpValida("https://loja.example").startsWith("https://"));
  assert.equal(sanitizarLayoutRecibo({ versao: 1, html: true }).ok, false);
  assert.equal(MENSAGEM_LAYOUT_RECIBO_INVALIDO.length > 0, true);
  assert.ok(TEXTO_LIVRE_RECIBO_MAX >= 500 && TEXTO_LIVRE_RECIBO_MAX <= 1000);
});

test("largura 58/80 mm quebra o texto livre", () => {
  const longo = "Mercadoria com garantia de 90 dias mediante este comprovante.";
  assert.ok(quebrarLinhaRecibo(longo, 32).every((linha) => linha.length <= 32));
  assert.ok(quebrarLinhaRecibo(longo, 42).every((linha) => linha.length <= 42));
});

test("impressão de teste usa a impressora selecionada do recibo", () => {
  const workspace = fonte("components/impressao/recibo-layout-workspace.tsx");
  assert.match(workspace, /configDoTipo\(configs\.configs, "recibo"\)/);
  assert.match(workspace, /imprimirPdfNaConfiguracao/);
  assert.match(workspace, /gerarPdfTesteReciboVendaAction/);
  assert.match(workspace, /Imprimir teste/);
});

test("PDV, Vendas e API compartilham o mesmo motor", () => {
  for (const arquivo of [
    "app/api/impressao/recibo/[id]/route.ts",
    "app/pdv/imprimir/recibo/[id]/page.tsx",
    "app/configuracoes/impressao/recibo-actions.ts",
  ]) {
    const src = fonte(arquivo);
    assert.match(src, /montarReciboVenda/, arquivo);
  }
  assert.match(
    fonte("app/vendas/[id]/page.tsx"),
    /\/api\/impressao\/recibo\//
  );
  assert.match(
    fonte("components/pdv/pdv-shell.tsx"),
    /\/api\/impressao\/recibo\//
  );
  assert.match(
    fonte("app/api/impressao/recibo/[id]/route.ts"),
    /gerarPdfReciboEmpresa/
  );
  assert.match(
    fonte("app/configuracoes/impressao/recibo-actions.ts"),
    /gerarPdfReciboEmpresa/
  );
  assert.match(
    fonte("lib/impressao/carregar-recibo.ts"),
    /resolverLogoReciboEmpresa/
  );
  assert.match(
    fonte("lib/impressao/recibo-layout-servidor.ts"),
    /resolverLogoReciboEmpresa/
  );
});
