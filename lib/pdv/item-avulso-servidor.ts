import "server-only";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { createClient } from "@/lib/supabase/server";

import { permitirItemAvulsoDoRegistro } from "./item-avulso";

export type ConfiguracaoItemAvulsoPdv = {
  permitirItemAvulso: boolean;
  produtoFiscalPadraoId: string | null;
};

export function configuracaoItemAvulsoDoRegistro(registro: {
  empresa_id?: string | null;
  permitir_item_avulso?: unknown;
  produto_fiscal_padrao_item_avulso_id?: string | null;
} | null): ConfiguracaoItemAvulsoPdv {
  return {
    permitirItemAvulso: permitirItemAvulsoDoRegistro(
      registro?.permitir_item_avulso
    ),
    produtoFiscalPadraoId: registro?.produto_fiscal_padrao_item_avulso_id
      ? String(registro.produto_fiscal_padrao_item_avulso_id)
      : null,
  };
}

export async function gravarItemAvulsoSessao(input: {
  permitirItemAvulso: boolean;
  produtoFiscalPadraoId: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_definir_pdv_item_avulso", {
    p_permitir: input.permitirItemAvulso === true,
    p_produto_fiscal_padrao_id: input.produtoFiscalPadraoId,
  });

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  const registro = data as {
    ok?: boolean;
    permitir_item_avulso?: boolean;
    produto_fiscal_padrao_item_avulso_id?: string | null;
    empresa_id?: string | null;
  } | null;

  if (!registro || registro.ok !== true) {
    return { ok: false as const, erro: "Não foi possível salvar a configuração." };
  }

  return {
    ok: true as const,
    permitirItemAvulso: registro.permitir_item_avulso !== false,
    produtoFiscalPadraoId: registro.produto_fiscal_padrao_item_avulso_id
      ? String(registro.produto_fiscal_padrao_item_avulso_id)
      : null,
    empresaId: registro.empresa_id ? String(registro.empresa_id) : null,
  };
}

export function assertConfigItemAvulsoDaEmpresa(
  registro: { empresa_id?: string | null } | null,
  empresaId: string
) {
  return registroPertenceAEmpresaAtiva(registro, empresaId);
}
