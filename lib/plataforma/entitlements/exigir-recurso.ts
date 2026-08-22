import "server-only";

import { cache } from "react";

import { decidirRecursoDoPlano } from "@/lib/plataforma/entitlements/camadas";
import {
  ErroEntitlement,
  logAcessoNegadoEntitlement,
} from "@/lib/plataforma/entitlements/erro";
import { RECURSOS_COM_ENFORCEMENT } from "@/lib/plataforma/entitlements/rollout";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import type { AcaoDoModulo, ModuloPermissao } from "@/lib/permissoes/tipos";

export async function exigirRecursoEmpresa(input: {
  empresaId: string;
  recurso: string;
  origem?: string;
}) {
  const empresaId = String(input.empresaId ?? "").trim();
  const recurso = String(input.recurso ?? "").trim();

  if (!empresaId) {
    throw new ErroEntitlement({
      codigo: "SEM_EMPRESA",
      recurso,
      empresaId: "",
      status: 401,
      mensagem: "Empresa não identificada.",
    });
  }

  const dados = await carregarEntitlementsEmpresa(empresaId);
  const decisao = decidirRecursoDoPlano({
    empresaId,
    recurso,
    assinatura: dados.assinatura,
    recursosDoPlano: dados.recursos,
  });

  if (!decisao.permitido) {
    logAcessoNegadoEntitlement({
      empresaId,
      recurso,
      origem: input.origem,
    });
    throw new ErroEntitlement({
      codigo:
        decisao.motivo === "SEM_EMPRESA"
          ? "SEM_EMPRESA"
          : "RECURSO_NAO_CONTRATADO",
      recurso,
      empresaId,
      status: decisao.motivo === "SEM_EMPRESA" ? 401 : 403,
    });
  }

  return dados;
}

export async function planoPermiteRecursoEmpresa(
  empresaId: string,
  recurso: string
) {
  const id = String(empresaId ?? "").trim();
  const dados = await carregarEntitlementsEmpresa(id);
  return decidirRecursoDoPlano({
    empresaId: id,
    recurso,
    assinatura: dados.assinatura,
    recursosDoPlano: dados.recursos,
  });
}

export const mapaRecursosLiberadosEmpresa = cache(async (empresaId: string) => {
  const id = String(empresaId ?? "").trim();
  const saida: Record<string, boolean> = {};
  if (!id) {
    return saida;
  }
  const dados = await carregarEntitlementsEmpresa(id);
  for (const chave of RECURSOS_COM_ENFORCEMENT) {
    saida[chave] = decidirRecursoDoPlano({
      empresaId: id,
      recurso: chave,
      assinatura: dados.assinatura,
      recursosDoPlano: dados.recursos,
    }).permitido;
  }
  return saida;
});

export async function exigirAcessoOperacao<M extends ModuloPermissao>(input: {
  empresaId: string;
  recurso: string;
  modulo: M;
  acao: AcaoDoModulo<M>;
  origem?: string;
}) {
  await exigirRecursoEmpresa({
    empresaId: input.empresaId,
    recurso: input.recurso,
    origem: input.origem,
  });

  const sessao = await exigirPermissao({
    modulo: input.modulo,
    acao: input.acao,
  });

  if (sessao.empresaId !== String(input.empresaId).trim()) {
    throw new ErroPermissao("Empresa da sessão não confere.", 403);
  }

  return sessao;
}

export function resultadoErroEntitlement(error: unknown): {
  ok: false;
  erro: string;
  codigo: "RECURSO_NAO_CONTRATADO";
} | null {
  if (!(error instanceof ErroEntitlement)) {
    return null;
  }
  return {
    ok: false,
    erro: error.message,
    codigo: "RECURSO_NAO_CONTRATADO",
  };
}
