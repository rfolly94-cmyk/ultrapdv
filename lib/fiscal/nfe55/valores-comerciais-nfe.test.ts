import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  conferirSomaItensFiscaisComVenda,
  valorTotalNotaGeranet,
} from "@/lib/fiscal/distribuir-desconto-itens";
import { calcularTotaisItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import {
  estoqueImpedeItemNfe,
  mesclarSnapshotItemComercial,
  totalItemNfe,
} from "@/lib/fiscal/nfe55/item-comercial";
import {
  compensarDiferencaSubtotalCatalogo,
  sincronizarPagamentoUnicoComTotal,
} from "@/lib/fiscal/nfe55/sincronizar-pagamentos";
import { totalLiquidoNota, type TotaisNotaNfe } from "@/lib/fiscal/nfe55/totais-nota";
import {
  aplicarPagamentosRascunhoNaEmissaoNfeVenda,
  aplicarPrecosComerciaisOperacaoNosItensVenda,
  precosComerciaisOperacaoCompativeis,
  totaisComerciaisNfeDosItens,
  totaisFiscaisEmissaoNfeVenda,
  totalFiscalEsperadoEmissaoNfeVenda,
  trocoEmissaoNfeVenda,
} from "@/lib/fiscal/nfe55/valores-comerciais-nfe";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
const emitirOperacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
const editor = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
const atualizar = actions.slice(
  actions.indexOf("export async function atualizarItemOperacaoFiscal"),
  actions.indexOf("export async function removerItemOperacaoFiscal")
);

const TOTAIS_ZERO: TotaisNotaNfe = {
  frete: 0,
  seguro: 0,
  outro: 0,
  desconto: 0,
};

function xmlNfeVendaOperacao(input: {
  qCom: number;
  vUnCom: number;
  precoCatalogo: number;
  totais?: TotaisNotaNfe;
  acrescimoPdv?: number;
  descontoPdv?: number;
}) {
  const totaisNota = input.totais ?? TOTAIS_ZERO;
  const itensVenda = [
    {
      produto_id: "prod-1",
      quantidade: input.qCom,
      valor_unitario: input.precoCatalogo,
    },
  ];
  const itensOperacao = [
    {
      produto_id: "prod-1",
      quantidade: input.qCom,
      valor_unitario: input.vUnCom,
    },
  ];
  assert.equal(
    precosComerciaisOperacaoCompativeis(itensVenda, itensOperacao),
    true
  );
  const overlay = aplicarPrecosComerciaisOperacaoNosItensVenda(
    itensVenda,
    itensOperacao
  );
  const totais = totaisFiscaisEmissaoNfeVenda({
    origemOperacaoFiscal: true,
    snapshotOperacao: { totais_nota: totaisNota },
    venda: {
      acrescimo: input.acrescimoPdv ?? 0,
      desconto: input.descontoPdv ?? 0,
      frete: 0,
    },
  });
  const qCom = Number(overlay[0]?.quantidade);
  const vUnCom = Number(overlay[0]?.valor_unitario);
  const item = calcularTotaisItemGeranet({
    quantidade: qCom,
    valorUnitario: vUnCom,
    desconto: totais.desconto,
    frete: totais.frete,
    seguro: totais.seguro,
    outro: totais.outro,
  });
  const comerciais = totaisComerciaisNfeDosItens({
    itens: [{ quantidade: qCom, valorUnitario: vUnCom }],
    totais,
  });
  const vNF = Number(
    valorTotalNotaGeranet([
      {
        quantidade: qCom,
        valorUnitario: vUnCom,
        desconto: item.desconto,
        frete: item.frete,
        seguro: item.seguro,
        outro: item.outro,
      },
    ])
  );
  assert.equal(vNF, item.valorLiquidoFiscal);
  assert.equal(vNF, comerciais.vNF);
  const vPag = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: Math.round(vNF * 100),
    pagamentos: [{ formaPagamentoId: "pix-1", valorCentavos: 1 }],
    permiteTrocoPorFormaId: { "pix-1": false },
  }).pagamentos[0]?.valorCentavos;
  return {
    qCom,
    vUnCom,
    vProd: item.valorBrutoItem,
    vDesc: item.desconto,
    vFrete: item.frete,
    vSeg: item.seguro,
    vOutro: item.outro,
    vNF,
    vPag: (vPag ?? 0) / 100,
    comerciais,
    totais,
    overlay,
  };
}

test("regressão XML real: qCom 5 vUnCom 70 não gera vOutro 175 nem vNF 525", () => {
  const catalogo = 35;
  const qCom = 5;
  const vUnCom = 70;
  const compensacao = compensarDiferencaSubtotalCatalogo({
    subtotalCatalogoCentavos: qCom * catalogo * 100,
    subtotalAlvoCentavos: qCom * vUnCom * 100,
    descontoCentavos: 0,
    acrescimoCentavos: 0,
  });
  assert.equal(compensacao.acrescimoCentavos, 17500);
  assert.equal(qCom * (vUnCom - catalogo), 175);

  const xml = xmlNfeVendaOperacao({
    qCom,
    vUnCom,
    precoCatalogo: catalogo,
    acrescimoPdv: compensacao.acrescimoCentavos / 100,
  });

  assert.equal(xml.qCom, 5);
  assert.equal(xml.vUnCom, 70);
  assert.equal(xml.vProd, 350);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 350);
  assert.equal(xml.vPag, 350);
  assert.notEqual(xml.vOutro, 175);
  assert.notEqual(xml.vNF, 525);
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: [
        {
          quantidade: 5,
          valorUnitario: 70,
          outro: xml.vOutro,
        },
      ],
      valorTotalVenda: xml.vNF,
    }),
    null
  );
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: [
        {
          quantidade: 5,
          valorUnitario: 70,
          outro: 175,
        },
      ],
      valorTotalVenda: 350,
    }) !== null,
    true
  );
});

test("mudar somente quantidade usa qCom editado e vOutro zero", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 35,
    precoCatalogo: 35,
    acrescimoPdv: 0,
  });
  assert.equal(xml.qCom, 5);
  assert.equal(xml.vUnCom, 35);
  assert.equal(xml.vProd, 175);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 175);
});

test("mudar somente preço usa vUnCom editado e vOutro zero", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 1,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 35,
  });
  assert.equal(xml.qCom, 1);
  assert.equal(xml.vUnCom, 70);
  assert.equal(xml.vProd, 70);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 70);
});

test("mudar quantidade e preço substitui valores comerciais", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 175,
  });
  assert.equal(totalItemNfe(xml.qCom, xml.vUnCom), 350);
  assert.equal(xml.vProd, 350);
  assert.equal(xml.vOutro, 0);
});

test("preço maior que o cadastro não vira acréscimo fiscal", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 2,
    vUnCom: 100,
    precoCatalogo: 40,
    acrescimoPdv: 120,
  });
  assert.equal(xml.vProd, 200);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 200);
});

test("preço menor que o cadastro não vira desconto fiscal", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 20,
    precoCatalogo: 35,
    descontoPdv: 75,
  });
  assert.equal(xml.vProd, 100);
  assert.equal(xml.vDesc, 0);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 100);
  assert.equal(
    totaisFiscaisEmissaoNfeVenda({
      origemOperacaoFiscal: true,
      snapshotOperacao: { totais_nota: TOTAIS_ZERO },
      venda: { acrescimo: 0, desconto: 75, frete: 0 },
    }).desconto,
    0
  );
});

test("estoque zero, negativo ou abaixo da quantidade não altera comercial", () => {
  assert.equal(estoqueImpedeItemNfe(0, 5), false);
  assert.equal(estoqueImpedeItemNfe(-8, 5), false);
  assert.equal(estoqueImpedeItemNfe(1, 5), false);
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 175,
  });
  assert.equal(xml.vProd, 350);
  assert.equal(xml.vOutro, 0);
});

test("desconto explícito vai para vDesc e não para vOutro", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 175,
    totais: { frete: 0, seguro: 0, outro: 0, desconto: 10 },
  });
  assert.equal(xml.vProd, 350);
  assert.equal(xml.vDesc, 10);
  assert.equal(xml.vOutro, 0);
  assert.equal(xml.vNF, 340);
});

test("outras despesas explícitas vão para vOutro", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 195,
    totais: { frete: 0, seguro: 0, outro: 20, desconto: 0 },
  });
  assert.equal(xml.vProd, 350);
  assert.equal(xml.vOutro, 20);
  assert.equal(xml.vNF, 370);
});

test("nenhuma outra despesa informada → vOutro zero", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 175,
  });
  assert.equal(xml.totais.outro, 0);
  assert.equal(xml.vOutro, 0);
});

test("pagamento único acompanha o total fiscal correto", () => {
  const xml = xmlNfeVendaOperacao({
    qCom: 5,
    vUnCom: 70,
    precoCatalogo: 35,
    acrescimoPdv: 175,
  });
  assert.equal(xml.vPag, 350);
  assert.equal(xml.vPag, xml.vNF);
  assert.match(editor, /sincronizarPagamentoUnicoComTotal/);
  assert.match(editor, /totalLiquidoNota\(totalProdutos, totaisNota\)/);
});

test("preço cadastrado do produto permanece inalterado", () => {
  assert.doesNotMatch(atualizar, /preco_venda:/);
  assert.doesNotMatch(atualizar, /from\("produtos"\)\s*\.update/);
});

test("snapshot guarda quantidade, preço e total efetivos", () => {
  const snapshot = mesclarSnapshotItemComercial(
    { ncm: "85177099" },
    { quantidade: 5, valor_unitario: 70, valor_total: 350 }
  );
  assert.equal(snapshot.quantidade, 5);
  assert.equal(snapshot.valor_unitario, 70);
  assert.equal(snapshot.valor_total, 350);
  assert.match(atualizar, /mesclarSnapshotItemComercial/);
});

test("UI não preenche Outras Despesas ao editar quantidade ou preço", () => {
  assert.match(editor, /onAlterarLocal=\{\(quantidade, valorUnitario\) =>/);
  assert.match(editor, /setAjusteItens/);
  assert.doesNotMatch(
    editor.slice(
      editor.indexOf("onAlterarLocal={(quantidade, valorUnitario)"),
      editor.indexOf("onAtualizar={(quantidade, valorUnitario)")
    ),
    /setTotaisTexto|outro:/
  );
  assert.match(
    editor,
    /setTotaisTexto\(\(atual\) => \(\{ \.\.\.atual, outro: event\.target\.value \}\)\)/
  );
});

test("vNF = vProd - vDesc + vFrete + vSeg + vOutro", () => {
  assert.equal(
    totalLiquidoNota(350, { desconto: 0, frete: 0, seguro: 0, outro: 0 }),
    350
  );
  assert.equal(
    totalLiquidoNota(350, { desconto: 10, frete: 20, seguro: 0, outro: 5 }),
    365
  );
});

test("emissão da operação fiscal nunca usa vendas.acrescimo como vOutro", () => {
  const totais = totaisFiscaisEmissaoNfeVenda({
    origemOperacaoFiscal: true,
    snapshotOperacao: {
      totais_nota: { frete: 0, seguro: 0, outro: 0, desconto: 0 },
    },
    venda: { acrescimo: 175, desconto: 0, frete: 0 },
  });
  assert.equal(totais.outro, 0);
  assert.match(emitirVenda, /totaisFiscaisEmissaoNfeVenda/);
  assert.match(emitirVenda, /aplicarPrecosComerciaisOperacaoNosItensVenda/);
  assert.match(emitirVenda, /totalFiscalEsperadoEmissaoNfeVenda/);
  assert.doesNotMatch(emitirVenda, /temTotaisSnapshot/);
  assert.doesNotMatch(emitirVenda, /numero\(venda\.acrescimo\)/);
  assert.match(emitirOperacao, /totaisNotaDoSnapshot/);
  assert.doesNotMatch(emitirOperacao, /venda\.acrescimo/);
});

test("venda originada no PDV preserva acréscimo comercial como vOutro", () => {
  const totais = totaisFiscaisEmissaoNfeVenda({
    origemOperacaoFiscal: false,
    snapshotOperacao: null,
    venda: { acrescimo: 12.5, desconto: 1, frete: 3 },
  });
  assert.equal(totais.outro, 12.5);
  assert.equal(totais.desconto, 1);
  assert.equal(totais.frete, 3);
  assert.equal(totais.seguro, 0);
});

test("conferência da operação usa total fiscal, não valor_total compensado", () => {
  assert.equal(
    totalFiscalEsperadoEmissaoNfeVenda({
      origemOperacaoFiscal: true,
      itens: [{ quantidade: 5, valorUnitario: 70 }],
      totais: TOTAIS_ZERO,
      valorTotalVenda: 525,
    }),
    350
  );
  assert.equal(
    totalFiscalEsperadoEmissaoNfeVenda({
      origemOperacaoFiscal: false,
      itens: [{ quantidade: 5, valorUnitario: 70 }],
      totais: TOTAIS_ZERO,
      valorTotalVenda: 525,
    }),
    525
  );
});

test("overlay recusa itens incompatíveis em vez de misturar cadastro", () => {
  const itensVenda = [
    { produto_id: "a", quantidade: 1, valor_unitario: 35, extra: true },
  ];
  const incompatível = aplicarPrecosComerciaisOperacaoNosItensVenda(itensVenda, [
    { produto_id: "b", quantidade: 5, valor_unitario: 70 },
  ]);
  assert.equal(incompatível[0]?.valor_unitario, 35);
  assert.equal(
    precosComerciaisOperacaoCompativeis(itensVenda, [
      { produto_id: "b", quantidade: 5, valor_unitario: 70 },
    ]),
    false
  );
});

test("pagamento corrigido no snapshot substitui vendas_pagamentos na nova tentativa", () => {
  const formaId = "11111111-1111-4111-8111-111111111111";
  const overlay = aplicarPagamentosRascunhoNaEmissaoNfeVenda({
    origemOperacaoFiscal: true,
    pagamentosVenda: [
      {
        id: "pg-antigo",
        forma_pagamento_codigo: "DINHEIRO",
        codigo_fiscal: "01",
        indicador_pagamento: "0",
        valor: 300,
        status: "confirmado",
      },
    ],
    pagamentosRascunho: [{ formaPagamentoId: formaId, valorCentavos: 34000 }],
    formas: [
      {
        id: formaId,
        codigo: "DINHEIRO",
        nome: "Dinheiro",
        codigo_fiscal: "01",
        permite_parcelamento: false,
      },
    ],
  });
  assert.equal(overlay.ok, true);
  if (!overlay.ok) {
    return;
  }
  assert.equal(overlay.overlay, true);
  assert.equal(Number(overlay.pagamentos[0]?.valor), 340);
  const fiadoId = "22222222-2222-4222-8222-222222222222";
  const overlayFiado = aplicarPagamentosRascunhoNaEmissaoNfeVenda({
    origemOperacaoFiscal: true,
    pagamentosVenda: [
      {
        id: "pg-fiado",
        forma_pagamento_codigo: "FIADO",
        codigo_fiscal: "05",
        indicador_pagamento: "0",
        valor: 340,
        status: "confirmado",
      },
    ],
    pagamentosRascunho: [{ formaPagamentoId: fiadoId, valorCentavos: 34000 }],
    formas: [
      {
        id: fiadoId,
        codigo: "FIADO",
        nome: "Fiado",
        codigo_fiscal: "05",
        permite_parcelamento: false,
        permite_fiado: true,
      },
    ],
  });
  assert.equal(overlayFiado.ok, true);
  if (overlayFiado.ok) {
    assert.equal(overlayFiado.pagamentos[0]?.indicador_pagamento, "1");
  }
  assert.equal(
    trocoEmissaoNfeVenda({
      origemOperacaoFiscal: true,
      overlayPagamentos: true,
      somaPagamentos: 340,
      totalFiscal: 340,
      trocoVenda: 10,
    }),
    0
  );
  const semRascunho = aplicarPagamentosRascunhoNaEmissaoNfeVenda({
    origemOperacaoFiscal: true,
    pagamentosVenda: [{ valor: 300, status: "confirmado" }],
    pagamentosRascunho: [],
    formas: [],
  });
  assert.equal(semRascunho.ok, true);
  if (semRascunho.ok) {
    assert.equal(semRascunho.overlay, false);
    assert.equal(Number(semRascunho.pagamentos[0]?.valor), 300);
  }
  assert.match(emitirVenda, /aplicarPagamentosRascunhoNaEmissaoNfeVenda/);
  assert.match(emitirVenda, /pagamentosRascunhoDoSnapshot/);
  assert.match(emitirVenda, /totalParaConferencia/);
  assert.doesNotMatch(
    fonte("app/fiscal/nfe/operacoes-actions.ts"),
    /A venda comercial já foi finalizada\./
  );
  assert.match(
    fonte("components/fiscal/nfe55/nfe-emissao-form.tsx"),
    /const podeEditar = edicaoDocumento\.permitido && emitivel/
  );
  assert.match(
    fonte("components/fiscal/nfe55/nfe-emissao-form.tsx"),
    /NF-e não autorizada/
  );
  assert.match(
    fonte("lib/fiscal/emissao-tentativas.ts"),
    /rpc_iniciar_tentativa_emissao_fiscal/
  );
});
