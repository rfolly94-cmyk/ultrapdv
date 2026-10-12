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
  carregarFatosSincronizacaoVinculo,
  consultarConflitoChaveTef,
  concluirPareamentoTef,
  salvarConfigTefEmpresa,
  substituirAutorizacaoTerminalTef,
} from "@/lib/pdv/tef/persistencia";
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
