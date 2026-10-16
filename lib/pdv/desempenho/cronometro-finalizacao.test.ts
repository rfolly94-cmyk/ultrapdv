import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  CLASSES_TEMPO_FINALIZACAO,
  criarCronometroFinalizacao,
  lerCorrelacaoFinalizacao,
  montarEventoDesempenho,
  PREFIXO_LOG_DESEMPENHO_PDV,
  type EventoEtapaFinalizacao,
  type ResumoFinalizacao,
} from "./cronometro-finalizacao";

const CORRELACAO = "8d4e2c10-6b3a-4f1e-9a77-2c6b0e5d4a11";
const VENDA = "da9bfd49-8033-4e7d-9d90-3f45302117d3";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("correlação inválida não mede nem publica", async () => {
  const vistos: unknown[] = [];
  const relogio = criarCronometroFinalizacao("venda-1", {
    emitir: (evento) => vistos.push(evento),
  });
  assert.equal(relogio.ativo, false);
  assert.equal(lerCorrelacaoFinalizacao("  "), null);
  const valor = await relogio.medir("persistencia_venda", "supabase", async () => 7);
  assert.equal(valor, 7);
  assert.equal(relogio.publicarResumo(true), null);
  assert.deepEqual(vistos, []);
});

test("separa operador, TEF, PIX, Supabase, NFC-e, impressão e liberação do PDV", async () => {
  let agora = 1_000;
  const vistos: Array<EventoEtapaFinalizacao | ResumoFinalizacao> = [];
  const relogio = criarCronometroFinalizacao(CORRELACAO, {
    agora: () => agora,
    incluirPdvLiberado: true,
    emitir: (evento) => vistos.push(evento),
  });

  relogio.marcar("interacao_operador", "operador", 12_000, true);
  relogio.marcar("pix_autorizacao", "pix", 8_000, true);
  await relogio.medir("tef_pagamento", "tef", async () => {
    agora += 4_500;
  });
  await relogio.medir(
    "supabase_rpc_finalizar",
    "supabase",
    async () => {
      agora += 320;
    },
    { rpc: "rpc_finalizar_venda_com_caixa" }
  );
  relogio.definirVenda(VENDA);
  await relogio.medir("nfce_geranet", "nfce", async () => {
    agora += 2_100;
  });
  await relogio.medir("impressao_baixar_pdf", "impressao", async () => {
    agora += 180;
  });
  await relogio.medir("impressao_conector", "impressao", async () => {
    agora += 90;
  });

  const resumo = relogio.publicarResumo(true);
  assert.ok(resumo);
  assert.equal(resumo.porClasse.operador, 12_000);
  assert.equal(resumo.porClasse.pix, 8_000);
  assert.equal(resumo.porClasse.tef, 4_500);
  assert.equal(resumo.porClasse.supabase, 320);
  assert.equal(resumo.porClasse.nfce, 2_100);
  assert.equal(resumo.porClasse.impressao, 270);
  assert.equal(resumo.porClasse.interface, 0);
  assert.equal(resumo.vendaId, VENDA);
  assert.equal(resumo.pdvLiberadoMs, resumo.totalMs);
  assert.equal(resumo.totalMs, 4_500 + 320 + 2_100 + 180 + 90);

  const liberacao = vistos.find(
    (evento) => evento.tipo === "etapa" && evento.etapa === "pdv_liberado"
  );
  assert.ok(liberacao && liberacao.tipo === "etapa");
  assert.equal(liberacao.papel, "total");
  assert.equal(liberacao.duracaoMs, resumo.totalMs);

  const rpc = vistos.find(
    (evento) => evento.tipo === "etapa" && evento.etapa === "supabase_rpc_finalizar"
  );
  assert.ok(rpc && rpc.tipo === "etapa");
  assert.equal(rpc.rpc, "rpc_finalizar_venda_com_caixa");
  assert.equal(PREFIXO_LOG_DESEMPENHO_PDV, "[pdv] desempenho");
  assert.equal(CLASSES_TEMPO_FINALIZACAO.length, 7);
});

test("erro interrompe a etapa sem engolir a falha", async () => {
  let agora = 0;
  const vistos: EventoEtapaFinalizacao[] = [];
  const relogio = criarCronometroFinalizacao(CORRELACAO, {
    agora: () => agora,
    emitir: (evento) => {
      if (evento.tipo === "etapa") {
        vistos.push(evento);
      }
    },
  });

  await assert.rejects(
    relogio.medir("nfce_geranet", "nfce", async () => {
      agora += 40;
      throw new Error("falha de rede");
    })
  );
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0]?.ok, false);
  assert.equal(vistos[0]?.duracaoMs, 40);
});

test("não publica cartão, documento, segredo nem payload", () => {
  const evento = montarEventoDesempenho({
    tipo: "etapa",
    correlacao: CORRELACAO,
    etapa: "tef_pagamento",
    classe: "tef",
    papel: "parte",
    duracaoMs: 10,
    ok: true,
    cpf: "12345678901",
    cartao: "4111111111111111",
    pan: "4111111111111111",
    xml: "<NFe><infNFe>",
    comprovante: "CREDITO A VISTA",
    certificado: "segredo",
    payload: { nsu: "1" },
    nome: "Maria",
  });
  assert.ok(evento);
  const serializado = JSON.stringify(evento);
  assert.doesNotMatch(serializado, /cpf|cartao|pan|xml|comprovante|certificado|payload|Maria|4111/i);
  assert.deepEqual(Object.keys(evento).sort(), [
    "classe",
    "correlacao",
    "duracaoMs",
    "etapa",
    "ok",
    "papel",
    "tipo",
  ]);

  assert.equal(
    montarEventoDesempenho({
      tipo: "etapa",
      correlacao: CORRELACAO,
      etapa: "tef_pagamento",
      classe: "tef",
      papel: "parte",
      duracaoMs: 10,
      ok: true,
      vendaId: "nao-e-uuid",
    }),
    null
  );
  assert.equal(
    montarEventoDesempenho({
      tipo: "etapa",
      correlacao: CORRELACAO,
      etapa: "texto livre",
      classe: "tef",
      papel: "parte",
      duracaoMs: 10,
      ok: true,
    }),
    null
  );
});

test("o F2 mede o caminho real e não manda a correlação ao PayGo", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const acao = fonte("app/pdv/actions.ts");
  const emissao = fonte("lib/fiscal/nfce/chamar-emissao-nfce-venda.ts");
  const rota = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const fluxo = fonte("lib/pdv/tef/fluxo-cliente.ts");
  const impressao = fonte("lib/impressao/executar-cliente.ts");

  assert.match(shell, /criarCronometroFinalizacao/);
  assert.match(shell, /interacao_operador/);
  assert.match(shell, /persistencia_venda/);
  assert.match(shell, /nfce_emissao/);
  assert.match(shell, /pix_autorizacao/);
  assert.match(acao, /supabase_rpc_finalizar/);
  assert.match(emissao, /x-ultrapdv-correlacao/);
  assert.match(rota, /nfce_geranet/);
  assert.match(rota, /nfce_montar_payload/);
  assert.match(impressao, /impressao_baixar_pdf/);
  assert.match(impressao, /impressao_conector/);

  const inicioCorpo = fluxo.indexOf("const corpoPagamento");
  const corpo = fluxo.slice(inicioCorpo, fluxo.indexOf("};", inicioCorpo));
  assert.match(fluxo, /tef_pagamento/);
  assert.doesNotMatch(corpo, /correlacao|medicao/);
  assert.doesNotMatch(fonte("lib/pdv/desempenho/cronometro-finalizacao.ts"), /console\.(log|debug)\(/);
});
