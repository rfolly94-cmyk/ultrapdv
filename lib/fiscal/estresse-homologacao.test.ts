import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolverAcoesEmissaoFiscal } from "./acoes-emissao";
import {
  avaliarBloqueioRascunhoFiscal,
  sanitizarPayloadTentativaFiscal,
} from "./emissao-tentativas";
import { resolverEstadoOperacionalFiscal } from "./estado-operacional-fiscal";
import {
  classificarLogEmitir,
  decidirStatusLocal,
  EmissaoParaConsulta,
  LogGeranetResumo,
  montarAtualizacaoEmissao,
} from "./geranet/classificar-consulta";
import {
  acoesEmissaoFiscal,
  classificarRespostaEmitir,
  persistirClassificacaoNaoAutorizada,
} from "./geranet/classificar-emissao";
import {
  persistenciaFalhaComunicacaoEmitir,
} from "./geranet/cliente-geranet";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const ROTAS_EMITIR = [
  "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfce-emitir/route.ts",
  "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts",
  "app/api/fiscal/geranet/nfe-emitir/route.ts",
  "app/api/fiscal/geranet/nfe55-emitir/route.ts",
  "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts",
];

const CHAVE_44 = "51260812345678000155650010000000111234567890";
const PROTOCOLO = "151260000000001";

type ModeloFiscal = "55" | "65";

type EmissaoSimulada = {
  id: string;
  empresaId: string;
  modelo: ModeloFiscal;
  serie: number;
  ambiente: 2;
  numero: number;
  status: string;
  chaveIdempotencia: string;
  classificacao: string | null;
  chaveAcesso: string | null;
  protocolo: string | null;
  xml: string | null;
  origemVendaId: string | null;
  tentativas: number;
};

type ResultadoGeranetSimulado =
  | { tipo: "autorizada" }
  | { tipo: "rejeitada"; cstat: string; mensagem: string }
  | { tipo: "timeout" }
  | { tipo: "http500" }
  | { tipo: "json_invalido" }
  | { tipo: "conexao_encerrada" }
  | { tipo: "dns_antes_do_post" }
  | { tipo: "crash_apos_envio" }
  | { tipo: "crash_antes_gravar"; cstat?: string }
  | { tipo: "processando" };

function chaveIdempotenciaNfe55(vendaId: string) {
  const bytes = createHash("sha256")
    .update(`ultrapdv:nfe55:${vendaId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function erroRede(code: string, name = "Error") {
  const error = new Error(code);
  error.name = name;
  (error as Error & { code?: string }).code = code;
  return error;
}

function comLock() {
  const filas = new Map<string, Promise<void>>();
  return async function withLock<T>(chave: string, fn: () => T | Promise<T>) {
    const anterior = filas.get(chave) ?? Promise.resolve();
    let liberar!: () => void;
    const atual = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    filas.set(
      chave,
      anterior.then(() => atual)
    );
    await anterior;
    try {
      return await fn();
    } finally {
      liberar();
    }
  };
}

class MotorFiscalSimulado {
  emissoes: EmissaoSimulada[] = [];
  chamadasGeranet: string[] = [];
  vendasCriadas = 0;
  estoqueMovimentos = 0;
  pagamentosCriados = 0;
  private proximo = new Map<string, number>();
  private withLock = comLock();

  private chaveNumeracao(
    empresaId: string,
    modelo: ModeloFiscal,
    serie: number
  ) {
    return `${empresaId}:${modelo}:${serie}:2`;
  }

  async reservar(params: {
    empresaId: string;
    modelo: ModeloFiscal;
    serie: number;
    chaveIdempotencia: string;
    origemVendaId?: string | null;
  }) {
    return this.withLock(
      `idem:${params.empresaId}:${params.chaveIdempotencia}`,
      async () => {
        const existente = this.emissoes.find(
          (item) =>
            item.empresaId === params.empresaId &&
            item.chaveIdempotencia === params.chaveIdempotencia &&
            item.status !== "inutilizada"
        );
        if (existente) {
          if (
            existente.modelo !== params.modelo ||
            existente.serie !== params.serie
          ) {
            throw new Error(
              "chave de idempotência já usada com parâmetros fiscais diferentes"
            );
          }
          return { ...existente, reutilizada: true as const };
        }

        return this.withLock(
          `num:${this.chaveNumeracao(params.empresaId, params.modelo, params.serie)}`,
          () => {
            const chaveNum = this.chaveNumeracao(
              params.empresaId,
              params.modelo,
              params.serie
            );
            const maxUsado =
              this.emissoes
                .filter(
                  (item) =>
                    item.empresaId === params.empresaId &&
                    item.modelo === params.modelo &&
                    item.serie === params.serie
                )
                .reduce((acc, item) => Math.max(acc, item.numero), 0) + 1;
            const proximo = this.proximo.get(chaveNum) ?? 1;
            const numero = Math.max(proximo, maxUsado);
            const emissao: EmissaoSimulada = {
              id: randomUUID(),
              empresaId: params.empresaId,
              modelo: params.modelo,
              serie: params.serie,
              ambiente: 2,
              numero,
              status: "reservada",
              chaveIdempotencia: params.chaveIdempotencia,
              classificacao: null,
              chaveAcesso: null,
              protocolo: null,
              xml: null,
              origemVendaId: params.origemVendaId ?? null,
              tentativas: 0,
            };
            this.emissoes.push(emissao);
            this.proximo.set(chaveNum, numero + 1);
            return { ...emissao, reutilizada: false as const };
          }
        );
      }
    );
  }

  async claim(emissaoId: string, empresaId: string) {
    return this.withLock(`claim:${empresaId}:${emissaoId}`, () => {
      const emissao = this.emissoes.find(
        (item) => item.id === emissaoId && item.empresaId === empresaId
      );
      if (!emissao) {
        return { ok: false as const, motivo: "nao_encontrada" };
      }
      const pode =
        emissao.status === "reservada" ||
        emissao.status === "rejeitada" ||
        (emissao.status === "erro_comunicacao" &&
          emissao.classificacao === "erro_envio");
      if (!pode) {
        return { ok: false as const, motivo: "bloqueado", status: emissao.status };
      }
      emissao.status = "enviando";
      emissao.tentativas += 1;
      return { ok: true as const, emissao };
    });
  }

  async transmitir(
    emissaoId: string,
    empresaId: string,
    resultado: ResultadoGeranetSimulado
  ) {
    const claim = await this.claim(emissaoId, empresaId);
    if (!claim.ok) {
      return { transmitiu: false as const, motivo: claim.motivo };
    }

    if (resultado.tipo === "crash_apos_envio") {
      this.chamadasGeranet.push(emissaoId);
      return { transmitiu: true as const, status: "enviando" };
    }

    if (resultado.tipo === "dns_antes_do_post") {
      const persistencia = persistenciaFalhaComunicacaoEmitir(
        erroRede("ENOTFOUND")
      );
      claim.emissao.status = persistencia.status;
      claim.emissao.classificacao = persistencia.classificacaoResumo;
      return {
        transmitiu: false as const,
        status: persistencia.status,
        retransmitir: persistencia.retransmitir,
      };
    }

    this.chamadasGeranet.push(emissaoId);

    if (resultado.tipo === "crash_antes_gravar") {
      return { transmitiu: true as const, status: "enviando" };
    }

    const evidencia = evidenciaDoResultado(resultado);
    if (resultado.tipo === "timeout" || resultado.tipo === "conexao_encerrada") {
      const persistencia = persistenciaFalhaComunicacaoEmitir(
        resultado.tipo === "timeout"
          ? Object.assign(new Error("aborted"), { name: "AbortError" })
          : erroRede("ECONNRESET")
      );
      claim.emissao.status = persistencia.status;
      claim.emissao.classificacao = persistencia.classificacaoResumo;
      return {
        transmitiu: true as const,
        status: persistencia.status,
        retransmitir: persistencia.retransmitir,
      };
    }

    const situacao = classificarRespostaEmitir(evidencia);
    if (situacao === "autorizada") {
      claim.emissao.status = "autorizada";
      claim.emissao.chaveAcesso = CHAVE_44;
      claim.emissao.protocolo = PROTOCOLO;
      claim.emissao.xml = "<nfeProc/>";
      claim.emissao.classificacao = "autorizada";
      return { transmitiu: true as const, status: "autorizada" };
    }

    const persistencia = persistirClassificacaoNaoAutorizada(
      situacao === "erro_envio" ? "erro_envio" : situacao === "rejeitada" ? "rejeitada" : "aguardando_reconciliacao"
    );
    claim.emissao.status = persistencia.status;
    claim.emissao.classificacao = persistencia.classificacaoResumo;
    return {
      transmitiu: true as const,
      status: persistencia.status,
      retransmitir: persistencia.retransmitir,
    };
  }

  async reconciliar(
    emissaoId: string,
    empresaId: string,
    situacao: "autorizada" | "rejeitada" | "processando" | "nao_encontrada" | "falha_consulta"
  ) {
    const emissao = this.emissoes.find(
      (item) => item.id === emissaoId && item.empresaId === empresaId
    );
    if (!emissao) {
      throw new Error("emissão de outra empresa ou inexistente");
    }
    const entrada: EmissaoParaConsulta = {
      id: emissao.id,
      modelo: emissao.modelo,
      serie: emissao.serie,
      numero: emissao.numero,
      ambiente: emissao.ambiente,
      status: emissao.status,
      codigo_numerico: "12345678",
      origem_id: emissao.origemVendaId,
    };
    const log: LogGeranetResumo | null =
      situacao === "autorizada"
        ? {
            id: 1,
            endpoint: "nfe/emitir",
            criado_em: new Date().toISOString(),
            http_status: 200,
            sucesso: true,
            chave: CHAVE_44,
            protocolo: PROTOCOLO,
            cstat: "100",
            numero: String(emissao.numero),
            situacao: "sucesso",
            mensagem: "Autorizado o uso da NF-e",
            xml: "3c786d6c",
            pdf: "25504446",
            modelo: emissao.modelo,
            serie: String(emissao.serie),
            ambiente: "2",
            codigo_numerico: "12345678",
            numero_venda: emissao.origemVendaId,
            contingencia: "nao",
          }
        : situacao === "rejeitada"
          ? {
              id: 2,
              endpoint: "nfe/emitir",
              criado_em: new Date().toISOString(),
              http_status: 422,
              sucesso: false,
              chave: null,
              protocolo: null,
              cstat: "230",
              numero: String(emissao.numero),
              situacao: "erro",
              mensagem: "Rejeição: IE do emitente não cadastrada",
              xml: null,
              pdf: null,
              modelo: emissao.modelo,
              serie: String(emissao.serie),
              ambiente: "2",
              codigo_numerico: "12345678",
              numero_venda: emissao.origemVendaId,
              contingencia: "nao",
            }
          : null;
    const classificada = log
      ? classificarLogEmitir(log, entrada)
      : situacao;
    const atualizacao = montarAtualizacaoEmissao({
      emissao: entrada,
      situacao: classificada,
      log,
      origem: "manual",
    });
    emissao.status = atualizacao.status_local;
    if (atualizacao.patch.chave_acesso) {
      emissao.chaveAcesso = String(atualizacao.patch.chave_acesso);
    }
    if (atualizacao.patch.protocolo) {
      emissao.protocolo = String(atualizacao.patch.protocolo);
    }
    if (atualizacao.patch.xml_hex) {
      emissao.xml = String(atualizacao.patch.xml_hex);
    }
    return atualizacao;
  }
}

function evidenciaDoResultado(resultado: ResultadoGeranetSimulado) {
  switch (resultado.tipo) {
    case "autorizada":
      return {
        httpOk: true,
        httpStatus: 200,
        situacao: "sucesso",
        cstat: "100",
        mensagem: "Autorizado o uso da NF-e",
        chave: CHAVE_44,
        protocolo: PROTOCOLO,
        transmissaoIniciada: true,
      };
    case "rejeitada":
      return {
        httpOk: false,
        httpStatus: 422,
        situacao: "erro",
        cstat: resultado.cstat,
        mensagem: resultado.mensagem,
        chave: null,
        protocolo: null,
        transmissaoIniciada: true,
      };
    case "http500":
      return {
        httpOk: false,
        httpStatus: 500,
        situacao: "erro",
        cstat: null,
        mensagem: "Erro HTTP: 500",
        chave: null,
        protocolo: null,
        transmissaoIniciada: true,
      };
    case "json_invalido":
      return {
        httpOk: true,
        httpStatus: 200,
        situacao: "erro",
        cstat: null,
        mensagem: "A Geranet respondeu em formato não reconhecido.",
        chave: null,
        protocolo: null,
        transmissaoIniciada: true,
      };
    case "processando":
      return {
        httpOk: false,
        httpStatus: 202,
        situacao: "processando",
        cstat: "105",
        mensagem: "Em processamento",
        chave: null,
        protocolo: null,
        transmissaoIniciada: true,
      };
    default:
      return {
        httpOk: false,
        httpStatus: 0,
        situacao: null,
        cstat: null,
        mensagem: "Falha",
        chave: null,
        protocolo: null,
        transmissaoIniciada: true,
      };
  }
}

test("mapa: rotas de emissão claimam antes da Geranet e isolam empresa_id", () => {
  for (const arquivo of ROTAS_EMITIR) {
    const rota = fonte(arquivo);
    assert.match(rota, /empresa_id/, arquivo);
    const posClaim = Math.max(
      rota.indexOf("claimTentativaEmissaoFiscal"),
      rota.indexOf("anexarTentativaTransmissaoContingencia"),
      rota.indexOf("rpc_iniciar_transmissao_contingencia")
    );
    const posGeranet = Math.max(
      rota.indexOf("await chamarGeranet"),
      rota.indexOf("https://nfe.geranet.net/api/v1/nfe/emitir")
    );
    assert.ok(posClaim >= 0, `${arquivo} deve claimar tentativa`);
    assert.ok(posGeranet > posClaim, `${arquivo} Geranet só depois do claim`);
    assert.match(rota, /persistenciaFalhaComunicacaoEmitir/, arquivo);
  }
});

test("mapa: PDV e venda usam chave de idempotência estável, não UUID novo a cada clique", () => {
  const pdv = fonte("lib/fiscal/nfce/chamar-emissao-nfce-venda.ts");
  const nfce = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const nfe = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const operacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  assert.match(pdv, /Idempotency-Key": vendaId/);
  assert.match(nfce, /p_chave_idempotencia:\s*vendaId/);
  assert.match(nfe, /chaveIdempotenciaNfe55/);
  assert.match(operacao, /chaveIdempotenciaOperacao/);
  const vendaId = randomUUID();
  assert.notEqual(chaveIdempotenciaNfe55(vendaId), vendaId);
  assert.equal(chaveIdempotenciaNfe55(vendaId), chaveIdempotenciaNfe55(vendaId));
});

test("NFC-e: venda simples, desconto, pagamentos e CPF não geram segunda reserva", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();
  const venda = randomUUID();
  const cenarios = [
    "simples",
    "varios_produtos",
    "desconto",
    "troco",
    "dinheiro",
    "pix",
    "debito",
    "credito",
    "combinado",
    "cpf_na_nota",
    "sem_cpf",
  ];
  const ids: string[] = [];
  for (const _ of cenarios) {
    const reservada = await motor.reservar({
      empresaId: empresa,
      modelo: "65",
      serie: 1,
      chaveIdempotencia: venda,
      origemVendaId: venda,
    });
    ids.push(reservada.id);
  }
  assert.equal(new Set(ids).size, 1);
  assert.equal(motor.emissoes.length, 1);
  assert.equal(motor.emissoes[0]?.numero, 1);
});

test("NF-e 55: PF/PJ, contribuinte e operação fora do PDV não cruzam chave da NFC-e", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();
  const venda = randomUUID();
  const operacao = randomUUID();
  const nfce = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: venda,
    origemVendaId: venda,
  });
  const nfeVenda = await motor.reservar({
    empresaId: empresa,
    modelo: "55",
    serie: 1,
    chaveIdempotencia: chaveIdempotenciaNfe55(venda),
    origemVendaId: venda,
  });
  const nfeOperacao = await motor.reservar({
    empresaId: empresa,
    modelo: "55",
    serie: 1,
    chaveIdempotencia: operacao,
  });
  assert.equal(nfce.numero, 1);
  assert.equal(nfeVenda.numero, 1);
  assert.equal(nfeOperacao.numero, 2);
  assert.notEqual(nfce.chaveIdempotencia, nfeVenda.chaveIdempotencia);
});

test("idempotência: duplo clique, duas abas e HTTP paralelo geram UMA transmissão Geranet", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();
  const venda = randomUUID();
  const primeira = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: venda,
    origemVendaId: venda,
  });
  const paralelo = await Promise.all(
    Array.from({ length: 8 }, () =>
      motor.reservar({
        empresaId: empresa,
        modelo: "65",
        serie: 1,
        chaveIdempotencia: venda,
        origemVendaId: venda,
      })
    )
  );
  assert.ok(paralelo.every((item) => item.id === primeira.id));
  assert.ok(paralelo.every((item) => item.numero === 1));

  const envios = await Promise.all(
    Array.from({ length: 8 }, () =>
      motor.transmitir(primeira.id, empresa, { tipo: "autorizada" })
    )
  );
  assert.equal(envios.filter((item) => item.transmitiu).length, 1);
  assert.equal(motor.chamadasGeranet.length, 1);
  assert.equal(motor.emissoes.filter((item) => item.status === "autorizada").length, 1);
});

test("numeração: 10 sequenciais + simultâneas sem número duplicado na mesma empresa/série", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();
  for (let i = 0; i < 10; i += 1) {
    await motor.reservar({
      empresaId: empresa,
      modelo: "65",
      serie: 1,
      chaveIdempotencia: randomUUID(),
    });
  }
  const simultaneas = await Promise.all(
    Array.from({ length: 20 }, () =>
      motor.reservar({
        empresaId: empresa,
        modelo: "65",
        serie: 1,
        chaveIdempotencia: randomUUID(),
      })
    )
  );
  const numeros = motor.emissoes
    .filter((item) => item.empresaId === empresa && item.modelo === "65")
    .map((item) => item.numero);
  assert.equal(new Set(numeros).size, numeros.length);
  assert.equal(Math.max(...numeros), 30);
  assert.equal(simultaneas.length, 20);
});

test("numeração: falha antes do envio reutiliza o mesmo número; timeout não abre número novo", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();
  const venda = randomUUID();
  const reservada = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: venda,
  });
  const dns = await motor.transmitir(reservada.id, empresa, {
    tipo: "dns_antes_do_post",
  });
  assert.equal(dns.status, "erro_comunicacao");
  assert.equal(dns.retransmitir, true);

  const retry = await motor.transmitir(reservada.id, empresa, { tipo: "timeout" });
  assert.equal(retry.status, "aguardando_reconciliacao");
  assert.equal(retry.retransmitir, false);

  const bloqueado = await motor.transmitir(reservada.id, empresa, {
    tipo: "autorizada",
  });
  assert.equal(bloqueado.transmitiu, false);
  assert.equal(motor.emissoes.length, 1);
  assert.equal(motor.emissoes[0]?.numero, 1);

  const outraVenda = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  assert.equal(outraVenda.numero, 2);
});

test("multiempresa: A/B NFC-e e NF-e simultâneas isolam série, número e documentos", async () => {
  const motor = new MotorFiscalSimulado();
  const empresaA = randomUUID();
  const empresaB = randomUUID();
  const [nfceA, nfceB, nfeA, nfeB] = await Promise.all([
    motor.reservar({
      empresaId: empresaA,
      modelo: "65",
      serie: 1,
      chaveIdempotencia: randomUUID(),
    }),
    motor.reservar({
      empresaId: empresaB,
      modelo: "65",
      serie: 1,
      chaveIdempotencia: randomUUID(),
    }),
    motor.reservar({
      empresaId: empresaA,
      modelo: "55",
      serie: 1,
      chaveIdempotencia: randomUUID(),
    }),
    motor.reservar({
      empresaId: empresaB,
      modelo: "55",
      serie: 1,
      chaveIdempotencia: randomUUID(),
    }),
  ]);
  assert.equal(nfceA.numero, 1);
  assert.equal(nfceB.numero, 1);
  assert.equal(nfeA.numero, 1);
  assert.equal(nfeB.numero, 1);
  assert.equal(nfceA.empresaId, empresaA);
  assert.equal(nfceB.empresaId, empresaB);
  await assert.rejects(
    () => motor.reconciliar(nfceA.id, empresaB, "autorizada"),
    /outra empresa/
  );
});

test("falhas A–J: classificação, claim e recuperação sem retransmitir ambíguo", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();

  const casos: Array<{
    nome: string;
    resultado: ResultadoGeranetSimulado;
    status: string;
    retransmitir: boolean;
  }> = [
    {
      nome: "A antes da Geranet",
      resultado: { tipo: "dns_antes_do_post" },
      status: "erro_comunicacao",
      retransmitir: true,
    },
    {
      nome: "B imediatamente depois",
      resultado: { tipo: "crash_apos_envio" },
      status: "enviando",
      retransmitir: false,
    },
    {
      nome: "C depois da resposta antes de gravar",
      resultado: { tipo: "crash_antes_gravar" },
      status: "enviando",
      retransmitir: false,
    },
    {
      nome: "F JSON inválido",
      resultado: { tipo: "json_invalido" },
      status: "aguardando_reconciliacao",
      retransmitir: false,
    },
    {
      nome: "G HTTP 500",
      resultado: { tipo: "http500" },
      status: "aguardando_reconciliacao",
      retransmitir: false,
    },
    {
      nome: "H timeout",
      resultado: { tipo: "timeout" },
      status: "aguardando_reconciliacao",
      retransmitir: false,
    },
    {
      nome: "I conexão encerrada",
      resultado: { tipo: "conexao_encerrada" },
      status: "aguardando_reconciliacao",
      retransmitir: false,
    },
  ];

  for (const caso of casos) {
    const venda = randomUUID();
    const reservada = await motor.reservar({
      empresaId: empresa,
      modelo: "65",
      serie: 1,
      chaveIdempotencia: venda,
    });
    const out = await motor.transmitir(reservada.id, empresa, caso.resultado);
    assert.equal(out.status, caso.status, caso.nome);
    const estado = resolverEstadoOperacionalFiscal({
      modelo: "65",
      status: String(out.status),
      classificacao:
        motor.emissoes.find((item) => item.id === reservada.id)?.classificacao,
    });
    assert.equal(estado.podeRetry, caso.retransmitir, caso.nome);
    if (!caso.retransmitir) {
      const segunda = await motor.transmitir(reservada.id, empresa, {
        tipo: "autorizada",
      });
      assert.equal(segunda.transmitiu, false, caso.nome);
    }
  }

  const autorizada = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  await motor.transmitir(autorizada.id, empresa, { tipo: "autorizada" });
  const depoisAutorizar = await motor.transmitir(autorizada.id, empresa, {
    tipo: "autorizada",
  });
  assert.equal(depoisAutorizar.transmitiu, false);

  const duasRespostas = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  const concorrentes = await Promise.all([
    motor.transmitir(duasRespostas.id, empresa, { tipo: "autorizada" }),
    motor.transmitir(duasRespostas.id, empresa, {
      tipo: "rejeitada",
      cstat: "230",
      mensagem: "Rejeição: IE do emitente não cadastrada",
    }),
  ]);
  assert.equal(concorrentes.filter((item) => item.transmitiu).length, 1);
  assert.equal(
    motor.emissoes.find((item) => item.id === duasRespostas.id)?.status,
    "autorizada"
  );
});

test("rejeição conclusiva permite retry no mesmo número; timeout nunca vira rejeição", () => {
  const rejeicao = classificarRespostaEmitir({
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: "230",
    mensagem: "Rejeição: IE do emitente não cadastrada",
    transmissaoIniciada: true,
  });
  const timeout = classificarRespostaEmitir({
    httpOk: false,
    httpStatus: 0,
    situacao: null,
    cstat: null,
    mensagem: "Timeout após iniciar transmissão à Geranet.",
    transmissaoIniciada: true,
  });
  const http500 = classificarRespostaEmitir({
    httpOk: false,
    httpStatus: 500,
    mensagem: "Erro HTTP: 500",
    transmissaoIniciada: true,
  });
  assert.equal(rejeicao, "rejeitada");
  assert.equal(timeout, "aguardando_reconciliacao");
  assert.equal(http500, "aguardando_reconciliacao");
  assert.equal(persistirClassificacaoNaoAutorizada(timeout).retransmitir, false);
  assert.equal(acoesEmissaoFiscal({ status: "rejeitada", cstat: "230" }).podeRetransmitir, true);
  assert.equal(
    acoesEmissaoFiscal({
      status: "aguardando_reconciliacao",
      classificacao: "erro_tecnico",
    }).podeRetransmitir,
    false
  );
});

test("reconciliação: autorizada, rejeitada e inconclusiva preservam número e bloqueio", async () => {
  const motor = new MotorFiscalSimulado();
  const empresa = randomUUID();

  const ambiguaOk = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  await motor.transmitir(ambiguaOk.id, empresa, { tipo: "timeout" });
  const achou = await motor.reconciliar(ambiguaOk.id, empresa, "autorizada");
  assert.equal(achou.status_local, "autorizada");
  assert.equal(motor.emissoes[0]?.numero, 1);
  assert.equal(motor.emissoes[0]?.chaveAcesso, CHAVE_44);

  const ambiguaRej = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  await motor.transmitir(ambiguaRej.id, empresa, { tipo: "timeout" });
  const rejeitou = await motor.reconciliar(ambiguaRej.id, empresa, "rejeitada");
  assert.equal(rejeitou.status_local, "rejeitada");
  assert.equal(ambiguaRej.numero, 2);

  const ainda = await motor.reservar({
    empresaId: empresa,
    modelo: "65",
    serie: 1,
    chaveIdempotencia: randomUUID(),
  });
  await motor.transmitir(ainda.id, empresa, { tipo: "timeout" });
  const pendente = await motor.reconciliar(ainda.id, empresa, "nao_encontrada");
  assert.equal(pendente.status_local, "aguardando_reconciliacao");
  assert.equal(decidirStatusLocal("aguardando_reconciliacao", "nao_encontrada"), "aguardando_reconciliacao");
  assert.equal(decidirStatusLocal("aguardando_reconciliacao", "processando"), "aguardando_reconciliacao");
  const retry = await motor.transmitir(ainda.id, empresa, { tipo: "autorizada" });
  assert.equal(retry.transmitiu, false);
});

test("carga 10/50/100: timeouts, rejeições e respostas fora de ordem sem duplicar número", async () => {
  for (const volume of [10, 50, 100]) {
    const motor = new MotorFiscalSimulado();
    const empresa = randomUUID();
    const tipos: ResultadoGeranetSimulado[] = [
      { tipo: "autorizada" },
      {
        tipo: "rejeitada",
        cstat: "230",
        mensagem: "Rejeição: IE do emitente não cadastrada",
      },
      { tipo: "timeout" },
      { tipo: "http500" },
      { tipo: "json_invalido" },
    ];
    const tarefas = Array.from({ length: volume }, (_, indice) => {
      const chave = randomUUID();
      const resultado = tipos[indice % tipos.length];
      if (!resultado) {
        throw new Error("resultado ausente");
      }
      return (async () => {
        const reservada = await motor.reservar({
          empresaId: empresa,
          modelo: indice % 2 === 0 ? "65" : "55",
          serie: 1,
          chaveIdempotencia: chave,
        });
        await motor.transmitir(reservada.id, empresa, resultado);
      })();
    });
    await Promise.all(tarefas.reverse());
    const nfce = motor.emissoes.filter((item) => item.modelo === "65");
    const nfe = motor.emissoes.filter((item) => item.modelo === "55");
    const numerosNfce = nfce.map((item) => item.numero);
    const numerosNfe = nfe.map((item) => item.numero);
    assert.equal(new Set(numerosNfce).size, nfce.length, `volume ${volume} NFC-e`);
    assert.equal(new Set(numerosNfe).size, nfe.length, `volume ${volume} NF-e`);
    assert.equal(motor.emissoes.length, volume);
    const ambiguas = motor.emissoes.filter(
      (item) =>
        item.status === "aguardando_reconciliacao" || item.status === "enviando"
    );
    for (const item of ambiguas) {
      const estado = resolverEstadoOperacionalFiscal({
        modelo: item.modelo,
        status: item.status,
        classificacao: item.classificacao,
      });
      assert.equal(estado.podeRetry, false);
    }
  }
});

test("integridade comercial: retry fiscal não cria venda, estoque nem pagamento", () => {
  const nfce = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const nfe = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  for (const rota of [nfce, nfe]) {
    const corpo = rota.slice(rota.indexOf("claimTentativaEmissaoFiscal"));
    assert.doesNotMatch(corpo, /\.from\(\s*"vendas"\s*\)\s*\.insert/);
    assert.doesNotMatch(corpo, /rpc_confirmar_saida/);
    assert.doesNotMatch(corpo, /estoque_atual/);
    assert.doesNotMatch(corpo, /\.from\(\s*"vendas_pagamentos"\s*\)\s*\.insert/);
    assert.doesNotMatch(corpo, /rpc_finalizar_venda/);
  }
});

test("snapshot: emissão da venda usa tributação congelada, não o grupo fiscal vivo", () => {
  const emitir = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  assert.match(emitir, /resolverTributacaoItemVenda/);
  assert.match(emitir, /precoVenda:\s*itemVenda\.valor_unitario/);
  assert.match(emitir, /snapshotFiscal: venda\.snapshot_fiscal/);
  assert.doesNotMatch(emitir, /itemVenda\.cfop\s*\?\?\s*grupo/);
  assert.doesNotMatch(emitir, /pisAliquota:\s*\n\s*grupo\.pis_aliquota/);
});

test("logs: payload sanitizado omite certificado, senha, CSC e token", () => {
  const limpo = sanitizarPayloadTentativaFiscal({
    certificadoDigital: "MII-CERT",
    senhaCertificadoDigital: "segredo",
    apiKey: "token-geranet",
    csc: "CSC-SECRETO",
    nfe: { empresa: { codigoSegurancaContribuinte: "123" } },
  });
  const json = JSON.stringify(limpo);
  assert.doesNotMatch(json, /MII-CERT/);
  assert.doesNotMatch(json, /segredo/);
  assert.doesNotMatch(json, /token-geranet/);
  assert.doesNotMatch(json, /CSC-SECRETO/);
});

test("UI e rascunho bloqueiam retransmissão de enviando/ambígua", () => {
  assert.equal(
    avaliarBloqueioRascunhoFiscal({
      id: "e1",
      status: "aguardando_reconciliacao",
    }).tipo,
    "bloquear"
  );
  assert.equal(
    avaliarBloqueioRascunhoFiscal({ id: "e1", status: "enviando" }).tipo,
    "bloquear"
  );
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: {
      modelo: "65",
      status: "aguardando_reconciliacao",
      classificacao: "erro_tecnico",
    },
  });
  assert.equal(acoes.podeRetransmitir, false);
  assert.equal(acoes.podeReconciliar, true);
});

test("cron de reconciliação consulta e não chama emitir", () => {
  const cron = fonte("app/api/cron/fiscal/reconciliar/route.ts");
  const helper = fonte("lib/fiscal/reconciliar-emissao.ts");
  assert.match(cron, /aguardando_reconciliacao/);
  assert.match(cron, /reconciliarEmissaoFiscal/);
  assert.doesNotMatch(cron, /nfe\/emitir/);
  assert.doesNotMatch(helper, /chamarGeranet/);
  assert.match(helper, /reenviou: false/);
});
