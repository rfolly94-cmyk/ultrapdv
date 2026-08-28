import assert from "node:assert/strict";
import { test } from "node:test";

import { caminhoArquivoSuporte, validarImagemSuporte } from "./imagem";
import {
  pixelsDaPosicaoAssistente,
  posicaoAssistenteDePixels,
  sanitizarPosicaoAssistente,
} from "./posicao";
import {
  conversaAtivaDoUsuario,
  conversaNaoLida,
  mesclarMensagemSuporte,
  ordenarFilaMaster,
  statusAposMensagem,
  usuarioPodeAcessarArquivo,
  usuarioPodeVerConversa,
} from "./regras";
import { fonte } from "../multiempresa/fonte";
import { empresaA, empresaB, usuarioA, usuarioB } from "../multiempresa/cenario";

test("1. usuário cria conversa na própria empresa e empresa_id não vem do frontend", () => {
  const actions = fonte("app/suporte/actions.ts");
  assert.match(actions, /obterContextoSuporteUsuario/);
  assert.match(actions, /empresa_id: empresaId/);
  assert.doesNotMatch(actions, /formData\.get\("empresa_id"\)/);
  assert.doesNotMatch(actions, /exigirEmpresaOperacional/);
});

test("2. usuário A não vê conversa do usuário B nem da empresa B", () => {
  const conversaA = {
    empresa_id: empresaA,
    aberto_por_usuario_id: usuarioA,
  };
  assert.equal(
    usuarioPodeVerConversa({ conversa: conversaA, usuarioId: usuarioA, empresaId: empresaA }),
    true
  );
  assert.equal(
    usuarioPodeVerConversa({ conversa: conversaA, usuarioId: usuarioB, empresaId: empresaA }),
    false
  );
  assert.equal(
    usuarioPodeVerConversa({ conversa: conversaA, usuarioId: usuarioA, empresaId: empresaB }),
    false
  );
});

test("3. Master vê empresas diferentes e usuário comum não chama action Master", () => {
  assert.match(fonte("app/master/suporte/actions.ts"), /exigirMaster/);
  assert.match(fonte("app/master/suporte/page.tsx"), /listarFilaSuporteMaster/);
  assert.doesNotMatch(fonte("app/suporte/actions.ts"), /exigirMaster/);
  const sql = fonte("supabase/migrations/20260820050000_suporte_chat_plataforma.sql");
  assert.match(sql, /administradores_plataforma/);
  assert.match(sql, /suporte_conversas_select_master/);
});

test("4. status vira aguardando_suporte no cliente e aguardando_cliente no Master", () => {
  assert.equal(statusAposMensagem("encerrada", "cliente"), "aguardando_suporte");
  assert.equal(statusAposMensagem("aguardando_cliente", "cliente"), "aguardando_suporte");
  assert.equal(statusAposMensagem("aguardando_suporte", "master"), "aguardando_cliente");
  assert.equal(statusAposMensagem("encerrada", "master"), "encerrada");
});

test("5. Master encerra sem apagar mensagens; conversa encerrada reabre se o cliente fala", () => {
  const acoes = fonte("app/master/suporte/actions.ts");
  assert.match(acoes, /status: "encerrada"/);
  assert.doesNotMatch(acoes, /from\("suporte_mensagens"\)[\s\S]*\.delete\(/);
  assert.equal(statusAposMensagem("encerrada", "cliente"), "aguardando_suporte");
  const sql = fonte("supabase/migrations/20260820050000_suporte_chat_plataforma.sql");
  assert.match(sql, /WHEN NEW\.remetente_tipo = 'cliente' THEN 'aguardando_suporte'/);
});

test("6. não lidas funcionam por usuário", () => {
  assert.equal(
    conversaNaoLida({
      ultimaMensagemEm: "2026-08-20T12:00:00.000Z",
      ultimaLeituraEm: "2026-08-20T11:00:00.000Z",
      ultimaRemetenteTipo: "master",
      visao: "cliente",
    }),
    true
  );
  assert.equal(
    conversaNaoLida({
      ultimaMensagemEm: "2026-08-20T12:00:00.000Z",
      ultimaLeituraEm: "2026-08-20T12:01:00.000Z",
      ultimaRemetenteTipo: "master",
      visao: "cliente",
    }),
    false
  );
  assert.equal(
    conversaNaoLida({
      ultimaMensagemEm: "2026-08-20T12:00:00.000Z",
      ultimaLeituraEm: null,
      ultimaRemetenteTipo: "cliente",
      visao: "cliente",
    }),
    false
  );
});

test("7. Realtime não duplica mensagens já conhecidas", () => {
  const atuais = [
    { id: "m1", created_at: "2026-08-20T10:00:00.000Z" },
    { id: "m2", created_at: "2026-08-20T11:00:00.000Z" },
  ];
  const mescladas = mesclarMensagemSuporte(atuais, {
    id: "m1",
    created_at: "2026-08-20T10:00:00.000Z",
  });
  assert.equal(mescladas.length, 2);
  const comNova = mesclarMensagemSuporte(atuais, {
    id: "m3",
    created_at: "2026-08-20T09:00:00.000Z",
  });
  assert.equal(comNova[0].id, "m3");
  assert.equal(comNova.length, 3);
});

test("8. imagem válida envia; inválida e acima de 5 MB são bloqueadas", () => {
  assert.equal(
    validarImagemSuporte({ type: "image/png", size: 1024, name: "foto.png" }).ok,
    true
  );
  assert.equal(
    validarImagemSuporte({ type: "application/pdf", size: 1024, name: "arquivo.pdf" }).ok,
    false
  );
  assert.equal(
    validarImagemSuporte({ type: "image/jpeg", size: 6 * 1024 * 1024, name: "foto.jpg" }).ok,
    false
  );
  const caminho = caminhoArquivoSuporte(empresaA, "conv-1", "png", "abc");
  assert.equal(caminho, `${empresaA}/conv-1/abc.png`);
  assert.doesNotMatch(caminho, /foto\.png/);
});

test("9. URL assinada não é liberada para outra empresa", () => {
  assert.equal(
    usuarioPodeAcessarArquivo({
      arquivoPath: `${empresaA}/conv-1/abc.jpg`,
      empresaId: empresaA,
      conversaId: "conv-1",
      conversaEmpresaId: empresaA,
      abertoPorUsuarioId: usuarioA,
      usuarioId: usuarioA,
      ehMaster: false,
    }),
    true
  );
  assert.equal(
    usuarioPodeAcessarArquivo({
      arquivoPath: `${empresaA}/conv-1/abc.jpg`,
      empresaId: empresaB,
      conversaId: "conv-1",
      conversaEmpresaId: empresaA,
      abertoPorUsuarioId: usuarioA,
      usuarioId: usuarioA,
      ehMaster: false,
    }),
    false
  );
});

test("10. suporte funciona com empresa suspensa e não está no bloqueio operacional", () => {
  const restrito = fonte("lib/assinatura/rotas-restritas.ts");
  assert.doesNotMatch(restrito, /\/suporte/);
  assert.match(fonte("app/suporte/actions.ts"), /obterContextoSuporteUsuario/);
  assert.doesNotMatch(fonte("app/suporte/actions.ts"), /exigirEmpresaOperacional/);
  assert.match(fonte("components/app-shell.tsx"), /AssistenteFlutuante/);
});

test("11. posição do botão persiste por usuario_id + empresa_id e não vaza entre empresas", () => {
  const sql = fonte("supabase/migrations/20260820050000_suporte_chat_plataforma.sql");
  assert.match(sql, /usuarios_preferencias_interface/);
  assert.match(sql, /UNIQUE \(usuario_id, empresa_id\)/);
  const a = sanitizarPosicaoAssistente({ lado: "left", offsetY: 20 });
  const b = sanitizarPosicaoAssistente({ lado: "right", offsetY: 80 });
  assert.notEqual(a.lado, b.lado);
  assert.notEqual(a.offsetY, b.offsetY);
  const viewport = { width: 1200, height: 800 };
  const pixels = pixelsDaPosicaoAssistente(a, viewport);
  const volta = posicaoAssistenteDePixels(pixels.x, pixels.y, viewport);
  assert.equal(volta.lado, "left");
});

test("12. Master não depende da empresa ativa; menu da IA não chama API", () => {
  assert.match(fonte("app/master/suporte/actions.ts"), /exigirMaster/);
  assert.doesNotMatch(fonte("app/master/suporte/actions.ts"), /buscarVinculoEmpresaAtiva/);
  const ia = fonte("components/suporte/central-ajuda-menu.tsx");
  assert.match(ia, /Assistente UltraPDV/);
  assert.doesNotMatch(ia, /openai|gemini|anthropic|fetch\(/i);
  assert.match(fonte("components/suporte/assistente-flutuante.tsx"), /aria-label="Abrir Central de Ajuda"/);
});

test("13. fila Master prioriza aguardando suporte; conversa ativa é a do próprio usuário", () => {
  const fila = ordenarFilaMaster([
    { status: "aguardando_cliente", ultima_mensagem_em: "2026-08-20T12:00:00.000Z" },
    { status: "aguardando_suporte", ultima_mensagem_em: "2026-08-20T10:00:00.000Z" },
    { status: "aguardando_suporte", ultima_mensagem_em: "2026-08-20T11:00:00.000Z" },
  ]);
  assert.equal(fila[0].status, "aguardando_suporte");
  assert.equal(fila[0].ultima_mensagem_em, "2026-08-20T11:00:00.000Z");
  const ativa = conversaAtivaDoUsuario(
    [
      {
        aberto_por_usuario_id: usuarioA,
        status: "encerrada",
        ultima_mensagem_em: "2026-08-20T12:00:00.000Z",
      },
      {
        aberto_por_usuario_id: usuarioA,
        status: "aguardando_cliente",
        ultima_mensagem_em: "2026-08-20T10:00:00.000Z",
      },
      {
        aberto_por_usuario_id: usuarioB,
        status: "aguardando_suporte",
        ultima_mensagem_em: "2026-08-20T13:00:00.000Z",
      },
    ],
    usuarioA
  );
  assert.equal(ativa?.status, "aguardando_cliente");
});

test("14. migration cria índices, RLS e bucket privado", () => {
  const sql = fonte("supabase/migrations/20260820050000_suporte_chat_plataforma.sql");
  assert.match(sql, /suporte_conversas_empresa_idx/);
  assert.match(sql, /suporte_mensagens_conversa_created_idx/);
  assert.match(sql, /suporte_conversa_leituras/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /'suporte-chat'/);
  assert.match(sql, /public = false/);
  assert.doesNotMatch(sql, /USING \(true\)/);
});
