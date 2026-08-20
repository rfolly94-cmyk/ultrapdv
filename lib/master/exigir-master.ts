import "server-only";

import {
  ErroAdminPlataforma,
  obterContextoAdminPlataforma,
} from "@/lib/plataforma/contexto";

export class ErroMaster extends ErroAdminPlataforma {
  constructor(mensagem: string, status = 404) {
    super(mensagem, status);
    this.name = "ErroMaster";
  }
}

export async function exigirMaster() {
  return obterContextoAdminPlataforma();
}

export async function obterMasterAtual() {
  try {
    return await exigirMaster();
  } catch (error) {
    if (error instanceof ErroAdminPlataforma) {
      return null;
    }
    throw error;
  }
}
