import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { bloqueioTefHomologacaoNfceProducao } from "@/lib/fiscal/tef/ambiente-tef-nfce";
import { mensagemAmbienteTef as mensagemServidor } from "@/lib/pdv/tef/prova";
import { assinarAmbienteTef, verificarAmbienteTef } from "@/lib/pdv/tef/prova";
import { decidirRecuperacao, validarPagamentoMisto } from "@/lib/pdv/tef/regras";
import {
  iniciarOperacao,
  memoriaTefVazia,
  registrarResultado,
  reservarOperacoesParaVenda,
  salvarConfigEmpresa,
  type MemoriaTef,
} from "@/lib/pdv/tef/orquestracao";

import {
  decidirPorEvidencia,
  hashComprovante,
  juntarComprovante,
  origemProducaoComprovada,
} from "./ambiente-transacao";
import { mensagemAmbienteTef as mensagemConnector } from "../../../print-agent/src/tef-prova.mjs";
import {
  hashComprovanteTef,
  juntarComprovanteTef,
} from "../../../print-agent/src/tef-prova.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const EMPRESA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_PRODUCAO = "pos-transac.pgweb.io:31735";
const HOST_SANDBOX = "pos-transac-sb.tpgweb.io:31735";
const PONTO_PRODUCAO = "6696546";
const PONTO_SANDBOX = "117473";
const COMPROVANTE_SANDBOX = juntarComprovante(
  "PAYGO - AMBIENTE SANDBOX\nTRANSACAO TESTE SEM VALOR FINANCEIRO\nPDC:117473",
  ""
);
const COMPROVANTE_PRODUCAO = juntarComprovante(
  "PAYGO\nTRANSACAO APROVADA\nPDC:6696546",
  ""
);

function chave() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function camposAmbiente(parcial: Record<string, string | number> = {}) {
  return {
    desafio: "ab".repeat(32),
    identificador: "11111111-1111-4111-8111-111111111111",
    valorCentavos: 100,
    nsu: "173923",
    autorizacao: "990557",
    rede: "C6 PAY",
    finalizacao: "1",
    pontoCaptura: PONTO_PRODUCAO,
    host: HOST_PRODUCAO,
    comprovanteSha256: hashComprovante(COMPROVANTE_PRODUCAO),
    ...parcial,
  };
}

function memoria(): MemoriaTef {
  const atual = memoriaTefVazia();
  atual.plataformaHabilitada = true;
  salvarConfigEmpresa(atual, EMPRESA, {
    habilitado: true,
    ambiente: "producao",
    estabelecimento: "SMARTCELL",
    pontoCaptura: PONTO_PRODUCAO,
  });
  return atual;
}

function aprovar(atual: MemoriaTef, operacaoId: string, origem = origemProducaoComprovada()) {
  return registrarResultado(atual, {
    empresaId: EMPRESA,
    operacaoId,
    provaValida: true,
    origem,
    modalidadeOficial: { provaValida: true, tipoCartao: 2 },
    resultado: {
      sucessoTransacao: true,
      nsu: "173923",
      codigoAutorizacao: "990557",
      rede: "C6 PAY",
      codigoFinalizacao: "1",
      valor: 1,
      confirmar: true,
      precisaConfirmacao: true,
    },
  });
}

test("a mensagem de ambiente do servidor e do Connector é a mesma", () => {
  const campos = camposAmbiente();
  assert.equal(mensagemServidor(campos), mensagemConnector(campos));
  assert.equal(juntarComprovante("a", "b"), juntarComprovanteTef("a", "b"));
  assert.equal(hashComprovante("a\nb"), hashComprovanteTef("a\nb"));
  assert.match(mensagemServidor(campos), /^ultrapdv-tef-ambiente-v1\n/);
});

test("aprovação sandbox não vira pagamento de produção", () => {
  const decisao = decidirPorEvidencia({
    comprovante: COMPROVANTE_SANDBOX,
    host: HOST_SANDBOX,
    pontoCaptura: PONTO_SANDBOX,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(decisao.efeito, "homologacao");
  assert.equal(decisao.proibirDesfazimento, true);
  const atual = memoria();
  const inicio = iniciarOperacao(atual, {
    empresaId: EMPRESA,
    dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    terminalCodigo: "117473",
    modalidade: "debito",
    valorCentavos: 100,
    identificador: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "idem-sandbox",
    usuarioId: "usuario",
    desafio: "ab".repeat(32),
    vinculoSegredo: "segredo",
    segredoVinculoHash: "hash",
    chavePublica: "pem",
  });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const registrado = aprovar(atual, inicio.operacaoId, decisao);
  assert.equal(registrado.ok && registrado.status, "reconciliacao");
  assert.equal(atual.operacoes[0]?.nsu, "173923");
  assert.equal(atual.operacoes[0]?.teste, false);
  assert.equal(
    decidirRecuperacao({
      empresaId: EMPRESA,
      operacao: atual.operacoes[0] ?? null,
      existeVenda: false,
    }).acao,
    "reconciliar"
  );
  assert.equal(
    reservarOperacoesParaVenda(atual, {
      empresaId: EMPRESA,
      usuarioId: "usuario",
      idempotencyKey: "venda",
      operacaoIds: [inicio.operacaoId],
    }).ok,
    false
  );
});

test("host divergente, ponto incorreto e comprovante sem valor financeiro bloqueiam produção", () => {
  const host = decidirPorEvidencia({
    comprovante: COMPROVANTE_PRODUCAO.replace("6696546", PONTO_PRODUCAO),
    host: HOST_SANDBOX,
    pontoCaptura: PONTO_PRODUCAO,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(host.efeito, "homologacao");
  assert.match(host.motivo, /homologação/);

  const ponto = decidirPorEvidencia({
    comprovante: "PAYGO\nTRANSACAO APROVADA\nPDC:117473",
    host: HOST_PRODUCAO,
    pontoCaptura: PONTO_SANDBOX,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(ponto.efeito, "homologacao");
  assert.match(ponto.motivo, /117473/);

  const semValor = decidirPorEvidencia({
    comprovante: "TRANSACAO TESTE SEM VALOR FINANCEIRO",
    host: HOST_PRODUCAO,
    pontoCaptura: PONTO_PRODUCAO,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(semValor.efeito, "homologacao");
  assert.match(semValor.motivo, /sem valor financeiro/);
});

test("dados ausentes e resposta adulterada não comprovam produção", () => {
  const ausente = decidirPorEvidencia({
    comprovante: "",
    host: "",
    pontoCaptura: "",
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(ausente.efeito, "desconhecido");
  assert.equal(ausente.proibirDesfazimento, true);

  const par = chave();
  const original = camposAmbiente();
  const prova = assinarAmbienteTef(par.privada, original);
  assert.equal(verificarAmbienteTef(par.publica, original, prova), true);
  assert.equal(
    verificarAmbienteTef(par.publica, { ...original, host: HOST_SANDBOX }, prova),
    false
  );
  assert.equal(
    verificarAmbienteTef(
      par.publica,
      { ...original, comprovanteSha256: hashComprovante(COMPROVANTE_SANDBOX) },
      prova
    ),
    false
  );
  const adulterada = decidirPorEvidencia({
    comprovante: COMPROVANTE_PRODUCAO,
    host: HOST_PRODUCAO,
    pontoCaptura: PONTO_PRODUCAO,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: false,
    fluxoHomologacao: false,
  });
  assert.equal(adulterada.efeito, "desconhecido");
  assert.equal(adulterada.host, "");
});

test("produção legítima segue autorizada e homologação explícita não financia NFC-e", () => {
  const producao = decidirPorEvidencia({
    comprovante: COMPROVANTE_PRODUCAO,
    host: HOST_PRODUCAO,
    pontoCaptura: PONTO_PRODUCAO,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: false,
  });
  assert.equal(producao.efeito, "producao");
  const atual = memoria();
  const inicio = iniciarOperacao(atual, {
    empresaId: EMPRESA,
    dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    terminalCodigo: "117473",
    modalidade: "debito",
    valorCentavos: 100,
    identificador: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "idem-producao",
    usuarioId: "usuario",
    desafio: "ab".repeat(32),
    vinculoSegredo: "segredo",
    segredoVinculoHash: "hash",
    chavePublica: "pem",
  });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const registrado = aprovar(atual, inicio.operacaoId, producao);
  assert.equal(registrado.ok && registrado.status, "autorizada");
  assert.equal(atual.operacoes[0]?.ambienteEfetivo, "producao");
  assert.equal(
    validarPagamentoMisto(
      [
        {
          modalidade: "debito",
          valorCentavos: 100,
          tefOperacaoId: inicio.operacaoId,
        },
      ],
      [
        {
          id: inicio.operacaoId,
          empresaId: EMPRESA,
          modalidade: "debito",
          valorCentavos: 100,
          status: "autorizada",
          vendaId: null,
          teste: false,
          nsu: "173923",
          autorizacao: "990557",
          ambienteEfetivo: "producao",
        },
      ],
      EMPRESA
    ).ok,
    true
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "producao",
      possuiTransacaoTef: true,
      ambientesEfetivos: ["producao"],
    }),
    null
  );

  const teste = decidirPorEvidencia({
    comprovante: COMPROVANTE_SANDBOX,
    host: HOST_SANDBOX,
    pontoCaptura: PONTO_SANDBOX,
    pontoOficial: PONTO_PRODUCAO,
    hostOficial: HOST_PRODUCAO,
    assinaturaValida: true,
    fluxoHomologacao: true,
  });
  assert.equal(teste.efeito, "homologacao");
  assert.equal(teste.fluxoTeste, false);
  assert.match(teste.diagnostico, /NFC-e de produção/);
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "producao",
      possuiTransacaoTef: true,
      ambientesEfetivos: ["homologacao"],
    }),
    "Esta transação TEF não foi comprovada como produção. A NFC-e de produção não foi emitida."
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "producao",
      possuiTransacaoTef: true,
      ambientesEfetivos: [""],
    }),
    "Esta transação TEF não foi comprovada como produção. A NFC-e de produção não foi emitida."
  );
});

test("o servidor exige a evidência assinada e a migration só sinaliza as NFC-e 38, 39 e 40", () => {
  const persistencia = readFileSync(join(raiz, "lib/pdv/tef/persistencia.ts"), "utf8");
  const resultado = persistencia.slice(
    persistencia.indexOf("export async function registrarResultadoTefPersistido"),
    persistencia.indexOf("export async function liberarConfirmacaoTefPersistida")
  );
  assert.match(resultado, /verificarAmbienteTef/);
  assert.match(resultado, /decidirPorEvidencia/);
  assert.match(resultado, /origem/);
  const cliente = readFileSync(join(raiz, "lib/pdv/tef/fluxo-cliente.ts"), "utf8");
  const trecho = cliente.slice(
    cliente.indexOf("provaAmbiente"),
    cliente.indexOf("if (!registro.ok || registro.status !== \"autorizada\")")
  );
  assert.match(trecho, /reconciliacao/);
  assert.match(trecho, /proibirDesfazimento/);
  const emissao = readFileSync(
    join(raiz, "app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    "utf8"
  );
  assert.match(emissao, /ambiente_efetivo/);
  const sql = readFileSync(
    join(raiz, "supabase/migrations/20261013020000_tef_ambiente_efetivo.sql"),
    "utf8"
  );
  assert.match(sql, /da9bfd49-8033-4e7d-9d90-3f45302117d3/);
  assert.match(sql, /094e24a7-84ac-4f4b-84c3-89a4de32ffe6/);
  assert.match(sql, /13bd2a21-6549-4585-9028-cdf7ce72a1b4/);
  assert.doesNotMatch(sql, /\bUPDATE\b/);
  assert.doesNotMatch(sql, /\bDELETE\b/);
  assert.match(sql, /INSERT INTO public\.tef_ocorrencias_simuladas/);
});
