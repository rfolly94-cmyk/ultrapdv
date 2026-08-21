import {
  ACOES_POR_MODULO,
  MODULOS_PERMISSAO,
  ehModuloPermissao,
  type LinhaPermissao,
  type ModuloPermissao,
  type PermissoesEfetivas,
} from "./tipos";

function definirAcoesDoModulo<M extends ModuloPermissao>(
  matriz: PermissoesEfetivas,
  modulo: M,
  valor: boolean
) {
  const bloco = Object.fromEntries(
    ACOES_POR_MODULO[modulo].map((acao) => [acao, valor])
  ) as PermissoesEfetivas[M];
  matriz[modulo] = bloco;
}

export function matrizVazia(): PermissoesEfetivas {
  const matriz = {} as PermissoesEfetivas;

  for (const modulo of MODULOS_PERMISSAO) {
    definirAcoesDoModulo(matriz, modulo, false);
  }

  return matriz;
}

export function matrizTotal(): PermissoesEfetivas {
  const matriz = matrizVazia();

  for (const modulo of MODULOS_PERMISSAO) {
    for (const acao of ACOES_POR_MODULO[modulo]) {
      (matriz[modulo] as Record<string, boolean>)[acao] = true;
    }
  }

  return matriz;
}

export function clonarPermissoes(origem: PermissoesEfetivas): PermissoesEfetivas {
  return JSON.parse(JSON.stringify(origem)) as PermissoesEfetivas;
}

export function marcarModulo(
  base: PermissoesEfetivas,
  modulo: ModuloPermissao,
  acoes: string[]
) {
  const next = clonarPermissoes(base);

  for (const acao of acoes) {
    if ((ACOES_POR_MODULO[modulo] as readonly string[]).includes(acao)) {
      (next[modulo] as Record<string, boolean>)[acao] = true;
    }
  }

  return next;
}

export function aplicarLinhas(
  base: PermissoesEfetivas,
  linhas: LinhaPermissao[]
) {
  const next = clonarPermissoes(base);

  for (const linha of linhas) {
    if (!ehModuloPermissao(linha.modulo)) {
      continue;
    }

    const bruto = linha.permissoes ?? {};
    for (const acao of ACOES_POR_MODULO[linha.modulo]) {
      if (typeof bruto[acao] === "boolean") {
        (next[linha.modulo] as Record<string, boolean>)[acao] = bruto[acao];
      }
    }
  }

  return next;
}

export function linhasDaMatriz(matriz: PermissoesEfetivas): LinhaPermissao[] {
  return MODULOS_PERMISSAO.map((modulo) => ({
    modulo,
    permissoes: { ...matriz[modulo] },
  }));
}

export function permissoesIguais(
  a: PermissoesEfetivas,
  b: PermissoesEfetivas
) {
  return JSON.stringify(a) === JSON.stringify(b);
}
