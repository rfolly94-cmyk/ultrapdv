import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  empresaPodeOperar,
  erroSchemaAssinaturaAusente,
  statusAssinaturaValido,
} from "./empresa-pode-operar";
import type { AssinaturaEmpresa } from "./tipos";

function linhaParaAssinatura(
  linha: Record<string, unknown> | null,
  empresaId: string
): AssinaturaEmpresa | null {
  if (!linha) {
    return null;
  }

  const plano = Array.isArray(linha.planos) ? linha.planos[0] : linha.planos;
  const planoObj = plano && typeof plano === "object" ? (plano as Record<string, unknown>) : null;

  return {
    id: String(linha.id ?? ""),
    empresa_id: String(linha.empresa_id ?? empresaId),
    plano_id: linha.plano_id ? String(linha.plano_id) : null,
    status: statusAssinaturaValido(linha.status) ? linha.status : "ativa",
    inicio_em: linha.inicio_em ? String(linha.inicio_em) : null,
    vencimento_em: linha.vencimento_em ? String(linha.vencimento_em) : null,
    carencia_ate: linha.carencia_ate ? String(linha.carencia_ate) : null,
    liberado_ate: linha.liberado_ate ? String(linha.liberado_ate) : null,
    suspenso_em: linha.suspenso_em ? String(linha.suspenso_em) : null,
    cancelado_em: linha.cancelado_em ? String(linha.cancelado_em) : null,
    observacao: linha.observacao ? String(linha.observacao) : null,
    plano_nome: planoObj?.nome ? String(planoObj.nome) : null,
    plano_valor_mensal:
      planoObj?.valor_mensal == null ? null : Number(planoObj.valor_mensal),
  };
}

export async function resolverAssinaturaEmpresa(empresaId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assinaturas_empresas")
    .select(
      "id, empresa_id, plano_id, status, inicio_em, vencimento_em, carencia_ate, liberado_ate, suspenso_em, cancelado_em, observacao, planos ( nome, valor_mensal )"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    if (erroSchemaAssinaturaAusente(error.message)) {
      return {
        assinatura: null as AssinaturaEmpresa | null,
        operacional: true,
        empresaId,
      };
    }
    throw new Error(error.message);
  }

  const assinatura = linhaParaAssinatura(
    (data ?? null) as Record<string, unknown> | null,
    empresaId
  );

  return {
    assinatura,
    operacional: empresaPodeOperar(assinatura),
    empresaId,
  };
}

export async function resolverAssinaturaEmpresaAtiva() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return null;
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(usuarioId))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo?.empresa_id) {
    return null;
  }

  return resolverAssinaturaEmpresa(String(vinculo.empresa_id));
}
