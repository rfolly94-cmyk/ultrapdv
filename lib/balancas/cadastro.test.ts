import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { produtoElegivelBalanca } from "./elegivel";
import { lerDadosBalancaProduto } from "./dados-produto";

const form = fonte("app/produtos/produto-cadastro-form.tsx");
const aba = fonte("app/produtos/produto-balanca-aba.tsx");
const actions = fonte("app/produtos/actions.ts");
const page = fonte("app/produtos/page.tsx");
const workspace = fonte("app/configuracoes/balancas/balancas-workspace.tsx");
const menu = fonte("lib/permissoes/menu.ts");

test("aba Balança só aparece para UN = KG e não cria checkbox de produto pesado", () => {
  assert.match(form, /label: "Balança"/);
  assert.match(form, /produtoElegivelBalanca\(unidade\)/);
  assert.match(form, /ProdutoBalancaAba/);
  assert.doesNotMatch(aba, /name="enviar_balanca"/);
  assert.doesNotMatch(form, /produto pesado/i);
  assert.doesNotMatch(aba, /produto pesado/i);
  assert.equal(produtoElegivelBalanca("KG"), true);
  assert.equal(produtoElegivelBalanca("UN"), false);
});

test("aba Balança tem PLU, descrição, validade da etiqueta, tara, departamento e mensagem", () => {
  assert.match(aba, /name="plu"/);
  assert.match(aba, /name="descricao_balanca"/);
  assert.match(aba, /name="validade_etiqueta_dias"/);
  assert.match(aba, /name="tara_padrao"/);
  assert.match(aba, /name="departamento_balanca"/);
  assert.match(aba, /name="mensagem_balanca"/);
  assert.match(aba, /não altera lote/i);
  assert.match(aba, /preço de venda/i);
});

test("cadastro e edição persistem produtos_balancas da empresa ativa sem gravar preço duplicado", () => {
  assert.match(actions, /persistirDadosBalancaProduto/);
  assert.match(actions, /from\("produtos_balancas"\)/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.match(actions, /onConflict: "empresa_id,produto_id"/);
  assert.match(actions, /MENSAGEM_PLU_DUPLICADO/);
  assert.doesNotMatch(
    actions.slice(
      actions.indexOf("async function persistirDadosBalancaProduto"),
      actions.indexOf("export async function cadastrarProduto")
    ),
    /preco_venda|estoque_lotes|enviar_balanca/
  );
  assert.match(page, /from\("produtos_balancas"\)/);
  assert.match(page, /\.eq\("empresa_id", vinculo\.empresa_id\)/);
});

test("vínculo gera PLU automático por empresa e a aba continua editável", () => {
  const actionsBalanca = fonte("app/configuracoes/balancas/actions.ts");
  assert.match(actionsBalanca, /atribuirPluComRetry/);
  assert.match(actionsBalanca, /garantirPluAoVincular/);
  assert.match(actionsBalanca, /precisaGerarPluVinculo/);
  assert.match(actionsBalanca, /listarPlusDaEmpresa/);
  const listar = actionsBalanca.slice(
    actionsBalanca.indexOf("export async function listarProdutosVinculadosBalanca"),
    actionsBalanca.indexOf("async function garantirPluAoVincular")
  );
  assert.match(listar, /precisaGerarPluVinculo/);
  assert.match(listar, /garantirPluAoVincular/);
  assert.match(listar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(aba, /name="plu"/);
  assert.match(aba, /próximo PLU/);
  assert.match(actions, /MENSAGEM_PLU_DUPLICADO/);
});

test("descrição da balança inicia com o nome do produto", () => {
  assert.match(aba, /produto\?\.descricao_balanca \?\? produto\?\.nome/);
  const formData = new FormData();
  const dados = lerDadosBalancaProduto(formData, { nomeProduto: "Banana prata" });
  assert.equal(dados.descricaoBalanca, "Banana prata");
  assert.equal("enviarBalanca" in dados, false);
});

test("página de produtos não quebra se a tabela ainda não existe", () => {
  const page = fonte("app/produtos/page.tsx");
  assert.match(page, /tabelaBalancaIndisponivel/);
});

test("Configurações > Balanças existe no menu e exporta após validar", () => {
  assert.match(menu, /href: "\/configuracoes\/balancas"/);
  assert.match(menu, /label: "Balanças"/);
  assert.match(workspace, /definirVinculoProdutoBalanca/);
  assert.match(workspace, /Produtos vinculados/);
  assert.match(workspace, /Exportar para balança/);
  assert.match(workspace, /Exportar somente válidos/);
  assert.match(workspace, /Cancelar para corrigir/);
  assert.match(workspace, /MENSAGEM_LAYOUT_NAO_IMPLEMENTADO/);
  assert.match(
    fonte("lib/balancas/tipos.ts"),
    /Layout de exportação ainda não implementado/
  );
});

test("Configurações > Balanças esconde campos técnicos e usa formato automático", () => {
  assert.match(workspace, /modelosDoFabricante/);
  assert.match(workspace, /aplicarSelecaoModelo/);
  assert.match(workspace, /<th>Formato<\/th>/);
  assert.match(workspace, /Formato/);
  assert.match(workspace, /Outro modelo/);
  assert.match(workspace, /Buscar modelo/);
  assert.match(workspace, /Configurações avançadas/);
  assert.match(workspace, /MENSAGEM_AVANCADO_ETIQUETA/);
  assert.match(workspace, /MENSAGEM_TROCA_MODELO_AVANCADO/);
  assert.match(workspace, /Departamento padrão/);
  assert.match(workspace, /name="departamento_padrao"/);
  assert.match(workspace, /AJUDA_DEPARTAMENTO_PADRAO/);
  assert.match(workspace, /rotuloDepartamentoTabela/);
  assert.match(
    fonte("lib/balancas/departamento.ts"),
    /Usado nos produtos que não possuem departamento específico/
  );
  assert.match(fonte("lib/balancas/departamento.ts"), /\(padrão\)/);
  assert.doesNotMatch(workspace, /Layout \/ formato/);
  assert.doesNotMatch(workspace, /name="layout"/);
  assert.doesNotMatch(workspace, /<details[^>]*\sopen\b/);
  assert.match(
    fonte("lib/balancas/modelos.ts"),
    /Este modelo ainda não possui configuração automática no UltraPDV/
  );
  assert.match(
    fonte("lib/balancas/modelos.ts"),
    /O UltraPDV selecionará automaticamente o formato compatível com o modelo escolhido/
  );
  assert.match(
    fonte("app/configuracoes/balancas/actions.ts"),
    /lerSelecaoModeloDoFormulario/
  );
  assert.match(workspace, /layoutExportacaoImplementado/);
  assert.match(workspace, /Itensmgv\.txt/);
  assert.match(fonte("lib/balancas/modelos.ts"), /Prix 4 Uno/);
});

test("modal Validar carga da balança não renderiza texto literal svg", () => {
  const inicio = workspace.indexOf('title="Validar carga da balança"');
  const fim = workspace.indexOf("</AppModal>", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const trecho = workspace.slice(inicio, fim);
  assert.doesNotMatch(trecho, />\s*svg\s*</);
  assert.doesNotMatch(trecho, /\{["'`]svg["'`]\}/);
  assert.doesNotMatch(trecho, /from ["']lucide-react["']/);

  const modal = fonte("components/ui/app-modal.tsx");
  assert.doesNotMatch(modal, /from ["']lucide-react["']/);
  assert.doesNotMatch(modal, />\s*svg\s*</);
  assert.doesNotMatch(modal, /\{["'`]svg["'`]\}/);
  assert.match(modal, /aria-label="Fechar"/);
  assert.match(modal, /aria-hidden="true"/);
});
