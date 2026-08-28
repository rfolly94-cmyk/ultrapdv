import { INTENCOES_CAIXA } from "./caixa";
import { INTENCOES_CARTEIRA } from "./carteira";
import { INTENCOES_CLIENTES } from "./clientes";
import { INTENCOES_ESTOQUE } from "./estoque";
import { INTENCOES_FISCAL } from "./fiscal";
import { INTENCOES_NOTIFICACOES } from "./notificacoes";
import { INTENCOES_PRODUTO } from "./produtos";
import { INTENCOES_VENDAS } from "./vendas";
import type { DefinicaoIntencao } from "../tipos";

export const DEFINICOES_INTENCAO: DefinicaoIntencao[] = [
  ...INTENCOES_VENDAS,
  ...INTENCOES_CARTEIRA,
  ...INTENCOES_ESTOQUE,
  ...INTENCOES_PRODUTO,
  ...INTENCOES_CLIENTES,
  ...INTENCOES_CAIXA,
  ...INTENCOES_FISCAL,
  ...INTENCOES_NOTIFICACOES,
];
