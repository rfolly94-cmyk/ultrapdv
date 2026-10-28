"use server";

import { autorizarProducao, declararServidorComercial } from "@/lib/pdv/tef/autorizacao-producao-servidor";
import {
  registrarComprovacaoCredenciamento,
  salvarConfiguracaoMotor,
  salvarIdentificacaoCredenciamento,
} from "@/lib/pdv/tef/politica-empresa-servidor";

export async function salvarMotorTefEmpresa(input: {
  habilitado: boolean;
  ambiente: "homologacao" | "producao";
  origem?: string;
}) {
  const resultado = await salvarConfiguracaoMotor({
    habilitado: input.habilitado === true,
    ambiente: input.ambiente === "producao" ? "producao" : "homologacao",
    origem: typeof input.origem === "string" ? input.origem : "",
  });
  if (!resultado.ok) return resultado;
  return { ok: true as const, producaoLiberada: false as const };
}

export async function salvarIdentificacaoCredenciamentoEmpresa(input: { referencia?: string }) {
  return salvarIdentificacaoCredenciamento(String(input.referencia ?? ""));
}

export async function registrarComprovacaoCredenciamentoEmpresa(input: { referencia?: string; acao?: string }) {
  return registrarComprovacaoCredenciamento({
    referencia: String(input.referencia ?? ""),
    acao: String(input.acao ?? ""),
  });
}

export async function declararServidorComercialEmpresa(input: { servidor?: string }) {
  return declararServidorComercial(String(input.servidor ?? ""));
}

export async function autorizarProducaoTefEmpresa(input: { origem?: string }) {
  return autorizarProducao(String(input?.origem ?? ""));
}
