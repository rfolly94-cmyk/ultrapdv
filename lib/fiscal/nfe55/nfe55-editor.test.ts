import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR,
  montarDocumentosReferenciados,
  notaFiscalReferenciaGeranet,
  textoAutomaticoDocumentosReferenciados,
} from "./documentos-referenciados";
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
} from "./infos-adicionais";
import { mapearTransporteParaGeranet, transporteNfeParaPayloadGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { resolverGrupoVeiculoNfe } from "@/lib/fiscal/transporte/resolver-veiculo-nfe";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const chave100 = "35240111222333000155550010000001001000000001";
const chave120 = "35240111222333000155550010000001201000000002";
const chave150 = "35240111222333000155550010000001501000000003";

test("A. uma NF-e de origem vira referência única", () => {
  const refs = montarDocumentosReferenciados([
    { chave: chave100, numero: "100", numeroItem: 1 },
    { chave: chave100, numero: "100", numeroItem: 2 },
  ]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.chave, chave100);
  assert.equal(notaFiscalReferenciaGeranet(refs), chave100);
});

test("B. duas entradas do mesmo fornecedor geram duas chaves, sem repetir", () => {
  const refs = montarDocumentosReferenciados([
    { chave: chave100, numero: "100" },
    { chave: chave120, numero: "120" },
    { chave: chave100, numero: "100" },
  ]);
  assert.deepEqual(
    refs.map((item) => item.chave),
    [chave100, chave120]
  );
  assert.match(
    textoAutomaticoDocumentosReferenciados(refs),
    /100/
  );
  assert.match(
    textoAutomaticoDocumentosReferenciados(refs),
    /120/
  );
});

test("C. mensagem de outro fornecedor é a do spec", () => {
  assert.equal(
    MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR,
    "Não é possível adicionar itens de outro fornecedor nesta devolução. Crie uma devolução separada para esse fornecedor."
  );
});

test("F. modalidade 9 não envia transportadora nem volumes à Geranet", () => {
  const mapeado = mapearTransporteParaGeranet({
    mod_frete: "9",
    transportador: {
      nome_razao_social: "Trans ABC",
      cpf_cnpj: "11222333000155",
    },
    volumes: [{ quantidade: 1, especie: "CX" }],
  });
  assert.equal(mapeado.modFrete, "9");
  assert.equal(mapeado.transportador, null);
  assert.equal(mapeado.volumes.length, 0);
  assert.equal(mapeado.veiculo.transmitirGeranet, false);
});

test("G/H. transportadora e volumes usam nomes Geranet existentes", () => {
  const mapeado = mapearTransporteParaGeranet({
    mod_frete: "0",
    transportador: {
      nome_razao_social: "Trans ABC",
      cpf_cnpj: "11.222.333/0001-55",
      inscricao_estadual: "123",
      endereco: "Rua A, 10",
      municipio: "Cuiaba",
      uf: "mt",
    },
    veiculo: { rntc: "123456", placa: "abc1d23", uf: "mt" },
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
  });
  assert.equal(mapeado.transportador?.cnpj, "11222333000155");
  assert.equal(mapeado.transportador?.cpf, undefined);
  assert.equal(mapeado.transportador?.razaoSocial, "Trans ABC");
  assert.equal(mapeado.transportador?.inscricaoEstadual, "123");
  assert.equal(mapeado.transportador?.endereco, "Rua A, 10");
  assert.equal(mapeado.transportador?.municipio, "Cuiaba");
  assert.equal(mapeado.transportador?.uf, "MT");
  assert.equal(mapeado.volumes[0]?.quantidade, 2);
  assert.equal(mapeado.volumes[0]?.descricao, "CAIXA");
  assert.equal(mapeado.volumes[0]?.marca, "Ultra");
  assert.equal(mapeado.volumes[0]?.pesoBruto, 10);
  assert.equal(mapeado.volumes[0]?.pesoLiquido, 8);
  assert.equal("numeracao" in (mapeado.volumes[0] ?? {}), false);
  assert.equal("rntc" in (transporteNfeParaPayloadGeranet({
    mod_frete: "0",
    transportador: { nome_razao_social: "Trans ABC" },
    veiculo: { rntc: "123456", placa: "abc1d23", uf: "mt" },
  }) ?? {}), false);
  assert.equal(mapeado.veiculo.placa, "ABC1D23");
  assert.equal(mapeado.veiculo.transmitirGeranet, false);
});

test("G2. CPF de 11 dígitos vai para nfe.transportador.cpf", () => {
  const mapeado = mapearTransporteParaGeranet({
    mod_frete: "1",
    transportador: {
      nome_razao_social: "Joao Transportes",
      cpf_cnpj: "123.456.789-01",
    },
  });
  assert.equal(mapeado.transportador?.cpf, "12345678901");
  assert.equal(mapeado.transportador?.cnpj, undefined);
});

test("G3. sem dados preenchidos não envia transportador nem volumes", () => {
  assert.equal(
    transporteNfeParaPayloadGeranet({
      mod_frete: "0",
      transportador: { nome_razao_social: "  " },
      volumes: [{ numeracao: "1-2" }],
    }),
    null
  );
  assert.equal(
    transporteNfeParaPayloadGeranet({
      mod_frete: "9",
      transportador: { nome_razao_social: "Trans ABC" },
      volumes: [{ quantidade: 1, especie: "CX" }],
    }),
    null
  );
});

test("I. informação do usuário não substitui texto automático", () => {
  const texto = montarInformacaoComplementarNfe({
    textosAutomaticos: [
      textoAutomaticoDocumentosReferenciados([
        { chave: chave100, numero: "100" },
        { chave: chave150, numero: "150" },
      ]),
    ],
    padraoEmpresa: "Empresa padrao.",
    textoUsuario: "Devolucao combinada.",
  });
  assert.match(texto, /35240111222333000155550010000001001000000001/);
  assert.match(texto, /Empresa padrao/);
  assert.match(texto, /Devolucao combinada/);
  assert.equal(
    montarInformacaoAdicionalFisco({ textoUsuario: "Fisco" }),
    "Fisco"
  );
});

test("veículo: grupo não é transmitido ao Geranet", () => {
  assert.equal(resolverGrupoVeiculoNfe({ modFrete: "9" }).coletar, false);
  assert.equal(resolverGrupoVeiculoNfe({ modFrete: "0" }).coletar, true);
  assert.equal(
    resolverGrupoVeiculoNfe({ modFrete: "0" }).transmitirGeranet,
    false
  );
  const emitirOperacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  assert.match(emitirOperacao, /transporteNfeParaPayloadGeranet/);
  assert.match(emitirVenda, /transporteNfeParaPayloadGeranet/);
  assert.doesNotMatch(emitirOperacao, /rntc:|placa:/);
  assert.doesNotMatch(emitirVenda, /veiculo:\s*\{/);
});
