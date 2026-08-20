import "server-only";

import { redirect } from "next/navigation";

import { resolverAssinaturaEmpresa } from "./resolver-assinatura-empresa";
import { MENSAGEM_ASSINATURA_RESTRITA } from "./tipos";

export class ErroAssinaturaRestrita extends Error {
  constructor(mensagem = MENSAGEM_ASSINATURA_RESTRITA) {
    super(mensagem);
    this.name = "ErroAssinaturaRestrita";
  }
}

export async function exigirEmpresaOperacional(empresaId: string) {
  const resolvida = await resolverAssinaturaEmpresa(empresaId);
  if (!resolvida.operacional) {
    throw new ErroAssinaturaRestrita();
  }
  return resolvida;
}

export async function exigirEmpresaOperacionalOuRedirecionar(empresaId: string) {
  try {
    return await exigirEmpresaOperacional(empresaId);
  } catch (error) {
    if (error instanceof ErroAssinaturaRestrita) {
      redirect("/assinatura");
    }
    throw error;
  }
}
