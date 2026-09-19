export class ErroPermissao extends Error {
  status: 401 | 403;
  codigo?: string;

  constructor(mensagem: string, status: 401 | 403 = 403, codigo?: string) {
    super(mensagem);
    this.name = "ErroPermissao";
    this.status = status;
    this.codigo = codigo;
  }
}

export const MENSAGEM_SEM_PERMISSAO =
  "Você não tem permissão para executar esta ação.";
