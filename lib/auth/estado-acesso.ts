export type VinculoAcesso = {
  empresa_id?: unknown;
  perfil?: unknown;
  principal?: unknown;
  ativo?: unknown;
};

export type EstadoAcessoSessao = {
  usuarioAtivo: boolean;
  teveVinculo: boolean;
  temVinculoOperacional: boolean;
  empresaId: string | null;
  perfil: string | null;
};

export function classificarEstadoAcesso(params: {
  usuarioAtivo?: boolean | null;
  vinculos?: VinculoAcesso[] | null;
}): EstadoAcessoSessao {
  const vinculos = params.vinculos ?? [];
  const operacional = vinculos.find(
    (item) => item.principal === true && item.ativo === true
  );

  return {
    usuarioAtivo: params.usuarioAtivo !== false,
    teveVinculo: vinculos.length > 0,
    temVinculoOperacional: Boolean(operacional),
    empresaId: operacional ? String(operacional.empresa_id ?? "") || null : null,
    perfil: operacional ? String(operacional.perfil ?? "") || null : null,
  };
}

export function acessoOperacionalDesativado(estado: EstadoAcessoSessao) {
  return !estado.usuarioAtivo || (estado.teveVinculo && !estado.temVinculoOperacional);
}

export function podeUsarOnboarding(estado: EstadoAcessoSessao) {
  return estado.usuarioAtivo && !estado.teveVinculo;
}
