import { CATALOGO_RECURSOS } from "@/lib/plataforma/recursos/catalogo";

export class ErroEntitlement extends Error {
  status: 401 | 403;
  codigo: "RECURSO_NAO_CONTRATADO" | "SEM_EMPRESA";
  recurso: string;
  empresaId: string;

  constructor(input: {
    mensagem?: string;
    codigo?: "RECURSO_NAO_CONTRATADO" | "SEM_EMPRESA";
    recurso: string;
    empresaId: string;
    status?: 401 | 403;
  }) {
    super(
      input.mensagem ??
        mensagemRecursoNaoContratado(nomeRecursoCatalogo(input.recurso))
    );
    this.name = "ErroEntitlement";
    this.codigo = input.codigo ?? "RECURSO_NAO_CONTRATADO";
    this.recurso = String(input.recurso ?? "").trim();
    this.empresaId = String(input.empresaId ?? "").trim();
    this.status = input.status ?? 403;
  }
}

export function nomeRecursoCatalogo(chave: string) {
  const encontrado = CATALOGO_RECURSOS.find((item) => item.chave === chave);
  return encontrado?.nome ?? "Este recurso";
}

export function mensagemRecursoNaoContratado(nomeRecurso: string) {
  return `${nomeRecurso} não está incluído no plano atual da sua empresa.`;
}

export function logAcessoNegadoEntitlement(input: {
  empresaId: string;
  recurso: string;
  origem?: string;
}) {
  console.info("[entitlement] acesso-negado", {
    empresa_id: String(input.empresaId ?? "").trim(),
    recurso: String(input.recurso ?? "").trim(),
    origem: String(input.origem ?? "desconhecida").trim() || "desconhecida",
  });
}
