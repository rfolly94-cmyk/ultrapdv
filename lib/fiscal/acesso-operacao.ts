import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import {
  recursoFiscalDoModelo,
  reconciliacaoFiscalDispensaPlano,
} from "@/lib/fiscal/entitlement-regras";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export {
  recursoFiscalDoModelo,
  reconciliacaoFiscalDispensaPlano,
} from "@/lib/fiscal/entitlement-regras";

export type RecursoFiscalPlano =
  | "nfe"
  | "nfce"
  | "cce"
  | "inutilizacao_fiscal";

export async function exigirOperacaoFiscal(input: {
  empresaId: string;
  recurso: RecursoFiscalPlano;
  acao: AcaoDoModulo<"fiscal">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: input.recurso,
    modulo: "fiscal",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function exigirEmissaoNfe(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso: "nfe",
    acao: "emitir_nfe",
    origem: input.origem,
  });
}

export async function exigirEmissaoNfce(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso: "nfce",
    acao: "emitir_nfce",
    origem: input.origem,
  });
}

export async function exigirCartaCorrecaoFiscal(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso: "cce",
    acao: "carta_correcao",
    origem: input.origem,
  });
}

export async function exigirInutilizacaoFiscal(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso: "inutilizacao_fiscal",
    acao: "inutilizar",
    origem: input.origem,
  });
}

export async function exigirCancelamentoDocumentoFiscal(input: {
  empresaId: string;
  modelo: string | number | null | undefined;
  origem: string;
}) {
  const recurso = recursoFiscalDoModelo(input.modelo);
  if (!recurso) {
    throw new ErroPermissao("Modelo fiscal não suportado para cancelamento.", 403);
  }

  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso,
    acao: "cancelar_nota",
    origem: input.origem,
  });
}

export async function exigirReconciliacaoDocumentoFiscal(input: {
  empresaId: string;
  modelo: string | number | null | undefined;
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  origem: string;
}) {
  const recurso = recursoFiscalDoModelo(input.modelo);
  if (!recurso) {
    throw new ErroPermissao(
      "Modelo fiscal não suportado para reconciliação.",
      403
    );
  }

  if (reconciliacaoFiscalDispensaPlano(input)) {
    const sessao = await exigirPermissao({
      modulo: "fiscal",
      acao: "reconciliar",
    });
    if (sessao.empresaId !== String(input.empresaId).trim()) {
      throw new ErroPermissao("Empresa da sessão não confere.", 403);
    }
    return sessao;
  }

  return exigirOperacaoFiscal({
    empresaId: input.empresaId,
    recurso,
    acao: "reconciliar",
    origem: input.origem,
  });
}

export async function planoNfePermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(identidade.empresaId, "nfe");
  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}

export function capturaErroAutorizacaoFiscal(error: unknown): {
  mensagem: string;
  status: number;
} | null {
  if (error instanceof ErroEntitlement) {
    return { mensagem: error.message, status: error.status };
  }
  if (error instanceof ErroPermissao) {
    return { mensagem: error.message, status: error.status };
  }
  return null;
}
