import { createAdminClient } from "@/lib/supabase/admin";
import {
  BUCKET_LOGOS_EMPRESAS,
  bufferParaHexLogomarca,
  detectarTipoLogo,
  logoPertenceAEmpresa,
} from "./logo";

export async function obterLogomarcaFiscalHex(
  empresaId: string
): Promise<string | undefined> {
  try {
    if (!empresaId) {
      return undefined;
    }

    const admin = createAdminClient();
    const { data: empresa, error } = await admin
      .from("empresas")
      .select("id, logo_path")
      .eq("id", empresaId)
      .maybeSingle();

    if (error || !empresa?.logo_path) {
      return undefined;
    }

    const path = String(empresa.logo_path);
    if (!logoPertenceAEmpresa(String(empresa.id), path)) {
      console.error("Logomarca fiscal ignorada: path não pertence à empresa.");
      return undefined;
    }

    const arquivo = await admin.storage
      .from(BUCKET_LOGOS_EMPRESAS)
      .download(path);

    if (arquivo.error || !arquivo.data) {
      console.error("Logomarca fiscal ignorada: arquivo ausente no Storage.");
      return undefined;
    }

    const bytes = Buffer.from(await arquivo.data.arrayBuffer());
    if (!detectarTipoLogo(bytes)) {
      console.error("Logomarca fiscal ignorada: arquivo não é PNG/JPEG.");
      return undefined;
    }

    const hex = bufferParaHexLogomarca(bytes);
    return hex || undefined;
  } catch {
    console.error("Logomarca fiscal ignorada: falha ao carregar a imagem.");
    return undefined;
  }
}
