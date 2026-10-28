import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { filaImpressaoVazia, type FilaImpressaoPdv } from "@/lib/pdv/impressao-fila";
import {
  executarImpressaoComprovantesTef,
  linhasComprovanteTef,
} from "@/lib/pdv/tef/comprovantes-impressao";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const VENDA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_A = "11111111-1111-4111-8111-111111111111";
const EMPRESA_B = "22222222-2222-4222-8222-222222222222";

function memoria() {
  let fila = filaImpressaoVazia();
  return {
    emCurso: new Set<string>(),
    ler: () => fila,
    gravar: (proxima: FilaImpressaoPdv) => {
      fila = proxima;
    },
  };
}

function pedido(empresaId: string, viaCliente = "VIA CLIENTE\nPORTADOR") {
  return {
    empresaId,
    vendaId: VENDA,
    status: "confirmada",
    pagamentoRecebido: true,
    transacaoConfirmada: true,
    viaEstabelecimento: "VIA ESTABELECIMENTO\nLOJA",
    viaCliente,
    rede: "C6 PAY",
    quando: "2026-10-26T18:23:31.000Z",
  };
}

test("duas vias confirmadas geram dois trabalhos e a repetição não imprime de novo", async () => {
  const base = memoria();
  const impressos: string[] = [];
  const primeira = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_A),
    ...base,
    agora: () => "2026-10-26T18:24:00.000Z",
    imprimirVia: async (via) => {
      impressos.push(`${via.documento}\n${via.texto}`);
      assert.deepEqual(via.linhas, linhasComprovanteTef(via.texto));
      return { ok: true };
    },
  });
  assert.equal(primeira.impresso, true);
  assert.equal(primeira.trabalhos, 2);
  assert.deepEqual(impressos.map((item) => item.split("\n")[0]), [
    "tef_estabelecimento",
    "tef_cliente",
  ]);
  assert.equal(impressos[0].includes("VIA CLIENTE"), false);
  assert.equal(impressos[1].includes("VIA ESTABELECIMENTO"), false);
  assert.equal(impressos.join("").includes("REDUZIDO"), false);

  const repetida = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_A),
    ...base,
    agora: () => "2026-10-26T18:25:00.000Z",
    imprimirVia: async () => {
      throw new Error("não deveria imprimir de novo");
    },
  });
  assert.equal(repetida.impresso, false);
  assert.equal(repetida.trabalhos, 0);
  assert.equal(impressos.length, 2);
});

test("antes da confirmação e sem uma das vias nada é impresso", async () => {
  const base = memoria();
  const bloqueada = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_A),
    status: "aguardando_confirmacao",
    pagamentoRecebido: false,
    transacaoConfirmada: false,
    ...base,
    agora: () => "2026-10-26T18:24:00.000Z",
    imprimirVia: async () => {
      throw new Error("não deveria imprimir");
    },
  });
  assert.equal(bloqueada.impresso, false);
  assert.match(bloqueada.motivo, /confirmada/i);

  const incompleta = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_A, ""),
    ...base,
    agora: () => "2026-10-26T18:24:00.000Z",
    imprimirVia: async () => {
      throw new Error("não deveria imprimir");
    },
  });
  assert.equal(incompleta.impresso, false);
  assert.match(incompleta.motivo, /duas vias/i);
});

test("a mesma venda em outra empresa imprime as próprias vias", async () => {
  const base = memoria();
  const empresas: string[] = [];
  for (const empresaId of [EMPRESA_A, EMPRESA_B]) {
    const resultado = await executarImpressaoComprovantesTef({
      ...pedido(empresaId),
      ...base,
      agora: () => "2026-10-26T18:24:00.000Z",
      imprimirVia: async (via) => {
        empresas.push(`${empresaId}:${via.documento}`);
        return { ok: true };
      },
    });
    assert.equal(resultado.trabalhos, 2);
  }
  assert.equal(empresas.length, 4);
  assert.equal(empresas.filter((item) => item.startsWith(EMPRESA_A)).length, 2);
  assert.equal(empresas.filter((item) => item.startsWith(EMPRESA_B)).length, 2);
});

test("quebras de linha do comprovante permanecem em linhas separadas", () => {
  assert.deepEqual(linhasComprovanteTef("VIA ESTABELECIMENTO\r\nLOJA\n\nDEBITO"), [
    "VIA ESTABELECIMENTO",
    "LOJA",
    "",
    "DEBITO",
  ]);
});

test("as combinações dos três interruptores imprimem só o que está marcado", async () => {
  const casos = [
    { cliente: false, estabelecimento: false, esperados: [] as string[] },
    { cliente: true, estabelecimento: false, esperados: ["tef_cliente"] },
    { cliente: false, estabelecimento: true, esperados: ["tef_estabelecimento"] },
    { cliente: true, estabelecimento: true, esperados: ["tef_estabelecimento", "tef_cliente"] },
  ];

  for (const caso of casos) {
    const base = memoria();
    const impressos: string[] = [];
    const resultado = await executarImpressaoComprovantesTef({
      ...pedido(EMPRESA_A),
      imprimirViaCliente: caso.cliente,
      imprimirViaEstabelecimento: caso.estabelecimento,
      ...base,
      agora: () => "2026-10-26T18:24:00.000Z",
      imprimirVia: async (via) => {
        impressos.push(`${via.documento}:${via.texto}`);
        return { ok: true };
      },
    });
    assert.deepEqual(impressos.map((item) => item.split(":")[0]), caso.esperados);
    assert.equal(resultado.trabalhos, caso.esperados.length);
    if (!caso.cliente) {
      assert.equal(impressos.some((item) => item.includes("VIA CLIENTE")), false);
    }
    if (!caso.estabelecimento) {
      assert.equal(impressos.some((item) => item.includes("VIA ESTABELECIMENTO")), false);
    }
    const repetida = await executarImpressaoComprovantesTef({
      ...pedido(EMPRESA_A),
      imprimirViaCliente: caso.cliente,
      imprimirViaEstabelecimento: caso.estabelecimento,
      ...base,
      agora: () => "2026-10-26T18:25:00.000Z",
      imprimirVia: async () => {
        throw new Error("não deveria imprimir de novo");
      },
    });
    assert.equal(repetida.trabalhos, 0);
  }
});

test("uma via desmarcada permanece no pedido e não substitui a via que faltou", async () => {
  const base = memoria();
  const guardada = "VIA CLIENTE\nPORTADOR";
  const soCliente = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_A, guardada),
    viaEstabelecimento: "",
    imprimirViaCliente: true,
    imprimirViaEstabelecimento: false,
    ...base,
    agora: () => "2026-10-26T18:24:00.000Z",
    imprimirVia: async (via) => {
      assert.equal(via.texto, guardada);
      return { ok: true };
    },
  });
  assert.equal(soCliente.trabalhos, 1);

  const faltouAMarcada = await executarImpressaoComprovantesTef({
    ...pedido(EMPRESA_B, ""),
    imprimirViaCliente: true,
    imprimirViaEstabelecimento: false,
    ...base,
    agora: () => "2026-10-26T18:24:00.000Z",
    imprimirVia: async () => {
      throw new Error("não deveria imprimir a via do estabelecimento no lugar da via do cliente");
    },
  });
  assert.equal(faltouAMarcada.impresso, false);
  assert.equal(faltouAMarcada.trabalhos, 0);
});

test("o PDV usa as duas vias só depois da confirmação e fora do recibo comercial", () => {
  const shell = readFileSync(resolve(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const motor = readFileSync(resolve(raiz, "UltraPDV.TEF/src/UltraPDV.TEF/Transacoes/MotorPayGo.cs"), "utf8");
  const ponte = readFileSync(resolve(raiz, "print-agent/src/tef-csharp-ponte.mjs"), "utf8");
  assert.match(shell, /executarImpressaoComprovantesTef/);
  assert.match(shell, /viasAutomaticasTef\(preferenciaTef\)/);
  assert.match(shell, /permitirReciboComercialNaVendaTef\(preferenciaTef\)/);
  assert.match(shell, /suprimirReciboComercial && destino\.tipo === "recibo"/);
  assert.match(shell, /copias: 1/);
  assert.doesNotMatch(shell, /tipoDocumento: "recibo"[\s\S]{0,120}tef_cliente/);
  assert.doesNotMatch(motor, /PreferenciaComprovantesTef|imprimir_via_cliente/);
  assert.match(motor, /stackalloc byte\[4096\]/);
  assert.match(motor, /ComprovanteEstabelecimento/);
  assert.match(motor, /ComprovanteCliente/);
  assert.doesNotMatch(motor, /LerComprovante\(biblioteca, InformacaoPgWeb\.ComprovanteReduzido\)/);
  assert.match(ponte, /viaEstabelecimento/);
  assert.match(ponte, /viaCliente/);
  assert.doesNotMatch(ponte, /juntarComprovante/);
});
