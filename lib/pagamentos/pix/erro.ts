export class ErroPixGeranet extends Error {
  readonly status: number;
  readonly codigo?: string;

  constructor(mensagem: string, status = 422, codigo?: string) {
    super(mensagem);
    this.name = "ErroPixGeranet";
    this.status = status;
    this.codigo = codigo;
  }
}
