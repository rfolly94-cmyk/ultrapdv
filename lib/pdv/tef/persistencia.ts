import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { recebedorFiscal, type DadosFiscaisMotor } from "@/lib/pdv/tef/fiscal-motor";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  iniciarOperacao,
  liberarConfirmacao,
  listarPendencias,
  marcarPendenciaAdministrativa,
  marcarConfirmada,
  marcarDesfeita,
  memoriaTefVazia,
  operacoesParaGravar,
  pedirDesfazimento,
  recuperarSimulacao,
  registrarResultado,
  reservarOperacoesParaVenda,
  salvarConfigEmpresa,
  vincularVenda,
  type MemoriaTef,
  type OperacaoTef,
  type TerminalTef,
} from "@/lib/pdv/tef/orquestracao";
import {
  decidirPorEvidencia,
  hashComprovante,
  juntarComprovante,
} from "@/lib/pdv/tef/ambiente-transacao";
import { credencialPayGoDoAmbiente } from "@/lib/pdv/tef/configuracao-paygo";
import {
  formaDaModalidadeEfetiva,
  mensagemFormaAusente,
  tipoCartaoOficial,
} from "@/lib/pdv/tef/modalidade-efetiva";
import {
  dadosFiscaisProvaTef,
  hashSegredoVinculo,
  verificarAmbienteTef,
  verificarIdentidadeTef,
  verificarModalidadeTef,
  verificarProvaTef,
  type CamposProvaTef,
} from "@/lib/pdv/tef/prova";
import {
  operacaoImpedeDiagnosticoPinpad,
  STATUS_TEF_ABERTOS,
  type ModalidadeTef,
  type ResultadoConectorTef,
} from "@/lib/pdv/tef/regras";
import type { TerminalTefAtivo } from "@/lib/pdv/tef/estado-terminal";
import type {
  ConfiguracaoSincronizacao,
  TerminalSincronizacao,
} from "@/lib/pdv/tef/sincronizar-vinculo";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export class ErroTef extends Error {
  status: number;

  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.name = "ErroTef";
    this.status = status;
  }
}

type Linha = Record<string, unknown>;

function admin() {
  return createAdminClient();
}

function migracaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST205|42P01|does not exist|schema cache/i.test(texto);
}

function colunaServidorAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|servidor_homologacao|servidor_producao|servidor_confirmado/i.test(texto);
}

function colunaHomologacaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|cnpj_instalacao|cnpj_producao|ponto_homologacao/i.test(texto);
}

function colunaOperacaoManualAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|permitir_operacao_manual/i.test(texto);
}

function colunaAmbienteAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|ambiente_efetivo|ponto_efetivo|host_efetivo|comprovante_sha256|motivo_ambiente/i.test(
    texto
  );
}

function colunaModalidadeAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /modalidade_solicitada|modalidade_efetiva|tipo_cartao_paygo/i.test(texto);
}

function colunaFiscalCartaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|bandeira_nome|cnpj_credenciadora|cnpj_recebedor|instituicao/i.test(texto);
}

function habilitacaoTefVazia(migracaoPendente: boolean) {
  return {
    habilitado: false,
    plataformaHabilitada: false,
    empresaHabilitada: false,
    permitirOperacaoManual: false,
    operacaoManualDisponivel: false,
    migracaoPendente,
    ambiente: "homologacao",
    ambienteGravado: "" as "" | "homologacao" | "producao",
    estabelecimento: "",
    pontoCaptura: "",
  };
}

function linhaOperacao(linha: Linha): OperacaoTef {
  return {
    id: String(linha.id),
    empresaId: String(linha.empresa_id),
    terminalId: String(linha.terminal_id),
    identificador: String(linha.identificador),
    idempotencyKey: String(linha.idempotency_key),
    modalidade: linha.modalidade === "credito" ? "credito" : "debito",
    modalidadeSolicitada:
      linha.modalidade_solicitada === "credito" || linha.modalidade_solicitada === "debito"
        ? linha.modalidade_solicitada
        : linha.modalidade === "credito"
          ? "credito"
          : "debito",
    modalidadeEfetiva:
      linha.modalidade_efetiva === "credito" || linha.modalidade_efetiva === "debito"
        ? linha.modalidade_efetiva
        : null,
    tipoCartaoPayGo:
      typeof linha.tipo_cartao_paygo === "number" &&
      Number.isInteger(linha.tipo_cartao_paygo)
        ? linha.tipo_cartao_paygo
        : null,
    valorCentavos: Number(linha.valor_centavos),
    status: linha.status as OperacaoTef["status"],
    nsu: linha.nsu ? String(linha.nsu) : null,
    autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
    rede: linha.rede ? String(linha.rede) : null,
    finalizacao: linha.finalizacao ? String(linha.finalizacao) : null,
    vendaId: linha.venda_id ? String(linha.venda_id) : null,
    teste: linha.teste === true,
    desafio: linha.desafio ? String(linha.desafio) : "",
    usuarioId: linha.usuario_id ? String(linha.usuario_id) : "",
    segredoVinculoHash: linha.segredo_vinculo_hash
      ? String(linha.segredo_vinculo_hash)
      : "",
    vendaIdempotencyKey: linha.venda_idempotency_key
      ? String(linha.venda_idempotency_key)
      : "",
    ambienteEfetivo:
      linha.ambiente_efetivo === "producao" ||
      linha.ambiente_efetivo === "homologacao" ||
      linha.ambiente_efetivo === "desconhecido"
        ? linha.ambiente_efetivo
        : "",
    pontoEfetivo: linha.ponto_efetivo ? String(linha.ponto_efetivo) : "",
    hostEfetivo: linha.host_efetivo ? String(linha.host_efetivo) : "",
    comprovanteSha256: linha.comprovante_sha256 ? String(linha.comprovante_sha256) : "",
    motivoAmbiente: linha.motivo_ambiente ? String(linha.motivo_ambiente) : "",
  };
}

function payloadOperacao(operacao: OperacaoTef) {
  return {
    id: operacao.id,
    empresa_id: operacao.empresaId,
    terminal_id: operacao.terminalId,
    identificador: operacao.identificador,
    idempotency_key: operacao.idempotencyKey,
    modalidade: operacao.modalidade,
    modalidade_solicitada: operacao.modalidadeSolicitada ?? operacao.modalidade,
    modalidade_efetiva: operacao.modalidadeEfetiva ?? null,
    tipo_cartao_paygo: operacao.tipoCartaoPayGo ?? null,
    valor_centavos: operacao.valorCentavos,
    status: operacao.status,
    nsu: operacao.nsu,
    autorizacao: operacao.autorizacao,
    rede: operacao.rede,
    finalizacao: operacao.finalizacao,
    venda_id: operacao.vendaId,
    teste: operacao.teste,
    desafio: operacao.desafio,
    usuario_id: operacao.usuarioId,
    segredo_vinculo_hash: operacao.segredoVinculoHash,
    venda_idempotency_key: operacao.vendaIdempotencyKey || null,
    ambiente_efetivo: operacao.ambienteEfetivo || "",
    ponto_efetivo: (operacao.pontoEfetivo || "").slice(0, 32),
    host_efetivo: (operacao.hostEfetivo || "").slice(0, 120),
    comprovante_sha256: (operacao.comprovanteSha256 || "").slice(0, 64),
    motivo_ambiente: (operacao.motivoAmbiente || "").slice(0, 400),
    updated_at: new Date().toISOString(),
  };
}

async function gravarDadosFiscaisOperacao(
  cliente: ReturnType<typeof admin>,
  operacao: OperacaoTef
) {
  const { error } = await cliente
    .from("tef_operacoes")
    .update({
      bandeira_nome: operacao.bandeiraNome ?? null,
      cnpj_credenciadora: operacao.cnpjCredenciadora ?? null,
      cnpj_recebedor: operacao.cnpjRecebedor ?? null,
      instituicao: operacao.instituicao ?? null,
    } as never)
    .eq("id", operacao.id)
    .eq("empresa_id", operacao.empresaId);
  if (error && !colunaFiscalCartaoAusente(error)) {
    throw new ErroTef("Não foi possível gravar os dados fiscais do TEF.", 500);
  }
}

const COLUNAS_FISCAIS_TEF =
  "id, modalidade, valor_centavos, status, autorizacao, nsu, rede, bandeira_nome, cnpj_credenciadora, cnpj_recebedor, instituicao";
const COLUNAS_FISCAIS_TEF_BASE =
  "id, modalidade, valor_centavos, status, autorizacao, nsu, rede";

function mapearOperacaoFiscal(linha: Linha) {
  return {
    id: String(linha.id),
    modalidade: linha.modalidade === "credito" ? ("credito" as const) : ("debito" as const),
    valorCentavos: Number(linha.valor_centavos),
    status: String(linha.status),
    autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
    nsu: linha.nsu ? String(linha.nsu) : null,
    rede: linha.rede ? String(linha.rede) : null,
    bandeiraNome: linha.bandeira_nome ? String(linha.bandeira_nome) : null,
    cnpjCredenciadora: linha.cnpj_credenciadora ? String(linha.cnpj_credenciadora) : null,
    cnpjRecebedor: linha.cnpj_recebedor ? String(linha.cnpj_recebedor) : null,
    instituicao: linha.instituicao ? String(linha.instituicao) : null,
  };
}

async function consultarOperacoesFiscais(
  filtro: (consulta: any) => any
) {
  const cliente = admin();
  const completa = await filtro(cliente.from("tef_operacoes").select(COLUNAS_FISCAIS_TEF));
  if (!completa.error) {
    return ((completa.data ?? []) as Linha[]).map(mapearOperacaoFiscal);
  }
  if (!colunaFiscalCartaoAusente(completa.error)) {
    if (migracaoAusente(completa.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os dados fiscais do TEF.", 500);
  }
  const base = await filtro(cliente.from("tef_operacoes").select(COLUNAS_FISCAIS_TEF_BASE));
  if (base.error) {
    if (migracaoAusente(base.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os dados fiscais do TEF.", 500);
  }
  return ((base.data ?? []) as Linha[]).map(mapearOperacaoFiscal);
}

export async function listarDadosFiscaisTefDaVenda(empresaId: string, vendaId: string) {
  return consultarOperacoesFiscais((consulta) =>
    consulta.eq("empresa_id", empresaId).eq("venda_id", vendaId)
  );
}

export async function listarFiscaisMotorDaVenda(empresaId: string, vendaId: string) {
  const cliente = admin();
  const consulta = await cliente
    .from("tef_motor_fiscal")
    .select("id, modalidade, valor_centavos, autorizacao, bandeira_nome, rede, instituicao, cnpj_credenciadora, cnpj_recebedor")
    .eq("empresa_id", empresaId)
    .eq("venda_id", vendaId);
  if (consulta.error) {
    if (!migracaoAusente(consulta.error)) {
      throw new ErroTef("Não foi possível consultar os dados fiscais do TEF.", 500);
    }
  }
  const linhas = consulta.error ? [] : ((consulta.data ?? []) as Linha[]);
  if (linhas.length > 0) {
    return linhas.map(mapearFiscalMotor);
  }
  const venda = await admin()
    .from("vendas")
    .select("snapshot_fiscal")
    .eq("id", vendaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const snapshot = venda.data?.snapshot_fiscal;
  const guardados = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as { tefMotorFiscal?: unknown }).tefMotorFiscal
    : null;
  if (!Array.isArray(guardados)) {
    return [];
  }
  return guardados.map((item) => mapearFiscalMotor(item as Linha));
}

function mapearFiscalMotor(linha: Linha) {
  return {
    id: String(linha.id ?? linha.chave ?? ""),
    modalidade: linha.modalidade === "credito" ? ("credito" as const) : ("debito" as const),
    valorCentavos: Number(linha.valor_centavos),
    status: "confirmada",
    autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
    nsu: null,
    rede: linha.rede ? String(linha.rede) : null,
    bandeiraNome: linha.bandeira_nome ? String(linha.bandeira_nome) : null,
    cnpjCredenciadora: linha.cnpj_credenciadora ? String(linha.cnpj_credenciadora) : null,
    cnpjRecebedor: linha.cnpj_recebedor ? String(linha.cnpj_recebedor) : null,
    instituicao: linha.instituicao ? String(linha.instituicao) : null,
  };
}

export async function gravarFiscalMotorNaVenda(input: {
  empresaId: string;
  vendaId: string;
  itens: Array<{ chave: string; valorCentavos: number; fiscal: DadosFiscaisMotor }>;
}) {
  if (input.itens.length === 0) {
    return;
  }
  const cliente = admin();
  const venda = await cliente
    .from("vendas")
    .select("id")
    .eq("id", input.vendaId)
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  if (venda.error || !venda.data) {
    return;
  }
  const empresa = await cliente.from("empresas").select("cnpj").eq("id", input.empresaId).maybeSingle();
  const cnpjEmpresa = empresa.data?.cnpj ? String(empresa.data.cnpj) : null;
  for (const item of input.itens) {
    const modalidade = item.chave.split(":").at(-2);
    if (modalidade !== "debito" && modalidade !== "credito") {
      continue;
    }
    if (!item.fiscal.autorizacao && !item.fiscal.bandeiraNome && !item.fiscal.cnpjCredenciadora) {
      continue;
    }
    const linha = {
      empresa_id: input.empresaId,
      venda_id: input.vendaId,
      chave: item.chave,
      modalidade,
      valor_centavos: item.valorCentavos,
      autorizacao: item.fiscal.autorizacao,
      bandeira_nome: item.fiscal.bandeiraNome,
      rede: item.fiscal.rede,
      instituicao: item.fiscal.instituicao,
      cnpj_credenciadora: item.fiscal.cnpjCredenciadora,
      cnpj_recebedor: recebedorFiscal(item.fiscal, cnpjEmpresa),
    };
    await guardarSnapshotFiscalMotor(cliente, input.empresaId, input.vendaId, linha);
    await completarPagamentoFiscal(cliente, input.empresaId, input.vendaId, linha);
    const existente = await cliente
      .from("tef_motor_fiscal")
      .select("id, venda_id, autorizacao, bandeira_nome, rede, instituicao, cnpj_credenciadora, cnpj_recebedor")
      .eq("empresa_id", input.empresaId)
      .eq("chave", item.chave)
      .maybeSingle();
    if (existente.error) {
      continue;
    }
    if (existente.data && String(existente.data.venda_id) !== input.vendaId) {
      continue;
    }
    if (existente.data) {
      const atual = existente.data as Linha;
      const patch: Record<string, string> = {};
      const campos = ["autorizacao", "bandeira_nome", "rede", "instituicao", "cnpj_credenciadora", "cnpj_recebedor"] as const;
      for (const campo of campos) {
        const novo = linha[campo];
        if (!atual[campo] && novo) {
          patch[campo] = novo;
        }
      }
      if (Object.keys(patch).length > 0) {
        await cliente.from("tef_motor_fiscal").update(patch).eq("id", atual.id).eq("empresa_id", input.empresaId);
      }
      continue;
    }
    await cliente.from("tef_motor_fiscal").insert(linha);
  }
}

async function completarPagamentoFiscal(
  cliente: ReturnType<typeof admin>,
  empresaId: string,
  vendaId: string,
  linha: { modalidade: string; valor_centavos: number; autorizacao: string | null; bandeira_nome: string | null }
) {
  if (!linha.autorizacao && !linha.bandeira_nome) {
    return;
  }
  const codigo = linha.modalidade === "credito" ? "03" : "04";
  const pagamentos = await cliente
    .from("vendas_pagamentos")
    .select("id, valor, bandeira, autorizacao")
    .eq("empresa_id", empresaId)
    .eq("venda_id", vendaId)
    .eq("codigo_fiscal", codigo);
  if (pagamentos.error || !pagamentos.data) {
    return;
  }
  const alvo = pagamentos.data.find((pagamento) => Math.round(Number(pagamento.valor ?? 0) * 100) === linha.valor_centavos);
  if (!alvo || String(alvo.autorizacao ?? "").trim() || String(alvo.bandeira ?? "").trim()) {
    return;
  }
  await cliente
    .from("vendas_pagamentos")
    .update({
      autorizacao: linha.autorizacao,
      bandeira: linha.bandeira_nome,
    })
    .eq("id", alvo.id)
    .eq("empresa_id", empresaId)
    .eq("venda_id", vendaId);
}

async function guardarSnapshotFiscalMotor(
  cliente: ReturnType<typeof admin>,
  empresaId: string,
  vendaId: string,
  linha: {
    chave: string;
    modalidade: string;
    valor_centavos: number;
    autorizacao: string | null;
    bandeira_nome: string | null;
    rede: string | null;
    instituicao: string | null;
    cnpj_credenciadora: string | null;
    cnpj_recebedor: string | null;
  }
) {
  const atual = await cliente
    .from("vendas")
    .select("snapshot_fiscal")
    .eq("id", vendaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (atual.error || !atual.data) {
    return;
  }
  const base = atual.data.snapshot_fiscal && typeof atual.data.snapshot_fiscal === "object" && !Array.isArray(atual.data.snapshot_fiscal)
    ? { ...(atual.data.snapshot_fiscal as Record<string, unknown>) }
    : {};
  const anteriores = Array.isArray(base.tefMotorFiscal) ? base.tefMotorFiscal : [];
  const fiscal = {
    chave: linha.chave,
    modalidade: linha.modalidade,
    valor_centavos: linha.valor_centavos,
    autorizacao: linha.autorizacao,
    bandeira_nome: linha.bandeira_nome,
    rede: linha.rede,
    instituicao: linha.instituicao,
    cnpj_credenciadora: linha.cnpj_credenciadora,
    cnpj_recebedor: linha.cnpj_recebedor,
  };
  await cliente
    .from("vendas")
    .update({
      snapshot_fiscal: {
        ...base,
        tefMotorFiscal: [
          ...anteriores.filter((item) => !item || typeof item !== "object" || (item as { chave?: unknown }).chave !== linha.chave),
          fiscal,
        ],
      },
    })
    .eq("id", vendaId)
    .eq("empresa_id", empresaId);
}

export async function listarDadosFiscaisTefPorIds(empresaId: string, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  return consultarOperacoesFiscais((consulta) =>
    consulta.eq("empresa_id", empresaId).in("id", ids)
  );
}

const COLUNAS_OPERACAO_TEF_BASE =
  "id, empresa_id, terminal_id, identificador, idempotency_key, modalidade, valor_centavos, status, nsu, autorizacao, rede, finalizacao, venda_id, teste, desafio, usuario_id, segredo_vinculo_hash, venda_idempotency_key, ambiente_efetivo, ponto_efetivo, host_efetivo, comprovante_sha256, motivo_ambiente";

const COLUNAS_OPERACAO_TEF = `${COLUNAS_OPERACAO_TEF_BASE}, modalidade_solicitada, modalidade_efetiva, tipo_cartao_paygo`;

async function lerLinhasOperacao(
  consulta: (
    colunas: string
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
) {
  const completa = await consulta(COLUNAS_OPERACAO_TEF);
  if (!completa.error) {
    return completa.data;
  }
  if (!colunaModalidadeAusente(completa.error)) {
    return exigirTabela(Promise.resolve(completa));
  }
  const base = await consulta(COLUNAS_OPERACAO_TEF_BASE);
  return exigirTabela(Promise.resolve(base));
}

async function exigirTabela<T>(consulta: PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>) {
  const { data, error } = await consulta;
  if (error) {
    if (migracaoAusente(error)) {
      const detalhe = colunaAmbienteAusente(error)
        ? " Aplique supabase/migrations/20261013020000_tef_ambiente_efetivo.sql. A aplicação não altera NFC-e, vendas nem operações já gravadas."
        : "";
      throw new ErroTef(
        `A estrutura de TEF ainda não foi aplicada neste ambiente.${detalhe}`,
        503
      );
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  return data;
}

type ClienteLeitura = {
  from: (tabela: string) => {
    select: (colunas: string) => any;
  };
};

export async function lerHabilitacaoTef(
  supabase: ClienteLeitura,
  empresaId: string
) {
  const plataforma = await supabase
    .from("tef_plataforma")
    .select("habilitada")
    .eq("id", true)
    .maybeSingle();
  if (plataforma.error) {
    if (migracaoAusente(plataforma.error)) {
      return habilitacaoTefVazia(true);
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  const config = await supabase
    .from("tef_configuracoes")
    .select("habilitado, ambiente, estabelecimento, ponto_captura")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (config.error) {
    if (migracaoAusente(config.error)) {
      return habilitacaoTefVazia(true);
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  const manual = await supabase
    .from("tef_configuracoes")
    .select("permitir_operacao_manual")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  let permitirOperacaoManual = false;
  let operacaoManualDisponivel = false;
  if (manual.error) {
    if (!colunaOperacaoManualAusente(manual.error)) {
      if (migracaoAusente(manual.error)) {
        return habilitacaoTefVazia(true);
      }
      throw new ErroTef("Não foi possível consultar o TEF.", 500);
    }
  } else {
    operacaoManualDisponivel = true;
    permitirOperacaoManual = manual.data?.permitir_operacao_manual === true;
  }
  const empresaHabilitada = config.data?.habilitado === true;
  const plataformaHabilitada = plataforma.data?.habilitada === true;
  const ambienteGravado =
    config.data?.ambiente === "producao" || config.data?.ambiente === "homologacao"
      ? config.data.ambiente
      : "";
  return {
    habilitado: plataformaHabilitada && empresaHabilitada,
    plataformaHabilitada,
    empresaHabilitada,
    permitirOperacaoManual,
    operacaoManualDisponivel,
    migracaoPendente: false,
    ambiente: config.data?.ambiente ? String(config.data.ambiente) : "homologacao",
    ambienteGravado,
    estabelecimento: config.data?.estabelecimento
      ? String(config.data.estabelecimento)
      : "",
    pontoCaptura: config.data?.ponto_captura ? String(config.data.ponto_captura) : "",
  };
}

async function carregarMemoria(
  empresaId: string,
  dispositivoId: string,
  idempotencyKey?: string
) {
  const cliente = admin();
  const memoria = memoriaTefVazia();
  memoria.criarId = () => randomUUID();
  const plataforma = await exigirTabela(
    cliente.from("tef_plataforma").select("habilitada").eq("id", true).maybeSingle()
  );
  memoria.plataformaHabilitada = plataforma?.habilitada === true;
  const config = await exigirTabela(
    cliente
      .from("tef_configuracoes")
      .select("habilitado, ambiente, estabelecimento, ponto_captura")
      .eq("empresa_id", empresaId)
      .maybeSingle()
  );
  if (config) {
    salvarConfigEmpresa(memoria, empresaId, {
      habilitado: config.habilitado === true,
      ambiente: config.ambiente === "producao" ? "producao" : "homologacao",
      estabelecimento: String(config.estabelecimento ?? ""),
      pontoCaptura: String(config.ponto_captura ?? ""),
    });
  }
  const terminais = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select(
        "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, estabelecimento, ponto_captura, revogada_em"
      )
      .eq("dispositivo_id", dispositivoId)
  );
  memoria.terminais = ((terminais ?? []) as Linha[]).map(
    (linha): TerminalTef => ({
      id: String(linha.id),
      empresaId: String(linha.empresa_id),
      codigo: String(linha.codigo),
      dispositivoId: String(linha.dispositivo_id),
      ativo: linha.ativo !== false,
      chavePublica: linha.chave_publica ? String(linha.chave_publica) : "",
      estabelecimento: linha.estabelecimento ? String(linha.estabelecimento) : "",
      pontoCaptura: linha.ponto_captura ? String(linha.ponto_captura) : "",
      revogadaEm: linha.revogada_em ? String(linha.revogada_em) : null,
    })
  );
  const nosso = memoria.terminais.find(
    (item) => item.empresaId === empresaId && item.ativo
  );
  if (nosso) {
    const abertas = await lerLinhasOperacao((colunas) =>
      cliente
        .from("tef_operacoes")
        .select(colunas)
        .eq("empresa_id", empresaId)
        .eq("terminal_id", nosso.id)
        .in("status", [...STATUS_TEF_ABERTOS])
    );
    memoria.operacoes = ((abertas ?? []) as Linha[]).map(linhaOperacao);
  }
  if (idempotencyKey) {
    const existente = (await lerLinhasOperacao((colunas) =>
      cliente
        .from("tef_operacoes")
        .select(colunas)
        .eq("empresa_id", empresaId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
    )) as Linha | null;
    if (existente && !memoria.operacoes.some((item) => item.id === String(existente.id))) {
      memoria.operacoes.push(linhaOperacao(existente));
    }
  }
  return { cliente, memoria, antes: memoria.operacoes.map((item) => ({ ...item })) };
}

async function gravarMemoria(
  cliente: ReturnType<typeof admin>,
  antes: OperacaoTef[],
  memoria: MemoriaTef,
  empresaId: string,
  terminaisAntes: TerminalTef[]
) {
  for (const terminal of memoria.terminais) {
    if (terminal.empresaId !== empresaId) {
      continue;
    }
    if (terminaisAntes.some((item) => item.id === terminal.id)) {
      const anterior = terminaisAntes.find((item) => item.id === terminal.id);
      if (
        terminal.chavePublica &&
        anterior &&
        terminal.chavePublica !== anterior.chavePublica
      ) {
        const atualizacao = await cliente
          .from("tef_terminais")
          .update({ chave_publica: terminal.chavePublica })
          .eq("id", terminal.id)
          .eq("empresa_id", empresaId);
        if (atualizacao.error) {
          throw new ErroTef("Não foi possível registrar a chave do terminal TEF.", 500);
        }
      }
      continue;
    }
    const { error } = await cliente.from("tef_terminais").insert({
      id: terminal.id,
      empresa_id: empresaId,
      codigo: terminal.codigo,
      dispositivo_id: terminal.dispositivoId,
      ativo: true,
      chave_publica: terminal.chavePublica,
    });
    if (error) {
      if (error.code === "23505") {
        throw new ErroTef("Este terminal já está vinculado a outra empresa.", 409);
      }
      throw new ErroTef("Não foi possível registrar o terminal TEF.", 500);
    }
  }
  for (const operacao of operacoesParaGravar(antes, memoria.operacoes, empresaId)) {
    const payload = payloadOperacao(operacao);
    const nova = !antes.some((item) => item.id === operacao.id);
    const gravacao = nova
      ? await cliente.from("tef_operacoes").insert(payload)
      : await cliente
          .from("tef_operacoes")
          .update(payload)
          .eq("id", operacao.id)
          .eq("empresa_id", empresaId);
    let error = gravacao.error;
    if (error && colunaModalidadeAusente(error)) {
      const resto: Record<string, unknown> = { ...payload };
      delete resto.modalidade_solicitada;
      delete resto.modalidade_efetiva;
      delete resto.tipo_cartao_paygo;
      const reservaModalidade = nova
        ? await cliente.from("tef_operacoes").insert(resto)
        : await cliente
            .from("tef_operacoes")
            .update(resto)
            .eq("id", operacao.id)
            .eq("empresa_id", empresaId);
      error = reservaModalidade.error;
    }
    if (error && colunaAmbienteAusente(error)) {
      const resto: Record<string, unknown> = { ...payload };
      delete resto.modalidade_solicitada;
      delete resto.modalidade_efetiva;
      delete resto.tipo_cartao_paygo;
      delete resto.ambiente_efetivo;
      delete resto.ponto_efetivo;
      delete resto.host_efetivo;
      delete resto.comprovante_sha256;
      delete resto.motivo_ambiente;
      const reserva = nova
        ? await cliente.from("tef_operacoes").insert(resto)
        : await cliente
            .from("tef_operacoes")
            .update({
              status: payload.status,
              nsu: payload.nsu,
              autorizacao: payload.autorizacao,
              rede: payload.rede,
              finalizacao: payload.finalizacao,
              venda_id: payload.venda_id,
              teste: payload.teste,
              updated_at: payload.updated_at,
            })
            .eq("id", operacao.id)
            .eq("empresa_id", empresaId);
      error = reserva.error;
    }
    if (error) {
      if (error.code === "23505") {
        throw new ErroTef("Este terminal TEF já está em uma operação.", 409);
      }
      throw new ErroTef("Não foi possível gravar a operação TEF.", 500);
    }
  }
}

export async function iniciarTefPersistido(input: {
  empresaId: string;
  usuarioId: string;
  dispositivoId: string;
  modalidade: ModalidadeTef;
  valorCentavos: number;
  idempotencyKey: string;
  chavePublica: string;
  assinaturaIdentidade: string;
  grupoVenda?: string;
}) {
  if (
    !verificarIdentidadeTef(
      input.chavePublica,
      input.dispositivoId,
      input.assinaturaIdentidade
    )
  ) {
    throw new ErroTef("O Connector não comprovou a identidade do terminal.", 403);
  }
  const { cliente, memoria, antes } = await carregarMemoria(
    input.empresaId,
    input.dispositivoId,
    input.idempotencyKey
  );
  const terminaisAntes = memoria.terminais.map((item) => ({ ...item }));
  const proprio = memoria.terminais.find(
    (item) => item.empresaId === input.empresaId && item.ativo && !item.revogadaEm
  );
  if (!proprio?.chavePublica) {
    throw new ErroTef("Este computador ainda não foi autorizado pelo estabelecimento.", 403);
  }
  if (proprio.chavePublica !== input.chavePublica) {
    throw new ErroTef("A chave deste Connector não confere com o terminal autorizado.", 403);
  }
  const configEmpresa = memoria.configuracoes[input.empresaId];
  if (configEmpresa?.ambiente === "producao") {
    const referencia = await referenciasProducaoTef(cliente, input.empresaId, proprio.id);
    if (!referencia.pontoOficial || !referencia.hostOficial) {
      throw new ErroTef(
        "Defina o ponto e o servidor de produção do TEF antes de cobrar. A operação não foi iniciada. Abra Configurações, Financeiro, TEF.",
        409
      );
    }
  }
  const vinculoSegredo = randomBytes(32).toString("hex");
  const resultado = iniciarOperacao(memoria, {
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    terminalCodigo: proprio.codigo,
    modalidade: input.modalidade,
    valorCentavos: input.valorCentavos,
    identificador: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    usuarioId: input.usuarioId,
    desafio: randomBytes(32).toString("hex"),
    vinculoSegredo,
    segredoVinculoHash: hashSegredoVinculo(vinculoSegredo),
    chavePublica: input.chavePublica,
    estabelecimento: configEmpresa?.estabelecimento,
    pontoCaptura: configEmpresa?.pontoCaptura,
    exigirTerminalPareado: true,
    grupoVenda: input.grupoVenda,
  });
  if (!resultado.ok) {
    throw new ErroTef(resultado.erro, resultado.codigo === "TEF_DESABILITADO" ? 403 : 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, terminaisAntes);
  const terminal = memoria.terminais.find(
    (item) => item.id === resultado.terminalId && item.empresaId === input.empresaId
  );
  return {
    ok: true as const,
    operacaoId: resultado.operacaoId,
    identificador: resultado.identificador,
    valor: resultado.valor,
    modalidade: resultado.modalidade,
    status: resultado.status,
    terminalCodigo: terminal?.codigo ?? resultado.terminalCodigo,
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    parear: false,
    jaAutorizada: resultado.jaAutorizada,
    emAndamento: resultado.emAndamento,
    repetida: resultado.repetida,
    recuperada: resultado.recuperada === true,
    cobrarDeNovo: resultado.cobrarDeNovo === true,
    diagnostico: resultado.diagnostico,
    modalidadeSolicitada: resultado.modalidadeSolicitada,
    modalidadeEfetiva: resultado.modalidadeEfetiva,
    avisoModalidade: resultado.avisoModalidade,
    desafio: resultado.repetida ? "" : resultado.desafio,
    vinculoSegredo: resultado.repetida ? "" : vinculoSegredo,
  };
}

async function memoriaDaOperacao(empresaId: string, operacaoId: string) {
  const cliente = admin();
  const memoria = memoriaTefVazia();
  const linha = (await lerLinhasOperacao((colunas) =>
    cliente
      .from("tef_operacoes")
      .select(colunas)
      .eq("empresa_id", empresaId)
      .eq("id", operacaoId)
      .maybeSingle()
  )) as Linha | null;
  if (!linha) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  memoria.operacoes = [linhaOperacao(linha)];
  memoria.plataformaHabilitada = true;
  return { cliente, memoria, antes: memoria.operacoes.map((item) => ({ ...item })) };
}

async function chavePublicaDaOperacao(
  cliente: ReturnType<typeof admin>,
  operacao: OperacaoTef
) {
  const linha = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("chave_publica")
      .eq("empresa_id", operacao.empresaId)
      .eq("id", operacao.terminalId)
      .maybeSingle()
  );
  return linha?.chave_publica ? String(linha.chave_publica) : "";
}

function camposProvados(
  operacao: OperacaoTef,
  campos: Omit<CamposProvaTef, "desafio" | "identificador" | "valorCentavos">
): CamposProvaTef {
  return {
    ...campos,
    desafio: operacao.desafio,
    identificador: operacao.identificador,
    valorCentavos: operacao.valorCentavos,
  };
}

function textoLimitado(valor: unknown, maximo: number) {
  const texto = typeof valor === "string" ? valor : "";
  return texto.length > maximo ? "" : texto;
}

export async function registrarResultadoTefPersistido(input: {
  empresaId: string;
  operacaoId: string;
  resultado: ResultadoConectorTef;
  prova: string;
  provaAmbiente?: string;
  comprovante?: string;
  host?: string;
  pontoCaptura?: string;
  provaModalidade?: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const fiscal = dadosFiscaisProvaTef(input.resultado);
  const camposFinanceiros = {
    nsu: input.resultado.nsu ?? "",
    autorizacao: input.resultado.autorizacao || input.resultado.codigoAutorizacao || "",
    rede: input.resultado.rede ?? "",
    finalizacao: input.resultado.finalizacao || input.resultado.codigoFinalizacao || "",
  };
  const provaValida = verificarProvaTef(
    chave,
    camposProvados(operacao, {
      acao: "pagamento",
      ...camposFinanceiros,
      sucesso: input.resultado.sucessoTransacao === true,
      codigo: input.resultado.codigo ?? "",
      bandeira: fiscal.bandeira,
      cnpjCredenciadora: fiscal.cnpjCredenciadora,
      cnpjRecebedor: fiscal.cnpjRecebedor,
      instituicao: fiscal.instituicao,
    }),
    input.prova
  );
  const comprovante = textoLimitado(input.comprovante, 48000);
  const host = textoLimitado(input.host, 120).trim();
  const pontoCaptura = textoLimitado(input.pontoCaptura, 32).trim();
  const comprovanteSha256 = hashComprovante(comprovante);
  const assinaturaAmbiente = verificarAmbienteTef(
    chave,
    {
      desafio: operacao.desafio,
      identificador: operacao.identificador,
      valorCentavos: operacao.valorCentavos,
      ...camposFinanceiros,
      pontoCaptura,
      host,
      comprovanteSha256,
    },
    textoLimitado(input.provaAmbiente, 4096)
  );
  const referencia = await referenciasProducaoTef(cliente, input.empresaId, operacao.terminalId);
  const origem = decidirPorEvidencia({
    comprovante,
    host,
    pontoCaptura,
    pontoOficial: referencia.pontoOficial,
    hostOficial: referencia.hostOficial,
    assinaturaValida: assinaturaAmbiente,
    fluxoHomologacao: referencia.fluxoHomologacao,
  });
  const provaModalidade = textoLimitado(input.provaModalidade, 4096);
  const avaliarModalidade = provaModalidade.length > 0;
  const tipoCartao = tipoCartaoOficial(input.resultado.tipoCartao);
  const provaModalidadeValida =
    avaliarModalidade &&
    verificarModalidadeTef(
      chave,
      {
        desafio: operacao.desafio,
        identificador: operacao.identificador,
        valorCentavos: operacao.valorCentavos,
        nsu: camposFinanceiros.nsu,
        autorizacao: camposFinanceiros.autorizacao,
        tipoCartao,
      },
      provaModalidade
    );
  const registrado = registrarResultado(memoria, {
    ...input,
    provaValida,
    origem,
    modalidadeOficial: avaliarModalidade
      ? { provaValida: provaModalidadeValida, tipoCartao }
      : undefined,
  });
  if (!registrado.ok) {
    throw new ErroTef(registrado.erro, 404);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, memoria.terminais);
  if (!registrado.repetida) {
    await gravarDadosFiscaisOperacao(cliente, memoria.operacoes[0]);
  }
  return {
    ok: true as const,
    status: registrado.status,
    teste: registrado.teste,
    diagnostico: registrado.diagnostico,
    proibirDesfazimento: registrado.proibirDesfazimento,
    modalidade: registrado.modalidade,
    modalidadeSolicitada: registrado.modalidadeSolicitada,
    modalidadeEfetiva: registrado.modalidadeEfetiva,
    avisoModalidade: registrado.avisoModalidade,
    erro: registrado.status === "autorizada" && !registrado.teste ? undefined : registrado.diagnostico,
  };
}

async function referenciasProducaoTef(
  cliente: ReturnType<typeof admin>,
  empresaId: string,
  terminalId: string
) {
  const config = await cliente
    .from("tef_configuracoes")
    .select("ambiente, ponto_captura, servidor_producao")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const terminal = await cliente
    .from("tef_terminais")
    .select("ponto_captura")
    .eq("empresa_id", empresaId)
    .eq("id", terminalId)
    .maybeSingle();
  const pontoTerminal = terminal.error ? "" : String(terminal.data?.ponto_captura ?? "").trim();
  const pontoConfig = config.error ? "" : String(config.data?.ponto_captura ?? "").trim();
  return {
    fluxoHomologacao: !config.error && config.data?.ambiente === "homologacao",
    pontoOficial: pontoTerminal || pontoConfig,
    hostOficial: config.error ? "" : String(config.data?.servidor_producao ?? "").trim(),
  };
}

export async function liberarConfirmacaoTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
  vendaId: string;
}) {
  const { memoria } = await memoriaDaOperacao(input.empresaId, input.operacaoId);
  const cliente = admin();
  const venda = await exigirTabela(
    cliente
      .from("vendas")
      .select("id, empresa_id")
      .eq("empresa_id", input.empresaId)
      .eq("id", input.vendaId)
      .maybeSingle()
  );
  if (venda) {
    memoria.vendas.push({
      id: String(venda.id),
      empresaId: input.empresaId,
      idempotencyKey: "",
    });
  }
  const liberada = liberarConfirmacao(memoria, input);
  if (!liberada.ok) {
    throw new ErroTef(liberada.erro, 409);
  }
  return liberada;
}

export async function marcarConfirmacaoTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
  prova: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao || operacao.empresaId !== input.empresaId) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const base = {
    acao: "confirmar" as const,
    nsu: operacao.nsu ?? "",
    autorizacao: operacao.autorizacao ?? "",
    rede: operacao.rede ?? "",
    finalizacao: operacao.finalizacao ?? "",
    codigo: "",
  };
  const provaOk = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: true }),
    input.prova
  );
  const provaFalha = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: false }),
    input.prova
  );
  if (!provaOk) {
    if (provaFalha) {
      operacao.status = "reconciliacao";
      await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
      return { ok: true as const, status: "reconciliacao" as const };
    }
    throw new ErroTef("A confirmação TEF não tem prova do terminal.", 409);
  }
  const marcada = marcarConfirmada(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    rede: operacao.rede ?? "",
    nsu: operacao.nsu ?? "",
    finalizacao: operacao.finalizacao ?? "",
    provaValida: true,
  });
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return { ok: true as const, status: "confirmada" as const };
}

export async function desfazerTefPersistido(input: {
  empresaId: string;
  usuarioId: string;
  operacaoId: string;
  idempotencyKeyVenda?: string | null;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  if (input.idempotencyKeyVenda) {
    const venda = await exigirTabela(
      cliente
        .from("vendas")
        .select("id, empresa_id")
        .eq("empresa_id", input.empresaId)
        .eq("idempotency_key", input.idempotencyKeyVenda)
        .maybeSingle()
    );
    if (venda) {
      memoria.vendas.push({
        id: String(venda.id),
        empresaId: input.empresaId,
        idempotencyKey: input.idempotencyKeyVenda,
      });
    }
  }
  const operacaoAtual = memoria.operacoes[0];
  let vendaIdEncontrada =
    memoria.vendas.find((item) => item.empresaId === input.empresaId)?.id ?? null;
  if (!vendaIdEncontrada && operacaoAtual?.vendaIdempotencyKey) {
    const vendaReservada = await exigirTabela(
      cliente
        .from("vendas")
        .select("id, empresa_id")
        .eq("empresa_id", input.empresaId)
        .eq("idempotency_key", operacaoAtual.vendaIdempotencyKey)
        .maybeSingle()
    );
    if (vendaReservada) {
      vendaIdEncontrada = String(vendaReservada.id);
      memoria.vendas.push({
        id: vendaIdEncontrada,
        empresaId: input.empresaId,
        idempotencyKey: operacaoAtual.vendaIdempotencyKey,
      });
    }
  }
  const statusAntes = memoria.operacoes[0]?.status;
  const pedido = pedirDesfazimento(memoria, {
    ...input,
    vendaIdEncontrada,
  });
  if (!pedido.ok) {
    throw new ErroTef(pedido.erro, 404);
  }
  if (memoria.operacoes[0]?.status !== statusAntes) {
    await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  }
  return pedido;
}

export async function recuperarSimulacaoTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const recuperada = recuperarSimulacao(memoria, input);
  if (!recuperada.ok) {
    throw new ErroTef(recuperada.erro, recuperada.codigo === "NAO_ENCONTRADA" ? 404 : 409);
  }
  if (!recuperada.repetida) {
    await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  }
  return recuperada;
}

export async function registrarDesfazimentoTefPersistido(input: {
  empresaId: string;
  operacaoId: string;
  prova: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const base = {
    acao: "desfazer" as const,
    nsu: operacao.nsu ?? "",
    autorizacao: operacao.autorizacao ?? "",
    rede: operacao.rede ?? "",
    finalizacao: operacao.finalizacao ?? "",
    codigo: "",
  };
  const provaOk = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: true }),
    input.prova
  );
  const marcada = marcarDesfeita(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    sucesso: provaOk,
    provaValida: provaOk,
  });
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  return { ok: true as const, status: marcada.status };
}

export async function listarPendenciasTefPersistidas(empresaId: string) {
  const cliente = admin();
  const linhas = await lerLinhasOperacao((colunas) =>
    cliente
      .from("tef_operacoes")
      .select(colunas)
      .eq("empresa_id", empresaId)
      .in("status", [...STATUS_TEF_ABERTOS])
  );
  const memoria = memoriaTefVazia();
  memoria.operacoes = ((linhas ?? []) as Linha[]).map(linhaOperacao);
  const terminais = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("id, codigo")
      .eq("empresa_id", empresaId)
  );
  const codigos = new Map(
    ((terminais ?? []) as Linha[]).map((linha) => [String(linha.id), String(linha.codigo)])
  );
  return listarPendencias(memoria, empresaId).map((item) => ({
    ...item,
    terminalCodigo: codigos.get(item.terminalId) ?? "",
  }));
}

export async function marcarPendenciaFormaTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const modalidade = operacao.modalidadeEfetiva ?? operacao.modalidade;
  const formas = await exigirTabela(
    cliente
      .from("formas_pagamento")
      .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado")
      .eq("empresa_id", input.empresaId)
  );
  const lista = ((formas ?? []) as Linha[]).map((linha) => ({
    id: String(linha.id),
    codigo: linha.codigo ? String(linha.codigo) : null,
    nome: linha.nome ? String(linha.nome) : null,
    tipo: linha.tipo ? String(linha.tipo) : null,
    codigo_fiscal: linha.codigo_fiscal ? String(linha.codigo_fiscal) : null,
    permite_fiado: linha.permite_fiado === true,
  }));
  if (formaDaModalidadeEfetiva(lista, modalidade)) {
    return {
      ok: true as const,
      pendente: false,
      status: operacao.status,
      diagnostico: operacao.motivoAmbiente || "",
    };
  }
  const marcada = marcarPendenciaAdministrativa(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    motivo: mensagemFormaAusente(modalidade),
  });
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return {
    ok: true as const,
    pendente: true,
    status: marcada.status,
    diagnostico: marcada.diagnostico,
    modalidadeEfetiva: marcada.modalidadeEfetiva,
  };
}

export async function vincularOperacoesTefNaVenda(input: {
  empresaId: string;
  vendaId: string;
  usuarioId: string;
  operacaoIds: string[];
  segredos: Record<string, string>;
}) {
  if (input.operacaoIds.length === 0) {
    return { confirmacaoLiberada: false };
  }
  let liberada = true;
  for (const operacaoId of input.operacaoIds) {
    const { cliente, memoria, antes } = await memoriaDaOperacao(
      input.empresaId,
      operacaoId
    );
    memoria.vendas.push({
      id: input.vendaId,
      empresaId: input.empresaId,
      idempotencyKey: "",
    });
    const venda = await cliente
      .from("vendas")
      .select("id")
      .eq("empresa_id", input.empresaId)
      .eq("id", input.vendaId)
      .maybeSingle();
    if (venda.error || !venda.data) {
      liberada = false;
      continue;
    }
    const vinculada = vincularVenda(memoria, {
      empresaId: input.empresaId,
      operacaoId,
      vendaId: input.vendaId,
      usuarioId: input.usuarioId,
      segredoVinculoHash: input.segredos[operacaoId] ?? "",
    });
    if (!vinculada.ok) {
      liberada = false;
      continue;
    }
    await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  }
  return { confirmacaoLiberada: liberada };
}

export async function reservarOperacoesTefParaVenda(input: {
  empresaId: string;
  usuarioId: string;
  idempotencyKey: string;
  operacaoIds: string[];
}) {
  if (input.operacaoIds.length === 0) {
    return { ok: true as const };
  }
  const cliente = admin();
  const memoria = memoriaTefVazia();
  const linhas = await exigirTabela(
    cliente
      .from("tef_operacoes")
      .select(
        "id, empresa_id, terminal_id, identificador, idempotency_key, modalidade, valor_centavos, status, nsu, autorizacao, rede, finalizacao, venda_id, teste, desafio, usuario_id, segredo_vinculo_hash, venda_idempotency_key, ambiente_efetivo, ponto_efetivo, host_efetivo, comprovante_sha256, motivo_ambiente"
      )
      .eq("empresa_id", input.empresaId)
      .in("id", input.operacaoIds)
  );
  memoria.operacoes = ((linhas ?? []) as Linha[]).map(linhaOperacao);
  const antes = memoria.operacoes.map((item) => ({ ...item }));
  const reservada = reservarOperacoesParaVenda(memoria, input);
  if (!reservada.ok) {
    throw new ErroTef(reservada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return { ok: true as const };
}

export async function autorizarPareamentoTef(input: {
  empresaId: string;
  usuarioId: string;
  codigo: string;
}) {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function concluirPareamentoTef(input: {
  empresaId: string;
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinatura: string;
}) {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function lerPerfilHomologacaoEmpresa(empresaId: string) {
  const cliente = admin();
  const consulta = await cliente
    .from("tef_configuracoes")
    .select("cnpj_instalacao, ponto_homologacao, cnpj_producao")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (consulta.error && /cnpj_producao/i.test(`${consulta.error.code ?? ""} ${consulta.error.message ?? ""}`)) {
    const base = await cliente
      .from("tef_configuracoes")
      .select("cnpj_instalacao, ponto_homologacao")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (base.error) {
      if (colunaHomologacaoAusente(base.error) || migracaoAusente(base.error)) {
        return { cnpjInstalacao: "", cnpjProducao: "", pontoHomologacao: "", colunas: false as const };
      }
      throw new ErroTef("Não foi possível consultar a homologação do TEF.", 500);
    }
    return {
      cnpjInstalacao: String(base.data?.cnpj_instalacao ?? ""),
      cnpjProducao: "",
      pontoHomologacao: String(base.data?.ponto_homologacao ?? ""),
      colunas: true as const,
    };
  }
  if (consulta.error) {
    if (colunaHomologacaoAusente(consulta.error) || migracaoAusente(consulta.error)) {
      return { cnpjInstalacao: "", cnpjProducao: "", pontoHomologacao: "", colunas: false as const };
    }
    throw new ErroTef("Não foi possível consultar a homologação do TEF.", 500);
  }
  return {
    cnpjInstalacao: String(consulta.data?.cnpj_instalacao ?? ""),
    cnpjProducao: String(consulta.data?.cnpj_producao ?? ""),
    pontoHomologacao: String(consulta.data?.ponto_homologacao ?? ""),
    colunas: true as const,
  };
}

async function cnpjTerminalProducao(empresaId: string) {
  const cliente = admin();
  const consulta = await cliente
    .from("tef_terminais")
    .select("cnpj, ambiente")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .is("revogada_em", null);
  if (consulta.error) return "";
  const linha = ((consulta.data ?? []) as Linha[]).find((item) => {
    const ambiente = item.ambiente;
    return ambiente === "producao" || ambiente === "" || ambiente == null;
  });
  const cnpj = String(linha?.cnpj ?? "").replace(/\D/g, "");
  return /^\d{14}$/.test(cnpj) ? cnpj : "";
}

export async function lerIdentidadeHomologacao(empresaId: string, dispositivoId: string) {
  void empresaId;
  void dispositivoId;
  return null;
}


export async function salvarIdentidadeHomologacao(input: {
  empresaId: string;
  terminalId: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
}) {
  void input;
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function instalacaoPayGoConfirmada(
  empresaId: string,
  ambiente: "homologacao" | "producao"
) {
  void empresaId;
  void ambiente;
  return false;
}


export async function lerServidoresPayGoEmpresa(empresaId: string) {
  const cliente = admin();
  const consulta = await cliente
    .from("tef_configuracoes")
    .select("servidor_homologacao, servidor_producao")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (consulta.error) {
    if (colunaServidorAusente(consulta.error) || migracaoAusente(consulta.error)) {
      return { servidorHomologacao: "", servidorProducao: "" };
    }
    throw new ErroTef("Não foi possível consultar o servidor PayGoWeb.", 500);
  }
  return {
    servidorHomologacao: String(consulta.data?.servidor_homologacao ?? ""),
    servidorProducao: String(consulta.data?.servidor_producao ?? ""),
  };
}

export async function gravarServidoresPayGoEmpresa(
  empresaId: string,
  input: {
    ambiente: "homologacao" | "producao";
    estabelecimento: string;
    pontoCaptura: string;
    servidorHomologacao: string;
    servidorProducao: string;
  }
) {
  const cliente = admin();
  const atual = await cliente
    .from("tef_configuracoes")
    .select("habilitado")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (atual.error) {
    if (migracaoAusente(atual.error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível consultar a configuração TEF.", 500);
  }
  if (atual.data?.habilitado === true) {
    const servidoresHabilitados: {
      servidor_homologacao?: string;
      servidor_producao?: string;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };
    if (input.servidorHomologacao) {
      servidoresHabilitados.servidor_homologacao = input.servidorHomologacao;
    }
    if (input.servidorProducao) {
      servidoresHabilitados.servidor_producao = input.servidorProducao;
    }
    const preenchimento = await cliente
      .from("tef_configuracoes")
      .update(servidoresHabilitados)
      .eq("empresa_id", empresaId);
    if (preenchimento.error) {
      if (colunaServidorAusente(preenchimento.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
          503
        );
      }
      throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
    }
    return { preservado: false as const };
  }
  const servidores = {
    servidor_homologacao: input.servidorHomologacao,
    servidor_producao: input.servidorProducao,
    updated_at: new Date().toISOString(),
  };
  if (!atual.data) {
    const inclusao = await cliente.from("tef_configuracoes").insert({
      empresa_id: empresaId,
      habilitado: false,
      ambiente: input.ambiente,
      estabelecimento: input.estabelecimento,
      ponto_captura: input.pontoCaptura,
      ...servidores,
    });
    if (inclusao.error) {
      if (colunaServidorAusente(inclusao.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
          503
        );
      }
      throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
    }
    return { preservado: false as const };
  }
  const atualizacao = await cliente
    .from("tef_configuracoes")
    .update({
      ambiente: input.ambiente,
      estabelecimento: input.estabelecimento,
      ponto_captura: input.pontoCaptura,
      ...servidores,
    })
    .eq("empresa_id", empresaId)
    .eq("habilitado", false);
  if (atualizacao.error) {
    if (colunaServidorAusente(atualizacao.error)) {
      throw new ErroTef(
        "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
        503
      );
    }
    throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
  }
  return { preservado: false as const };
}

export async function revogarTerminalTef(input: { empresaId: string; terminalId: string }) {
  void input;
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function listarTerminaisAtivosEmpresa(
  supabase: ClienteLeitura,
  empresaId: string
): Promise<TerminalTefAtivo[]> {
  const consulta = await supabase
    .from("tef_terminais")
    .select("id, codigo, dispositivo_id, estabelecimento, ponto_captura, revogada_em")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  if (consulta.error) {
    if (migracaoAusente(consulta.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os terminais TEF.", 500);
  }
  const linhas = ((consulta.data ?? []) as Linha[]).filter((linha) => !linha.revogada_em);
  const ids = linhas.map((linha) => String(linha.id));
  const pendentes = new Set<string>();
  if (ids.length > 0) {
    const operacoes = await supabase
      .from("tef_operacoes")
      .select("terminal_id")
      .eq("empresa_id", empresaId)
      .in("terminal_id", ids)
      .in("status", [...STATUS_TEF_ABERTOS]);
    if (operacoes.error) {
      if (!migracaoAusente(operacoes.error)) {
        throw new ErroTef("Não foi possível consultar as pendências TEF.", 500);
      }
    } else {
      for (const linha of (operacoes.data ?? []) as Linha[]) {
        pendentes.add(String(linha.terminal_id));
      }
    }
  }
  return linhas.map((linha) => ({
    id: String(linha.id),
    codigo: String(linha.codigo),
    dispositivoId: String(linha.dispositivo_id),
    estabelecimento: String(linha.estabelecimento ?? ""),
    pontoCaptura: String(linha.ponto_captura ?? ""),
    temPendencia: pendentes.has(String(linha.id)),
  }));
}

export async function diagnosticoPinpadBloqueado(
  supabase: ClienteLeitura,
  empresaId: string,
  terminalId: string
) {
  const operacoes = await supabase
    .from("tef_operacoes")
    .select("status, nsu, rede, finalizacao")
    .eq("empresa_id", empresaId)
    .eq("terminal_id", terminalId)
    .in("status", [...STATUS_TEF_ABERTOS]);
  if (operacoes.error) {
    if (migracaoAusente(operacoes.error)) {
      return false;
    }
    throw new ErroTef("Não foi possível consultar as pendências TEF.", 500);
  }
  return ((operacoes.data ?? []) as Linha[]).some((linha) =>
    operacaoImpedeDiagnosticoPinpad({
      status: String(linha.status ?? ""),
      nsu: linha.nsu == null ? null : String(linha.nsu),
      rede: linha.rede == null ? null : String(linha.rede),
      finalizacao: linha.finalizacao == null ? null : String(linha.finalizacao),
    })
  );
}

export async function dispositivoAtivoDeOutraEmpresa(
  empresaId: string,
  dispositivoId: string
) {
  const cliente = admin();
  let linhas: Linha[] = [];
  try {
    const data = await exigirTabela(
      cliente
        .from("tef_terminais")
        .select("empresa_id")
        .eq("dispositivo_id", dispositivoId)
        .eq("ativo", true)
    );
    linhas = (data ?? []) as Linha[];
  } catch (error) {
    if (error instanceof ErroTef && error.status === 503) {
      return false;
    }
    throw error;
  }
  return linhas.some((linha) => String(linha.empresa_id) !== empresaId);
}

export async function salvarConfigTefEmpresa(
  empresaId: string,
  config: {
    habilitado: boolean;
    ambiente: "homologacao" | "producao";
    estabelecimento: string;
    pontoCaptura: string;
    cnpjInstalacao?: string;
    cnpjProducao?: string;
    pontoHomologacao?: string;
    permitirOperacaoManual?: boolean;
  }
) {
  const cliente = admin();
  const base = {
    empresa_id: empresaId,
    habilitado: config.habilitado,
    ambiente: config.ambiente,
    estabelecimento: config.estabelecimento,
    ponto_captura: config.pontoCaptura,
    updated_at: new Date().toISOString(),
  };
  const gravarManual = config.permitirOperacaoManual !== undefined;
  const { error } = await cliente.from("tef_configuracoes").upsert({
    ...base,
    ...(gravarManual
      ? { permitir_operacao_manual: config.permitirOperacaoManual === true }
      : {}),
  } as typeof base);
  if (error && gravarManual && colunaOperacaoManualAusente(error)) {
    if (config.permitirOperacaoManual) {
      throw new ErroTef(
        "A autorização de cartão manual ainda não está disponível neste ambiente.",
        503
      );
    }
    const reserva = await cliente.from("tef_configuracoes").upsert(base);
    if (reserva.error) {
      if (migracaoAusente(reserva.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível salvar a configuração TEF.", 500);
    }
  } else if (error) {
    if (migracaoAusente(error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível salvar a configuração TEF.", 500);
  }
  if (
    config.cnpjInstalacao === undefined &&
    config.cnpjProducao === undefined &&
    config.pontoHomologacao === undefined
  ) {
    return;
  }
  const perfil = await cliente
    .from("tef_configuracoes")
    .update({
      cnpj_instalacao: config.cnpjInstalacao ?? "",
      cnpj_producao: config.cnpjProducao ?? "",
      ponto_homologacao: config.pontoHomologacao ?? "",
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId);
  if (perfil.error) {
    if (colunaHomologacaoAusente(perfil.error)) {
      const texto = `${perfil.error.code ?? ""} ${perfil.error.message ?? ""}`;
      const migration = /cnpj_producao/i.test(texto)
        ? "20261017140000_tef_cnpj_por_ambiente.sql"
        : "20261017120000_tef_homologacao_empresa.sql";
      throw new ErroTef(
        `A homologação do TEF ainda não foi aplicada no banco. A migration ${migration} precisa ser aplicada antes de salvar o CNPJ e o ponto de homologação.`,
        503
      );
    }
    throw new ErroTef("Não foi possível salvar a homologação do TEF.", 500);
  }
}

function ambienteSincronizacao(valor: unknown): TerminalSincronizacao["ambiente"] {
  return valor === "producao" || valor === "homologacao" ? valor : "";
}

export async function alinharTerminaisAoPontoSalvo(
  empresaId: string,
  ponto: {
    ambiente: string;
    pontoAtivo: string;
    pontoOutro: string;
    estabelecimento: string;
    servidor: string;
    cnpj: string;
  }
) {
  void empresaId;
  void ponto;
  throw new ErroTef(
    "A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.",
    410
  );
}

export async function carregarFatosSincronizacaoVinculo(input: {
  empresaId: string;
  dispositivoId: string;
}) {
  const cliente = admin();
  const completo = await cliente
    .from("tef_terminais")
    .select(
      "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, chave_id, estabelecimento, ponto_captura, revogada_em, ambiente, servidor, cnpj"
    )
    .eq("dispositivo_id", input.dispositivoId);
  let linhas: Linha[] = [];
  if (completo.error) {
    if (!colunaServidorAusente(completo.error)) {
      if (migracaoAusente(completo.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível consultar o terminal.", 500);
    }
    const base = await exigirTabela(
      cliente
        .from("tef_terminais")
        .select(
          "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, chave_id, estabelecimento, ponto_captura, revogada_em"
        )
        .eq("dispositivo_id", input.dispositivoId)
    );
    linhas = ((base ?? []) as Linha[]).map((linha) => ({
      ...linha,
      ambiente: "",
      servidor: "",
      cnpj: "",
    }));
  } else {
    linhas = (completo.data ?? []) as Linha[];
  }
  const empresaId = input.empresaId.trim().toLowerCase();
  const destaEmpresa = linhas.find(
    (linha) =>
      String(linha.empresa_id).toLowerCase() === empresaId &&
      linha.ativo !== false &&
      !linha.revogada_em
  );
  const dispositivoOutraEmpresa = linhas.some(
    (linha) =>
      String(linha.empresa_id).toLowerCase() !== empresaId &&
      linha.ativo !== false &&
      !linha.revogada_em
  );
  const terminal: TerminalSincronizacao | null = destaEmpresa
    ? {
        id: String(destaEmpresa.id),
        empresaId: String(destaEmpresa.empresa_id),
        codigo: String(destaEmpresa.codigo ?? ""),
        dispositivoId: String(destaEmpresa.dispositivo_id),
        chavePublica: destaEmpresa.chave_publica ? String(destaEmpresa.chave_publica) : "",
        chaveId: destaEmpresa.chave_id ? String(destaEmpresa.chave_id) : "",
        estabelecimento: String(destaEmpresa.estabelecimento ?? ""),
        pontoCaptura: String(destaEmpresa.ponto_captura ?? ""),
        ativo: destaEmpresa.ativo !== false,
        revogada: Boolean(destaEmpresa.revogada_em),
        ambiente: ambienteSincronizacao(destaEmpresa.ambiente),
        servidor: String(destaEmpresa.servidor ?? ""),
        cnpj: String(destaEmpresa.cnpj ?? ""),
      }
    : null;
  const configConsulta = await cliente
    .from("tef_configuracoes")
    .select("ambiente, estabelecimento, ponto_captura, servidor_homologacao, servidor_producao")
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  let configLinha: Linha | null = null;
  if (configConsulta.error) {
    if (!colunaServidorAusente(configConsulta.error)) {
      if (migracaoAusente(configConsulta.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível consultar a configuração TEF.", 500);
    }
    const base = await exigirTabela(
      cliente
        .from("tef_configuracoes")
        .select("ambiente, estabelecimento, ponto_captura")
        .eq("empresa_id", input.empresaId)
        .maybeSingle()
    );
    configLinha = base ? { ...base, servidor_homologacao: "", servidor_producao: "" } : null;
  } else {
    configLinha = configConsulta.data;
  }
  const ambiente = ambienteSincronizacao(configLinha?.ambiente);
  const perfil = await lerPerfilHomologacaoEmpresa(input.empresaId);
  const credencial = credencialPayGoDoAmbiente({
    ambiente,
    pontoCaptura: String(configLinha?.ponto_captura ?? ""),
    pontoHomologacao: perfil.pontoHomologacao,
    servidorHomologacao: String(configLinha?.servidor_homologacao ?? ""),
    servidorProducao: String(configLinha?.servidor_producao ?? ""),
    cnpjHomologacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    cnpjTerminal: ambiente === "producao" ? String(terminal?.cnpj ?? "") : "",
  });
  const config: ConfiguracaoSincronizacao = {
    ambiente,
    estabelecimento: String(configLinha?.estabelecimento ?? ""),
    pontoCaptura: credencial.ok ? credencial.ponto : "",
    servidor: credencial.ok ? credencial.servidor : "",
  };
  let pendenciaFinanceira = false;
  if (terminal) {
    const abertas = await exigirTabela(
      cliente
        .from("tef_operacoes")
        .select("id")
        .eq("empresa_id", input.empresaId)
        .eq("terminal_id", terminal.id)
        .in("status", [...STATUS_TEF_ABERTOS])
        .limit(1)
    );
    pendenciaFinanceira = ((abertas ?? []) as Linha[]).length > 0;
  }
  return {
    dispositivoOutraEmpresa,
    pendenciaFinanceira,
    terminal,
    config,
    cnpjEmpresa: credencial.ok ? credencial.cnpj : "",
  };
}

function funcaoRecuperacaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST202|42883|tef_recuperar_autorizacao_terminal|schema cache/i.test(texto);
}

export async function consultarConflitoChaveTef(input: {
  terminalId: string;
  chavePublica: string;
}): Promise<{ chaveJaRevogada: boolean; chaveEmOutroTerminal: boolean }> {
  void input;
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function substituirAutorizacaoTerminalTef(input: {
  empresaId: string;
  dispositivoId: string;
  usuarioId: string;
  chavePublica: string;
  chaveId: string | null;
  chaveAnterior: string;
  fingerprintAnterior: string;
  fingerprintAtual: string;
}): Promise<{ efeito: string; motivo: string }> {
  void input;
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function definirTefPlataforma(habilitada: boolean) {
  const cliente = admin();
  const { error } = await cliente
    .from("tef_plataforma")
    .update({ habilitada, atualizado_em: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    if (migracaoAusente(error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível atualizar a disponibilidade do TEF.", 500);
  }
}

export async function lerTefPlataforma() {
  const cliente = admin();
  const data = await exigirTabela(
    cliente.from("tef_plataforma").select("habilitada").eq("id", true).maybeSingle()
  );
  return { habilitada: data?.habilitada === true };
}
