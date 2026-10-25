import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { juntarComprovante } from "@/lib/pdv/tef/ambiente-transacao";
import {
  autorizarComputadorHomologacao,
  selecionarPontoDoAmbiente,
  terminalExclusivoHomologacao,
} from "@/lib/pdv/tef/configuracao-paygo";

import { ErroAcessoSessao } from "@/lib/auth/contexto-autorizado";
import { resolverContextoAutorizadoEmpresa } from "@/lib/auth/contexto-autorizado";
import { exigirMaster } from "@/lib/master/exigir-master";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirOperacaoPdv } from "@/lib/pdv/acesso-operacao";
import {
  definirTefPlataforma,
  desfazerTefPersistido,
  recuperarSimulacaoTefPersistida,
  dispositivoAtivoDeOutraEmpresa,
  ErroTef,
  iniciarTefPersistido,
  lerHabilitacaoTef,
  lerTefPlataforma,
  liberarConfirmacaoTefPersistida,
  listarPendenciasTefPersistidas,
  marcarPendenciaFormaTefPersistida,
  diagnosticoPinpadBloqueado,
  listarTerminaisAtivosEmpresa,
  marcarConfirmacaoTefPersistida,
  registrarDesfazimentoTefPersistido,
  registrarResultadoTefPersistido,
  reservarOperacoesTefParaVenda,
  revogarTerminalTef,
  autorizarPareamentoTef,
  alinharTerminaisAoPontoSalvo,
  carregarFatosSincronizacaoVinculo,
  consultarConflitoChaveTef,
  concluirPareamentoTef,
  salvarConfigTefEmpresa,
  gravarServidoresPayGoEmpresa,
  lerServidoresPayGoEmpresa,
  lerPerfilHomologacaoEmpresa,
  instalacaoPayGoConfirmada,
  salvarIdentidadeHomologacao,
  substituirAutorizacaoTerminalTef,
} from "@/lib/pdv/tef/persistencia";
import { aceitarVinculoIdentidadeHomologacao } from "@/lib/pdv/tef/identidade-homologacao";
import { credencialPayGoDoAmbiente, persistirConfiguracaoPayGo, validarConfiguracaoPayGo, type EstadoConfiguracaoPayGo } from "@/lib/pdv/tef/configuracao-paygo";
import { tipoCartaoOficial } from "@/lib/pdv/tef/modalidade-efetiva";
import { hashSegredoVinculo, verificarIdentidadeTef, verificarProvaTef } from "@/lib/pdv/tef/prova";
import { fingerprintChavePublicaEd25519 } from "@/lib/pdv/tef/fingerprint-chave";
import { decidirRecuperacaoAutorizacao } from "@/lib/pdv/tef/recuperar-autorizacao";
import { planejarSincronizacaoVinculo } from "@/lib/pdv/tef/sincronizar-vinculo";
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

function resumirPendencias(
  pendencias: Awaited<ReturnType<typeof listarPendenciasTefPersistidas>>
) {
  return pendencias.map((item) => ({
    id: item.id,
    status: item.status,
    valorCentavos: item.valorCentavos,
    modalidade: item.modalidade,
    modalidadeSolicitada: item.modalidadeSolicitada,
    modalidadeEfetiva: item.modalidadeEfetiva,
    tipoCartaoPayGo: item.tipoCartaoPayGo,
    diagnostico: item.diagnostico,
    proibirDesfazimento: item.proibirDesfazimento,
    origem: item.origem,
    rotulo: item.rotulo,
    simulacao: item.simulacao,
    recuperarNoCaixa: item.recuperarNoCaixa,
    identificador: item.identificador,
    terminalCodigo: item.terminalCodigo,
  }));
}

export async function lerConfigTefSessao() {
  const ctx = await sessaoPdv();
  const habilitacao = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  const perfil = await lerPerfilHomologacaoEmpresa(ctx.empresaId);
  const pontoCapturaProducao = habilitacao.pontoCaptura;
  const pontoHomologacao = perfil.pontoHomologacao;
  const selecao = selecionarPontoDoAmbiente({
    ambiente: habilitacao.ambienteGravado,
    pontoCapturaProducao,
    pontoHomologacao,
  });
  const pontos = {
    pontoCaptura: pontoCapturaProducao,
    pontoCapturaProducao,
    pontoHomologacao,
    pontoCapturaAtivo: selecao.ok ? selecao.pontoCapturaAtivo : "",
  };
  if (!habilitacao.habilitado) {
    return {
      ok: true as const,
      habilitado: false,
      empresaHabilitada: habilitacao.empresaHabilitada,
      plataformaHabilitada: habilitacao.plataformaHabilitada,
      permitirOperacaoManual: habilitacao.permitirOperacaoManual,
      migracaoPendente: habilitacao.migracaoPendente,
      ambiente: habilitacao.ambienteGravado,
      ...pontos,
      pendencias: [],
    };
  }
  const pendencias = resumirPendencias(await listarPendenciasTefPersistidas(ctx.empresaId));
  const base = {
    habilitado: true as const,
    empresaHabilitada: true as const,
    plataformaHabilitada: true as const,
    permitirOperacaoManual: habilitacao.permitirOperacaoManual,
    migracaoPendente: false as const,
    ambiente: habilitacao.ambienteGravado,
    estabelecimento: habilitacao.estabelecimento,
    ...pontos,
    pendencias,
    empresaId: ctx.empresaId,
  };
  if (!selecao.ok) {
    return { ok: false as const, codigo: selecao.codigo, mensagem: selecao.erro, ...base };
  }
  return { ok: true as const, ...base };
}

export async function lerTerminalHomologacaoSessao() {
  const config = await lerConfigTefSessao();
  if (!("empresaId" in config) || !config.empresaId || config.ambiente !== "homologacao") {
    return { ok: false as const, codigo: "perfil" as const, config };
  }
  if (config.ok === false) {
    return { ok: false as const, codigo: config.codigo, config };
  }
  const servidores = await lerServidoresPayGoEmpresa(config.empresaId);
  const decisao = terminalExclusivoHomologacao({
    empresaId: config.empresaId,
    empresaOrigem: config.empresaId,
    identificador: config.pontoHomologacao,
    pontoHomologacao: config.pontoHomologacao,
    servidorHomologacao: servidores.servidorHomologacao,
    servidorProducao: servidores.servidorProducao,
  });
  if (!decisao.ok) {
    return { ok: false as const, codigo: decisao.codigo, config };
  }
  return { ok: true as const, config, posid: decisao.posid, terminalCodigo: decisao.terminalCodigo };
}

export async function autorizarComputadorHomologacaoSessao(dispositivoId: string, posid: string) {
  const ctx = await sessaoPdv();
  const terminais = await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  return autorizarComputadorHomologacao({
    empresaId: ctx.empresaId,
    dispositivoId,
    posid,
    terminais: terminais.map((terminal) => ({
      empresaId: ctx.empresaId,
      dispositivoId: terminal.dispositivoId,
      codigo: terminal.codigo,
      ativo: true,
    })),
  });
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

export async function registrarPendenciaFormaTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return marcarPendenciaFormaTefPersistida({
    empresaId: ctx.empresaId,
    operacaoId: uuid(body.operacaoId),
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
    nomeBandeiraPadrao: texto(limpo.nomeBandeiraPadrao) || null,
    nomeCartao: texto(limpo.nomeCartao) || null,
    bandeira: texto(limpo.bandeira) || null,
    cnpjCredenciadora: texto(limpo.cnpjCredenciadora) || null,
    cnpjRecebedor: texto(limpo.cnpjRecebedor) || null,
    instituicao: texto(limpo.instituicao) || null,
    tipoCartao: tipoCartaoOficial(limpo.tipoCartao),
  };
  return registrarResultadoTefPersistido({
    empresaId: ctx.empresaId,
    operacaoId: uuid(limpo.operacaoId),
    resultado,
    prova: texto(body.prova),
    provaAmbiente: texto(body.provaAmbiente),
    provaModalidade: texto(body.provaModalidade),
    comprovante: juntarComprovante(
      typeof body.comprovante1Via === "string" ? body.comprovante1Via : "",
      typeof body.comprovante2Via === "string" ? body.comprovante2Via : ""
    ),
    host: texto(body.host || body.servidor),
    pontoCaptura: texto(body.pontoCaptura),
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

export async function recuperarSimulacaoTefSessao(body: Record<string, unknown>) {
  const ctx = await sessaoPdv();
  return recuperarSimulacaoTefPersistida({
    empresaId: ctx.empresaId,
    operacaoId: uuid(body.operacaoId),
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

async function estadoConfiguracaoDaSessao() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  const atual = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  const [servidores, perfil, homologacaoConfirmada, producaoConfirmada] = await Promise.all([
    lerServidoresPayGoEmpresa(ctx.empresaId),
    lerPerfilHomologacaoEmpresa(ctx.empresaId),
    instalacaoPayGoConfirmada(ctx.empresaId, "homologacao"),
    instalacaoPayGoConfirmada(ctx.empresaId, "producao"),
  ]);
  const ambiente: EstadoConfiguracaoPayGo["ambiente"] =
    atual.ambiente === "producao" || atual.ambiente === "homologacao" ? atual.ambiente : "";
  return {
    ctx,
    estado: {
      habilitado: atual.habilitado,
      ambiente,
      estabelecimento: atual.estabelecimento,
      cnpjInstalacao: perfil.cnpjInstalacao,
      cnpjProducao: perfil.cnpjProducao,
      pontoCaptura: atual.pontoCaptura,
      pontoHomologacao: perfil.pontoHomologacao,
      servidorHomologacao: servidores.servidorHomologacao,
      servidorProducao: servidores.servidorProducao,
      permitirOperacaoManual: atual.permitirOperacaoManual,
      instalacaoHomologacaoConfirmada: homologacaoConfirmada,
      instalacaoProducaoConfirmada: producaoConfirmada,
    },
  };
}

export async function validarConfiguracaoTefSessao(input: {
  habilitado: boolean;
  ambiente: "homologacao" | "producao";
  estabelecimento: string;
  cnpjInstalacao: string;
  pontoCaptura: string;
  servidor: string;
}) {
  const { estado } = await estadoConfiguracaoDaSessao();
  return validarConfiguracaoPayGo(estado, { ...input, habilitado: true });
}

export async function salvarConfigTefSessao(input: {
  habilitado: boolean;
  ambiente: "homologacao" | "producao";
  estabelecimento: string;
  cnpjInstalacao: string;
  pontoCaptura: string;
  servidor: string;
  permitirOperacaoManual?: boolean;
}) {
  const { ctx, estado: atual } = await estadoConfiguracaoDaSessao();
  if (atual.ambiente && atual.ambiente !== input.ambiente) {
    const abertas = await listarPendenciasTefPersistidas(ctx.empresaId);
    if (abertas.length > 0) {
      throw new ErroTef("Há transação TEF em aberto. O ambiente não foi alterado.");
    }
  }
  const plano = persistirConfiguracaoPayGo(atual, input);
  if (!plano.ok) {
    throw new ErroTef(plano.erro);
  }
  await salvarConfigTefEmpresa(ctx.empresaId, {
    habilitado: plano.estado.habilitado,
    ambiente: plano.estado.ambiente === "producao" ? "producao" : "homologacao",
    estabelecimento: plano.estado.estabelecimento,
    cnpjInstalacao: plano.estado.cnpjInstalacao,
    cnpjProducao: plano.estado.cnpjProducao,
    pontoCaptura: plano.estado.pontoCaptura,
    pontoHomologacao: plano.estado.pontoHomologacao,
    permitirOperacaoManual: input.permitirOperacaoManual,
  });
  if (plano.associacao === "gravar") {
    await gravarServidoresPayGoEmpresa(ctx.empresaId, {
      ambiente: plano.estado.ambiente === "producao" ? "producao" : "homologacao",
      estabelecimento: plano.estado.estabelecimento,
      pontoCaptura: plano.estado.pontoCaptura,
      servidorHomologacao: plano.estado.servidorHomologacao,
      servidorProducao: plano.estado.servidorProducao,
    });
  }
  const producao = plano.estado.ambiente === "producao";
  await alinharTerminaisAoPontoSalvo(ctx.empresaId, {
    ambiente: producao ? "producao" : "homologacao",
    pontoAtivo: producao ? plano.estado.pontoCaptura : plano.estado.pontoHomologacao,
    pontoOutro: producao ? plano.estado.pontoHomologacao : plano.estado.pontoCaptura,
    estabelecimento: plano.estado.estabelecimento,
    servidor: producao ? plano.estado.servidorProducao : plano.estado.servidorHomologacao,
    cnpj: producao ? plano.estado.cnpjProducao : plano.estado.cnpjInstalacao,
  });
  return { ok: true as const, associacao: plano.associacao };
}

export async function lerConfigTefAdministrativa() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  const config = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  const [perfil, instalacaoHomologacaoConfirmada, instalacaoProducaoConfirmada] = config.migracaoPendente
    ? [{ cnpjInstalacao: "", cnpjProducao: "", pontoHomologacao: "" }, false, false]
    : await Promise.all([
        lerPerfilHomologacaoEmpresa(ctx.empresaId),
        instalacaoPayGoConfirmada(ctx.empresaId, "homologacao"),
        instalacaoPayGoConfirmada(ctx.empresaId, "producao"),
      ]);
  const servidores = await lerServidoresPayGoEmpresa(ctx.empresaId);
  const producao = config.ambiente === "producao";
  await alinharTerminaisAoPontoSalvo(ctx.empresaId, {
    ambiente: producao ? "producao" : "homologacao",
    pontoAtivo: producao ? config.pontoCaptura : perfil.pontoHomologacao,
    pontoOutro: producao ? perfil.pontoHomologacao : config.pontoCaptura,
    estabelecimento: config.estabelecimento,
    servidor: producao ? servidores.servidorProducao : servidores.servidorHomologacao,
    cnpj: producao ? perfil.cnpjProducao : perfil.cnpjInstalacao,
  });
  const terminaisAlinhados = config.migracaoPendente
    ? []
    : await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  return {
    ...config,
    cnpjInstalacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    pontoHomologacao: perfil.pontoHomologacao,
    instalacaoHomologacaoConfirmada,
    instalacaoProducaoConfirmada,
    empresaId: ctx.empresaId,
    terminais: terminaisAlinhados,
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
  if (await diagnosticoPinpadBloqueado(ctx.supabase, ctx.empresaId, terminal.id)) {
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

export async function autorizarDiagnosticoHomologacao(dispositivoId: string) {
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
    throw new ErroTef("Este computador não está autorizado para o TEF desta empresa.", 403);
  }
  if (await diagnosticoPinpadBloqueado(ctx.supabase, ctx.empresaId, terminal.id)) {
    throw new ErroTef("Terminal ocupado com operação financeira.", 409);
  }
  const [perfil, servidores, habilitacao] = await Promise.all([
    lerPerfilHomologacaoEmpresa(ctx.empresaId),
    lerServidoresPayGoEmpresa(ctx.empresaId),
    lerHabilitacaoTef(ctx.supabase, ctx.empresaId),
  ]);
  const credencial = credencialPayGoDoAmbiente({
    ambiente: "homologacao",
    pontoCaptura: habilitacao.pontoCaptura,
    pontoHomologacao: perfil.pontoHomologacao,
    servidorHomologacao: servidores.servidorHomologacao,
    servidorProducao: servidores.servidorProducao,
    cnpjHomologacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    cnpjTerminal: "",
  });
  if (!credencial.ok) {
    throw new ErroTef(credencial.erro, 409);
  }
  return { ok: true as const, autorizado: true as const };
}

export async function autorizarDiagnosticoComunicacao(dispositivoId: string) {
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
    throw new ErroTef("Este computador não está autorizado para o TEF desta empresa.", 403);
  }
  if (await diagnosticoPinpadBloqueado(ctx.supabase, ctx.empresaId, terminal.id)) {
    throw new ErroTef("Terminal ocupado com operação financeira.", 409);
  }
  const [perfil, servidores, habilitacao] = await Promise.all([
    lerPerfilHomologacaoEmpresa(ctx.empresaId),
    lerServidoresPayGoEmpresa(ctx.empresaId),
    lerHabilitacaoTef(ctx.supabase, ctx.empresaId),
  ]);
  if (habilitacao.ambiente !== "producao") {
    throw new ErroTef("O ambiente desta empresa não é produção. Nenhum teste foi enviado.", 409);
  }
  const credencial = credencialPayGoDoAmbiente({
    ambiente: "producao",
    pontoCaptura: habilitacao.pontoCaptura,
    pontoHomologacao: perfil.pontoHomologacao,
    servidorHomologacao: servidores.servidorHomologacao,
    servidorProducao: servidores.servidorProducao,
    cnpjHomologacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    cnpjTerminal: "",
  });
  if (!credencial.ok || credencial.ambiente !== "producao") {
    throw new ErroTef(
      credencial.ok ? "O ambiente desta empresa não é produção. Nenhum teste foi enviado." : credencial.erro,
      409
    );
  }
  return { ok: true as const, autorizado: true as const, ambiente: "producao" as const };
}

export async function credencialInstalacaoHomologacao(dispositivoId: string) {
  const autorizado = await autorizarDiagnosticoHomologacao(dispositivoId);
  const ctx = await resolverContextoAutorizadoEmpresa();
  const [perfil, servidores, habilitacao] = await Promise.all([
    lerPerfilHomologacaoEmpresa(ctx.empresaId),
    lerServidoresPayGoEmpresa(ctx.empresaId),
    lerHabilitacaoTef(ctx.supabase, ctx.empresaId),
  ]);
  const credencial = credencialPayGoDoAmbiente({
    ambiente: "homologacao",
    pontoCaptura: habilitacao.pontoCaptura,
    pontoHomologacao: perfil.pontoHomologacao,
    servidorHomologacao: servidores.servidorHomologacao,
    servidorProducao: servidores.servidorProducao,
    cnpjHomologacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    cnpjTerminal: "",
  });
  if (!credencial.ok || credencial.ambiente !== "homologacao") {
    throw new ErroTef("A instalação usa somente a configuração de homologação desta empresa.", 409);
  }
  const id = uuid(dispositivoId);
  const terminais = await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  const terminal = terminais.find((item) => item.dispositivoId === id);
  if (!terminal) {
    throw new ErroTef("Este computador não está autorizado para o TEF desta empresa.", 403);
  }
  return {
    autorizado,
    credencial,
    empresaId: ctx.empresaId,
    terminal: {
      id: terminal.id,
      dispositivoId: terminal.dispositivoId,
      estabelecimento: terminal.estabelecimento,
    },
  };
}

export async function credencialInstalacaoProducao(dispositivoId: string) {
  await autorizarDiagnosticoComunicacao(dispositivoId);
  const ctx = await resolverContextoAutorizadoEmpresa();
  const [perfil, servidores, habilitacao] = await Promise.all([
    lerPerfilHomologacaoEmpresa(ctx.empresaId),
    lerServidoresPayGoEmpresa(ctx.empresaId),
    lerHabilitacaoTef(ctx.supabase, ctx.empresaId),
  ]);
  const credencial = credencialPayGoDoAmbiente({
    ambiente: "producao",
    pontoCaptura: habilitacao.pontoCaptura,
    pontoHomologacao: perfil.pontoHomologacao,
    servidorHomologacao: servidores.servidorHomologacao,
    servidorProducao: servidores.servidorProducao,
    cnpjHomologacao: perfil.cnpjInstalacao,
    cnpjProducao: perfil.cnpjProducao,
    cnpjTerminal: "",
  });
  if (!credencial.ok || credencial.ambiente !== "producao") {
    throw new ErroTef("A instalação de produção usa somente a configuração desta empresa.", 409);
  }
  const id = uuid(dispositivoId);
  const terminais = await listarTerminaisAtivosEmpresa(ctx.supabase, ctx.empresaId);
  const terminal = terminais.find((item) => item.dispositivoId === id);
  if (!terminal) {
    throw new ErroTef("Este computador não está autorizado para o TEF desta empresa.", 403);
  }
  return {
    credencial,
    empresaId: ctx.empresaId,
    terminal: {
      id: terminal.id,
      dispositivoId: terminal.dispositivoId,
      estabelecimento: terminal.estabelecimento,
    },
  };
}

export async function vincularIdentidadeHomologacaoSessao(input: {
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  codigo: string;
  assinaturaPareamento: string;
}) {
  const { empresaId, terminal } = await credencialInstalacaoHomologacao(input.dispositivoId);
  const aceite = aceitarVinculoIdentidadeHomologacao({
    empresaSessaoId: empresaId,
    dispositivoInformado: input.dispositivoId,
    terminalInformadoId: terminal.id,
    dispositivoAutorizado: terminal.dispositivoId,
    terminalAutorizadoId: terminal.id,
    chavePublica: input.chavePublica,
    chaveId: input.chaveId,
    codigo: input.codigo,
    assinaturaPareamento: input.assinaturaPareamento,
  });
  if (!aceite.ok) {
    throw new ErroTef(aceite.motivo, 403);
  }
  await salvarIdentidadeHomologacao({
    empresaId: aceite.registro.empresa_id,
    terminalId: aceite.registro.terminal_id,
    dispositivoId: aceite.registro.dispositivo_id,
    chavePublica: aceite.registro.chave_publica,
    chaveId: aceite.registro.chave_id,
  });
  return { ok: true as const, vinculada: true as const, chaveId: aceite.registro.chave_id };
}

export async function prepararAcessoPastaTef(dispositivoId: string) {
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
  return {
    ok: true as const,
    empresaId: ctx.empresaId,
    terminalCodigo: terminal.codigo,
    estabelecimento: terminal.estabelecimento,
    desafio: randomBytes(32).toString("hex"),
    pendenciaFinanceira: terminal.temPendencia,
    mensagemPendencia: terminal.temPendencia
      ? "Há operação TEF pendente, autorização sem confirmação ou conciliação. A pasta não pode ser alterada."
      : "",
  };
}

export async function prepararInicializacaoBiblioteca(dispositivoId: string) {
  const acesso = await prepararAcessoPinpad(dispositivoId);
  const ctx = await resolverContextoAutorizadoEmpresa();
  const habilitacao = await lerHabilitacaoTef(ctx.supabase, ctx.empresaId);
  if (habilitacao.ambiente !== "producao") {
    throw new ErroTef(
      "A inicialização explícita exige o ambiente oficial de produção desta empresa.",
      409
    );
  }
  return {
    ok: true as const,
    empresaId: acesso.empresaId,
    acao: "inicializar" as const,
  };
}

export async function prepararSincronizacaoVinculoTefSessao(input: {
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  assinaturaPareamento: string;
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
  const codigo = texto(input.codigo).toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(codigo)) {
    throw new ErroTef("Código de pareamento inválido.");
  }
  const dispositivoId = uuid(input.dispositivoId);
  const chavePublica = texto(input.chavePublica);
  const assinaturaValida = verificarProvaTef(
    chavePublica,
    {
      acao: "pareamento",
      desafio: hashSegredoVinculo(codigo),
      identificador: dispositivoId,
      valorCentavos: 0,
      nsu: "",
      autorizacao: "",
      rede: "",
      finalizacao: "",
      sucesso: true,
      codigo: "",
    },
    texto(input.assinaturaPareamento)
  );
  if (!assinaturaValida) {
    throw new ErroTef("O Connector não comprovou a chave deste computador.", 403);
  }
  const fatos = await carregarFatosSincronizacaoVinculo({
    empresaId: ctx.empresaId,
    dispositivoId,
  });
  return planejarSincronizacaoVinculo({
    empresaSessaoId: ctx.empresaId,
    permissaoEditar: true,
    dispositivoInformado: dispositivoId,
    chavePublicaInformada: chavePublica,
    ...fatos,
  });
}

const MOTIVO_RECUPERACAO: Record<string, string> = {
  chave_invalida: "A chave comprovada não é uma chave pública Ed25519.",
  outra_empresa: "Este computador está vinculado a outra empresa.",
  sem_terminal: "A chave comprovada não pertence ao terminal desta empresa.",
  pendente: "Há transação ou reconciliação pendente. A recuperação fica bloqueada até a resolução financeira.",
  chave_revogada: "A chave atual do Connector já foi revogada. A recuperação não gera outra chave.",
  chave_outro_terminal: "A chave atual já autoriza outro terminal.",
  substituida:
    "A autorização deste terminal mudou durante a recuperação. Confira as chaves antes de tentar de novo. Nenhuma chave nova foi gerada.",
};

function motivoRecuperacao(codigo: string) {
  return MOTIVO_RECUPERACAO[codigo] || "Não foi possível recuperar a autorização deste computador.";
}

async function sessaoFinanceiro() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      throw new ErroTef(error.message, error.status);
    }
    throw error;
  }
  return ctx;
}

export async function diagnosticarRecuperacaoTefSessao(input: {
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinaturaIdentidade: string;
}) {
  const ctx = await sessaoFinanceiro();
  const dispositivoId = uuid(input.dispositivoId);
  const chavePublica = texto(input.chavePublica);
  const assinaturaValida = verificarIdentidadeTef(
    chavePublica,
    dispositivoId,
    texto(input.assinaturaIdentidade)
  );
  if (!assinaturaValida) {
    throw new ErroTef("O Connector não comprovou a identidade deste computador.", 403);
  }
  const fatos = await carregarFatosSincronizacaoVinculo({
    empresaId: ctx.empresaId,
    dispositivoId,
  });
  const terminal = fatos.terminal;
  const fingerprintAutorizada = fingerprintChavePublicaEd25519(terminal?.chavePublica ?? "");
  const fingerprintConnector = fingerprintChavePublicaEd25519(chavePublica);
  const conferem = Boolean(
    fingerprintAutorizada && fingerprintConnector && fingerprintAutorizada === fingerprintConnector
  );
  return {
    codigo: terminal?.codigo ?? "",
    terminalId: terminal?.id ?? "",
    pontoCaptura: terminal?.pontoCaptura ?? "",
    chaveIdAutorizada: terminal?.chaveId ?? "",
    fingerprintAutorizada: fingerprintAutorizada ?? "",
    chaveIdConnector: UUID.test(texto(input.chaveId)) ? texto(input.chaveId).toLowerCase() : "",
    fingerprintConnector: fingerprintConnector ?? "",
    conferem,
    pendencia: fatos.pendenciaFinanceira,
    outraEmpresa: fatos.dispositivoOutraEmpresa,
    administrador: ctx.perfil === "administrador",
  };
}

export async function recuperarAutorizacaoTefSessao(input: {
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinaturaPareamento: string;
  perdaConfirmada: boolean;
}) {
  const ctx = await sessaoFinanceiro();
  const codigo = texto(input.codigo).toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(codigo)) {
    throw new ErroTef("Código de pareamento inválido.");
  }
  const dispositivoId = uuid(input.dispositivoId);
  const chavePublica = texto(input.chavePublica);
  const assinaturaValida = verificarProvaTef(
    chavePublica,
    {
      acao: "pareamento",
      desafio: hashSegredoVinculo(codigo),
      identificador: dispositivoId,
      valorCentavos: 0,
      nsu: "",
      autorizacao: "",
      rede: "",
      finalizacao: "",
      sucesso: true,
      codigo: "",
    },
    texto(input.assinaturaPareamento)
  );
  const fatos = await carregarFatosSincronizacaoVinculo({
    empresaId: ctx.empresaId,
    dispositivoId,
  });
  const conflito = fatos.terminal
    ? await consultarConflitoChaveTef({
        terminalId: fatos.terminal.id,
        chavePublica,
      })
    : { chaveJaRevogada: false, chaveEmOutroTerminal: false };
  const decisao = decidirRecuperacaoAutorizacao({
    administrador: ctx.perfil === "administrador",
    permissaoEditar: true,
    perdaConfirmada: input.perdaConfirmada === true,
    assinaturaValida,
    empresaSessaoId: ctx.empresaId,
    dispositivoAssinado: dispositivoId,
    chavePublicaComprovada: chavePublica,
    chaveIdInformada: texto(input.chaveId),
    fingerprintComprovada: fingerprintChavePublicaEd25519(chavePublica),
    dispositivoOutraEmpresa: fatos.dispositivoOutraEmpresa,
    pendenciaFinanceira: fatos.pendenciaFinanceira,
    reconciliacao: false,
    chaveJaRevogada: conflito.chaveJaRevogada,
    chaveEmOutroTerminal: conflito.chaveEmOutroTerminal,
    terminal: fatos.terminal,
  });
  if (decisao.efeito === "recusar") {
    return {
      efeito: "recusar" as const,
      motivo: decisao.motivo,
      vinculo: null,
      gerarChave: false as const,
      executaInstalacao: false as const,
    };
  }
  if (decisao.efeito === "autorizar" && fatos.terminal) {
    const fingerprintAnterior = fingerprintChavePublicaEd25519(fatos.terminal.chavePublica);
    const fingerprintAtual = fingerprintChavePublicaEd25519(chavePublica);
    if (!fingerprintAnterior || !fingerprintAtual) {
      return {
        efeito: "recusar" as const,
        motivo: "A chave comprovada não é uma chave pública Ed25519.",
        vinculo: null,
        gerarChave: false as const,
        executaInstalacao: false as const,
      };
    }
    const troca = await substituirAutorizacaoTerminalTef({
      empresaId: ctx.empresaId,
      dispositivoId,
      usuarioId: ctx.usuarioId,
      chavePublica,
      chaveId: UUID.test(texto(input.chaveId)) ? texto(input.chaveId).toLowerCase() : null,
      chaveAnterior: fatos.terminal.chavePublica,
      fingerprintAnterior,
      fingerprintAtual,
    });
    if (troca.efeito === "recusar") {
      return {
        efeito: "recusar" as const,
        motivo: motivoRecuperacao(troca.motivo),
        vinculo: null,
        gerarChave: false as const,
        executaInstalacao: false as const,
      };
    }
  }
  try {
    const atualizados = await carregarFatosSincronizacaoVinculo({
      empresaId: ctx.empresaId,
      dispositivoId,
    });
    const plano = planejarSincronizacaoVinculo({
      empresaSessaoId: ctx.empresaId,
      permissaoEditar: true,
      dispositivoInformado: dispositivoId,
      chavePublicaInformada: chavePublica,
      ...atualizados,
    });
    return {
      efeito: decisao.efeito === "ja_autorizada" ? ("ja_autorizada" as const) : ("autorizada" as const),
      motivo: plano.efeito === "sincronizar" ? "" : plano.motivo,
      vinculo: plano.vinculo,
      gerarChave: false as const,
      executaInstalacao: false as const,
    };
  } catch (error) {
    if (decisao.efeito !== "autorizar") {
      throw error;
    }
    return {
      efeito: "autorizada" as const,
      motivo:
        "A autorização foi atualizada no banco, mas a sincronização local não pôde ser preparada. Use Sincronizar Connector para repetir só essa gravação. Não gere outra chave.",
      vinculo: null,
      gerarChave: false as const,
      executaInstalacao: false as const,
    };
  }
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
