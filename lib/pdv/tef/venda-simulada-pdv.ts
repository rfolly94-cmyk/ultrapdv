import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { escreverMenuPwGetData } from "../../../print-agent/src/tef-getdata.mjs";
import { bibliotecaVendaNativa } from "../../../print-agent/src/tef-venda-nativa.mjs";
import { PWINFO, PWRET } from "../../../tef-2/fase-1/contrato.mjs";
import { cobrancaRealBloqueada, MENSAGEM_COBRANCA_BLOQUEADA } from "./motor";
import { SessaoVendaNativa } from "./venda-nativa";
import type { ContextoVendaPgweb, PedidoVendaPgweb } from "./venda-pgweb";

export const MENSAGEM_SIMULADA_NAO_RECEBIDA =
  "O pagamento não foi recebido e a venda não foi finalizada.";

const cliques = new Map<string, ReturnType<typeof conduzirVendaSimuladaPdv>>();

export type RetornoVendaSimulada = {
  ok: false;
  simulado: true;
  pagamentoRecebido: false;
  podeFinalizar: false;
  operacoes: [];
  estados: string[];
  status: string;
  situacao: string;
  mensagem: string;
  idempotencyKey: string;
  empresaId: string;
  terminalCodigo: string;
  vendaId: string;
};

export function rotuloEstadoSimulado(entrada: {
  situacao?: string;
  status?: string;
  codigo?: string | number;
}) {
  const status = entrada.status ?? "";
  const situacao = entrada.situacao ?? "";
  if (entrada.codigo === "EMPRESA_DIVERGENTE" || situacao === "isolada") {
    return "Recuperação necessária.";
  }
  if (status === "confirmada" || situacao === "confirmada") return "Confirmado.";
  if (status === "desfazimento_pendente") return "Desfazimento pendente.";
  if (status === "recusada" || status === "cancelada" || situacao === "recusada" || situacao === "cancelada") {
    return "Recusado.";
  }
  if (
    status === "timeout" ||
    status === "desconhecida" ||
    situacao === "falha_comunicacao" ||
    situacao === "desconhecida" ||
    situacao === "EMPRESA_DIVERGENTE"
  ) {
    return "Recuperação necessária.";
  }
  if (status === "autorizada" || situacao === "pendente" || situacao === "autorizada") {
    return "Autorizado, aguardando confirmação.";
  }
  if (
    status === "iniciada" ||
    situacao === "aguardando_captura" ||
    situacao === "aguardando_pinpad"
  ) {
    return "Aguardando cartão.";
  }
  if (situacao === "processando" || situacao === "ocupada") return "Processando.";
  return "";
}

function registrar(estados: string[], rotulo: string) {
  if (rotulo && estados[estados.length - 1] !== rotulo) estados.push(rotulo);
}

export function dllSimulada(roteiro: "aprovada" | "rede" | "recusada" | "falha" = "aprovada") {
  const resultados = new Map<number, string>();
  let etapa = 0;
  const estado = {
    inits: 0,
    confirmacoes: 0,
    novas: 0,
    params: [] as Array<[number, string]>,
  };
  const funcoes = {
    estado,
    PW_iInit() {
      estado.inits += 1;
      return PWRET.OK;
    },
    PW_iSetEnvironment() {
      return PWRET.OK;
    },
    PW_iNewTransac() {
      estado.novas += 1;
      etapa = 0;
      return PWRET.OK;
    },
    PW_iAddParam(info: number, valor: string) {
      estado.params.push([info, valor]);
      return PWRET.OK;
    },
    PW_iExecTransac(capturas: Array<Record<string, unknown>>, quantidade: number[]) {
      if (roteiro === "rede") return PWRET.TIMEOUT;
      if (etapa === 0) {
        etapa = 1;
        escreverMenuPwGetData(capturas, 0, {
          identificador: PWINFO.CURRENCY,
          prompt: "Modalidade",
          textos: ["A vista"],
          valores: ["1"],
        });
        quantidade[0] = 1;
        return PWRET.MOREDATA;
      }
      resultados.set(PWINFO.CNFREQ, roteiro === "recusada" ? "0" : "1");
      resultados.set(PWINFO.REQNUM, "1001");
      resultados.set(PWINFO.AUTLOCREF, "LOC-1");
      resultados.set(PWINFO.AUTEXTREF, "EXT-1");
      resultados.set(PWINFO.VIRTMERCH, "7711001");
      resultados.set(PWINFO.AUTHSYST, "SIMULADO");
      quantidade[0] = 0;
      return PWRET.OK;
    },
    PW_iGetResult(info: number, saida: Buffer) {
      saida.fill(0);
      const valor = resultados.get(info);
      if (valor) saida.write(valor, "latin1");
      return valor ? PWRET.OK : PWRET.NODATA;
    },
    PW_iConfirmation() {
      estado.confirmacoes += 1;
      return roteiro === "falha" ? PWRET.INVCALL : PWRET.OK;
    },
    PW_iWaitConfirmation() {
      return PWRET.OK;
    },
  };
  return {
    funcoes,
    biblioteca: bibliotecaVendaNativa(funcoes, {
      koffi: { struct() { return {}; }, array() { return "array"; } },
    }),
  };
}

function retorno(
  autorizado: ContextoVendaPgweb,
  pedido: PedidoVendaPgweb,
  resultado: { situacao?: string; status?: string; codigo?: string | number; mensagem?: string },
  estados: string[],
  mensagem = MENSAGEM_SIMULADA_NAO_RECEBIDA
): RetornoVendaSimulada {
  registrar(estados, rotuloEstadoSimulado(resultado));
  return {
    ok: false,
    simulado: true,
    pagamentoRecebido: false,
    podeFinalizar: false,
    operacoes: [],
    estados,
    status: resultado.status ?? "",
    situacao: resultado.situacao ?? "",
    mensagem,
    idempotencyKey: pedido.idempotencyKey,
    empresaId: autorizado.empresaId,
    terminalCodigo: autorizado.terminalCodigo,
    vendaId: pedido.vendaId,
  };
}

export async function conduzirVendaSimuladaPdv(input: {
  autorizado: ContextoVendaPgweb;
  pedido: PedidoVendaPgweb;
  raiz: string;
  arquivoJournal?: string;
  arquivoLivro?: string;
  biblioteca?: ReturnType<typeof bibliotecaVendaNativa>;
  roteiro?: "aprovada" | "rede" | "recusada" | "falha";
  pararEm?: "autorizada" | "confirmada";
  acao?: "vender" | "confirmar" | "retomar";
}) {
  if (!cobrancaRealBloqueada()) {
    return {
      ok: false as const,
      simulado: false as const,
      pagamentoRecebido: false as const,
      podeFinalizar: false as const,
      operacoes: [] as [],
      estados: [] as string[],
      status: "",
      situacao: "bloqueada",
      mensagem: MENSAGEM_COBRANCA_BLOQUEADA,
      idempotencyKey: input.pedido.idempotencyKey,
      empresaId: input.autorizado.empresaId,
      terminalCodigo: input.autorizado.terminalCodigo,
      vendaId: input.pedido.vendaId,
    };
  }
  const pasta = path.join(input.raiz, input.autorizado.empresaId);
  mkdirSync(pasta, { recursive: true });
  const transporte = input.biblioteca ?? dllSimulada(input.roteiro ?? "aprovada").biblioteca;
  const venda = new SessaoVendaNativa({
    autorizado: input.autorizado,
    biblioteca: transporte,
    arquivoJournal: input.arquivoJournal ?? path.join(pasta, "journal.json"),
    arquivoLivro: input.arquivoLivro ?? path.join(pasta, "livro.json"),
  });
  const estados: string[] = [];
  const inicio = await venda.iniciar();
  if (input.acao === "retomar" && (inicio.status === "autorizada" || inicio.situacao === "pendente")) {
    registrar(estados, "Recuperação necessária.");
  }
  registrar(estados, rotuloEstadoSimulado(inicio));
  const acao = input.acao ?? "vender";
  if (acao === "retomar") return retorno(input.autorizado, input.pedido, inicio, estados);
  if (acao === "confirmar") {
    const confirmada = await venda.confirmar(input.pedido.idempotencyKey);
    return retorno(input.autorizado, input.pedido, confirmada, estados);
  }
  registrar(estados, "Processando.");
  const andamento = await venda.vender(input.pedido);
  registrar(estados, rotuloEstadoSimulado(andamento));
  if (andamento.situacao === "aguardando_captura") {
    registrar(estados, "Processando.");
    const autorizada = await venda.responder({
      solicitacaoId: andamento.solicitacaoId,
      indice: 0,
      idempotencyKey: input.pedido.idempotencyKey,
    });
    registrar(estados, rotuloEstadoSimulado(autorizada));
    if (input.pararEm === "autorizada" || autorizada.status !== "autorizada") {
      return retorno(input.autorizado, input.pedido, autorizada, estados);
    }
    const confirmada = await venda.confirmar(input.pedido.idempotencyKey);
    return retorno(input.autorizado, input.pedido, confirmada, estados);
  }
  return retorno(input.autorizado, input.pedido, andamento, estados);
}

export function encaminharCliqueSimulado(input: Parameters<typeof conduzirVendaSimuladaPdv>[0]) {
  const chave = [
    input.autorizado.empresaId,
    input.autorizado.terminalCodigo,
    input.pedido.vendaId,
    input.pedido.idempotencyKey,
  ].join("|");
  const existente = cliques.get(chave);
  if (existente) return existente;
  const promessa = conduzirVendaSimuladaPdv(input).finally(() => {
    cliques.delete(chave);
  });
  cliques.set(chave, promessa);
  return promessa;
}

export function pedidoSimulado(input: {
  vendaId: string;
  idempotencyKey?: string;
  valorCentavos?: number;
  modalidade?: "debito" | "credito";
}): PedidoVendaPgweb {
  return {
    vendaId: input.vendaId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    modalidade: input.modalidade ?? "debito",
    valorCentavos: input.valorCentavos ?? 2590,
  };
}
