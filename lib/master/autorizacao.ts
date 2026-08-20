import { decidirAcessoAdminPlataforma } from "@/lib/plataforma/autorizacao";

export function decidirAcessoMaster(input: {
  usuarioId: string | null;
  autenticado: boolean;
  admin: { usuario_id: string; ativo: boolean } | null;
}) {
  return decidirAcessoAdminPlataforma(input);
}

export { rotaMaster } from "@/lib/assinatura/rotas-restritas";
