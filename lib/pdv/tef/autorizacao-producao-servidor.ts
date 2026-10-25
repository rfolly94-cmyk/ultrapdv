import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { avaliarAutorizacaoProducao } from "@/lib/pdv/tef/habilitacao-producao";
import { carregarConfiguracaoMotor } from "@/lib/pdv/tef/politica-empresa-servidor";
import { carregarSinaisCobranca } from "@/lib/pdv/tef/sinais-cobranca";
import { classificarServidorComercial, declaracaoRepeteServidorConfirmado } from "@/lib/pdv/tef/servidor-comercial";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hostDe(valor: string) {
  const separador = valor.lastIndexOf(":");
  return (separador > 0 ? valor.slice(0, separador) : valor).trim().toLowerCase();
}

async function auditar(input: {
  empresaId: string;
  usuarioId: string;
  terminalId?: string | null;
  dispositivoId?: string | null;
  acao: "servidor_declarado" | "servidor_validado" | "pinpad_registrado" | "producao_autorizada";
}) {
  const admin = createAdminClient();
  return admin.from("tef_motor_producao_auditoria").insert({
    empresa_id: input.empresaId,
    usuario_id: input.usuarioId,
    terminal_id: input.terminalId && UUID.test(input.terminalId) ? input.terminalId : null,
    dispositivo_id: input.dispositivoId && UUID.test(input.dispositivoId) ? input.dispositivoId : null,
    acao: input.acao,
  });
}

export async function invalidarAutorizacaoProducao(empresaId: string) {
  try {
    const admin = createAdminClient();
    await admin.from("tef_motor_empresas").update({
      producao_autorizada: false,
      updated_at: new Date().toISOString(),
    }).eq("empresa_id", empresaId);
  } catch {
    return;
  }
}

export async function declararServidorComercial(valor: string) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) return { ok: false as const, erro: "A empresa ativa não foi resolvida." };
  if (sessao.perfil.trim().toLowerCase() !== "administrador") {
    return { ok: false as const, erro: "Somente o administrador da empresa pode informar o servidor comercial." };
  }
  const endereco = classificarServidorComercial(valor);
  if (!endereco.ok) return { ok: false as const, erro: endereco.motivo };
  try {
    const admin = createAdminClient();
    const homologacao = await admin
      .from("tef_configuracoes")
      .select("servidor_homologacao")
      .eq("empresa_id", sessao.empresaId)
      .maybeSingle();
    const gravado = homologacao.data && typeof homologacao.data.servidor_homologacao === "string"
      ? homologacao.data.servidor_homologacao
      : "";
    if (gravado && hostDe(gravado) === hostDe(endereco.servidor)) {
      return {
        ok: false as const,
        erro: "Este endereço é de homologação. Informe o servidor comercial de produção fornecido pela PayGo.",
      };
    }
    const atual = await carregarConfiguracaoMotor(sessao.empresaId);
    if (declaracaoRepeteServidorConfirmado(atual.servidorComercial, endereco.servidor, atual.servidorComercialValidado)) {
      return { ok: true as const, validado: true as const };
    }
    const agora = new Date().toISOString();
    const { data, error } = await admin.from("tef_motor_empresas").update({
      servidor_comercial: endereco.servidor,
      servidor_comercial_validado: false,
      servidor_validado_em: null,
      servidor_validado_por: null,
      servidor_validado_terminal: null,
      producao_autorizada: false,
      updated_at: agora,
    }).eq("empresa_id", sessao.empresaId).select("empresa_id").maybeSingle();
    if (error || !data) {
      return { ok: false as const, erro: "Não foi possível gravar o servidor comercial. A migration da habilitação precisa estar aplicada." };
    }
    const auditoria = await auditar({
      empresaId: sessao.empresaId,
      usuarioId: sessao.usuarioId,
      acao: "servidor_declarado",
    });
    if (auditoria.error) {
      await admin.from("tef_motor_empresas").update({
        servidor_comercial: "",
        servidor_comercial_validado: false,
        producao_autorizada: false,
      }).eq("empresa_id", sessao.empresaId);
      return { ok: false as const, erro: "O servidor foi recusado porque a auditoria não pôde ser gravada." };
    }
    return { ok: true as const, validado: false as const };
  } catch {
    return { ok: false as const, erro: "A habilitação comercial ainda não está disponível neste ambiente." };
  }
}

export async function confirmarServidorComercial(input: {
  empresaId: string;
  usuarioId: string;
  terminalId: string;
  dispositivoId: string;
  codigo: string;
  nativo: boolean;
  servidorValidado: boolean;
}) {
  const config = await carregarConfiguracaoMotor(input.empresaId);
  const endereco = classificarServidorComercial(config.servidorComercial);
  if (!endereco.ok || !input.nativo || !input.servidorValidado || input.codigo !== "configurada") {
    return { ok: false as const, erro: "A biblioteca não confirmou o servidor comercial declarado. Nada foi marcado como validado." };
  }
  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { error } = await admin.from("tef_motor_empresas").update({
    servidor_comercial_validado: true,
    servidor_validado_em: agora,
    servidor_validado_por: input.usuarioId,
    servidor_validado_terminal: UUID.test(input.terminalId) ? input.terminalId : null,
    producao_autorizada: false,
    updated_at: agora,
  }).eq("empresa_id", input.empresaId);
  if (error) {
    return { ok: false as const, erro: "A biblioteca respondeu, mas a validação do servidor não foi gravada." };
  }
  const auditoria = await auditar({
    empresaId: input.empresaId,
    usuarioId: input.usuarioId,
    terminalId: input.terminalId,
    dispositivoId: input.dispositivoId,
    acao: "servidor_validado",
  });
  if (auditoria.error) {
    await admin.from("tef_motor_empresas").update({
      servidor_comercial_validado: false,
      servidor_validado_em: null,
      servidor_validado_por: null,
      servidor_validado_terminal: null,
    }).eq("empresa_id", input.empresaId);
    return { ok: false as const, erro: "A validação do servidor não foi auditada e permanece pendente." };
  }
  return { ok: true as const };
}

export async function registrarPinpadProducao(input: {
  empresaId: string;
  usuarioId: string;
  terminalId: string;
  dispositivoId: string;
  journalInstalacao: string;
  codigoNativo: number | null;
}) {
  if (!UUID.test(input.terminalId) || !UUID.test(input.dispositivoId) || !input.journalInstalacao) {
    return { ok: false as const, erro: "O teste não foi associado ao ponto, ao terminal e ao dispositivo. A aprovação não foi gravada." };
  }
  if (input.codigoNativo === null || !Number.isInteger(input.codigoNativo)) {
    return { ok: false as const, erro: "A biblioteca não informou o retorno nativo. A aprovação não foi gravada." };
  }
  const aprovado = input.codigoNativo === 0;
  const admin = createAdminClient();
  const { error } = await admin.from("tef_motor_pinpad_producao").insert({
    empresa_id: input.empresaId,
    terminal_id: input.terminalId,
    dispositivo_id: input.dispositivoId,
    journal_instalacao: input.journalInstalacao,
    codigo_nativo: input.codigoNativo,
    aprovado,
    aprovado_por: input.usuarioId,
  });
  if (error) {
    return { ok: false as const, erro: "O retorno do PinPad não foi gravado. A cobrança continua bloqueada." };
  }
  await invalidarAutorizacaoProducao(input.empresaId);
  await auditar({
    empresaId: input.empresaId,
    usuarioId: input.usuarioId,
    terminalId: input.terminalId,
    dispositivoId: input.dispositivoId,
    acao: "pinpad_registrado",
  });
  return { ok: true as const, aprovado };
}

export async function autorizarProducao(origem: string) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return { ok: false as const, erro: "A empresa ativa não foi resolvida.", pendentes: [] as string[] };
  }
  const carregado = await carregarSinaisCobranca(origem, sessao.empresaId);
  const decisao = avaliarAutorizacaoProducao({
    administrador: sessao.perfil.trim().toLowerCase() === "administrador",
    credenciamentoComprovado: carregado.config.credenciamentoComprovado,
    servidorValidado: carregado.config.servidorComercialValidado,
    pontoInstalado: carregado.sinais.pontoProducaoInstalado,
    pinpadAprovado: carregado.sinais.pinpadAprovado,
    pendenciaFinanceira: carregado.sinais.pendenciaFinanceira,
    empresaSessao: sessao.empresaId,
    terminalId: carregado.terminalId,
    dispositivoId: carregado.dispositivoId,
  });
  if (!decisao.pode) {
    return {
      ok: false as const,
      erro: "A produção não foi habilitada. As condições obrigatórias ainda não estão comprovadas.",
      pendentes: decisao.pendencias,
    };
  }
  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { data, error } = await admin.from("tef_motor_empresas").update({
    producao_autorizada: true,
    updated_at: agora,
  }).eq("empresa_id", sessao.empresaId).select("empresa_id").maybeSingle();
  if (error || !data || String(data.empresa_id) !== sessao.empresaId) {
    return { ok: false as const, erro: "A autorização não foi gravada.", pendentes: [] as string[] };
  }
  const auditoria = await auditar({
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    terminalId: carregado.terminalId,
    dispositivoId: carregado.dispositivoId,
    acao: "producao_autorizada",
  });
  if (auditoria.error) {
    await invalidarAutorizacaoProducao(sessao.empresaId);
    return { ok: false as const, erro: "A autorização não foi auditada e permanece desligada.", pendentes: [] as string[] };
  }
  return { ok: true as const, producaoLiberada: true as const };
}
