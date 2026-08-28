import type {
  EstadoNotificacaoUsuario,
  FiltroCentralNotificacoes,
  NotificacaoCentral,
  NotificacaoPersistida,
  OpcaoAdiarNotificacao,
} from "./tipos";

export function estadoNotificacaoVazio(): EstadoNotificacaoUsuario {
  return {
    lidaEm: null,
    dispensadaEm: null,
    adiadaAte: null,
  };
}

export function notificacaoAdiada(
  estado: EstadoNotificacaoUsuario,
  agora: Date
) {
  if (!estado.adiadaAte) {
    return false;
  }
  return new Date(estado.adiadaAte).getTime() > agora.getTime();
}

export function notificacaoContaNoSino(
  notificacao: Pick<NotificacaoPersistida, "status">,
  estado: EstadoNotificacaoUsuario,
  agora: Date
) {
  if (notificacao.status !== "ativa") {
    return false;
  }
  if (estado.dispensadaEm) {
    return false;
  }
  if (estado.lidaEm) {
    return false;
  }
  if (notificacaoAdiada(estado, agora)) {
    return false;
  }
  return true;
}

export function notificacaoVisivelNaCentral(
  notificacao: Pick<NotificacaoPersistida, "status">,
  estado: EstadoNotificacaoUsuario,
  agora: Date,
  filtro: FiltroCentralNotificacoes
) {
  if (notificacao.status !== "ativa") {
    return false;
  }
  if (estado.dispensadaEm) {
    return false;
  }
  if (filtro !== "todas" && notificacaoAdiada(estado, agora)) {
    return false;
  }
  return true;
}

export function aplicarFiltroCentral(
  item: NotificacaoCentral,
  filtro: FiltroCentralNotificacoes
) {
  if (filtro === "todas") {
    return true;
  }
  if (filtro === "importantes") {
    return item.nivel === "importante" || item.nivel === "critico";
  }
  if (filtro === "estoque") {
    return item.categoria === "estoque" || item.categoria === "validade";
  }
  if (filtro === "financeiro") {
    return item.categoria === "financeiro";
  }
  if (filtro === "fiscal") {
    return item.categoria === "fiscal";
  }
  if (filtro === "sistema") {
    return item.categoria === "caixa" || item.categoria === "sistema";
  }
  return true;
}

export function aplicarAcaoUsuario(params: {
  estado: EstadoNotificacaoUsuario;
  acao: "lida" | "nao_lida" | "dispensar" | "adiar";
  adiar?: OpcaoAdiarNotificacao;
  agora: Date;
}): EstadoNotificacaoUsuario {
  const agoraIso = params.agora.toISOString();

  if (params.acao === "lida") {
    return { ...params.estado, lidaEm: agoraIso };
  }
  if (params.acao === "nao_lida") {
    return { ...params.estado, lidaEm: null };
  }
  if (params.acao === "dispensar") {
    return { ...params.estado, dispensadaEm: agoraIso, lidaEm: agoraIso };
  }
  if (params.acao === "adiar") {
    return {
      ...params.estado,
      adiadaAte: adiadaAteIso(params.adiar ?? "1h", params.agora),
      lidaEm: params.estado.lidaEm,
    };
  }
  return params.estado;
}

export function adiadaAteIso(opcao: OpcaoAdiarNotificacao, agora: Date) {
  const data = new Date(agora.getTime());
  if (opcao === "1h") {
    data.setHours(data.getHours() + 1);
    return data.toISOString();
  }
  if (opcao === "amanha") {
    data.setDate(data.getDate() + 1);
    return data.toISOString();
  }
  data.setDate(data.getDate() + 7);
  return data.toISOString();
}

export function tempoRelativoNotificacao(
  iso: string,
  agora: Date = new Date()
) {
  const alvo = new Date(iso).getTime();
  if (!Number.isFinite(alvo)) {
    return "";
  }
  const delta = Math.max(0, agora.getTime() - alvo);
  const minutos = Math.floor(delta / 60_000);
  if (minutos < 1) {
    return "agora";
  }
  if (minutos < 60) {
    return `há ${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    return `há ${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  if (dias === 1) {
    return "ontem";
  }
  if (dias < 7) {
    return `há ${dias} dias`;
  }
  return new Date(iso).toLocaleDateString("pt-BR");
}
