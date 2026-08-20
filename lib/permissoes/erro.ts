export class ErroPermissao extends Error {
  status: 401 | 403;

  constructor(mensagem: string, status: 401 | 403 = 403) {
    super(mensagem);
    this.name = "ErroPermissao";
    this.status = status;
  }
}

export const MENSAGEM_SEM_PERMISSAO =
  "Você não tem permissão para executar esta ação.";
