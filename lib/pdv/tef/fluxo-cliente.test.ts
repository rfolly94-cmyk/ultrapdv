import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confirmarTefAposVenda,
  desfazerCobrancasTef,
  executarCobrancasTef,
  reenviarProvaLocal,
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
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: {
            compativel: true,
            nome: "UltraPDVTef_135.exe",
            versao: "1.3.5",
            caminho: "C:\\Program Files\\UltraPDV Connector\\bin\\tef\\UltraPDVTef_135.exe",
          },
          biblioteca: { cobrancaPermitida: true, motivo: "produção comprovada" },
        },
      });
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
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: {
            compativel: true,
            nome: "UltraPDVTef_135.exe",
            versao: "1.3.5",
            caminho: "C:\\Program Files\\UltraPDV Connector\\bin\\tef\\UltraPDVTef_135.exe",
          },
          biblioteca: { cobrancaPermitida: true, motivo: "produção comprovada" },
        },
      });
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

test("não inicia cobrança quando o agente carregado não é o desta versão", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: {
            compativel: false,
            nome: "UltraPDVTef_135.exe",
            versao: "",
            caminho: "",
            situacao: "antigo_ignorado",
          },
          biblioteca: { cobrancaPermitida: true },
        },
      });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 100 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-agente",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /UltraPDVTef_135\.exe/);
  assert.equal(chamadas.some((item) => item.includes("/tef/pagamento")), false);
  assert.equal(chamadas.some((item) => item.includes("/api/pdv/tef/iniciar")), false);
});

test("não inicia cobrança quando a biblioteca não comprova produção", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: { compativel: true, nome: "UltraPDVTef_135.exe", versao: "1.3.5" },
          biblioteca: {
            cobrancaPermitida: false,
            pontoSolicitado: "117473",
            servidorSolicitado: "pos-transac-sb.tpgweb.io:31735",
            motivo: "A biblioteca está apontada para homologação. A cobrança não foi iniciada.",
          },
        },
      });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 100 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-bloqueio",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /homologação/);
  assert.equal(chamadas.some((item) => item.includes("/tef/pagamento")), false);
  assert.equal(chamadas.some((item) => item.includes("/api/pdv/tef/iniciar")), false);
});

test("não inicia cobrança quando o Connector não informa a biblioteca", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, { ok: true, tef: { inicializado: true } });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 100 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-desconhecido",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /não carregou o agente TEF desta versão/);
  assert.equal(chamadas.some((item) => item.includes("/tef/pagamento")), false);
});

test("modalidade indeterminada não confirma nem cobra de novo", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: { compativel: true, nome: "UltraPDVTef_138.exe" },
          biblioteca: { cobrancaPermitida: true },
        },
      });
    }
    if (url.endsWith("/tef/identidade")) {
      return jsonResposta(200, {
        ok: true,
        dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        chavePublica: "chave",
        assinatura: "assinatura",
      });
    }
    if (url.endsWith("/api/pdv/tef/iniciar")) {
      return jsonResposta(200, {
        ok: true,
        operacaoId: "op-1",
        identificador: "id-1",
        valor: 10,
        terminalCodigo: "117473",
        empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        desafio: "ab".repeat(32),
        vinculoSegredo: "segredo",
      });
    }
    if (url.endsWith("/tef/pagamento")) {
      return jsonResposta(200, {
        ok: true,
        resultado: { sucessoTransacao: true, tipoCartao: null, nsu: "1" },
      });
    }
    if (url.endsWith("/api/pdv/tef/resultado")) {
      return jsonResposta(200, {
        ok: true,
        status: "reconciliacao",
        proibirDesfazimento: true,
        diagnostico:
          "O TEF foi aprovado, mas o tipo do cartão não veio no campo oficial. A venda e a NFC-e não foram concluídas. Nenhuma nova cobrança foi iniciada.",
      });
    }
    return jsonResposta(500, { ok: false, erro: "inesperado" });
  };
  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 1000 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: () => "idem-modalidade",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.erro, /Nenhuma nova cobrança foi iniciada/);
  }
  assert.equal(chamadas.filter((item) => item.includes("/tef/pagamento")).length, 1);
  assert.equal(chamadas.some((item) => item.includes("/tef/confirmar")), false);
  assert.equal(chamadas.some((item) => item.includes("/tef/desfazer")), false);
});

test("segundo F2 reapresenta a autorização e não chama o pinpad", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tef/status")) {
      return jsonResposta(200, {
        ok: true,
        tef: {
          inicializado: true,
          agente: { compativel: true, nome: "UltraPDVTef_138.exe" },
          biblioteca: { cobrancaPermitida: true },
        },
      });
    }
    if (url.endsWith("/tef/identidade")) {
      return jsonResposta(200, {
        ok: true,
        chavePublica: "chave",
        assinatura: "assinatura",
      });
    }
    if (url.endsWith("/api/pdv/tef/iniciar")) {
      return jsonResposta(200, {
        ok: true,
        operacaoId: "op-existente",
        identificador: "id-existente",
        valor: 10,
        status: "autorizada",
        modalidadeEfetiva: "credito",
        modalidadeSolicitada: "debito",
        jaAutorizada: true,
        cobrarDeNovo: false,
        diagnostico: "",
      });
    }
    return jsonResposta(500, { ok: false, erro: "não deveria cobrar" });
  };
  const resultado = await executarCobrancasTef(
    {
      parcelas: [
        { formaPagamentoId: "debito", modalidade: "debito", valorCentavos: 1000 },
        { formaPagamentoId: "credito", modalidade: "credito", valorCentavos: 500 },
      ],
      origem: "http://127.0.0.1:18182",
      dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      idempotencyKey: (indice) => `idem-misto-${indice}`,
      grupoVenda: "venda-mista",
    },
    { fetchImpl }
  );
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.erro, /Nenhuma nova cobrança foi iniciada/);
    assert.match(resultado.erro, /crédito/);
  }
  assert.equal(chamadas.some((item) => item.includes("/tef/pagamento")), false);
  assert.equal(chamadas.some((item) => item.includes("/tef/confirmar")), false);
  assert.equal(chamadas.some((item) => item.includes("/tef/desfazer")), false);
});

test("falha entre Connector e servidor reenvia a prova de modalidade sem nova cobrança", async () => {
  let corpoResultado = "";
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/tef/recuperacao")) {
      return jsonResposta(200, {
        ok: true,
        recuperacao: {
          identificador: "id-queda",
          prova: "prova-financeira",
          sucessoTransacao: true,
          nsu: "998877",
          autorizacao: "AUT01",
          rede: "C6 PAY",
          finalizacao: "FIN01",
          valor: 10,
          confirmar: true,
          tipoCartao: 1,
          provaModalidade: "prova-modalidade",
          provaAmbiente: "prova-ambiente",
          host: "pos-transac.pgweb.io:31735",
          pontoCaptura: "6696546",
          comprovante1Via: "via1",
          comprovante2Via: "via2",
        },
      });
    }
    if (url.endsWith("/api/pdv/tef/resultado")) {
      corpoResultado = String(init?.body ?? "");
      return jsonResposta(200, { ok: true, status: "autorizada" });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await reenviarProvaLocal(
    {
      origem: "http://127.0.0.1:18182",
      empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      terminalCodigo: "117473",
      pendencias: [{ id: "op-queda", identificador: "id-queda", status: "iniciada" }],
    },
    { fetchImpl }
  );
  assert.equal(resultado.reenviadas, 1);
  const corpo = JSON.parse(corpoResultado) as Record<string, unknown>;
  assert.equal(corpo.tipoCartao, 1);
  assert.equal(corpo.provaModalidade, "prova-modalidade");
  assert.equal(corpo.provaAmbiente, "prova-ambiente");
  assert.equal(corpo.host, "pos-transac.pgweb.io:31735");
  assert.equal(corpo.pontoCaptura, "6696546");
  assert.equal(corpo.modalidadeEfetiva, undefined);
});

test("recuperação sem prova de modalidade não inventa a modalidade efetiva", async () => {
  let corpoResultado = "";
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/tef/recuperacao")) {
      return jsonResposta(200, {
        ok: true,
        recuperacao: {
          identificador: "id-sem-prova",
          prova: "prova-financeira",
          sucessoTransacao: true,
          nsu: "1",
          autorizacao: "A",
          rede: "C6 PAY",
          finalizacao: "1",
          valor: 10,
          modalidadeSolicitada: "debito",
          modalidadeEfetiva: "credito",
        },
      });
    }
    if (url.endsWith("/api/pdv/tef/resultado")) {
      corpoResultado = String(init?.body ?? "");
      return jsonResposta(200, { ok: true, status: "reconciliacao" });
    }
    return jsonResposta(500, { ok: false });
  };
  const resultado = await reenviarProvaLocal(
    {
      origem: "http://127.0.0.1:18182",
      empresaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      terminalCodigo: "117473",
      pendencias: [{ id: "op-sem-prova", identificador: "id-sem-prova", status: "desconhecida" }],
    },
    { fetchImpl }
  );
  assert.equal(resultado.status, "reconciliacao");
  const corpo = JSON.parse(corpoResultado) as Record<string, unknown>;
  assert.equal(corpo.provaModalidade, undefined);
  assert.equal(corpo.modalidadeEfetiva, undefined);
  assert.equal(corpo.modalidadeSolicitada, undefined);
});
