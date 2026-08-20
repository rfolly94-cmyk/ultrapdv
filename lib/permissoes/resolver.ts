import {
  aplicarLinhas,
  matrizTotal,
  matrizVazia,
  permissoesIguais,
} from "./matriz";
import { presetDoPerfil } from "./presets";
import type {
  LinhaPermissao,
  OrigemPermissao,
  PermissoesEfetivas,
} from "./tipos";

export function resolverPermissoesEfetivas(input: {
  perfil: string;
  linhas?: LinhaPermissao[] | null;
}): PermissoesEfetivas {
  const perfil = String(input.perfil ?? "").trim().toLowerCase();

  if (perfil === "administrador") {
    return matrizTotal();
  }

  const preset = presetDoPerfil(perfil);
  const linhas = input.linhas ?? [];

  if (linhas.length === 0) {
    return preset;
  }

  return aplicarLinhas(preset, linhas);
}

export function origemDasPermissoes(input: {
  perfil: string;
  linhas?: LinhaPermissao[] | null;
  efetivas?: PermissoesEfetivas;
}): OrigemPermissao {
  const perfil = String(input.perfil ?? "").trim().toLowerCase();

  if (perfil === "administrador") {
    return "administrador";
  }

  const linhas = input.linhas ?? [];
  if (linhas.length === 0) {
    return "perfil_padrao";
  }

  const efetivas =
    input.efetivas ?? resolverPermissoesEfetivas({ perfil, linhas });

  if (permissoesIguais(efetivas, presetDoPerfil(perfil))) {
    return "perfil_padrao";
  }

  return "personalizada";
}

export function sanitizarMatrizRecebida(valor: unknown): PermissoesEfetivas | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }

  const linhas = Object.entries(valor as Record<string, unknown>).map(
    ([modulo, permissoes]) => ({
      modulo,
      permissoes:
        permissoes && typeof permissoes === "object"
          ? (permissoes as Record<string, boolean>)
          : {},
    })
  );

  return aplicarLinhas(matrizVazia(), linhas);
}
