import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import type { AcaoDoModulo, ModuloPermissao, PermissoesEfetivas } from "@/lib/permissoes/tipos";

import type {
  NomeFerramentaIa,
  NomeFerramentaResultadoIa,
  ResultadoFerramentaIa,
} from "./tipos";
import { MENSAGEM_IA_SEM_PERMISSAO } from "./tipos";

export type RecursoFerramentaIa =
  | "vendas"
  | "produtos"
  | "estoque"
  | "clientes"
  | "caixa"
  | "fiscal"
  | "relatorios"
  | "pdv";

const MODULO_RECURSO: Record<
  RecursoFerramentaIa,
  { modulo: ModuloPermissao; recurso: string }
> = {
  vendas: { modulo: "vendas", recurso: "vendas" },
  produtos: { modulo: "produtos", recurso: "produtos" },
  estoque: { modulo: "estoque", recurso: "estoque" },
  clientes: { modulo: "clientes", recurso: "clientes" },
  caixa: { modulo: "caixa", recurso: "caixa" },
  fiscal: { modulo: "fiscal", recurso: "fiscal" },
  relatorios: { modulo: "relatorios", recurso: "relatorios" },
  pdv: { modulo: "pdv", recurso: "pdv" },
};

export async function autorizarFerramentaIa<M extends ModuloPermissao>(params: {
  empresaId: string;
  permissoes: PermissoesEfetivas | null;
  recurso: RecursoFerramentaIa;
  acao: AcaoDoModulo<M>;
  mensagem?: string;
}): Promise<{ ok: true } | { ok: false; erro: string; codigo: "sem_permissao" }> {
  const mapa = MODULO_RECURSO[params.recurso];
  const plano = await planoPermiteRecursoEmpresa(params.empresaId, mapa.recurso);
  if (!plano.permitido) {
    return {
      ok: false,
      erro: params.mensagem ?? MENSAGEM_IA_SEM_PERMISSAO,
      codigo: "sem_permissao",
    };
  }
  if (!temPermissao(params.permissoes, mapa.modulo, params.acao as never)) {
    return {
      ok: false,
      erro: params.mensagem ?? MENSAGEM_IA_SEM_PERMISSAO,
      codigo: "sem_permissao",
    };
  }
  return { ok: true };
}

export function recusaFerramentaIa(
  ferramenta: NomeFerramentaIa | NomeFerramentaResultadoIa,
  auth: { ok: false; erro: string; codigo: "sem_permissao" }
): ResultadoFerramentaIa {
  return {
    ok: false,
    ferramenta,
    erro: auth.erro,
    codigo: auth.codigo,
  };
}
