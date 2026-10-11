import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confirmarTefAposVenda,
  desfazerCobrancasTef,
  executarCobrancasTef,
} from "./fluxo-cliente";

function jsonResposta(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

test("recusa não confirma e desfaz somente o que o servidor liberar", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, { ok: true, tef: { inicializado: true } });
    }
    if (url.endsWith("/tef/identidade")) {
      return jsonResposta(200, {
        ok: true,
        dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        chavePublica: "chave-publica",
        assinatura: "assinatura",
      });
    }
    if (url.endsWith("/api/pdv/tef/iniciar")) {
      return jsonResposta(200, {
        ok: true,
        operacaoId: "op-1",
        identificador: "abc",
        valor: 10,
        terminalCodigo: "CX01",
        empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parear: false,
        jaAutorizada: false,
      });
    }
    if (url.endsWith("/tef/pagamento")) {
      return jsonResposta(200, {
        ok: false,
        codigo: "TEF_TIMEOUT",
        resultado: { codigo: "TEF_TIMEOUT" },
      });
    }
    if (url.endsWith("/api/pdv/tef/resultado")) {
      return jsonResposta(200, { ok: true, status: "timeout" });
    }
    if (url.endsWith("/api/pdv/tef/desfazer")) {
      return jsonResposta(200, { ok: true, executar: "nenhum" });
    }
    return jsonResposta(500, { ok: false });
  };

  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        {
          formaPagamentoId: "debito",
          modalidade: "debito",
          valorCentavos: 1000,
        },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-1",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  assert.equal(chamadas.some((item) => item.includes("/api/pdv/tef/resultado")), true);
  assert.equal(chamadas.some((item) => item.includes("/tef/confirmar")), false);
});

test("confirmação no Connector só acontece depois da liberação da venda", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/liberar-confirmacao")) {
      return jsonResposta(409, { ok: false, confirmar: false, erro: "bloqueada" });
    }
    return jsonResposta(200, { ok: true });
  };
  const resultado = await confirmarTefAposVenda(
    {
      vendaId: "venda-1",
      origem: "http://127.0.0.1:18182",
      operacoes: [
        {
          formaPagamentoId: "debito",
          operacaoId: "op-1",
          valorCentavos: 1000,
          identificador: "abc",
          empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          terminalCodigo: "CX01",
          desafio: "",
          vinculoSegredo: "",
          autorizacao: "",
        },
      ],
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  assert.equal(chamadas.some((item) => item.includes("/tef/confirmar")), false);
});

test("desfazimento não chama o Connector quando a venda já existe", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    chamadas.push(url);
    return jsonResposta(200, { ok: true, executar: "nenhum" });
  };
  await desfazerCobrancasTef(
    {
      origem: "http://127.0.0.1:18182",
      idempotencyKeyVenda: "venda",
      operacoes: [
        {
          formaPagamentoId: "debito",
          operacaoId: "op-1",
          valorCentavos: 1000,
          identificador: "abc",
          empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          terminalCodigo: "CX01",
          desafio: "",
          vinculoSegredo: "",
          autorizacao: "",
        },
      ],
    },
    { fetchImpl }
  );
  assert.equal(
    chamadas.some((item) => item === "http://127.0.0.1:18182/tef/desfazer"),
    false
  );
});

test("PIX sem autorização é aceito e cartão sem autorização não é tratado como negado", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, { ok: true, tef: { inicializado: true } });
    }
    if (url.endsWith("/tef/identidade")) {
      return jsonResposta(200, {
        ok: true,
        dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        chavePublica: "chave-publica",
        assinatura: "assinatura",
      });
    }
    if (url.endsWith("/api/pdv/tef/iniciar")) {
      return jsonResposta(200, {
        ok: true,
        operacaoId: "op-pix",
        identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
        valor: 1,
        terminalCodigo: "117473",
        empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        desafio: "ab".repeat(32),
        vinculoSegredo: "segredo",
      });
    }
    if (url.endsWith("/tef/pagamento")) {
      return jsonResposta(200, {
        ok: true,
        prova: "prova",
        resultado: {
          sucessoTransacao: true,
          nsu: "E1928374620261011120364LDuT35VP5",
          codigoAutorizacao: "",
          rede: "PIX C6 BANK",
          finalizacao: "1",
          valor: 1,
          confirmar: true,
        },
      });
    }
    if (url.endsWith("/api/pdv/tef/resultado")) {
      return jsonResposta(200, { ok: true, status: "autorizada" });
    }
    return jsonResposta(500, { ok: false });
  };
  const pix = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 100 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-pix",
    },
    { fetchImpl }
  );
  assert.equal(pix.ok, true);
  assert.equal(chamadas.some((item) => item.includes("/tef/confirmar")), false);

  const cartao = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 100 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-cartao",
    },
    {
      fetchImpl: async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/pdv/tef/resultado")) {
          return jsonResposta(200, { ok: true, status: "desconhecida" });
        }
        if (url.endsWith("/api/pdv/tef/desfazer")) {
          return jsonResposta(200, { ok: true, executar: "nenhum" });
        }
        return fetchImpl(url, init);
      },
    }
  );
  assert.equal(cartao.ok, false);
  if (!cartao.ok) {
    assert.match(cartao.erro, /desconhecido/);
    assert.doesNotMatch(cartao.erro, /não autorizou/);
  }
});

test("falha ao persistir a venda desfaz o PIX pelos identificadores originais", async () => {
  const enviados: Array<Record<string, unknown>> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/pdv/tef/desfazer")) {
      return jsonResposta(200, {
        ok: true,
        executar: "desfazer",
        rede: "PIX C6 BANK",
        nsu: "E1928374620261011120364LDuT35VP5",
        finalizacao: "1",
        autorizacao: "",
        identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
        valorCentavos: 100,
        desafio: "ab".repeat(32),
      });
    }
    if (url.endsWith("/tef/desfazer")) {
      enviados.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResposta(200, {
        ok: true,
        resultado: { desfeita: true, confirmada: false },
      });
    }
    if (url.endsWith("/api/pdv/tef/registrar-desfazimento")) {
      return jsonResposta(200, { ok: true });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await desfazerCobrancasTef(
    {
      origem: "http://127.0.0.1:18182",
      idempotencyKeyVenda: "idem-venda",
      operacoes: [
        {
          formaPagamentoId: "debito",
          operacaoId: "418344b8-b518-4029-9f11-7d86e1d9815f",
          valorCentavos: 100,
          identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
          empresaId: "347878e3-608a-46c4-9f22-7bebb982ff6d",
          terminalCodigo: "117473",
          desafio: "",
          vinculoSegredo: "segredo",
          autorizacao: "",
        },
      ],
    },
    { fetchImpl }
  );
  assert.equal(resultado.desfez, 1);
  assert.equal(enviados[0]?.acao, "desfazer");
  assert.equal(enviados[0]?.rede, "PIX C6 BANK");
  assert.equal(enviados[0]?.nsu, "E1928374620261011120364LDuT35VP5");
  assert.equal(enviados[0]?.finalizacao, "1");
});
