import {
  ACOES_POR_MODULO,
  ehModuloPermissao,
  type AcaoDoModulo,
  type ModuloPermissao,
  type PermissoesEfetivas,
} from "./tipos";

export function temPermissao<M extends ModuloPermissao>(
  permissoes: PermissoesEfetivas | null | undefined,
  modulo: M,
  acao: AcaoDoModulo<M>
) {
  if (!permissoes) {
    return false;
  }

  return Boolean(permissoes[modulo]?.[acao]);
}

export function temAcessoModulo(
  permissoes: PermissoesEfetivas | null | undefined,
  modulo: ModuloPermissao
) {
  return temPermissao(permissoes, modulo, "acessar" as AcaoDoModulo<typeof modulo>);
}

export function acaoExisteNoModulo(modulo: string, acao: string) {
  if (!ehModuloPermissao(modulo)) {
    return false;
  }

  return (ACOES_POR_MODULO[modulo] as readonly string[]).includes(acao);
}
