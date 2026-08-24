import {
  CATALOGO_RECURSOS,
} from "@/lib/plataforma/recursos/catalogo";
import { empresaPossuiRecurso } from "@/lib/plataforma/recursos/resolver";
import type {
  AssinaturaParaEntitlement,
  RecursoDoPlano,
} from "@/lib/plataforma/recursos/resolver";
import {
  acaoExisteNoModulo,
  temPermissao,
} from "@/lib/permissoes/tem-permissao";
import type {
  AcaoDoModulo,
  ModuloPermissao,
  PermissoesEfetivas,
} from "@/lib/permissoes/tipos";

import {
  modoEntitlementDoRecurso,
  type ModoEntitlement,
} from "./rollout";

export type { ModoEntitlement } from "./rollout";

/**
 * Padrão global permanece off. O rollout seletivo em
 * RECURSOS_COM_ENFORCEMENT liga enforce por recurso
 * (hoje: importador, impressao_automatica, relatorios, contabilidade, pix_integrado, carteira, produtos, clientes, estoque, nfce, nfe, cce, inutilizacao_fiscal, vendas, pdv, catalogo, caixa).
 * Não usar este módulo em helpers Geranet nem nas RPCs internas.
 */
export const MODO_ENTITLEMENT = "off" as const;

export const MOTIVOS_NEGACAO = [
  "SEM_EMPRESA",
  "EMPRESA_DIVERGENTE",
  "ASSINATURA_SUSPENSA",
  "RECURSO_NAO_CONTRATADO",
  "PERMISSAO_USUARIO_NEGADA",
  "LIMITE_PLANO_ATINGIDO",
] as const;

export type MotivoNegacao = (typeof MOTIVOS_NEGACAO)[number];

export const MENSAGEM_MOTIVO_NEGACAO: Record<MotivoNegacao, string> = {
  SEM_EMPRESA: "Empresa não identificada.",
  EMPRESA_DIVERGENTE: "A assinatura não pertence a esta empresa.",
  ASSINATURA_SUSPENSA: "A assinatura desta empresa está suspensa.",
  RECURSO_NAO_CONTRATADO: "Este recurso não está disponível no plano da empresa.",
  PERMISSAO_USUARIO_NEGADA: "Você não possui permissão para executar esta ação.",
  LIMITE_PLANO_ATINGIDO: "O limite do plano foi atingido.",
};

/**
 * Recurso do plano → módulo de permissão de usuário já existente.
 * Fiscal, carteira, PIX e impressão não têm 1:1 no plano vs matriz.
 */
export const RECURSO_PARA_MODULO = {
  pdv: "pdv",
  vendas: "vendas",
  produtos: "produtos",
  clientes: "clientes",
  estoque: "estoque",
  carteira: "clientes",
  relatorios: "relatorios",
  nfce: "fiscal",
  nfe: "fiscal",
  cce: "fiscal",
  inutilizacao_fiscal: "fiscal",
  contabilidade: "contabilidade",
  importador: "importacao_dados",
  pix_integrado: "financeiro",
  impressao_automatica: "configuracoes",
  catalogo: "catalogo",
  caixa: "caixa",
  suporte_prioritario: null,
} as const satisfies Record<string, ModuloPermissao | null>;

export type RecursoComModulo = keyof typeof RECURSO_PARA_MODULO;

export function recursoDoCatalogoExiste(chave: string) {
  return CATALOGO_RECURSOS.some((item) => item.chave === chave);
}

export type AvaliacaoCamadas = {
  permitido: boolean;
  motivo: MotivoNegacao | null;
  planoPermitiu: boolean;
  usuarioPermitiu: boolean;
  modoEntitlement: ModoEntitlement;
};

export function decidirRecursoDoPlano(input: {
  empresaId: string;
  recurso: string;
  assinatura: AssinaturaParaEntitlement | null;
  recursosDoPlano?: RecursoDoPlano[] | null;
  modoEntitlement?: ModoEntitlement;
}): {
  permitido: boolean;
  motivo: MotivoNegacao | null;
  planoPermitiu: boolean;
  modoEntitlement: ModoEntitlement;
} {
  const modo = input.modoEntitlement ?? modoEntitlementDoRecurso(input.recurso);
  const empresaId = String(input.empresaId ?? "").trim();

  if (!empresaId) {
    return {
      permitido: false,
      motivo: "SEM_EMPRESA",
      planoPermitiu: false,
      modoEntitlement: modo,
    };
  }

  const planoPermitiu = empresaPossuiRecurso({
    empresaId,
    chave: input.recurso,
    assinatura: input.assinatura,
    recursosDoPlano: input.recursosDoPlano,
  });

  if (modo === "enforce" && !planoPermitiu) {
    return {
      permitido: false,
      motivo: "RECURSO_NAO_CONTRATADO",
      planoPermitiu,
      modoEntitlement: modo,
    };
  }

  return {
    permitido: true,
    motivo: null,
    planoPermitiu,
    modoEntitlement: modo,
  };
}

export function avaliarCamadasAcesso(input: {
  empresaId: string;
  usuarioId: string;
  recurso: string;
  modulo: ModuloPermissao;
  acao: string;
  assinatura: AssinaturaParaEntitlement | null;
  recursosDoPlano?: RecursoDoPlano[] | null;
  permissoes: PermissoesEfetivas | null;
  modoEntitlement?: ModoEntitlement;
}): AvaliacaoCamadas {
  const modo = input.modoEntitlement ?? modoEntitlementDoRecurso(input.recurso);
  const empresaId = String(input.empresaId ?? "").trim();
  const usuarioId = String(input.usuarioId ?? "").trim();

  if (!empresaId || !usuarioId) {
    return resultado(false, "SEM_EMPRESA", false, false, modo);
  }

  const plano = decidirRecursoDoPlano({
    empresaId,
    recurso: input.recurso,
    assinatura: input.assinatura,
    recursosDoPlano: input.recursosDoPlano,
    modoEntitlement: modo,
  });
  const planoPermitiu = plano.planoPermitiu;

  const acaoValida = acaoExisteNoModulo(input.modulo, input.acao);
  const usuarioPermitiu =
    acaoValida &&
    temPermissao(
      input.permissoes,
      input.modulo,
      input.acao as AcaoDoModulo<typeof input.modulo>
    );

  if (modo === "enforce" && !planoPermitiu) {
    return resultado(false, "RECURSO_NAO_CONTRATADO", planoPermitiu, usuarioPermitiu, modo);
  }

  if (!usuarioPermitiu) {
    return resultado(false, "PERMISSAO_USUARIO_NEGADA", planoPermitiu, usuarioPermitiu, modo);
  }

  return resultado(true, null, planoPermitiu, usuarioPermitiu, modo);
}

function resultado(
  permitido: boolean,
  motivo: MotivoNegacao | null,
  planoPermitiu: boolean,
  usuarioPermitiu: boolean,
  modoEntitlement: ModoEntitlement
): AvaliacaoCamadas {
  return {
    permitido,
    motivo,
    planoPermitiu,
    usuarioPermitiu,
    modoEntitlement,
  };
}
