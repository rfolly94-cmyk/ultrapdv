import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  MENSAGEM_FRETE_9_COM_DADOS,
  normalizarDadosTransporteVenda,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { resolverDadosTransporteNfe } from "@/lib/fiscal/transporte/resolver-transporte-nfe";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const preenchido = {
  mod_frete: "9" as const,
  transportador: {
    nome_razao_social: "Trans ABC",
    cpf_cnpj: "11222333000155",
    inscricao_estadual: "123",
    endereco: "Rua A, 10",
    municipio: "Cuiaba",
    uf: "MT",
  },
  veiculo: { rntc: "123456", placa: "ABC1D23", uf: "MT" },
  volumes: [
    {
      quantidade: 2,
      especie: "CAIXA",
      marca: "Ultra",
      numeracao: "1-2",
      peso_bruto_kg: 10,
      peso_liquido_kg: 8,
    },
  ],
};

test("normalizar com frete 9 preserva transportador, veículo e volumes", () => {
  const dados = normalizarDadosTransporteVenda(preenchido);
  assert.equal(dados.mod_frete, "9");
  assert.equal(dados.transportador?.nome_razao_social, "Trans ABC");
  assert.equal(dados.veiculo?.placa, "ABC1D23");
  assert.equal(dados.volumes?.[0]?.especie, "CAIXA");
  assert.equal(dados.volumes?.[0]?.marca, "Ultra");
  assert.equal(dados.volumes?.[0]?.numeracao, "1-2");
  assert.equal(dados.volumes?.[0]?.peso_bruto_kg, 10);
});

test("normalizar volumes persiste marca S/M e especie com trim", () => {
  const dados = normalizarDadosTransporteVenda({
    mod_frete: "1",
    volumes: [
      {
        quantidade: 1,
        especie: "  CAIXA  ",
        marca: "  S/M  ",
        peso_bruto_kg: 10,
        peso_liquido_kg: 8,
      },
    ],
  });
  assert.equal(dados.volumes?.[0]?.especie, "CAIXA");
  assert.equal(dados.volumes?.[0]?.marca, "S/M");
  assert.equal(dados.volumes?.[0]?.peso_bruto_kg, 10);
  assert.equal(dados.volumes?.[0]?.peso_liquido_kg, 8);
});

test("normalizar volumes usa descricao como especie quando especie vem vazia", () => {
  const dados = normalizarDadosTransporteVenda({
    volumes: [{ descricao: "VOLUME", marca: "ACME" }],
  });
  assert.equal(dados.volumes?.[0]?.especie, "VOLUME");
  assert.equal(dados.volumes?.[0]?.marca, "ACME");
});

test("persistência de volumes materializa marca e especie e mantém o form montado", () => {
  const normalizer = fonte("lib/fiscal/transporte/dados-transporte-venda.ts");
  const form = fonte("components/vendas/transporte-venda-form.tsx");
  const emissao = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const action = fonte("app/fiscal/nfe/operacoes-actions.ts");
  assert.match(normalizer, /especie: texto\(bruto\.especie\) \|\| texto\(bruto\.descricao\)/);
  assert.match(normalizer, /marca: texto\(bruto\.marca\)/);
  assert.match(form, /especie: texto\(volume\.especie\)/);
  assert.match(form, /marca: texto\(volume\.marca\)/);
  assert.match(emissao, /NfeRecolhivel titulo="Transporte" manterMontado/);
  assert.match(action, /normalizarDadosTransporteVenda/);
  assert.match(action, /\.eq\("empresa_id", empresaId\)/);
});

test("frete 9 sem detalhes não conflita", () => {
  assert.equal(
    transporteConflitaComFrete9({ mod_frete: "9", volumes: [{ especie: "" }] }),
    false
  );
});

test("frete 9 com detalhes preenchidos conflita com a mensagem oficial", () => {
  assert.equal(transporteConflitaComFrete9(preenchido), true);
  assert.equal(
    MENSAGEM_FRETE_9_COM_DADOS,
    "Há dados de transporte preenchidos, mas a modalidade está como Sem frete."
  );
});

test("resolução usa operação fiscal antes da venda", () => {
  const resolvido = resolverDadosTransporteNfe({
    dadosOperacao: { mod_frete: "0", transportador: { nome_razao_social: "Da operação" } },
    dadosVenda: { mod_frete: "1", transportador: { nome_razao_social: "Da venda" } },
  });
  assert.equal(resolvido.origem, "operacao");
  assert.equal(resolvido.dados.mod_frete, "0");
  assert.equal(resolvido.dados.transportador?.nome_razao_social, "Da operação");
});

test("resolução cai na venda quando a operação não tem transporte", () => {
  const resolvido = resolverDadosTransporteNfe({
    dadosVenda: { mod_frete: "1", transportador: { nome_razao_social: "Da venda" } },
  });
  assert.equal(resolvido.origem, "venda");
  assert.equal(resolvido.dados.mod_frete, "1");
});

test("carregar transporte da emissão filtra empresa_id e prioriza a operação", () => {
  const helper = fonte("lib/fiscal/transporte/resolver-transporte-nfe.ts");
  assert.match(helper, /\.eq\("empresa_id", empresaId\)/);
  assert.match(helper, /fiscal_operacoes/);
  assert.match(helper, /venda_id/);
  const venda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const operacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  assert.match(venda, /carregarTransporteNfe55/);
  assert.match(operacao, /carregarTransporteNfe55/);
  assert.match(venda, /transporteConflitaComFrete9/);
  assert.match(operacao, /transporteConflitaComFrete9/);
});

test("NF-e 55 envia nfe.frete e transportador/volumes persistidos", () => {
  const venda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const operacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  assert.match(venda, /transporteNfeParaPayloadGeranet/);
  assert.match(operacao, /transporteNfeParaPayloadGeranet/);
  assert.match(venda, /frete:\s*\n\s*modalidadeFrete/);
  assert.match(operacao, /frete: transporteResolvido\.dados\.mod_frete/);
  assert.doesNotMatch(venda, /transporte:\s*null/);
  assert.doesNotMatch(operacao, /transporte:\s*null/);
});

test("salvar e emitir bloqueiam frete 9 com dados preenchidos", () => {
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const form = fonte("components/vendas/transporte-venda-form.tsx");
  const vendaRota = fonte("app/api/vendas/[id]/transporte/route.ts");
  assert.match(actions, /MENSAGEM_FRETE_9_COM_DADOS/);
  assert.match(form, /MENSAGEM_FRETE_9_COM_DADOS/);
  assert.match(vendaRota, /MENSAGEM_FRETE_9_COM_DADOS/);
  assert.doesNotMatch(actions, /dados\.mod_frete === "9" \? null/);
  assert.doesNotMatch(vendaRota, /modFrete === "9"/);
});

test("emitir persiste o transporte sujo do formulário antes de transmitir", () => {
  const editor = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const form = fonte("components/vendas/transporte-venda-form.tsx");
  assert.match(form, /persistirSeNecessario/);
  assert.match(editor, /transporteRef/);
  assert.match(editor, /persistirSeNecessario/);
  const emitir = editor.slice(editor.indexOf("function emitir()"));
  assert.match(emitir, /persistirRascunho/);
});
