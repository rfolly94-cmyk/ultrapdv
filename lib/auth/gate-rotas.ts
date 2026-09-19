import { rotaAdminPlataforma } from "@/lib/plataforma/autorizacao";

import {
  CODIGO_ACESSO_DESATIVADO,
  CODIGO_EMPRESA_NAO_OPERACIONAL,
  CODIGO_NAO_AUTENTICADO,
  CODIGO_SEM_EMPRESA,
  CODIGO_SEM_PERMISSAO,
  MENSAGEM_ACESSO_DESATIVADO,
  MENSAGEM_EMPRESA_NAO_OPERACIONAL,
  MENSAGEM_SEM_EMPRESA,
} from "./mensagens-acesso";
import {
  acessoOperacionalDesativado,
  podeUsarOnboarding,
  type EstadoAcessoSessao,
} from "./estado-acesso";

function rotaMaster(pathname: string) {
  return pathname === "/master" || pathname.startsWith("/master/");
}

const ROTAS_PUBLICAS_EXATAS = new Set([
  "/",
  "/login",
  "/logout",
  "/cadastro",
  "/recuperar-senha",
  "/nova-senha",
  "/confirmar-email",
]);

const PREFIXOS_PUBLICOS = [
  "/auth",
  "/catalogo",
  "/api/webhooks",
  "/api/cron",
];

function comPrefixo(pathname: string, prefixo: string) {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`);
}

export function ehRotaApi(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function ehRotaPublicaIntencional(pathname: string) {
  if (ROTAS_PUBLICAS_EXATAS.has(pathname)) {
    return true;
  }

  return PREFIXOS_PUBLICOS.some((prefixo) => comPrefixo(pathname, prefixo));
}

export function ehRotaPlataforma(pathname: string) {
  return rotaAdminPlataforma(pathname) || rotaMaster(pathname);
}

export function ehRotaOnboarding(pathname: string) {
  return comPrefixo(pathname, "/onboarding") || comPrefixo(pathname, "/api/onboarding");
}

export function ehRotaCadastroApiOnboarding(pathname: string) {
  return comPrefixo(pathname, "/api/cadastro");
}

export function ehRotaAcessoDesativado(pathname: string) {
  return comPrefixo(pathname, "/acesso-desativado");
}

export type DecisaoGate =
  | { tipo: "seguir" }
  | { tipo: "redirect"; destino: string }
  | {
      tipo: "json";
      status: number;
      codigo: string;
      erro: string;
    };

function jsonNaoAutenticado(): DecisaoGate {
  return {
    tipo: "json",
    status: 401,
    codigo: CODIGO_NAO_AUTENTICADO,
    erro: "Não autenticado.",
  };
}

function jsonDesativado(): DecisaoGate {
  return {
    tipo: "json",
    status: 403,
    codigo: CODIGO_ACESSO_DESATIVADO,
    erro: MENSAGEM_ACESSO_DESATIVADO,
  };
}

function jsonSemEmpresa(): DecisaoGate {
  return {
    tipo: "json",
    status: 403,
    codigo: CODIGO_SEM_EMPRESA,
    erro: MENSAGEM_SEM_EMPRESA,
  };
}

function jsonEmpresaNaoOperacional(): DecisaoGate {
  return {
    tipo: "json",
    status: 403,
    codigo: CODIGO_EMPRESA_NAO_OPERACIONAL,
    erro: MENSAGEM_EMPRESA_NAO_OPERACIONAL,
  };
}

export function jsonSemPermissao(): DecisaoGate {
  return {
    tipo: "json",
    status: 403,
    codigo: CODIGO_SEM_PERMISSAO,
    erro: "Você não tem permissão para esta ação.",
  };
}

export function decidirGateSessao(input: {
  pathname: string;
  autenticado: boolean;
  estado: EstadoAcessoSessao;
  empresaOperacional?: boolean | null;
  rotaOperacional?: boolean;
}): DecisaoGate {
  const pathname = input.pathname;
  const api = ehRotaApi(pathname);

  if (ehRotaPublicaIntencional(pathname) || ehRotaPlataforma(pathname)) {
    return { tipo: "seguir" };
  }

  if (ehRotaAcessoDesativado(pathname)) {
    if (!input.autenticado) {
      return api ? jsonNaoAutenticado() : { tipo: "redirect", destino: "/login" };
    }
    return { tipo: "seguir" };
  }

  if (!input.autenticado) {
    return api ? jsonNaoAutenticado() : { tipo: "redirect", destino: "/login" };
  }

  if (acessoOperacionalDesativado(input.estado)) {
    if (api) {
      return jsonDesativado();
    }
    return { tipo: "redirect", destino: "/acesso-desativado" };
  }

  if (!input.estado.temVinculoOperacional) {
    if (ehRotaOnboarding(pathname) || ehRotaCadastroApiOnboarding(pathname)) {
      return { tipo: "seguir" };
    }
    if (api) {
      return jsonSemEmpresa();
    }
    return { tipo: "redirect", destino: "/onboarding" };
  }

  if (ehRotaOnboarding(pathname)) {
    if (api) {
      return {
        tipo: "json",
        status: 409,
        codigo: "EMPRESA_JA_VINCULADA",
        erro: "Este login já possui uma empresa principal ativa.",
      };
    }
    return { tipo: "redirect", destino: "/painel" };
  }

  if (input.empresaOperacional === false && input.rotaOperacional) {
    return api
      ? jsonEmpresaNaoOperacional()
      : { tipo: "redirect", destino: "/assinatura" };
  }

  return { tipo: "seguir" };
}

export function destinoPosLogin(estado: EstadoAcessoSessao) {
  if (acessoOperacionalDesativado(estado)) {
    return "/acesso-desativado";
  }
  if (podeUsarOnboarding(estado) || !estado.temVinculoOperacional) {
    return "/onboarding";
  }
  if (String(estado.perfil ?? "").toLowerCase() === "contador") {
    return "/contabilidade";
  }
  return "/painel";
}
