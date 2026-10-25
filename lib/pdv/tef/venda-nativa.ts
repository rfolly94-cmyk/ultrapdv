import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { cobrancaRealBloqueada } from "@/lib/pdv/tef/motor";
import type { StatusTef } from "@/lib/pdv/tef/regras";
import {
  VendaPgwebPdv,
  type ContextoVendaPgweb,
  type PedidoVendaPgweb,
  type ResultadoVendaPgweb,
} from "@/lib/pdv/tef/venda-pgweb";

const PAN = /\d{13,19}/;

export type RegistroVendaNativa = {
  empresaId: string;
  terminalCodigo: string;
  dispositivoId: string;
  vendaId: string;
  idempotencyKey: string;
  modalidade: "debito" | "credito" | "";
  valorCentavos: number;
  status: StatusTef;
  nsu: string;
  autorizacao: string;
  rede: string;
  finalizacao: string;
  pagamentoRecebido: false;
};

export type ResultadoVendaNativa = ResultadoVendaPgweb & {
  status: StatusTef | "";
  pagamentoRecebido: false;
  registro: RegistroVendaNativa | null;
};

type Livro = { versao: 1; registros: RegistroVendaNativa[] };

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function chaveRegistro(empresaId: string, idempotencyKey: string) {
  return `${empresaId}|${idempotencyKey}`;
}

export function statusFinanceiro(
  resultado: Pick<ResultadoVendaPgweb, "ok" | "situacao" | "codigo">,
  anterior: RegistroVendaNativa | null = null
): StatusTef | "" {
  if (resultado.codigo === "EMPRESA_DIVERGENTE" || resultado.codigo === "TERMINAL_DIVERGENTE") return "";
  if (resultado.codigo === "TRANSACAO_DESCONHECIDA") return "desconhecida";
  if (resultado.codigo === "PENDENTE" || resultado.codigo === "OCUPADO" || resultado.codigo === "PINPAD_OCUPADO") {
    return "";
  }
  if (
    resultado.ok === false &&
    typeof resultado.codigo === "number" &&
    (anterior?.status === "autorizada" || anterior?.status === "iniciada" || anterior?.status === "desfazimento_pendente")
  ) {
    return "desfazimento_pendente";
  }
  if (resultado.situacao === "confirmada") return "confirmada";
  if (resultado.situacao === "desfeita") return "desfeita";
  if (resultado.situacao === "autorizada" || resultado.situacao === "pendente") return "autorizada";
  if (resultado.situacao === "recusada") return "recusada";
  if (resultado.situacao === "cancelada") return "cancelada";
  if (resultado.situacao === "falha_comunicacao") return "timeout";
  if (resultado.situacao === "aguardando_captura" || resultado.situacao === "aguardando_pinpad") return "iniciada";
  return resultado.ok === true ? "" : "desconhecida";
}

export function encaixeFinalizacaoExistente(registro: RegistroVendaNativa | null) {
  if (!registro || cobrancaRealBloqueada() || registro.pagamentoRecebido !== false) return null;
  if (registro.status !== "confirmada") return null;
  return null;
}

function registroDe(autorizado: ContextoVendaPgweb, pedido: PedidoVendaPgweb | undefined, resultado: ResultadoVendaPgweb, anterior: RegistroVendaNativa | null): RegistroVendaNativa | null {
    const status = statusFinanceiro(resultado, anterior);
  if (!status || status === "desconhecida") return anterior;
  const base = anterior ?? {
    empresaId: autorizado.empresaId,
    terminalCodigo: autorizado.terminalCodigo,
    dispositivoId: autorizado.dispositivoId,
    vendaId: texto(resultado.vendaId) || texto(pedido?.vendaId),
    idempotencyKey: texto(pedido?.idempotencyKey),
    modalidade: resultado.modalidade || pedido?.modalidade || "",
    valorCentavos: resultado.valorCentavos || pedido?.valorCentavos || 0,
    status,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    pagamentoRecebido: false as const,
  };
  return {
    ...base,
    status,
    vendaId: texto(resultado.vendaId) || base.vendaId,
    valorCentavos: resultado.valorCentavos || base.valorCentavos,
    modalidade: resultado.modalidade || base.modalidade,
    nsu: texto(resultado.conciliacao.reqNum) || base.nsu,
    autorizacao: texto(resultado.conciliacao.locRef) || base.autorizacao,
    rede: texto(resultado.conciliacao.authSyst) || base.rede,
    finalizacao: texto(resultado.conciliacao.extRef) || base.finalizacao,
    pagamentoRecebido: false,
  };
}

function semCartao(livro: Livro) {
  const serial = JSON.stringify(livro);
  if (PAN.test(serial) || /"pan"|"pin"|"senha"/i.test(serial)) {
    throw new Error("Persistência TEF tentou gravar dado sensível.");
  }
}

export class SessaoVendaNativa {
  private readonly venda: VendaPgwebPdv;
  private readonly autorizado: ContextoVendaPgweb;
  private readonly arquivoLivro: string;
  private registros = new Map<string, RegistroVendaNativa>();

  constructor(input: {
    autorizado: ContextoVendaPgweb;
    biblioteca: { real?: boolean };
    arquivoJournal: string;
    arquivoLivro: string;
  }) {
    this.autorizado = input.autorizado;
    this.arquivoLivro = input.arquivoLivro;
    this.venda = new VendaPgwebPdv({
      autorizado: input.autorizado,
      biblioteca: input.biblioteca,
      arquivo: input.arquivoJournal,
    });
    this.ler();
  }

  private ler() {
    try {
      const livro = JSON.parse(readFileSync(this.arquivoLivro, "utf8")) as Livro;
      if (livro?.versao !== 1 || !Array.isArray(livro.registros)) return;
      for (const registro of livro.registros) {
        if (registro.pagamentoRecebido !== false) continue;
        this.registros.set(chaveRegistro(registro.empresaId, registro.idempotencyKey), {
          ...registro,
          pagamentoRecebido: false,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private gravar() {
    const livro: Livro = { versao: 1, registros: [...this.registros.values()] };
    semCartao(livro);
    mkdirSync(dirname(this.arquivoLivro), { recursive: true });
    writeFileSync(this.arquivoLivro, JSON.stringify(livro));
  }

  private publicar(resultado: ResultadoVendaPgweb, pedido?: PedidoVendaPgweb): ResultadoVendaNativa {
    const isolada = resultado.codigo === "EMPRESA_DIVERGENTE" || resultado.codigo === "TERMINAL_DIVERGENTE";
    const desconhecida = resultado.codigo === "TRANSACAO_DESCONHECIDA";
    const chave = texto(pedido?.idempotencyKey);
    const anterior = chave ? this.registros.get(chaveRegistro(this.autorizado.empresaId, chave)) ?? null : null;
    const registro = isolada || desconhecida ? null : registroDe(this.autorizado, pedido, resultado, anterior);
    if (registro?.idempotencyKey) {
      this.registros.set(chaveRegistro(registro.empresaId, registro.idempotencyKey), registro);
      this.gravar();
    }
    return {
      ...resultado,
      status: registro?.status ?? (desconhecida ? "desconhecida" : ""),
      pagamentoRecebido: false,
      registro,
    };
  }

  async iniciar() {
    return this.publicar(await this.venda.iniciar());
  }

  async vender(pedido: PedidoVendaPgweb) {
    const aberto = [...this.registros.values()].find(
      (item) =>
        item.empresaId === this.autorizado.empresaId &&
        item.terminalCodigo === this.autorizado.terminalCodigo &&
        (item.status === "autorizada" || item.status === "desfazimento_pendente" || item.status === "iniciada") &&
        item.idempotencyKey !== pedido.idempotencyKey
    );
    if (aberto) {
      return {
        ok: false,
        pagamentoAprovado: false,
        cobrancaReal: false,
        transacaoConfirmada: false,
        repetida: false,
        situacao: "pendente",
        codigo: "PENDENTE",
        mensagem: "Há transação pendente neste terminal. Nenhuma nova venda foi iniciada.",
        solicitacaoId: "",
        vendaId: "",
        valorCentavos: 0,
        empresaId: this.autorizado.empresaId,
        terminalCodigo: this.autorizado.terminalCodigo,
        modalidade: "",
        conciliacao: { reqNum: "", locRef: "", extRef: "", authSyst: "" },
        status: "",
        pagamentoRecebido: false,
        registro: null,
      };
    }
    return this.publicar(await this.venda.vender(pedido), pedido);
  }

  async responder(pedido: { solicitacaoId: string; indice?: number; valor?: string; cancelar?: boolean; idempotencyKey: string }) {
    const resultado = await this.venda.responder(pedido);
    return this.publicar(resultado, {
      vendaId: resultado.vendaId,
      valorCentavos: resultado.valorCentavos,
      idempotencyKey: pedido.idempotencyKey,
      modalidade: resultado.modalidade || "debito",
    });
  }

  private recusarOutraEmpresa(idempotencyKey: string) {
    return [...this.registros.values()].find(
      (item) => item.idempotencyKey === idempotencyKey && item.empresaId !== this.autorizado.empresaId
    );
  }

  private desconhecida(): ResultadoVendaNativa {
    return {
      ok: false,
      pagamentoAprovado: false,
      cobrancaReal: false,
      transacaoConfirmada: false,
      repetida: false,
      situacao: "desconhecida",
      codigo: "TRANSACAO_DESCONHECIDA",
      mensagem: "A transação não pertence a este terminal.",
      solicitacaoId: "",
      vendaId: "",
      valorCentavos: 0,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      modalidade: "",
      conciliacao: { reqNum: "", locRef: "", extRef: "", authSyst: "" },
      status: "desconhecida",
      pagamentoRecebido: false,
      registro: null,
    };
  }

  async confirmar(idempotencyKey: string) {
    if (this.recusarOutraEmpresa(idempotencyKey)) {
      return {
        ...this.desconhecida(),
        codigo: "EMPRESA_DIVERGENTE",
        situacao: "isolada",
        status: "",
        mensagem: "A transação pendente pertence a outra empresa. Nenhuma operação foi executada.",
      };
    }
    const registro = this.registros.get(chaveRegistro(this.autorizado.empresaId, idempotencyKey));
    if (!registro || registro.empresaId !== this.autorizado.empresaId) return this.desconhecida();
    const resultado = await this.venda.confirmar();
    return this.publicar(resultado, {
      vendaId: registro.vendaId,
      valorCentavos: registro.valorCentavos,
      idempotencyKey,
      modalidade: registro.modalidade || "debito",
    });
  }

  async desfazer(idempotencyKey: string, motivo: "desfazer_manual" | "queda" | "comunicacao" | "aborto" | "fiscal" = "desfazer_manual") {
    if (this.recusarOutraEmpresa(idempotencyKey)) {
      return {
        ...this.desconhecida(),
        codigo: "EMPRESA_DIVERGENTE",
        situacao: "isolada",
        status: "",
        mensagem: "A transação pendente pertence a outra empresa. Nenhuma operação foi executada.",
      };
    }
    const registro = this.registros.get(chaveRegistro(this.autorizado.empresaId, idempotencyKey));
    if (!registro) return this.desconhecida();
    const resultado = await this.venda.desfazer(motivo);
    return this.publicar(resultado, {
      vendaId: registro.vendaId,
      valorCentavos: registro.valorCentavos,
      idempotencyKey,
      modalidade: registro.modalidade || "debito",
    });
  }
}
