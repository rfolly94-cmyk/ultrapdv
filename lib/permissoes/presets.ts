import type { PerfilUsuario } from "@/lib/usuarios/perfis";

import { marcarModulo, matrizTotal, matrizVazia } from "./matriz";
import {
  ACOES_POR_MODULO,
  type ModuloPermissao,
  type PermissoesEfetivas,
} from "./tipos";

function todasAcoes(modulo: ModuloPermissao) {
  return [...ACOES_POR_MODULO[modulo]];
}

function montar(
  regras: Array<[ModuloPermissao, string[] | "todas"]>
): PermissoesEfetivas {
  let matriz = matrizVazia();

  for (const [modulo, acoes] of regras) {
    matriz = marcarModulo(
      matriz,
      modulo,
      acoes === "todas" ? todasAcoes(modulo) : acoes
    );
  }

  return matriz;
}

export const PRESETS_PERFIL: Record<PerfilUsuario, PermissoesEfetivas> = {
  administrador: matrizTotal(),

  gerente: montar([
    ["inicio", "todas"],
    ["vendas", "todas"],
    ["pdv", "todas"],
    ["clientes", "todas"],
    ["produtos", "todas"],
    ["estoque", "todas"],
    ["fiscal", [
      "acessar",
      "emitir_nfe",
      "emitir_nfce",
      "cancelar_nota",
      "carta_correcao",
      "inutilizar",
      "reconciliar",
    ]],
    ["financeiro", ["acessar", "criar", "editar", "excluir"]],
    ["contabilidade", "todas"],
    ["configuracoes", ["acessar", "editar_empresa"]],
    ["catalogo", "todas"],
    ["importacao_dados", "todas"],
    ["relatorios", "todas"],
  ]),

  vendedor: montar([
    ["inicio", ["acessar"]],
    ["vendas", ["acessar"]],
    ["pdv", ["acessar", "finalizar_venda", "usar_fiado"]],
    ["clientes", ["acessar", "criar", "editar"]],
    ["produtos", ["acessar"]],
    ["relatorios", ["acessar"]],
  ]),

  caixa: montar([
    ["inicio", ["acessar"]],
    ["vendas", ["acessar"]],
    ["pdv", ["acessar", "finalizar_venda"]],
    ["clientes", ["acessar", "acessar_carteira", "receber_carteira"]],
  ]),

  operador: montar([
    ["inicio", ["acessar"]],
    ["vendas", ["acessar", "criar", "editar"]],
    ["pdv", ["acessar", "finalizar_venda", "aplicar_desconto"]],
    ["clientes", ["acessar", "criar", "editar"]],
    ["produtos", ["acessar", "criar", "editar"]],
    ["estoque", ["acessar", "movimentar"]],
    ["catalogo", ["acessar", "pedidos"]],
    ["relatorios", ["acessar"]],
  ]),

  contador: montar([
    ["produtos", ["acessar"]],
    ["estoque", ["acessar"]],
    ["fiscal", ["acessar", "reconciliar"]],
    ["contabilidade", "todas"],
    ["relatorios", "todas"],
  ]),
};

export function presetDoPerfil(perfil: string): PermissoesEfetivas {
  const chave = String(perfil ?? "").trim().toLowerCase() as PerfilUsuario;
  return PRESETS_PERFIL[chave] ?? matrizVazia();
}
