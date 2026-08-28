import { CATALOGO_CONSULTA_IA } from "./catalogo";
import { AGREGACOES_CONSULTA, OPERADORES_FILTRO_CONSULTA } from "./tipos";

export function catalogoCompactoConsultaIa() {
  const fontes = Object.values(CATALOGO_CONSULTA_IA).map((fonte) => {
    const campos = fonte.campos
      .map((campo) => `${campo.nome}:${campo.tipo}`)
      .join(", ");
    const relacoes = fonte.relacoes.map((item) => item.nome).join(", ") || "—";
    return `${fonte.nome} — ${fonte.descricao}\n  campos: ${campos}\n  relações: ${relacoes}`;
  });
  return [
    "Catálogo de consulta (somente leitura). Use consultar_dados com estes nomes.",
    `Operadores: ${OPERADORES_FILTRO_CONSULTA.join(", ")}`,
    `Agregações: ${AGREGACOES_CONSULTA.join(", ")}`,
    "Não envie SQL, empresa_id, SELECT * nem nomes de tabela PostgreSQL.",
    ...fontes,
  ].join("\n");
}
