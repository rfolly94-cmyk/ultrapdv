"use server";

import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { aplicarEstadoNotificacaoUsuario } from "@/lib/notificacoes/aplicar-usuario";
import { listarNotificacoesDaEmpresa } from "@/lib/notificacoes/listar";
import { actionUrlSegura } from "@/lib/notificacoes/rotas";
import {
  MENSAGEM_NOTIFICACOES_MIGRATION,
  tabelaNotificacoesIndisponivel,
} from "@/lib/notificacoes/schema";
import {
  carregarConfiguracaoNotificacoesEmpresa,
  sincronizarNotificacoesEmpresa,
} from "@/lib/notificacoes/sincronizar";
import { normalizarConfiguracaoNotificacoes } from "@/lib/notificacoes/config";
import {
  ADIAR_NOTIFICACAO,
  FILTROS_CENTRAL_NOTIFICACOES,
  type ConfiguracaoNotificacoes,
  type FiltroCentralNotificacoes,
  type OpcaoAdiarNotificacao,
} from "@/lib/notificacoes/tipos";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { createClient } from "@/lib/supabase/server";

async function contextoNotificacoes() {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    redirect("/login");
  }
  await exigirEmpresaOperacionalOuRedirecionar(sessao.empresaId);
  return {
    supabase: await createClient(),
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    podeEditar: temPermissao(
      sessao.permissoes,
      "configuracoes",
      "editar_empresa"
    ),
  };
}

function filtroValido(valor: string): valor is FiltroCentralNotificacoes {
  return (FILTROS_CENTRAL_NOTIFICACOES as readonly string[]).includes(valor);
}

export async function contarNotificacoesAction() {
  const { supabase, empresaId, usuarioId } = await contextoNotificacoes();
  await sincronizarNotificacoesEmpresa({
    supabase,
    empresaId,
    forcar: false,
  });
  const lista = await listarNotificacoesDaEmpresa({
    supabase,
    empresaId,
    usuarioId,
  });
  if (!lista.ok) {
    if (lista.indisponivel) {
      return { ok: true as const, contador: 0 };
    }
    return { ok: false as const, erro: lista.erro };
  }
  return { ok: true as const, contador: lista.contador };
}

export async function listarCentralNotificacoesAction(filtro = "todas") {
  const { supabase, empresaId, usuarioId } = await contextoNotificacoes();
  const escolhido = filtroValido(filtro) ? filtro : "todas";
  const sync = await sincronizarNotificacoesEmpresa({
    supabase,
    empresaId,
    forcar: true,
  });
  if (!sync.ok && sync.indisponivel) {
    return {
      ok: true as const,
      itens: [],
      contador: 0,
      aviso: MENSAGEM_NOTIFICACOES_MIGRATION,
    };
  }
  if (!sync.ok) {
    return { ok: false as const, erro: sync.erro };
  }

  const lista = await listarNotificacoesDaEmpresa({
    supabase,
    empresaId,
    usuarioId,
    filtro: escolhido,
  });
  if (!lista.ok) {
    if (lista.indisponivel) {
      return {
        ok: true as const,
        itens: [],
        contador: 0,
        aviso: MENSAGEM_NOTIFICACOES_MIGRATION,
      };
    }
    return { ok: false as const, erro: lista.erro };
  }

  return {
    ok: true as const,
    itens: lista.itens.map((item) => ({
      ...item,
      actionUrl: actionUrlSegura(item.actionUrl),
    })),
    contador: lista.contador,
  };
}

export async function acaoNotificacaoUsuarioAction(input: {
  notificacaoId: string;
  acao: "lida" | "nao_lida" | "dispensar" | "adiar";
  adiar?: OpcaoAdiarNotificacao;
}) {
  const { supabase, empresaId, usuarioId } = await contextoNotificacoes();
  const notificacaoId = String(input.notificacaoId ?? "").trim();
  if (!notificacaoId) {
    return { ok: false as const, erro: "Notificação não encontrada." };
  }

  const { data: notificacao, error } = await supabase
    .from("notificacoes")
    .select("id, empresa_id")
    .eq("empresa_id", empresaId)
    .eq("id", notificacaoId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, erro: error.message };
  }
  if (!notificacao || String(notificacao.empresa_id) !== empresaId) {
    return { ok: false as const, erro: "Notificação não encontrada nesta empresa." };
  }

  return aplicarEstadoNotificacaoUsuario({
    supabase,
    empresaId,
    usuarioId,
    notificacaoId,
    acao: input.acao,
    adiar:
      input.adiar &&
      (ADIAR_NOTIFICACAO as readonly string[]).includes(input.adiar)
        ? input.adiar
        : "1h",
  });
}

export async function carregarConfiguracaoNotificacoesAction() {
  const { supabase, empresaId, podeEditar } = await contextoNotificacoes();
  const carregada = await carregarConfiguracaoNotificacoesEmpresa(
    supabase,
    empresaId
  );
  if (!carregada.ok) {
    if (carregada.indisponivel) {
      return {
        ok: true as const,
        config: normalizarConfiguracaoNotificacoes(null),
        podeEditar,
        aviso: MENSAGEM_NOTIFICACOES_MIGRATION,
      };
    }
    return { ok: false as const, erro: carregada.erro };
  }
  return {
    ok: true as const,
    config: carregada.config,
    podeEditar,
  };
}

export async function salvarConfiguracaoNotificacoesAction(
  config: ConfiguracaoNotificacoes
) {
  const { supabase, empresaId, podeEditar } = await contextoNotificacoes();
  if (!podeEditar) {
    return { ok: false as const, erro: "Você não pode alterar estas configurações." };
  }

  const normalizada = normalizarConfiguracaoNotificacoes(config);
  const { error } = await supabase.from("notificacoes_configuracoes").upsert(
    {
      empresa_id: empresaId,
      configuracao: normalizada,
    },
    { onConflict: "empresa_id" }
  );

  if (error) {
    if (tabelaNotificacoesIndisponivel(error)) {
      return { ok: false as const, erro: MENSAGEM_NOTIFICACOES_MIGRATION };
    }
    return { ok: false as const, erro: error.message };
  }

  await sincronizarNotificacoesEmpresa({
    supabase,
    empresaId,
    forcar: true,
  });

  return { ok: true as const, mensagem: "Preferências de avisos salvas." };
}
