import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confirmarTefAposVenda,
  desfazerCobrancasTef,
  executarCobrancasTef,
  executarVendaPinpad,
  reenviarProvaLocal,
} from "./fluxo-cliente";

const pedido = {
  parcelas: [{ formaPagamentoId: "debito", modalidade: "debito" as const, valorCentavos: 100 }],
  origem: "http://127.0.0.1:18182",
  dispositivoId: "disp-1",
  idempotencyKey: () => "idem-1",
  ambiente: "producao" as const,
};

test("cobrança, confirmação, desfazimento e reenvio não chamam Connector nem API", async () => {
  const chamadas: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${url}`);
    return { ok: true, status: 200, json: async () => ({ ok: true, pagamentoRecebido: true }) };
  };
  const cobranca = await executarCobrancasTef(pedido, { fetchImpl });
  const pinpad = await executarVendaPinpad({ ...pedido, buscar: fetchImpl });
  const confirmacao = await confirmarTefAposVenda(
    {
      vendaId: "venda-1",
      origem: pedido.origem,
      operacoes: [
        {
          formaPagamentoId: "debito",
          operacaoId: "op-1",
          valorCentavos: 100,
          identificador: "id-1",
          empresaId: "empresa-1",
          terminalCodigo: "t-1",
          desafio: "d",
          vinculoSegredo: "s",
          autorizacao: "",
        },
      ],
    },
    { fetchImpl }
  );
  const desfazer = await desfazerCobrancasTef(
    {
      origem: pedido.origem,
      idempotencyKeyVenda: null,
      operacoes: [
        {
          formaPagamentoId: "debito",
          operacaoId: "op-1",
          valorCentavos: 100,
          identificador: "id-1",
          empresaId: "empresa-1",
          terminalCodigo: "t-1",
          desafio: "d",
          vinculoSegredo: "s",
          autorizacao: "",
        },
      ],
    },
    { fetchImpl }
  );
  const reenvio = await reenviarProvaLocal(
    {
      origem: pedido.origem,
      empresaId: "empresa-1",
      terminalCodigo: "t-1",
      pendencias: [{ id: "op-1", identificador: "id-1", status: "iniciada" }],
    },
    { fetchImpl }
  );

  assert.equal(cobranca.ok, false);
  assert.match(cobranca.erro, /desativada/);
  assert.deepEqual(cobranca.operacoes, []);
  assert.equal(pinpad.ok, false);
  assert.equal(pinpad.pagamentoRecebido, false);
  assert.equal(confirmacao.ok, false);
  assert.equal(desfazer.desfez, 0);
  assert.equal(reenvio.reenviadas, 0);
  assert.deepEqual(chamadas, []);
});
