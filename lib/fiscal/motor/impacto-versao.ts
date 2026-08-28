import type { SupabaseClient } from "@supabase/supabase-js";

import { analisarGruposFiscaisProdutos } from "./analisar-lote";
import { dataReferenciaIso } from "./tipos";

export async function registrarImpactoNovaVersao(params: {
  admin: SupabaseClient;
  versaoId: string;
}) {
  const { data: empresas } = await params.admin
    .from("empresas")
    .select("id")
    .limit(2000);
  const dataReferencia = dataReferenciaIso(new Date());
  let afetadas = 0;

  for (const empresa of empresas ?? []) {
    const empresaId = String(empresa.id);
    const lote = await analisarGruposFiscaisProdutos({
      supabase: params.admin,
      empresaId,
      dataReferencia,
    });
    if (lote.quantidadeRevisao <= 0) {
      continue;
    }
    afetadas += 1;
    await params.admin.from("fiscal_ia_impacto_empresa").upsert(
      {
        empresa_id: empresaId,
        versao_id: params.versaoId,
        quantidade_produtos: lote.quantidadeRevisao,
        resumo: {
          ncmExtinto: lote.ncmExtinto.length,
          gruposSemIbsCbs: lote.gruposSemIbsCbs.length,
        },
        ativo: true,
      },
      { onConflict: "empresa_id,versao_id" }
    );
  }

  return { empresasAfetadas: afetadas };
}
