import assert from "node:assert/strict";
import test from "node:test";

import { FRASE_TESTE_FINANCEIRO_HOMOLOGACAO } from "./menu-homologacao-contrato";
import { encaminharMenuConectorHomologacao, urlMenuConectorHomologacao } from "./menu-homologacao-conector";

test("o PDV encaminha o menu ao Connector único sem índice e sem pagamento", async () => {
  const pedidos: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  const resposta = await encaminharMenuConectorHomologacao(
    {
      acao: "responder",
      empresaId: "empresa-a",
      terminalCodigo: "caixa-1",
      frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
      capturaId: 2,
      valor: "9691",
    },
    {
      origem: "http://127.0.0.1:18182",
      buscar: async (url, init) => {
        pedidos.push({ url: String(url), corpo: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({
            ok: true,
            fase: "menu",
            pagamentoRecebido: true,
            podeFinalizar: true,
            nfcEEmitida: true,
            menu: { capturaId: 3, wIdentificador: 0x29, opcoes: [{ texto: "Débito", valor: "02" }] },
          }),
          { status: 200 }
        );
      },
    }
  );
  assert.equal(pedidos[0]?.url, urlMenuConectorHomologacao("http://127.0.0.1:18182"));
  assert.equal(pedidos[0]?.corpo.valor, "9691");
  assert.equal("indice" in (pedidos[0]?.corpo ?? {}), false);
  assert.equal(resposta.pagamentoRecebido, false);
  assert.equal(resposta.podeFinalizar, false);
  assert.equal(resposta.nfcEEmitida, false);
  assert.equal(resposta.execucaoFisica, false);
});

test("a recusa do Connector sem mensagem chega ao PDV com o motivo", async () => {
  const resposta = await encaminharMenuConectorHomologacao(
    {
      acao: "iniciar",
      empresaId: "empresa-a",
      terminalCodigo: "caixa-lab",
      frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
      assinatura: "prova",
    },
    {
      origem: "http://127.0.0.1:18182",
      buscar: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            codigo: "transporte",
            motivo: "A sessão nativa residente não está disponível.",
            execucaoFisica: false,
            comandoDll: false,
          }),
          { status: 409 }
        ),
    }
  );
  assert.equal(resposta.codigo, "transporte");
  assert.equal(resposta.mensagem, "A sessão nativa residente não está disponível.");
  assert.equal(resposta.execucaoFisica, false);
});

test("produção e falha de rede não chamam o Connector financeiro", async () => {
  let chamadas = 0;
  const producao = await encaminharMenuConectorHomologacao(
    {
      acao: "iniciar",
      empresaId: "empresa-a",
      terminalCodigo: "caixa-1",
      frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
    },
    {
      origem: "http://10.0.0.8:18181",
      buscar: async () => {
        chamadas += 1;
        return new Response("{}", { status: 200 });
      },
    }
  );
  assert.equal(producao.codigo, "conector");
  assert.equal(chamadas, 0);
  const rede = await encaminharMenuConectorHomologacao(
    {
      acao: "iniciar",
      empresaId: "empresa-a",
      terminalCodigo: "caixa-1",
      frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
    },
    {
      origem: "http://127.0.0.1:18182",
      buscar: async () => {
        throw new Error("offline");
      },
    }
  );
  assert.equal(rede.codigo, "comunicacao");
  assert.equal(rede.pagamentoRecebido, false);
});
