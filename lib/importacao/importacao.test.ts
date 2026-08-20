import assert from "node:assert/strict";
import { test } from "node:test";

import { classificarLinhasClientes } from "./clientes";
import {
  calcularAjusteEstoque,
  formatarAjusteEstoque,
  normalizarEan,
  normalizarNcm,
  parseMonetario,
  quantidadeEhInvalida,
  textoCelula,
} from "./normalizadores";
import { colunasDoCabecalho, linhasAposCabecalho } from "./parser";
import { classificarLinhasProdutos } from "./produtos";
import type { ConfiguracaoImportacao, LinhaPlanilha } from "./tipos";
import { fonte } from "../multiempresa/fonte";

const empresaA = "emp-a";
const empresaB = "emp-b";

function configProdutos(
  extra?: Partial<ConfiguracaoImportacao>
): ConfiguracaoImportacao {
  return {
    tipo: "produtos",
    nomeArquivo: "produtos.xlsx",
    aba: "Planilha1",
    linhaCabecalho: 1,
    colunas: ["Código", "EAN", "Produto", "Venda", "Custo", "NCM", "Cat", "UN", "Marca", "Qtd"],
    camposProduto: ["codigo", "ean", "nome", "preco_venda"],
    camposCliente: [],
    mapeamento: {
      codigo: "Código",
      ean: "EAN",
      nome: "Produto",
      preco_venda: "Venda",
    },
    regrasProdutos: {
      identificador: "codigo",
      existente: "atualizar",
      categoriaAusente: "criar",
      marcaAusente: "criar",
      gerarCodigoAutomatico: true,
      importarEstoque: false,
      colunaQuantidade: null,
      quantidadeInvalida: "erro",
    },
    regrasClientes: {
      identificador: "cpf_cnpj",
      existente: "atualizar",
    },
    ...extra,
  };
}

function linha(numero: number, valores: Record<string, string>): LinhaPlanilha {
  return { numero, valores };
}

test("normaliza valores monetários de planilha", () => {
  assert.equal(parseMonetario("1500"), 1500);
  assert.equal(parseMonetario("1500.50"), 1500.5);
  assert.equal(parseMonetario("1500,50"), 1500.5);
  assert.equal(parseMonetario("R$ 1.500,50"), 1500.5);
  assert.equal(parseMonetario("1.500,50"), 1500.5);
  assert.equal(parseMonetario("1.500"), 1500);
  assert.equal(parseMonetario("abc"), null);
});

test("EAN permanece string e não vira notação científica", () => {
  assert.equal(normalizarEan("07891234567890"), "07891234567890");
  assert.equal(typeof normalizarEan("07891234567890"), "string");
  assert.equal(textoCelula(7891234567890), "7891234567890");
  assert.equal(normalizarEan(7891234567890), "7891234567890");
});

test("NCM aceita máscara e dígitos", () => {
  assert.equal(normalizarNcm("8529.90.20"), "85299020");
  assert.equal(normalizarNcm("85299020"), "85299020");
});

test("cabeçalho pode começar depois da linha 1", () => {
  const matriz = [
    ["Relatório UltraCell"],
    ["Código", "Produto"],
    ["1", "Capinha"],
  ];
  assert.deepEqual(colunasDoCabecalho(matriz, 2), ["Código", "Produto"]);
  const linhas = linhasAposCabecalho(matriz, 2, ["Código", "Produto"]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]?.valores.Produto, "Capinha");
});

test("campo não marcado não entra no payload de atualização", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "preco_venda"],
      mapeamento: { codigo: "Código", nome: "Produto", preco_venda: "Venda" },
    }),
    linhas: [
      linha(2, {
        Código: "10",
        Produto: "Capinha",
        Venda: "55,00",
        Custo: "10,00",
        NCM: "85299020",
      }),
    ],
    produtos: [
      {
        id: "p1",
        empresa_id: empresaA,
        codigo: "10",
        codigo_barras: null,
        nome: "Antigo",
      },
    ],
    categorias: [],
    marcas: [],
  });

  const payload = previa.linhas[0]?.payload ?? {};
  assert.equal(previa.linhas[0]?.existenteId, "p1");
  assert.equal(previa.linhas[0]?.situacao, "atualizar");
  assert.equal(payload.nome, "Capinha");
  assert.equal(payload.preco_venda, 55);
  assert.equal(payload.codigo, "10");
  assert.equal("preco_custo" in payload, false);
  assert.equal("ncm" in payload, false);
  assert.equal("categoria_nome" in payload, false);
  assert.equal("marca_nome" in payload, false);
  assert.equal(previa.linhas[0]?.ignorarEstoque, true);
});

test("duplicidade de código na própria planilha vira erro", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos(),
    linhas: [
      linha(2, { Código: "10", EAN: "1", Produto: "A", Venda: "1" }),
      linha(3, { Código: "10", EAN: "2", Produto: "B", Venda: "2" }),
    ],
    produtos: [],
    categorias: [],
    marcas: [],
  });

  assert.equal(previa.linhas[1]?.situacao, "erro");
  assert.match(previa.linhas[1]?.observacao ?? "", /Código duplicado dentro da planilha/);
});

test("produto de outra empresa não é atualizado", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos(),
    linhas: [linha(2, { Código: "10", EAN: "", Produto: "Novo nome", Venda: "9" })],
    produtos: [
      {
        id: "p-b",
        empresa_id: empresaB,
        codigo: "10",
        codigo_barras: null,
        nome: "Empresa B",
      },
    ],
    categorias: [],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.existenteId, null);
  assert.equal(previa.linhas[0]?.situacao, "criar");
});

test("categoria de outra empresa não é utilizada", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "categoria"],
      mapeamento: { codigo: "Código", nome: "Produto", categoria: "Cat" },
      regrasProdutos: {
        ...configProdutos().regrasProdutos,
        categoriaAusente: "erro",
      },
    }),
    linhas: [linha(2, { Código: "11", Produto: "Fone", Cat: "Acessórios" })],
    produtos: [],
    categorias: [
      { id: "c-b", empresa_id: empresaB, nome: "Acessórios", ativo: true },
    ],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.situacao, "erro");
  assert.match(previa.linhas[0]?.observacao ?? "", /Categoria não encontrada/);
});

test("marca de outra empresa não é utilizada", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "marca"],
      mapeamento: { codigo: "Código", nome: "Produto", marca: "Marca" },
      regrasProdutos: {
        ...configProdutos().regrasProdutos,
        marcaAusente: "erro",
      },
    }),
    linhas: [linha(2, { Código: "11", Produto: "Fone", Marca: "Samsung" })],
    produtos: [],
    categorias: [],
    marcas: [{ id: "m-b", empresa_id: empresaB, nome: "Samsung", ativo: true }],
  });

  assert.equal(previa.linhas[0]?.situacao, "erro");
  assert.match(previa.linhas[0]?.observacao ?? "", /Marca não encontrada/);
});

test("categoria da empresa ativa casa ignorando maiúsculas", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "categoria"],
      mapeamento: { codigo: "Código", nome: "Produto", categoria: "Cat" },
    }),
    linhas: [linha(2, { Código: "11", Produto: "Fone", Cat: "ACESSÓRIOS" })],
    produtos: [],
    categorias: [
      { id: "c-a", empresa_id: empresaA, nome: "Acessórios", ativo: true },
    ],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.situacao, "criar");
  assert.doesNotMatch(previa.linhas[0]?.observacao ?? "", /Categoria será criada/);
});

test("quantidade inválida não é alterada silenciosamente", () => {
  assert.equal(quantidadeEhInvalida("F").invalida, true);
  assert.equal(quantidadeEhInvalida("-").invalida, true);
  assert.equal(quantidadeEhInvalida("SEM ESTOQUE").invalida, true);

  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "estoque_atual"],
      mapeamento: { codigo: "Código", nome: "Produto", estoque_atual: "Qtd" },
    }),
    linhas: [linha(2, { Código: "11", Produto: "Fone", Qtd: "F" })],
    produtos: [],
    categorias: [],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.situacao, "erro");
  assert.match(previa.linhas[0]?.observacao ?? "", /Quantidade inválida/);
});

test("linha vazia nos campos selecionados é ignorada", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos(),
    linhas: [linha(2, { Código: "", EAN: "", Produto: "", Venda: "" })],
    produtos: [],
    categorias: [],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.situacao, "ignorado");
});

test("cliente de outra empresa não é atualizado", () => {
  const config = configProdutos({
    tipo: "clientes",
    camposProduto: [],
    camposCliente: ["nome", "cpf_cnpj"],
    mapeamento: { nome: "Produto", cpf_cnpj: "Código" },
  });
  const previa = classificarLinhasClientes({
    empresaId: empresaA,
    config,
    linhas: [linha(2, { Produto: "Maria", Código: "12345678901" })],
    clientes: [
      {
        id: "c-b",
        empresa_id: empresaB,
        nome: "Maria B",
        cpf_cnpj: "12345678901",
        email: null,
        telefone: null,
      },
    ],
  });

  assert.equal(previa.linhas[0]?.existenteId, null);
  assert.equal(previa.linhas[0]?.situacao, "criar");
});

test("migration de importação isola empresa e usa RLS existente", () => {
  const migracao = fonte("supabase/migrations/20260819150000_importacoes_dados.sql");
  assert.match(migracao, /empresa_id uuid NOT NULL/);
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /REVOKE ALL ON TABLE public\.importacoes_dados FROM PUBLIC, anon/);
  assert.doesNotMatch(migracao, /from public, anon, authenticated/);
});

test("gravação nunca aceita empresa_id do cliente", () => {
  const actions = fonte("app/configuracoes/importar-dados/actions.ts");
  assert.match(actions, /principal", true/);
  assert.match(actions, /ativo", true/);
  assert.match(actions, /usuarios_empresas/);
  assert.doesNotMatch(actions, /config\.empresaId|configBruta\.empresa_id/);
  const executar = fonte("lib/importacao/executar.ts");
  assert.match(executar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(executar, /rpc_movimentar_estoque_produto/);
  assert.doesNotMatch(executar, /from\("estoque_atual"\)[\s\S]*update/);
});

test("campos de cliente vêm do cadastro atual e não incluem técnicos", () => {
  const tipos = fonte("lib/importacao/tipos.ts");
  const cadastro = fonte("app/clientes/actions.ts");
  const bloco = tipos.slice(
    tipos.indexOf("export const CAMPOS_CLIENTE"),
    tipos.indexOf("export type CampoCliente")
  );
  assert.match(bloco, /"nome"/);
  assert.match(bloco, /"cpf_cnpj"/);
  assert.match(bloco, /"email"/);
  assert.doesNotMatch(bloco, /"id"/);
  assert.doesNotMatch(bloco, /empresa_id/);
  assert.doesNotMatch(bloco, /created_at/);
  assert.doesNotMatch(bloco, /saldo_devedor/);
  assert.match(cadastro, /formData.get\("nome"\)/);
  assert.match(cadastro, /formData.get\("cpf_cnpj"\)/);
  assert.match(cadastro, /formData.get\("indicador_ie_destinatario"\)/);
});

test("atalhos e aba de configurações apontam para o mesmo fluxo", () => {
  assert.match(
    fonte("lib/permissoes/menu.ts"),
    /\/configuracoes\/importar-dados/
  );
  assert.match(
    fonte("components/configuracoes/configuracoes-module-tabs.tsx"),
    /ABAS_CONFIGURACOES_PERMISSAO/
  );
  assert.match(fonte("app/produtos/page.tsx"), /tipo=produtos/);
  assert.match(fonte("app/clientes/page.tsx"), /tipo=clientes/);
  assert.match(fonte("components/estoque/estoque-workspace.tsx"), /tipo=produtos/);
});

function configEstoque(
  extra?: Partial<ConfiguracaoImportacao>
): ConfiguracaoImportacao {
  const base = configProdutos(extra);
  return {
    ...base,
    camposProduto: extra?.camposProduto ?? ["codigo", "nome", "estoque_atual"],
    mapeamento: extra?.mapeamento ?? {
      codigo: "Código",
      nome: "Produto",
      estoque_atual: "Qtd",
    },
    regrasProdutos: {
      ...base.regrasProdutos,
      quantidadeInvalida:
        extra?.regrasProdutos?.quantidadeInvalida ??
        base.regrasProdutos.quantidadeInvalida,
    },
  };
}

function classificarEstoque(params: {
  planilha: string;
  sistema?: number;
  empresaProduto?: string;
  quantidadeInvalida?: ConfiguracaoImportacao["regrasProdutos"]["quantidadeInvalida"];
  novo?: boolean;
}) {
  return classificarLinhasProdutos({
    empresaId: empresaA,
    config: configEstoque({
      regrasProdutos: {
        ...configProdutos().regrasProdutos,
        quantidadeInvalida: params.quantidadeInvalida ?? "erro",
      },
    }),
    linhas: [
      linha(2, { Código: "10", Produto: "Fone", Qtd: params.planilha }),
    ],
    produtos: params.novo
      ? []
      : [
          {
            id: "p1",
            empresa_id: params.empresaProduto ?? empresaA,
            codigo: "10",
            codigo_barras: null,
            nome: "Fone",
            quantidade_atual: params.sistema ?? 0,
          },
        ],
    categorias: [],
    marcas: [],
  });
}

test("ajuste de estoque: 0 → 10 = +10", () => {
  const calculo = calcularAjusteEstoque(0, 10);
  assert.equal(calculo.ajuste, 10);
  assert.equal(formatarAjusteEstoque(calculo.ajuste), "+10");

  const previa = classificarEstoque({ planilha: "10", novo: true });
  const linhaRevisao = previa.linhas[0];
  assert.equal(linhaRevisao?.estoqueAtualSistema, 0);
  assert.equal(linhaRevisao?.estoquePlanilha, 10);
  assert.equal(linhaRevisao?.ajusteEstoque, 10);
  assert.equal(linhaRevisao?.estoqueAposImportacao, 10);
  assert.match(linhaRevisao?.observacao ?? "", /Ajuste: \+10/);
});

test("ajuste de estoque: 5 → 10 = +5", () => {
  const previa = classificarEstoque({ planilha: "10", sistema: 5 });
  const linhaRevisao = previa.linhas[0];
  assert.equal(linhaRevisao?.existenteId, "p1");
  assert.equal(linhaRevisao?.estoqueAtualSistema, 5);
  assert.equal(linhaRevisao?.estoquePlanilha, 10);
  assert.equal(linhaRevisao?.ajusteEstoque, 5);
  assert.equal(linhaRevisao?.estoqueAposImportacao, 10);
  assert.equal(linhaRevisao?.quantidadeEstoque, 10);
});

test("ajuste de estoque: 10 → 4 = -6", () => {
  const previa = classificarEstoque({ planilha: "4", sistema: 10 });
  const linhaRevisao = previa.linhas[0];
  assert.equal(linhaRevisao?.ajusteEstoque, -6);
  assert.equal(linhaRevisao?.estoqueAposImportacao, 4);
  assert.equal(formatarAjusteEstoque(-6), "-6");
  assert.match(linhaRevisao?.observacao ?? "", /Ajuste: -6/);
});

test("ajuste de estoque: 10 → 10 = nenhum ajuste", () => {
  const previa = classificarEstoque({ planilha: "10", sistema: 10 });
  const linhaRevisao = previa.linhas[0];
  assert.equal(linhaRevisao?.ajusteEstoque, 0);
  assert.equal(linhaRevisao?.estoqueAposImportacao, 10);
  assert.equal(linhaRevisao?.ignorarEstoque, false);
});

test("Estoque atual não marcado deixa o estoque inalterado", () => {
  const previa = classificarLinhasProdutos({
    empresaId: empresaA,
    config: configProdutos({
      camposProduto: ["codigo", "nome", "preco_venda"],
      mapeamento: { codigo: "Código", nome: "Produto", preco_venda: "Venda" },
    }),
    linhas: [
      linha(2, { Código: "10", Produto: "Fone", Venda: "9", Qtd: "99" }),
    ],
    produtos: [
      {
        id: "p1",
        empresa_id: empresaA,
        codigo: "10",
        codigo_barras: null,
        nome: "Fone",
        quantidade_atual: 7,
      },
    ],
    categorias: [],
    marcas: [],
  });

  assert.equal(previa.linhas[0]?.ignorarEstoque, true);
  assert.equal(previa.linhas[0]?.quantidadeEstoque, null);
  assert.equal(previa.linhas[0]?.ajusteEstoque ?? null, null);
});

test("estoque inválido segue a regra escolhida pelo usuário", () => {
  const erro = classificarEstoque({
    planilha: "F",
    sistema: 5,
    quantidadeInvalida: "erro",
  });
  assert.equal(erro.linhas[0]?.situacao, "erro");

  const zero = classificarEstoque({
    planilha: "SEM ESTOQUE",
    sistema: 5,
    quantidadeInvalida: "zero",
  });
  assert.equal(zero.linhas[0]?.estoquePlanilha, 0);
  assert.equal(zero.linhas[0]?.ajusteEstoque, -5);
  assert.equal(zero.linhas[0]?.estoqueAposImportacao, 0);

  const ignorar = classificarEstoque({
    planilha: "-",
    sistema: 5,
    quantidadeInvalida: "ignorar_estoque",
  });
  assert.equal(ignorar.linhas[0]?.ignorarEstoque, true);
  assert.equal(ignorar.linhas[0]?.quantidadeEstoque, null);
});

test("produto de outra empresa nunca pode ter estoque alterado", () => {
  const previa = classificarEstoque({
    planilha: "15",
    sistema: 99,
    empresaProduto: empresaB,
  });
  const linhaRevisao = previa.linhas[0];
  assert.equal(linhaRevisao?.existenteId, null);
  assert.equal(linhaRevisao?.situacao, "criar");
  assert.equal(linhaRevisao?.estoqueAtualSistema, 0);
  assert.equal(linhaRevisao?.estoquePlanilha, 15);
  assert.equal(linhaRevisao?.ajusteEstoque, 15);
});

test("Estoque atual é campo de destino do importador de produtos", () => {
  const tipos = fonte("lib/importacao/tipos.ts");
  const bloco = tipos.slice(
    tipos.indexOf("export const CAMPOS_PRODUTO"),
    tipos.indexOf("export type CampoProduto")
  );
  assert.match(bloco, /"estoque_atual"/);
  assert.match(fonte("lib/importacao/tipos.ts"), /Estoque atual/);
  const executar = fonte("lib/importacao/executar.ts");
  assert.match(executar, /p_operacao: "AJUSTE"/);
  assert.match(executar, /origem: "IMPORTACAO"/);
  assert.doesNotMatch(executar, /from\("estoque_atual"\)[\s\S]*\.update\(/);
});
