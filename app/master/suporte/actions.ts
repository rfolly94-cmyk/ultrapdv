"use server";

import { randomUUID } from "node:crypto";

import { registrarAuditoriaPlataforma } from "@/lib/plataforma/auditoria";
import { exigirMaster } from "@/lib/master/exigir-master";
import { caminhoArquivoSuporte, validarImagemSuporte } from "@/lib/suporte/imagem";
import { ordenarFilaMaster, usuarioPodeAcessarArquivo } from "@/lib/suporte/regras";
import {
  BUCKET_SUPORTE_CHAT,
  MENSAGENS_POR_PAGINA,
  type ConversaSuporte,
  type MensagemSuporte,
  type StatusConversaSuporte,
} from "@/lib/suporte/tipos";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function contarFilaSuporteMaster() {
  const { admin } = await exigirMaster();
  const { count, error } = await admin
    .from("suporte_conversas")
    .select("id", { count: "exact", head: true })
    .eq("status", "aguardando_suporte");
  if (error) {
    return { ok: false as const, erro: error.message, total: 0 };
  }
  return { ok: true as const, total: count ?? 0 };
}

export async function listarFilaSuporteMaster(input: {
  status?: string;
  q?: string;
}) {
  const { admin } = await exigirMaster();
  const status = texto(input.status);
  const busca = texto(input.q).replace(/[%_,()]/g, " ");

  let consulta = admin
    .from("suporte_conversas")
    .select(
      "id, empresa_id, aberto_por_usuario_id, atendente_master_usuario_id, status, assunto, ultima_mensagem_em, created_at"
    )
    .order("ultima_mensagem_em", { ascending: false })
    .limit(200);

  if (
    status === "aguardando_suporte" ||
    status === "aguardando_cliente" ||
    status === "encerrada" ||
    status === "aberta"
  ) {
    consulta = consulta.eq("status", status);
  }

  const { data, error } = await consulta;
  if (error) {
    return { ok: false as const, erro: error.message, linhas: [] as ConversaSuporte[] };
  }

  const conversas = (data ?? []) as ConversaSuporte[];
  const empresaIds = [...new Set(conversas.map((item) => item.empresa_id))];
  const usuarioIds = [
    ...new Set(
      conversas.flatMap((item) =>
        [item.aberto_por_usuario_id, item.atendente_master_usuario_id].filter(Boolean)
      )
    ),
  ] as string[];
  const conversaIds = conversas.map((item) => item.id);

  const [{ data: empresas }, { data: usuarios }, { data: ultimas }] = await Promise.all([
    empresaIds.length
      ? admin
          .from("empresas")
          .select("id, nome_fantasia, razao_social")
          .in("id", empresaIds)
      : Promise.resolve({ data: [] }),
    usuarioIds.length
      ? admin.from("usuarios").select("id, nome, email").in("id", usuarioIds)
      : Promise.resolve({ data: [] }),
    conversaIds.length
      ? admin
          .from("suporte_mensagens")
          .select("conversa_id, texto, tipo, created_at")
          .in("conversa_id", conversaIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const empresaPorId = new Map(
    (empresas ?? []).map((empresa) => [
      String(empresa.id),
      texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
    ])
  );
  const usuarioPorId = new Map(
    (usuarios ?? []).map((usuario) => [
      String(usuario.id),
      texto(usuario.nome || usuario.email) || "Usuário",
    ])
  );
  const ultimaPorConversa = new Map<string, string>();
  for (const mensagem of ultimas ?? []) {
    const id = String(mensagem.conversa_id);
    if (ultimaPorConversa.has(id)) {
      continue;
    }
    ultimaPorConversa.set(
      id,
      mensagem.tipo === "imagem" ? "Imagem" : texto(mensagem.texto) || "—"
    );
  }

  const linhas = ordenarFilaMaster(
    conversas.map((conversa) => ({
      ...conversa,
      empresa_nome: empresaPorId.get(conversa.empresa_id) ?? "Empresa",
      usuario_nome: usuarioPorId.get(conversa.aberto_por_usuario_id) ?? "Usuário",
      ultima_mensagem: ultimaPorConversa.get(conversa.id) ?? "—",
    }))
  ).filter((linha) => {
    if (!busca) {
      return true;
    }
    const alvo = `${linha.empresa_nome} ${linha.usuario_nome}`.toLowerCase();
    return alvo.includes(busca.toLowerCase());
  });

  return { ok: true as const, linhas };
}

export async function carregarAtendimentoMaster(conversaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data: conversa, error } = await admin
    .from("suporte_conversas")
    .select(
      "id, empresa_id, aberto_por_usuario_id, atendente_master_usuario_id, status, assunto, ultima_mensagem_em, created_at"
    )
    .eq("id", conversaId)
    .maybeSingle();

  if (error || !conversa) {
    return { ok: false as const, erro: error?.message || "Atendimento não encontrado." };
  }

  const [{ data: empresa }, { data: usuario }, { data: atendente }, { data: mensagens }] =
    await Promise.all([
      admin
        .from("empresas")
        .select("id, nome_fantasia, razao_social")
        .eq("id", conversa.empresa_id)
        .maybeSingle(),
      admin
        .from("usuarios")
        .select("id, nome, email")
        .eq("id", conversa.aberto_por_usuario_id)
        .maybeSingle(),
      conversa.atendente_master_usuario_id
        ? admin
            .from("usuarios")
            .select("id, nome, email")
            .eq("id", conversa.atendente_master_usuario_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("suporte_mensagens")
        .select(
          "id, conversa_id, empresa_id, remetente_usuario_id, remetente_tipo, tipo, texto, arquivo_path, created_at"
        )
        .eq("conversa_id", conversaId)
        .eq("empresa_id", conversa.empresa_id)
        .order("created_at", { ascending: false })
        .limit(MENSAGENS_POR_PAGINA),
    ]);

  return {
    ok: true as const,
    conversa: {
      ...(conversa as ConversaSuporte),
      empresa_nome:
        texto(empresa?.nome_fantasia || empresa?.razao_social) || "Empresa",
      usuario_nome: texto(usuario?.nome || usuario?.email) || "Usuário",
    },
    atendenteNome: texto(atendente?.nome || atendente?.email) || null,
    masterUsuarioId: usuarioId,
    mensagens: ((mensagens ?? []) as MensagemSuporte[]).slice().reverse(),
  };
}

async function gravarMensagemMaster(
  conversaId: string,
  payload: { tipo: "texto"; texto: string } | { tipo: "imagem"; arquivo_path: string }
) {
  const { admin, usuarioId } = await exigirMaster();
  const { data: conversa, error } = await admin
    .from("suporte_conversas")
    .select("id, empresa_id, status")
    .eq("id", conversaId)
    .maybeSingle();

  if (error || !conversa) {
    return { ok: false as const, erro: "Atendimento não encontrado." };
  }

  const { data: mensagem, error: erroMensagem } = await admin
    .from("suporte_mensagens")
    .insert({
      conversa_id: conversaId,
      empresa_id: conversa.empresa_id,
      remetente_usuario_id: usuarioId,
      remetente_tipo: "master",
      ...payload,
    })
    .select(
      "id, conversa_id, empresa_id, remetente_usuario_id, remetente_tipo, tipo, texto, arquivo_path, created_at"
    )
    .single();

  if (erroMensagem || !mensagem) {
    return { ok: false as const, erro: erroMensagem?.message || "Não foi possível enviar." };
  }

  await admin.from("suporte_conversa_leituras").upsert(
    {
      conversa_id: conversaId,
      usuario_id: usuarioId,
      ultima_leitura_em: new Date().toISOString(),
    },
    { onConflict: "conversa_id,usuario_id" }
  );

  return { ok: true as const, mensagem: mensagem as MensagemSuporte };
}

export async function masterResponderSuporte(conversaId: string, textoBruto: string) {
  const mensagem = texto(textoBruto);
  if (!mensagem) {
    return { ok: false as const, erro: "Digite uma mensagem." };
  }
  return gravarMensagemMaster(conversaId, { tipo: "texto", texto: mensagem });
}

export async function masterEnviarImagemSuporte(formData: FormData) {
  const conversaId = texto(formData.get("conversa_id"));
  const arquivo = formData.get("arquivo");
  if (!conversaId) {
    return { ok: false as const, erro: "Atendimento não encontrado." };
  }
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

  const { admin } = await exigirMaster();
  const { data: conversa } = await admin
    .from("suporte_conversas")
    .select("id, empresa_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (!conversa) {
    return { ok: false as const, erro: "Atendimento não encontrado." };
  }

  const caminho = caminhoArquivoSuporte(
    String(conversa.empresa_id),
    conversaId,
    validacao.extensao,
    randomUUID()
  );
  const { error: erroUpload } = await admin.storage
    .from(BUCKET_SUPORTE_CHAT)
    .upload(caminho, arquivo, { contentType: validacao.mime, upsert: false });
  if (erroUpload) {
    return { ok: false as const, erro: erroUpload.message };
  }
  return gravarMensagemMaster(conversaId, { tipo: "imagem", arquivo_path: caminho });
}

export async function masterAssumirSuporte(conversaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data, error } = await admin
    .from("suporte_conversas")
    .update({
      atendente_master_usuario_id: usuarioId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversaId)
    .select("id, empresa_id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false as const, erro: error?.message || "Não foi possível assumir." };
  }
  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: "suporte_assumido",
    empresaId: data.empresa_id,
    metadados: { conversa_id: conversaId },
  });
  return { ok: true as const };
}

export async function masterEncerrarSuporte(conversaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data, error } = await admin
    .from("suporte_conversas")
    .update({
      status: "encerrada" satisfies StatusConversaSuporte,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversaId)
    .select("id, empresa_id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false as const, erro: error?.message || "Não foi possível encerrar." };
  }
  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: "suporte_encerrado",
    empresaId: data.empresa_id,
    metadados: { conversa_id: conversaId },
  });
  return { ok: true as const };
}

export async function masterReabrirSuporte(conversaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data, error } = await admin
    .from("suporte_conversas")
    .update({
      status: "aguardando_suporte" satisfies StatusConversaSuporte,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversaId)
    .select("id, empresa_id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false as const, erro: error?.message || "Não foi possível reabrir." };
  }
  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: "suporte_reaberto",
    empresaId: data.empresa_id,
    metadados: { conversa_id: conversaId },
  });
  return { ok: true as const };
}

export async function masterUrlAssinadaImagem(arquivoPath: string, conversaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data: conversa } = await admin
    .from("suporte_conversas")
    .select("id, empresa_id, aberto_por_usuario_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (!conversa) {
    return { ok: false as const, erro: "Atendimento não encontrado." };
  }
  if (
    !usuarioPodeAcessarArquivo({
      arquivoPath,
      empresaId: String(conversa.empresa_id),
      conversaId,
      conversaEmpresaId: String(conversa.empresa_id),
      abertoPorUsuarioId: String(conversa.aberto_por_usuario_id),
      usuarioId,
      ehMaster: true,
    })
  ) {
    return { ok: false as const, erro: "Arquivo não disponível." };
  }
  const { data, error } = await admin.storage
    .from(BUCKET_SUPORTE_CHAT)
    .createSignedUrl(arquivoPath, 60);
  if (error || !data?.signedUrl) {
    return { ok: false as const, erro: error?.message || "Não foi possível abrir a imagem." };
  }
  return { ok: true as const, url: data.signedUrl };
}
