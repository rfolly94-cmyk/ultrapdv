import { createAdminClient } from "@/lib/supabase/admin";

import { ErroPixGeranet } from "./contexto";
import { garantirEmpresa } from "./montar-payload";

export {
  CAMPOS_PIX_LOCAL,
  ehModoPix,
  validarConfiguracaoPixLocal,
} from "./local-config";

export async function carregarConfiguracaoPixLocal(empresaId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integracoes_pix")
    .select(
      "id, empresa_id, modo, ativo, chave_pix, recebedor_nome, recebedor_cidade"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(
      `Não foi possível carregar o PIX Local: ${error.message}`,
      500
    );
  }

  if (!data) {
    return null;
  }

  garantirEmpresa(empresaId, String(data.empresa_id));

  return {
    id: String(data.id),
    empresa_id: String(data.empresa_id),
    modo: data.modo === "local_manual" ? "local_manual" : "geranet",
    ativo: Boolean(data.ativo),
    chave_pix: data.chave_pix ? String(data.chave_pix) : null,
    recebedor_nome: data.recebedor_nome ? String(data.recebedor_nome) : null,
    recebedor_cidade: data.recebedor_cidade
      ? String(data.recebedor_cidade)
      : null,
  };
}
