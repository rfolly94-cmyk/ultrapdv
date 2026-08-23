import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  linhasReciboRecebimentoCarteira,
  montarItensReciboRecebimento,
  nomeArquivoReciboRecebimento,
  slugArquivoRecibo,
  urlPdfReciboRecebimento,
} from "./recibo-carteira";

test("recibo usa o valor historicamente alocado, nao o aberto atual", () => {
  const itens = montarItensReciboRecebimento({
    alocacoes: [
      { item_id: "i1", valor: 55 },
      { item_id: "i2", valor: 45 },
    ],
    itens: [
      {
        id: "i1",
        titulo_id: "t1",
        produto_nome: "Frontal A12 C/ Aro Diamond",
        valor_aberto: 0,
      },
      {
        id: "i2",
        titulo_id: "t2",
        produto_nome: "Produto XYZ",
        valor_aberto: 155,
      },
    ],
    titulos: [
      { id: "t1", numero_venda: 45 },
      { id: "t2", numero_venda: 44 },
    ],
  });

  assert.deepEqual(itens, [
    {
      numeroVenda: 45,
      produtoNome: "Frontal A12 C/ Aro Diamond",
      valorAplicado: 55,
    },
    {
      numeroVenda: 44,
      produtoNome: "Produto XYZ",
      valorAplicado: 45,
    },
  ]);
  assert.equal(
    itens.some((item) => item.valorAplicado === 0 || item.valorAplicado === 155),
    false
  );
});

test("baixa parcial lista so o valor aplicado naquele recebimento", () => {
  const itens = montarItensReciboRecebimento({
    alocacoes: [{ item_id: "i1", valor: "30.00" }],
    itens: [
      {
        id: "i1",
        titulo_id: "t1",
        produto_nome: "Servico",
        valor_aberto: 70,
      },
    ],
    titulos: [{ id: "t1", numero_venda: 10 }],
  });

  assert.equal(itens.length, 1);
  assert.equal(itens[0]?.valorAplicado, 30);
  const linhas = linhasReciboRecebimentoCarteira({
    empresaNome: "Loja Teste",
    empresaDocumento: "12345678000199",
    empresaTelefone: "",
    empresaEndereco: "",
    clienteNome: "Rafael Folly",
    clienteDocumento: "00000000000",
    recebimentoId: "rec-1",
    dataIso: "2026-08-22T22:42:00.000Z",
    dataHora: "22/08/2026, 22:42",
    formaPagamento: "Dinheiro",
    valor: 30,
    itens,
    operadorNome: "Caixa",
    rodapeDataHora: "22/08/2026, 22:42",
  }).join("\n");

  assert.match(linhas, /RECIBO DE RECEBIMENTO/);
  assert.match(linhas, /Venda #10/);
  assert.match(linhas, /Valor aplicado: R\$\s*30,00/);
  assert.match(linhas, /Total recebido: R\$\s*30,00/);
  assert.match(linhas, /Recebimento registrado no UltraPDV/);
  assert.match(linhas, /Operador: Caixa/);
  assert.doesNotMatch(linhas, /NF-e|NFC-e|DANFE|chave de acesso/i);
  assert.doesNotMatch(linhas, /70,00/);
});

test("um recebimento que baixou varios itens lista todos", () => {
  const linhas = linhasReciboRecebimentoCarteira({
    empresaNome: "Loja Teste",
    empresaDocumento: "",
    empresaTelefone: "",
    empresaEndereco: "",
    clienteNome: "Rafael Folly",
    clienteDocumento: "",
    recebimentoId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    dataIso: "2026-08-22T22:42:00.000Z",
    dataHora: "22/08/2026, 22:42",
    formaPagamento: "Dinheiro",
    valor: 100,
    itens: [
      { numeroVenda: 45, produtoNome: "Frontal A12", valorAplicado: 55 },
      { numeroVenda: 44, produtoNome: "Produto XYZ", valorAplicado: 45 },
    ],
    operadorNome: "",
    rodapeDataHora: "22/08/2026, 22:42",
  }).join("\n");

  assert.match(linhas, /Venda #45/);
  assert.match(linhas, /Frontal A12/);
  assert.match(linhas, /Venda #44/);
  assert.match(linhas, /Produto XYZ/);
  assert.match(linhas, /Total recebido: R\$\s*100,00/);
});

test("nome do PDF segue Recibo-cliente-data-recebimento", () => {
  assert.equal(slugArquivoRecibo("Rafael Folly"), "Rafael-Folly");
  assert.equal(
    nomeArquivoReciboRecebimento({
      clienteNome: "Rafael Folly",
      dataIso: "2026-08-22T22:42:00.000-03:00",
      recebimentoId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }),
    "Recibo-Rafael-Folly-2026-08-22-aaaaaaaa.pdf"
  );
  assert.equal(
    urlPdfReciboRecebimento({
      recebimentoId: "rec-1",
      clienteId: "cli-1",
      papel: "80mm",
    }),
    "/api/impressao/carteira-recebimento/rec-1?cliente=cli-1&papel=80mm"
  );
});

test("loader e API isolam empresa ativa e o cliente do recebimento", () => {
  const loader = fonte("lib/impressao/carregar-recibo-carteira.ts");
  assert.match(loader, /eq\("empresa_id", empresaId\)/);
  assert.match(loader, /eq\("cliente_id", clienteId\)/);
  assert.match(loader, /eq\("id", recebimentoId\)/);
  assert.match(loader, /carteira_cliente_recebimento_alocacoes/);
  assert.match(loader, /montarItensReciboRecebimento/);
  assert.doesNotMatch(loader, /valor_aberto/);
  assert.doesNotMatch(loader, /createServiceRole|service_role|SERVICE_ROLE/);

  const rota = fonte("app/api/impressao/carteira-recebimento/[id]/route.ts");
  const corpo = rota.slice(rota.indexOf("export async function GET"));
  assert.match(corpo, /buscarVinculoEmpresaAtiva/);
  assert.match(corpo, /exigirOperacaoCarteira/);
  assert.match(corpo, /acao: "acessar_carteira"/);
  assert.match(corpo, /carregarReciboRecebimentoCarteiraDaEmpresaAtiva/);
  assert.match(corpo, /gerarPdfSimples/);
  assert.match(corpo, /searchParams.get\("cliente"\)/);
  assert.ok(
    corpo.indexOf("exigirOperacaoCarteira") <
      corpo.indexOf("carregarReciboRecebimentoCarteiraDaEmpresaAtiva")
  );
});

test("modal abre antes de imprimir e usa o Conector, nao window.print", () => {
  const modal = fonte(
    "components/clientes/carteira/modal-recibo-recebimento.tsx"
  );
  assert.match(modal, /Recibo de recebimento/);
  assert.match(modal, /Imprimir na impressora/);
  assert.match(modal, /Salvar PDF/);
  assert.match(modal, /imprimirUrlPdfNoUltraPdvConector/);
  assert.match(modal, /tipoDocumento: "recibo"/);
  assert.match(modal, /configDoTipo\(configs.configs, "recibo"\)/);
  assert.match(modal, /MENSAGEM_CONECTOR_AUSENTE/);
  assert.doesNotMatch(modal, /window\.print/);

  const workspace = fonte(
    "components/clientes/carteira/CarteiraClienteWorkspace.tsx"
  );
  assert.match(workspace, /ModalReciboRecebimento/);
  assert.match(workspace, /onImprimir/);
  assert.match(workspace, /origem === "RECEBIMENTO"/);
  assert.doesNotMatch(workspace, /window\.print/);
});
