import assert from "node:assert/strict";
import { test } from "node:test";

import { paraHex } from "@/lib/fiscal/documento-fiscal";
import { obterDocumentoFiscal } from "@/lib/fiscal/obter-documento-fiscal";

import { buscarDaEmpresaAtiva, recusarCruzado } from "./app-layer";
import {
  emissaoA,
  emissaoB,
  empresaA,
  empresaB,
  usuarioA,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls } from "./rls-memoria";

const pdfHex = paraHex(Buffer.from("%PDF-1.4 recuperado"));

function xmlHex(marca: string) {
  return paraHex(
    Buffer.from(
      `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="${marca}"></infNFe></NFe></nfeProc>`,
      "utf8"
    )
  );
}

function linhaEmissao(empresaId: string, emissaoId: string, marcaXml: string) {
  return {
    id: emissaoId,
    empresa_id: empresaId,
    modelo: "55",
    serie: 1,
    numero: 10,
    ambiente: 2,
    status: "autorizada",
    xml_hex: xmlHex(marcaXml),
    pdf_hex: pdfHex,
  };
}

const emissoes = [
  linhaEmissao(empresaA, emissaoA, "NFeA"),
  linhaEmissao(empresaB, emissaoB, "NFeEMPRESAB"),
];

function adminEmissao(
  registros: typeof emissoes,
  onConsulta?: (filtros: Record<string, string>) => Promise<void> | void
) {
  return {
    from(tabela: string) {
      const filtros: Record<string, string> = {};
      const cadeia = {
        select() {
          return cadeia;
        },
        eq(coluna: string, valor: string) {
          filtros[coluna] = String(valor);
          return cadeia;
        },
        async maybeSingle() {
          await onConsulta?.(filtros);
          if (tabela !== "fiscal_emissoes") {
            return { data: null, error: null };
          }
          const data =
            registros.find(
              (registro) =>
                registro.id === filtros.id &&
                registro.empresa_id === filtros.empresa_id
            ) ?? null;
          return { data, error: null };
        },
      };
      return cadeia;
    },
  };
}

test("fiscal: A não lê emissão B pelo UUID", () => {
  assert.equal(buscarPorIdComRls(emissoes, usuarioA, vinculosPadrao, emissaoB), null);
  assert.equal(buscarDaEmpresaAtiva(emissoes, empresaA, emissaoB), null);
  assert.equal(
    recusarCruzado(buscarDaEmpresaAtiva(emissoes, empresaA, emissaoB), empresaA).status,
    404
  );
});

test("fiscal: consulta interna de documento filtra id + empresa_id", async () => {
  const admin = adminEmissao(emissoes);
  await assert.rejects(
    () =>
      obterDocumentoFiscal({
        admin: admin as never,
        empresaId: empresaA,
        emissaoId: emissaoB,
        tipo: "xml",
      }),
    /Emissão fiscal não encontrada/
  );
});

test("fiscal: A lê XML da própria emissão sem Geranet", async () => {
  const admin = adminEmissao(emissoes);
  const resultado = await obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoA,
    tipo: "xml",
  });
  assert.equal(resultado.fonte, "local");
  assert.equal(resultado.geranetChamado, false);
});

test("inflight: chave inclui empresaId, emissaoId e tipo", () => {
  const helper = fonte("lib/fiscal/obter-documento-fiscal.ts");
  assert.match(
    helper,
    /function chaveInflight\(\s*empresaId: string,\s*emissaoId: string,\s*tipo: TipoDocumentoFiscal/
  );
  assert.match(
    helper,
    /return `\$\{empresaId\}:\$\{emissaoId\}:\$\{tipo\}`/
  );
  assert.match(helper, /inflight\.get\(chave\)/);
  assert.match(helper, /inflight\.set\(chave, trabalho\)/);
  assert.match(helper, /inflight\.delete\(chave\)/);
});

test("inflight: A e B com o mesmo emissaoId não compartilham Promise nem XML", async () => {
  const emissaoX = "e9999999-9999-4999-8999-999999999999";
  const registros = [
    linhaEmissao(empresaA, emissaoX, "NFeEMPRESAA"),
    linhaEmissao(empresaB, emissaoX, "NFeEMPRESAB"),
  ];

  let liberarB!: () => void;
  const holdB = new Promise<void>((resolve) => {
    liberarB = resolve;
  });
  let consultasA = 0;
  let consultasB = 0;

  const adminB = adminEmissao(registros, async (filtros) => {
    if (filtros.empresa_id === empresaB) {
      consultasB += 1;
      await holdB;
    }
  });
  const adminA = adminEmissao(registros, (filtros) => {
    if (filtros.empresa_id === empresaA) {
      consultasA += 1;
    }
  });

  const pedidoB = obterDocumentoFiscal({
    admin: adminB as never,
    empresaId: empresaB,
    emissaoId: emissaoX,
    tipo: "xml",
  });

  const pedidoA = obterDocumentoFiscal({
    admin: adminA as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });

  assert.notEqual(pedidoA, pedidoB);
  liberarB();
  const [docB, docA] = await Promise.all([pedidoB, pedidoA]);

  assert.equal(consultasA, 1);
  assert.equal(consultasB, 1);
  assert.match(docA.buffer.toString("utf8"), /NFeEMPRESAA/);
  assert.match(docB.buffer.toString("utf8"), /NFeEMPRESAB/);
  assert.equal(docA.buffer.equals(docB.buffer), false);
});

test("inflight: duas chamadas simultâneas da Empresa A compartilham a Promise", async () => {
  const emissaoX = "e8888888-8888-4888-8888-888888888888";
  const registros = [linhaEmissao(empresaA, emissaoX, "NFeEMPRESAA")];

  let liberar!: () => void;
  const hold = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  let consultas = 0;

  const admin = adminEmissao(registros, async () => {
    consultas += 1;
    await hold;
  });

  const primeira = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });
  const segunda = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });

  assert.equal(primeira, segunda);
  liberar();
  const [doc1, doc2] = await Promise.all([primeira, segunda]);
  assert.equal(consultas, 1);
  assert.equal(doc1.buffer.equals(doc2.buffer), true);
  assert.match(doc1.buffer.toString("utf8"), /NFeEMPRESAA/);
});

test("inflight: XML e PDF da mesma emissão não compartilham Promise", async () => {
  const emissaoX = "e7777777-7777-4777-8777-777777777777";
  const registros = [linhaEmissao(empresaA, emissaoX, "NFeEMPRESAA")];

  let consultas = 0;
  const admin = adminEmissao(registros, () => {
    consultas += 1;
  });

  const xml = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });
  const pdf = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "pdf",
  });

  assert.notEqual(xml, pdf);
  const [docXml, docPdf] = await Promise.all([xml, pdf]);
  assert.equal(consultas, 2);
  assert.equal(docXml.tipo, "xml");
  assert.equal(docPdf.tipo, "pdf");
});

test("inflight: sucesso remove a entrada e a próxima chamada consulta de novo", async () => {
  const emissaoX = "e6666666-6666-4666-8666-666666666666";
  const registros = [linhaEmissao(empresaA, emissaoX, "NFeEMPRESAA")];
  let consultas = 0;
  const admin = adminEmissao(registros, () => {
    consultas += 1;
  });

  const primeira = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });
  const primeiro = await primeira;

  const segunda = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoX,
    tipo: "xml",
  });

  assert.notEqual(segunda, primeira);
  const segundo = await segunda;
  assert.equal(consultas, 2);
  assert.equal(primeiro.buffer.equals(segundo.buffer), true);
});

test("inflight: falha não deixa Promise rejeitada presa no Map", async () => {
  const emissaoInexistente = "e5555555-5555-4555-8555-555555555555";
  let consultas = 0;
  const admin = adminEmissao(emissoes, () => {
    consultas += 1;
  });

  const primeira = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoInexistente,
    tipo: "xml",
  });

  await assert.rejects(() => primeira, /Emissão fiscal não encontrada/);

  const segunda = obterDocumentoFiscal({
    admin: admin as never,
    empresaId: empresaA,
    emissaoId: emissaoInexistente,
    tipo: "xml",
  });

  assert.notEqual(segunda, primeira);
  await assert.rejects(() => segunda, /Emissão fiscal não encontrada/);
  assert.equal(consultas, 2);
});

test("numeração: UNIQUE é (empresa_id, modelo, ambiente, serie)", () => {
  assert.match(
    fonte("supabase/migrations/20260814165000_fiscal_numeracao_por_ambiente.sql"),
    /fiscal_numeracoes_empresa_modelo_ambiente_serie_uidx/
  );
  assert.match(
    fonte("supabase/migrations/20260814165000_fiscal_numeracao_por_ambiente.sql"),
    /empresa_id,[\s\S]+modelo,[\s\S]+ambiente,[\s\S]+serie/
  );
});

test("numeração: A e B podem ter modelo 55 / ambiente 2 / série 1 / número 10", () => {
  const chaves = emissoes.map(
    (emissao) =>
      `${emissao.empresa_id}:${emissao.modelo}:${emissao.ambiente}:${emissao.serie}`
  );
  assert.equal(new Set(chaves).size, 2);
  assert.equal(emissoes[0].numero, emissoes[1].numero);
});

test("configuração fiscal e certificado: leitura filtra empresa_id da sessão", () => {
  const arquivo = fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts");
  assert.match(arquivo, /\.eq\("empresa_id", vinculo\.empresa_id\)/);
  assert.match(arquivo, /\.eq\("id", id\)/);
});

test("Geranet: emissão resolve empresa da sessão antes do provider", () => {
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirOperacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  assert.match(emitirVenda, /vinculo\.empresa_id/);
  assert.match(emitirOperacao, /const empresaId = String\(vinculo\.empresa_id\)/);
  assert.match(emitirOperacao, /Operação não encontrada nesta empresa/);
});

test("tentativas fiscais: SELECT autenticado só da empresa com acesso; escrita service_role", () => {
  const migracao = fonte(
    "supabase/migrations/20260818200000_fiscal_emissao_tentativas.sql"
  );
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /foreign key \(emissao_id, empresa_id\)/);
  assert.match(migracao, /grant execute[\s\S]*rpc_iniciar_tentativa_emissao_fiscal[\s\S]*to service_role/);
});

test("naturezas: trigger impede CFOP/regra de outra empresa", () => {
  const trigger = fonte(
    "supabase/migrations/20260817210000_fiscal_naturezas_mesma_empresa.sql"
  );
  assert.match(trigger, /fiscal_assert_cfop_regra_mesma_empresa/);
  assert.match(trigger, /fiscal_assert_emissao_natureza_mesma_empresa/);
});

test("entradas: A não visualiza nem devolve B", () => {
  const entradas = fonte("app/fiscal/entradas/actions.ts");
  const devolucao = fonte("app/fiscal/entradas/devolucao-actions.ts");
  assert.match(entradas, /empresa_id/);
  assert.match(devolucao, /empresa_id/);
});

test("TESTE E: empresa B não atualiza snapshot de NF-e da empresa A", () => {
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const cabecalho = actions.slice(
    actions.indexOf("export async function salvarCabecalhoFiscalOperacao"),
    actions.indexOf("export async function adicionarItemOperacaoFiscal")
  );
  assert.match(cabecalho, /getContexto/);
  assert.match(cabecalho, /eq\("id", input.operacaoId\)/);
  assert.match(cabecalho, /eq\("empresa_id", empresaId\)/);
  assert.match(cabecalho, /registroPertenceAEmpresaAtiva\(operacao, empresaId\)/);
  assert.match(cabecalho, /from\("fiscal_numeracoes"\)/);
  assert.match(cabecalho, /eq\("modelo", "55"\)/);
  assert.match(actions, /eq\("principal", true\)/);
  assert.match(actions, /eq\("ativo", true\)/);
  assert.doesNotMatch(cabecalho, /from\("vendas"\)/);
});
