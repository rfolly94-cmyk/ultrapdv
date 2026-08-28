import { hrefSeguroAssistente } from "./rotas";
import type { AcaoAssistente, TipoAcaoFrontendAssistente } from "./tipos";

const TIPOS_PERMITIDOS = new Set<TipoAcaoFrontendAssistente>([
  "navigate",
  "show_results",
  "select_entity",
  "open_details",
]);

export function acaoFrontendPermitida(
  acao: AcaoAssistente
): AcaoAssistente | null {
  if (
    acao.confirmarAcao ||
    acao.cancelarAcao ||
    acao.aplicarFiscal ||
    acao.desfazerAcao
  ) {
    return null;
  }
  const tipo = acao.type ?? (acao.href ? "navigate" : null);
  if (!tipo || !TIPOS_PERMITIDOS.has(tipo)) {
    return null;
  }
  if (tipo === "show_results") {
    return {
      type: "show_results",
      label: String(acao.label ?? "Resultados").slice(0, 80),
    };
  }
  const href = hrefSeguroAssistente(acao.href);
  if (!href) {
    return null;
  }
  return {
    type: tipo,
    label: String(acao.label ?? "Abrir").slice(0, 80),
    href,
    entityId: acao.entityId,
    entityTipo: acao.entityTipo,
  };
}

export function sanitizarAcoesFrontendAssistente(
  acoes: AcaoAssistente[] | null | undefined
): AcaoAssistente[] {
  const saida: AcaoAssistente[] = [];
  const vistos = new Set<string>();
  for (const acao of acoes ?? []) {
    const limpa = acaoFrontendPermitida(acao);
    if (!limpa) {
      continue;
    }
    const chave = `${limpa.type}:${limpa.href ?? ""}:${limpa.label}`;
    if (vistos.has(chave)) {
      continue;
    }
    vistos.add(chave);
    saida.push(limpa);
    if (saida.length >= 8) {
      break;
    }
  }
  return saida;
}
