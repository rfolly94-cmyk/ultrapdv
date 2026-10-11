import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { ErroAcessoSessao } from "@/lib/auth/contexto-autorizado";
import { resolverContextoAutorizadoEmpresa } from "@/lib/auth/contexto-autorizado";
import { exigirMaster } from "@/lib/master/exigir-master";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirOperacaoPdv } from "@/lib/pdv/acesso-operacao";
import {
  definirTefPlataforma,
  desfazerTefPersistido,
  dispositivoAtivoDeOutraEmpresa,
  ErroTef,
  iniciarTefPersistido,
  lerHabilitacaoTef,
  lerTefPlataforma,
  liberarConfirmacaoTefPersistida,
  listarPendenciasTefPersistidas,
  listarTerminaisAtivosEmpresa,
  marcarConfirmacaoTefPersistida,
  registrarDesfazimentoTefPersistido,
  registrarResultadoTefPersistido,
  reservarOperacoesTefParaVenda,
  revogarTerminalTef,
  autorizarPareamentoTef,
  concluirPareamentoTef,
  salvarConfigTefEmpresa,
} from "@/lib/pdv/tef/persistencia";
import {
  classificarFormaTef,
  sanitizarParaLog,
  type ModalidadeTef,
  type ResultadoConectorTef,
} from "@/lib/pdv/tef/regras";

export { ErroTef };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function uuid(valor: unknown) {
  const id = texto(valor);
  if (!UUID.test(id)) {
    throw new ErroTef("Identificador inválido.");
  }
  return id;
}

async function sessaoPdv() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  await exigirOperacaoPdv({
    empresaId: ctx.empresaId,
    acao: "finalizar_venda",
    origem: "tef",
  });
  return ctx;
}

export async function lerConfigTefSessao() {
  const ctx = await sessaoPdv();
  const habilitacao = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  if (!habilitacao.habilitado) {
    return {
      ok: true as const,
      habilitado: false,
      empresaHabilitada: habilitacao.empresaHabilitada,
      plataformaHabilitada: habilitacao.plataformaHabilitada,
      permitirOperacaoManual: habilitacao.permitirOperacaoManual,
      migracaoPendente: habilitacao.migracaoPendente,
      pendencias: [],
    };
  }
  const pendencias = await listarPendenciasTefPersistidas(ctx.empresaId);
  return {
    ok: true as const,
    habilitado: true,
    empresaHabilitada: true,
    plataformaHabilitada: true,
    permitirOperacaoManual: habilitacao.permitirOperacaoManual,
    migracaoPendente: false,
    ambiente: habilitacao.ambiente,
    estabelecimento: habilitacao.estabelecimento,
    pontoCaptura: habilitacao.pontoCaptura,
    pendencias: pendencias.map((item) => ({
      id: item.id,
      status: item.status,
      valorCentavos: item.valorCentavos,
      modalidade: item.modalidade,
      identificador: item.identificador,
      terminalCodigo: item.terminalCodigo,
    })),
    empresaId: ctx.empresaId,
  };
}

export async function iniciarTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  const modalidade = texto(body.modalidade);
  if (modalidade !== "debito" && modalidade !== "credito") {
    throw new ErroTef("Modalidade TEF inválida.");
  }
  const valorCentavos = Number(body.valorCentavos);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new ErroTef("Valor do pagamento deve ser maior que zero.");
  }
  const formaId = uuid(body.formaPagamentoId);
  const { data: forma, error } = await ctx.supabase
    .from("formas_pagamento")
    .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado, empresa_id")
    .eq("empresa_id", ctx.empresaId)
    .eq("id", formaId)
    .maybeSingle();
  if (error || !forma) {
    throw new ErroTef("Forma de pagamento não encontrada.", 404);
  }
  if (classificarFormaTef(forma) !== modalidade) {
    throw new ErroTef("A forma de pagamento não corresponde ao TEF solicitado.");
  }
  return iniciarTefPersistido({
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    dispositivoId: uuid(body.dispositivoId),
    modalidade: modalidade as ModalidadeTef,
    valorCentavos,
    idempotencyKey: uuid(body.idempotencyKey ?? randomUUID()),
    chavePublica: texto(body.chavePublica),
    assinaturaIdentidade: texto(body.assinaturaIdentidade),
    grupoVenda: body.grupoVenda ? uuid(body.grupoVenda) : undefined,
  });
}

export async function registrarResultadoTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  const limpo = sanitizarParaLog(body) as Record<string, unknown>;
  const resultado: ResultadoConectorTef = {
    sucessoTransacao:
      limpo.sucessoTransacao === true
        ? true
        : limpo.sucessoTransacao === false
          ? false
          : undefined,
    nsu: texto(limpo.nsu) || null,
    autorizacao: texto(limpo.autorizacao) || null,
    rede: texto(limpo.rede) || null,
    finalizacao: texto(limpo.finalizacao) || null,
    valor: Number.isFinite(Number(limpo.valor)) ? Number(limpo.valor) : null,
    confirmar: limpo.confirmar === true,
    precisaConfirmacao: limpo.precisaConfirmacao === true,
    transacaoPendenteConfirmacao: limpo.transacaoPendenteConfirmacao === true,
    cancelada: limpo.cancelada === true,
    canceladoOperador: limpo.canceladoOperador === true,
    codigo: texto(limpo.codigo) || null,
    teste: limpo.teste === true,
    nomeBandeiraPadrao: texto(limpo.nomeBandeiraPadrao) || null,
    nomeCartao: texto(limpo.nomeCartao) || null,
    bandeira: texto(limpo.bandeira) || null,
    cnpjCredenciadora: texto(limpo.cnpjCredenciadora) || null,
    cnpjRecebedor: texto(limpo.cnpjRecebedor) || null,
    instituicao: texto(limpo.instituicao) || null,
  };
  return registrarResultadoTefPersistido({
    empresaId: ctx.empresaId,
    operacaoId: uuid(limpo.operacaoId),
    resultado,
    prova: texto(body.prova),
  });
}

export async function liberarConfirmacaoTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return liberarConfirmacaoTefPersistida({
    empresaId: ctx.empresaId,
    operacaoId: uuid(body.operacaoId),
    vendaId: uuid(body.vendaId),
  });
}

export async function registrarConfirmacaoTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return marcarConfirmacaoTefPersistida({
    empresaId: ctx.empresaId,
    operacaoId: uuid(body.operacaoId),
    prova: texto(body.prova),
  });
}

export async function desfazerTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return desfazerTefPersistido({
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    operacaoId: uuid(body.operacaoId),
    idempotencyKeyVenda: body.idempotencyKeyVenda
      ? uuid(body.idempotencyKeyVenda)
      : null,
  });
}

export async function registrarDesfazimentoTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return registrarDesfazimentoTefPersistido({
    empresaId: ctx.empresaId,
    operacaoId: uuid(body.operacaoId),
    prova: texto(body.prova),
  });
}

export async function autorizarPareamentoTefSessao(codigo: string) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const normalizado = codigo.trim().toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(normalizado)) {
    throw new ErroTef("Código de pareamento inválido.");
  }
  return autorizarPareamentoTef({
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    codigo: normalizado,
  });
}

export async function concluirPareamentoTefSessao(body: Record<string, unknown>) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const codigo = texto(body.codigo).toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(codigo)) {
    throw new ErroTef("Código de pareamento inválido.");
  }
  return concluirPareamentoTef({
    empresaId: ctx.empresaId,
    codigo,
    dispositivoId: uuid(body.dispositivoId),
    chavePublica: texto(body.chavePublica),
    chaveId: texto(body.chaveId),
    assinatura: texto(body.assinaturaPareamento),
  });
}

export async function revogarTerminalTefSessao(terminalId: string) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  return revogarTerminalTef({
    empresaId: ctx.empresaId,
    terminalId: uuid(terminalId),
  });
}

export async function salvarConfigTefSessao(input: {
  habilitado: boolean;
  ambiente: "homologacao" | "producao";
  estabelecimento: string;
  pontoCaptura: string;
  permitirOperacaoManual?: boolean;
}) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const estabelecimento = input.estabelecimento.trim().slice(0, 40);
  const pontoCaptura = input.pontoCaptura.trim().slice(0, 40);
  if (input.habilitado && (!estabelecimento || !pontoCaptura)) {
    throw new ErroTef("Informe o estabelecimento e o ponto de captura.");
  }
  await salvarConfigTefEmpresa(ctx.empresaId, {
    habilitado: input.habilitado,
    ambiente: input.ambiente === "producao" ? "producao" : "homologacao",
    estabelecimento,
    pontoCaptura,
    permitirOperacaoManual: input.permitirOperacaoManual,
  });
  return { ok: true as const };
}

export async function lerConfigTefAdministrativa() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  const config = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  const terminais = config.migracaoPendente
    ? []
    : await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  return {
    ...config,
    empresaId: ctx.empresaId,
    terminais,
    podeRevogar: true as const,
  };
}

export async function prepararAcessoPinpad(dispositivoId: string) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const id = uuid(dispositivoId);
  const terminais = await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  const terminal = terminais.find((item) => item.dispositivoId === id);
  if (!terminal) {
    throw new ErroTef(
      "Este computador não está autorizado para o TEF desta empresa.",
      403
    );
  }
  if (terminal.temPendencia) {
    throw new ErroTef("Terminal ocupado com operação financeira.", 409);
  }
  return {
    ok: true as const,
    empresaId: ctx.empresaId,
    terminalCodigo: terminal.codigo,
    estabelecimento: terminal.estabelecimento,
    desafio: randomBytes(32).toString("hex"),
  };
}

export async function verificarComputadorTefSessao(dispositivoId: string) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const outraEmpresa = await dispositivoAtivoDeOutraEmpresa(
    ctx.empresaId,
    uuid(dispositivoId)
  );
  return { outraEmpresa };
}

export async function definirDisponibilidadeTefPlataforma(habilitada: boolean) {
  await exigirMaster();
  await definirTefPlataforma(habilitada);
  return { ok: true as const, habilitada };
}

export async function lerDisponibilidadeTefPlataforma() {
  await exigirMaster();
  return lerTefPlataforma();
}
