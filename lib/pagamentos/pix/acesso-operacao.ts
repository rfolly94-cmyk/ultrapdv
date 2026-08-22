import "server-only";

import { exigirRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirPixIntegradoEmpresa(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirRecursoEmpresa({
    empresaId: input.empresaId,
    recurso: "pix_integrado",
    origem: input.origem,
  });
}
