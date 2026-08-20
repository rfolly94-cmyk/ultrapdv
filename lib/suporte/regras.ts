import { conversaEstaAtiva, type RemetenteSuporte } from "./tipos";

export function statusAposMensagem(
  statusAtual: string | null | undefined,
  remetenteTipo: RemetenteSuporte
) {
  if (remetenteTipo === "cliente") {
    return "aguardando_suporte";
  }
  if (statusAtual === "encerrada") {
    return "encerrada";
  }
  return "aguardando_cliente";
}

export function usuarioPodeVerConversa(input: {
  conversa: {
    empresa_id: string;
    aberto_por_usuario_id: string;
  };
  usuarioId: string;
  empresaId: string;
}) {
  return (
    input.conversa.aberto_por_usuario_id === input.usuarioId &&
    input.conversa.empresa_id === input.empresaId
  );
}

export function usuarioPodeAcessarArquivo(input: {
  arquivoPath: string;
  empresaId: string;
  conversaId: string;
  conversaEmpresaId: string;
  abertoPorUsuarioId: string;
  usuarioId: string;
  ehMaster: boolean;
}) {
  const [empresaPath, conversaPath] = input.arquivoPath.split("/");
  if (empresaPath !== input.empresaId || conversaPath !== input.conversaId) {
    return false;
  }
  if (input.conversaEmpresaId !== input.empresaId) {
    return false;
  }
  if (input.ehMaster) {
    return true;
  }
  return input.abertoPorUsuarioId === input.usuarioId;
}

export function conversaAtivaDoUsuario<T extends {
  aberto_por_usuario_id: string;
  status: string;
  ultima_mensagem_em: string;
}>(conversas: T[], usuarioId: string) {
  return (
    conversas
      .filter(
        (conversa) =>
          conversa.aberto_por_usuario_id === usuarioId &&
          conversaEstaAtiva(conversa.status)
      )
      .sort((a, b) =>
        String(b.ultima_mensagem_em).localeCompare(String(a.ultima_mensagem_em))
      )[0] ?? null
  );
}

export function ordenarFilaMaster<T extends {
  status: string;
  ultima_mensagem_em: string;
}>(conversas: T[]) {
  const peso = (status: string) => (status === "aguardando_suporte" ? 0 : 1);
  return [...conversas].sort((a, b) => {
    const porStatus = peso(a.status) - peso(b.status);
    if (porStatus !== 0) {
      return porStatus;
    }
    return String(b.ultima_mensagem_em).localeCompare(String(a.ultima_mensagem_em));
  });
}

export function conversaNaoLida(input: {
  ultimaMensagemEm: string | null | undefined;
  ultimaLeituraEm: string | null | undefined;
  ultimaRemetenteTipo?: string | null;
  visao: "cliente" | "master";
}) {
  if (!input.ultimaMensagemEm) {
    return false;
  }
  if (input.visao === "cliente" && input.ultimaRemetenteTipo !== "master") {
    return false;
  }
  if (input.visao === "master" && input.ultimaRemetenteTipo !== "cliente") {
    return false;
  }
  if (!input.ultimaLeituraEm) {
    return true;
  }
  return (
    new Date(input.ultimaMensagemEm).getTime() >
    new Date(input.ultimaLeituraEm).getTime()
  );
}

export function mesclarMensagemSuporte<T extends { id: string; created_at: string }>(
  atuais: T[],
  nova: T
) {
  if (atuais.some((item) => item.id === nova.id)) {
    return atuais;
  }
  return [...atuais, nova].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

export function nomeCanalConversa(conversaId: string) {
  return `suporte-conversa:${conversaId}`;
}

export function nomeCanalEmpresa(empresaId: string) {
  return `suporte-empresa:${empresaId}`;
}
