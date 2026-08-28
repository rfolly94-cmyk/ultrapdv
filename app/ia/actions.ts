"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { cancelarPropostaAcao } from "@/lib/ia/acoes/cancelar";
import { confirmarPropostaAcao } from "@/lib/ia/acoes/confirmar";
import { desfazerAcaoIa } from "@/lib/ia/acoes/desfazer";
import { parseContextoTelaAssistente } from "@/lib/ia/contexto";
import { executarAssistenteIa } from "@/lib/ia/executar-assistente";
import {
  garantirConversaIa,
  gravarMensagemIa,
  listarMensagensIa,
} from "@/lib/ia/historico";
import { MENSAGEM_IA_MIGRATION, SUGESTOES_ASSISTENTE, SUGESTOES_ASSISTENTE_IA } from "@/lib/ia/tipos";
import { lerConfigProviderIa } from "@/lib/ia/provider";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { createClient } from "@/lib/supabase/server";

async function contextoAssistente() {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    redirect("/login");
  }
  await exigirEmpresaOperacionalOuRedirecionar(sessao.empresaId);
  const identidade = await obterIdentidadeEmpresaSessao();
  return {
    supabase: await createClient(),
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    permissoes: sessao.permissoes,
    empresaNome: identidade?.nome || "Empresa",
  };
}

function sugestoesAssistente() {
  const iaDisponivel = Boolean(lerConfigProviderIa());
  return {
    sugestoes: iaDisponivel
      ? [...SUGESTOES_ASSISTENTE, ...SUGESTOES_ASSISTENTE_IA]
      : [...SUGESTOES_ASSISTENTE],
    iaDisponivel,
  };
}

function ctxFerramenta(
  ctx: Awaited<ReturnType<typeof contextoAssistente>>,
  conversaId: string | null,
  pathname = "/produtos"
) {
  return {
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    conversaId,
    permissoes: ctx.permissoes,
    tela: parseContextoTelaAssistente({ pathname }),
  };
}

export async function carregarAssistenteIaAction() {
  const ctx = await contextoAssistente();
  const { sugestoes, iaDisponivel } = sugestoesAssistente();
  const conversa = await garantirConversaIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
  });
  if (!conversa.ok) {
    return {
      ok: true as const,
      mensagens: [],
      conversaId: null,
      sugestoes,
      iaDisponivel,
      aviso: conversa.indisponivel ? MENSAGEM_IA_MIGRATION : conversa.erro,
    };
  }
  const lista = await listarMensagensIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    conversaId: conversa.conversaId,
  });
  if (!lista.ok) {
    return {
      ok: true as const,
      mensagens: [],
      conversaId: conversa.conversaId,
      sugestoes,
      iaDisponivel,
      aviso: lista.indisponivel ? MENSAGEM_IA_MIGRATION : lista.erro,
    };
  }
  return {
    ok: true as const,
    mensagens: lista.mensagens,
    conversaId: conversa.conversaId,
    sugestoes,
    iaDisponivel,
  };
}

export async function enviarMensagemAssistenteIaAction(input: {
  texto: string;
  pathname?: string;
  search?: string;
  notificacaoIds?: string[];
}) {
  const ctx = await contextoAssistente();
  const texto = String(input.texto ?? "").trim().slice(0, 2000);
  if (!texto) {
    return { ok: false as const, erro: "Escreva uma pergunta." };
  }
  const conversa = await garantirConversaIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    titulo: texto.slice(0, 80),
  });
  if (!conversa.ok) {
    return {
      ok: false as const,
      erro: conversa.indisponivel ? MENSAGEM_IA_MIGRATION : conversa.erro,
    };
  }

  const historico = await listarMensagensIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    conversaId: conversa.conversaId,
    limite: 12,
  });
  await gravarMensagemIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    conversaId: conversa.conversaId,
    papel: "usuario",
    conteudo: texto,
  });

  const tela = parseContextoTelaAssistente({
    pathname: input.pathname ?? "/",
    search: input.search ?? "",
    notificacaoIds: input.notificacaoIds,
  });

  const saida = await executarAssistenteIa({
    ctx: {
      supabase: ctx.supabase,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      conversaId: conversa.conversaId,
      permissoes: ctx.permissoes,
      tela,
    },
    historico: historico.ok ? historico.mensagens : [],
    pergunta: texto,
    empresaNome: ctx.empresaNome,
  });

  const gravada = await gravarMensagemIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    conversaId: conversa.conversaId,
    papel: "assistente",
    conteudo: saida.texto,
    acoes: saida.acoes,
    propostaFiscal: saida.propostaFiscal,
    propostaAcao: saida.propostaAcao,
    modo: saida.modo,
    contextoDeterministico: saida.contextoDeterministico,
    contextoAnalitico: saida.contextoAnalitico,
  });
  if (!gravada.ok) {
    return {
      ok: true as const,
      conversaId: conversa.conversaId,
      mensagem: {
        id: "temp",
        papel: "assistente" as const,
        conteudo: saida.texto,
        acoes: saida.acoes,
        propostaFiscal: saida.propostaFiscal,
        propostaAcao: saida.propostaAcao,
        modo: saida.modo,
        contextoDeterministico: saida.contextoDeterministico,
        contextoAnalitico: saida.contextoAnalitico,
        createdAt: new Date().toISOString(),
      },
    };
  }
  return {
    ok: true as const,
    conversaId: conversa.conversaId,
    mensagem: gravada.mensagem,
  };
}

async function mensagemResultado(params: {
  ctx: Awaited<ReturnType<typeof contextoAssistente>>;
  conversaId: string;
  conteudo: string;
  propostaAcao?: import("@/lib/ia/acoes/tipos").CardPropostaAcao | null;
  acoes?: import("@/lib/ia/tipos").AcaoAssistente[];
}) {
  return gravarMensagemIa({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.conversaId,
    papel: "assistente",
    conteudo: params.conteudo,
    acoes: params.acoes,
    propostaAcao: params.propostaAcao,
  });
}

export async function confirmarAcaoAssistenteAction(input: {
  propostaId: string;
  nomeGrupo?: string;
}) {
  const ctx = await contextoAssistente();
  const propostaId = String(input.propostaId ?? "").trim();
  if (!propostaId) {
    return { ok: false as const, erro: "Proposta inválida." };
  }
  const conversa = await garantirConversaIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
  });
  if (!conversa.ok) {
    return { ok: false as const, erro: conversa.erro };
  }
  const aplicado = await confirmarPropostaAcao({
    ctx: ctxFerramenta(ctx, conversa.conversaId),
    propostaId,
    nomeGrupo: input.nomeGrupo ? String(input.nomeGrupo).trim() : undefined,
  });
  if (!aplicado.ok) {
    const gravada = await mensagemResultado({
      ctx,
      conversaId: conversa.conversaId,
      conteudo: `Não consegui aplicar a alteração. ${aplicado.erro ?? aplicado.mensagem}`,
      propostaAcao: {
        id: propostaId,
        tipo: "atualizacao_fiscal_produto",
        entidadeTipo: "produto",
        entidadeId: null,
        titulo: "Erro",
        descricao: aplicado.erro ?? aplicado.mensagem,
        diferencas: [],
        impacto: [],
        avisos: [aplicado.erro ?? aplicado.mensagem],
        card: "erro",
      },
    });
    return {
      ok: false as const,
      erro: aplicado.erro ?? aplicado.mensagem,
      mensagem: gravada.ok ? gravada.mensagem : null,
    };
  }
  revalidatePath("/produtos");
  revalidatePath("/produtos/grupos-fiscais");
  revalidatePath("/estoque");
  const gravada = await mensagemResultado({
    ctx,
    conversaId: conversa.conversaId,
    conteudo: aplicado.mensagem,
    acoes: aplicado.podeDesfazer
      ? [{ label: "Desfazer alteração", desfazerAcao: { propostaId } }]
      : [],
    propostaAcao: {
      id: propostaId,
      tipo: "atualizacao_fiscal_produto",
      entidadeTipo: "produto",
      entidadeId: aplicado.entidadeId ?? null,
      titulo: "Resultado",
      descricao: aplicado.mensagem,
      diferencas: [],
      impacto: [],
      avisos: [],
      podeDesfazer: Boolean(aplicado.podeDesfazer),
      card: "resultado",
    },
  });
  return {
    ok: true as const,
    mensagem: gravada.ok ? gravada.mensagem : null,
  };
}

export async function cancelarAcaoAssistenteAction(input: { propostaId: string }) {
  const ctx = await contextoAssistente();
  const propostaId = String(input.propostaId ?? "").trim();
  if (!propostaId) {
    return { ok: false as const, erro: "Proposta inválida." };
  }
  const conversa = await garantirConversaIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
  });
  if (!conversa.ok) {
    return { ok: false as const, erro: conversa.erro };
  }
  const saida = await cancelarPropostaAcao({
    ctx: ctxFerramenta(ctx, conversa.conversaId),
    propostaId,
  });
  if (!saida.ok) {
    return saida;
  }
  const gravada = await mensagemResultado({
    ctx,
    conversaId: conversa.conversaId,
    conteudo: saida.mensagem,
  });
  return {
    ok: true as const,
    mensagem: gravada.ok ? gravada.mensagem : null,
  };
}

export async function desfazerAcaoAssistenteAction(input: { propostaId: string }) {
  const ctx = await contextoAssistente();
  const propostaId = String(input.propostaId ?? "").trim();
  if (!propostaId) {
    return { ok: false as const, erro: "Proposta inválida." };
  }
  const conversa = await garantirConversaIa({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
  });
  if (!conversa.ok) {
    return { ok: false as const, erro: conversa.erro };
  }
  const saida = await desfazerAcaoIa({
    ctx: ctxFerramenta(ctx, conversa.conversaId),
    propostaId,
  });
  if (!saida.ok) {
    return saida;
  }
  const gravada = await mensagemResultado({
    ctx,
    conversaId: conversa.conversaId,
    conteudo: saida.mensagem,
  });
  return {
    ok: true as const,
    mensagem: gravada.ok ? gravada.mensagem : null,
  };
}

export async function aplicarFiscalAssistenteAction(input: {
  propostaId: string;
}) {
  return confirmarAcaoAssistenteAction(input);
}
