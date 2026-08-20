import type { RegistroEmpresa, VinculoTeste } from "./cenario";

/**
 * Espelho da política tem_acesso_empresa usada nas RLS:
 * vínculo do auth.uid() com a empresa, ativo = true.
 * NÃO exige principal — isso é regra da aplicação, não da RLS.
 */
export function temAcessoEmpresa(
  usuarioId: string,
  empresaId: string,
  vinculos: VinculoTeste[]
) {
  return vinculos.some(
    (vinculo) =>
      vinculo.usuario_id === usuarioId &&
      vinculo.empresa_id === empresaId &&
      vinculo.ativo === true
  );
}

export function filtrarPorRls<T extends RegistroEmpresa>(
  registros: T[],
  usuarioId: string,
  vinculos: VinculoTeste[]
) {
  return registros.filter((registro) =>
    temAcessoEmpresa(usuarioId, registro.empresa_id, vinculos)
  );
}

export function buscarPorIdComRls<T extends RegistroEmpresa>(
  registros: T[],
  usuarioId: string,
  vinculos: VinculoTeste[],
  id: string
) {
  return (
    filtrarPorRls(registros, usuarioId, vinculos).find(
      (registro) => registro.id === id
    ) ?? null
  );
}

export function escreverComRls<T extends RegistroEmpresa>(
  registros: T[],
  usuarioId: string,
  vinculos: VinculoTeste[],
  id: string,
  mutar: (registro: T) => T
): { ok: true; registros: T[] } | { ok: false; motivo: "nao_encontrado" } {
  const atual = buscarPorIdComRls(registros, usuarioId, vinculos, id);
  if (!atual) {
    return { ok: false, motivo: "nao_encontrado" };
  }

  return {
    ok: true,
    registros: registros.map((registro) =>
      registro.id === id ? mutar(registro) : registro
    ),
  };
}

export function inserirUnicoPorEmpresa<T extends { empresa_id: string }>(
  existentes: T[],
  novo: T,
  chave: (item: T) => string
) {
  const conflito = existentes.some(
    (item) =>
      item.empresa_id === novo.empresa_id && chave(item) === chave(novo)
  );

  if (conflito) {
    throw new Error("unique_violation");
  }

  existentes.push(novo);
  return novo;
}
