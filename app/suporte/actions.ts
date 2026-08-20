"use server";

import { randomUUID } from "node:crypto";

import { buscarConversaAtivaUsuario } from "@/lib/suporte/conversas";
import { ErroSuporte, obterContextoSuporteUsuario } from "@/lib/suporte/contexto";
import { caminhoArquivoSuporte, validarImagemSuporte } from "@/lib/suporte/imagem";
import { sanitizarPosicaoAssistente } from "@/lib/suporte/posicao";
import { conversaNaoLida, usuarioPodeAcessarArquivo } from "@/lib/suporte/regras";
import {
  BUCKET_SUPORTE_CHAT,
  MENSAGENS_POR_PAGINA,
  POSICAO_ASSISTENTE_PADRAO,
  type MensagemSuporte,
  type PosicaoAssistente,
} from "@/lib/suporte/tipos";

function textoMensagem(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function carregarPainelSuporte() {
  try {
    const { supabase, usuarioId, empresaId } = await obterContextoSuporteUsuario();
    const conversa = await buscarConversaAtivaUsuario(supabase, usuarioId, empresaId);
    const [{ data: preferencia }, { data: leitura }] = await Promise.all([
      supabase
        .from("usuarios_preferencias_interface")
        .select("assistente_lado, assistente_offset_y")
        .eq("usuario_id", usuarioId)
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      conversa
        ? supabase
            .from("suporte_conversa_leituras")
            .select("ultima_leitura_em")
            .eq("conversa_id", conversa.id)
            .eq("usuario_id", usuarioId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const mensagens = conversa
      ? await carregarMensagensInterno(supabase, conversa.id, empresaId)
      : [];

    const ultimaMaster = [...mensagens]
      .reverse()
      .find((item) => item.remetente_tipo === "master");

    const naoLidas = conversaNaoLida({
      ultimaMensagemEm: ultimaMaster?.created_at ?? conversa?.ultima_mensagem_em,
      ultimaLeituraEm: leitura?.ultima_leitura_em,
      ultimaRemetenteTipo: ultimaMaster ? "master" : "cliente",
      visao: "cliente",
    })
      ? 1
      : 0;

    return {
      ok: true as const,
      usuarioId,
      empresaId,
      conversa,
      mensagens,
      naoLidas,
      posicao: sanitizarPosicaoAssistente({
        lado: preferencia?.assistente_lado,
        offsetY: preferencia?.assistente_offset_y,
      }),
    };
  } catch (error) {
    return {
      ok: false as const,
      erro: error instanceof ErroSuporte ? error.message : "Não foi possível abrir o suporte.",
      posicao: POSICAO_ASSISTENTE_PADRAO,
      conversa: null,
      mensagens: [] as MensagemSuporte[],
      naoLidas: 0,
    };
  }
}

async function carregarMensagensInterno(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  conversaId: string,
  empresaId: string,
  antesDe?: string
) {
  let consulta = supabase
    .from("suporte_mensagens")
    .select(
      "id, conversa_id, empresa_id, remetente_usuario_id, remetente_tipo, tipo, texto, arquivo_path, created_at"
    )
    .eq("conversa_id", conversaId)
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(MENSAGENS_POR_PAGINA);

  if (antesDe) {
    consulta = consulta.lt("created_at", antesDe);
  }

  const { data, error } = await consulta;
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MensagemSuporte[]).slice().reverse();
}

export async function carregarMensagensAnteriores(conversaId: string, antesDe: string) {
  const { supabase, empresaId } = await obterContextoSuporteUsuario();
  const mensagens = await carregarMensagensInterno(
    supabase,
    conversaId,
    empresaId,
    antesDe
  );
  return { ok: true as const, mensagens };
}

export async function salvarPosicaoAssistente(posicao: PosicaoAssistente) {
  const { supabase, usuarioId, empresaId } = await obterContextoSuporteUsuario();
  const sanitizada = sanitizarPosicaoAssistente(posicao);
  const { error } = await supabase.from("usuarios_preferencias_interface").upsert(
    {
      usuario_id: usuarioId,
      empresa_id: empresaId,
      assistente_lado: sanitizada.lado,
      assistente_offset_y: sanitizada.offsetY,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "usuario_id,empresa_id" }
  );
  if (error) {
    return { ok: false as const, erro: error.message };
  }
  return { ok: true as const, posicao: sanitizada };
}

export async function enviarMensagemSuporte(textoBruto: string) {
  const texto = textoMensagem(textoBruto);
  if (!texto) {
    return { ok: false as const, erro: "Digite uma mensagem." };
  }

  const { supabase, usuarioId, empresaId } = await obterContextoSuporteUsuario();
  let conversa = await buscarConversaAtivaUsuario(supabase, usuarioId, empresaId);

  if (!conversa) {
    const { data: criada, error } = await supabase
      .from("suporte_conversas")
      .insert({
        empresa_id: empresaId,
        aberto_por_usuario_id: usuarioId,
        status: "aguardando_suporte",
      })
      .select(
        "id, empresa_id, aberto_por_usuario_id, atendente_master_usuario_id, status, assunto, ultima_mensagem_em, created_at"
      )
      .single();
    if (error || !criada) {
      return { ok: false as const, erro: error?.message || "Não foi possível abrir o atendimento." };
    }
    conversa = criada;
  }

  const { data: mensagem, error: erroMensagem } = await supabase
    .from("suporte_mensagens")
    .insert({
      conversa_id: conversa.id,
      empresa_id: empresaId,
      remetente_usuario_id: usuarioId,
      remetente_tipo: "cliente",
      tipo: "texto",
      texto,
    })
    .select(
      "id, conversa_id, empresa_id, remetente_usuario_id, remetente_tipo, tipo, texto, arquivo_path, created_at"
    )
    .single();

  if (erroMensagem || !mensagem) {
    return { ok: false as const, erro: erroMensagem?.message || "Não foi possível enviar." };
  }

  await marcarLeituraSuporte(conversa.id);
  return { ok: true as const, conversa, mensagem: mensagem as MensagemSuporte };
}

export async function enviarImagemSuporte(formData: FormData) {
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false as const, erro: "Selecione uma imagem." };
  }

  const validacao = validarImagemSuporte({
    type: arquivo.type,
    size: arquivo.size,
    name: arquivo.name,
  });
  if (!validacao.ok) {
    return validacao;
  }

  const { supabase, usuarioId, empresaId } = await obterContextoSuporteUsuario();
  let conversa = await buscarConversaAtivaUsuario(supabase, usuarioId, empresaId);
  if (!conversa) {
    const { data: criada, error } = await supabase
      .from("suporte_conversas")
      .insert({
        empresa_id: empresaId,
        aberto_por_usuario_id: usuarioId,
        status: "aguardando_suporte",
      })
      .select(
        "id, empresa_id, aberto_por_usuario_id, atendente_master_usuario_id, status, assunto, ultima_mensagem_em, created_at"
      )
      .single();
    if (error || !criada) {
      return { ok: false as const, erro: error?.message || "Não foi possível abrir o atendimento." };
    }
    conversa = criada;
  }

  const caminho = caminhoArquivoSuporte(
    empresaId,
    conversa.id,
    validacao.extensao,
    randomUUID()
  );

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_SUPORTE_CHAT)
    .upload(caminho, arquivo, {
      contentType: validacao.mime,
      upsert: false,
    });

  if (erroUpload) {
    return { ok: false as const, erro: erroUpload.message || "Não foi possível enviar a imagem." };
  }

  const { data: mensagem, error: erroMensagem } = await supabase
    .from("suporte_mensagens")
    .insert({
      conversa_id: conversa.id,
      empresa_id: empresaId,
      remetente_usuario_id: usuarioId,
      remetente_tipo: "cliente",
      tipo: "imagem",
      arquivo_path: caminho,
    })
    .select(
      "id, conversa_id, empresa_id, remetente_usuario_id, remetente_tipo, tipo, texto, arquivo_path, created_at"
    )
    .single();

  if (erroMensagem || !mensagem) {
    return { ok: false as const, erro: erroMensagem?.message || "Não foi possível registrar a imagem." };
  }

  await marcarLeituraSuporte(conversa.id);
  return { ok: true as const, conversa, mensagem: mensagem as MensagemSuporte };
}

export async function marcarLeituraSuporte(conversaId: string) {
  const { supabase, usuarioId } = await obterContextoSuporteUsuario();
  const { error } = await supabase.from("suporte_conversa_leituras").upsert(
    {
      conversa_id: conversaId,
      usuario_id: usuarioId,
      ultima_leitura_em: new Date().toISOString(),
    },
    { onConflict: "conversa_id,usuario_id" }
  );
  if (error) {
    return { ok: false as const, erro: error.message };
  }
  return { ok: true as const };
}

export async function urlAssinadaImagemSuporte(arquivoPath: string, conversaId: string) {
  const { supabase, usuarioId, empresaId } = await obterContextoSuporteUsuario();
  const { data: conversa, error } = await supabase
    .from("suporte_conversas")
    .select("id, empresa_id, aberto_por_usuario_id")
    .eq("id", conversaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !conversa) {
    return { ok: false as const, erro: "Conversa não encontrada." };
  }

  if (
    !usuarioPodeAcessarArquivo({
      arquivoPath,
      empresaId,
      conversaId,
      conversaEmpresaId: String(conversa.empresa_id),
      abertoPorUsuarioId: String(conversa.aberto_por_usuario_id),
      usuarioId,
      ehMaster: false,
    })
  ) {
    return { ok: false as const, erro: "Arquivo não disponível." };
  }

  const { data, error: erroUrl } = await supabase.storage
    .from(BUCKET_SUPORTE_CHAT)
    .createSignedUrl(arquivoPath, 60);

  if (erroUrl || !data?.signedUrl) {
    return { ok: false as const, erro: erroUrl?.message || "Não foi possível abrir a imagem." };
  }

  return { ok: true as const, url: data.signedUrl };
}
