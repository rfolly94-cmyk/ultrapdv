import type { DefinicaoFerramentaIa, NomeFerramentaIa, ResultadoFerramentaIa } from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";
import { consultarCaixaIa } from "./caixa";
import { consultarCarteiraIa, consultarClienteIa } from "./clientes";
import {
  consultarEmissaoFiscalIa,
  diagnosticarNotaIa,
} from "./fiscal";
import {
  analisarGruposFiscaisProdutosIa,
  analisarOperacaoFiscalIa,
  classificarProdutoFiscalMotorIa,
  consultarCestIa,
  consultarClassificacaoIbsCbsIa,
  consultarNcmIa,
  consultarOrigemMercadoriaIa,
  pesquisarNcmIa,
  recomendarGrupoFiscalIa,
  sugerirCestIa,
  validarFiscalProdutoMotorIa,
  validarNcmIa,
} from "../fiscal/motor-tools";
import { consultarNotificacoesIa } from "./notificacoes";
import { consultarEstoqueIa, consultarProdutoIa } from "./produtos";
import {
  consultarVendasIa,
  rankingProdutosIa,
  resumirVendasPeriodoIa,
} from "./vendas";
import {
  proporAcaoNotificacaoIa,
  proporAtribuicaoGrupoFiscalIa,
  proporAtualizacaoFiscalProdutoIa,
  proporAtualizacaoProdutoIa,
  proporCriacaoGrupoFiscalIa,
} from "./propor";
import { consultarAnaliticoIa } from "../analitico/consultar";
import {
  CAMPOS_FILTRO_ANALITICO,
  NOMES_DIMENSAO_ANALITICA,
  NOMES_METRICA_ANALITICA,
  OPERADORES_FILTRO_ANALITICO,
} from "../analitico/tipos";

const objeto = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties: props,
  required,
});

const periodo = {
  type: "string",
  description:
    "hoje, ontem, anteontem, 7d, 30d, mes, mes_anterior, semana, semana_anterior, ano",
};

export const DEFINICOES_FERRAMENTAS_IA: DefinicaoFerramentaIa[] = [
  {
    nome: "consultar_vendas",
    descricao: "Consulta o resumo de vendas do período ou uma venda específica da empresa ativa.",
    parametros: objeto({
      periodo,
      vendaId: { type: "string" },
      clienteId: { type: "string" },
      rankingClientes: { type: "boolean" },
    }),
  },
  {
    nome: "resumir_vendas_periodo",
    descricao: "Resume faturamento, quantidade e ticket médio. Pode comparar com o período anterior.",
    parametros: objeto({
      periodo,
      compararAnterior: { type: "boolean" },
    }),
  },
  {
    nome: "ranking_produtos",
    descricao: "Ranking dos produtos mais vendidos no período.",
    parametros: objeto({ periodo }),
  },
  {
    nome: "consultar_produto",
    descricao: "Busca produto da empresa ativa por id ou nome.",
    parametros: objeto({
      produtoId: { type: "string" },
      busca: { type: "string" },
    }),
  },
  {
    nome: "consultar_estoque",
    descricao: "Lista produtos acabando, zerados ou negativos usando a regra oficial de estoque.",
    parametros: objeto({
      filtro: { type: "string", description: "acabando, zerados, negativos" },
    }),
  },
  {
    nome: "consultar_cliente",
    descricao: "Busca cliente da empresa ativa.",
    parametros: objeto({
      clienteId: { type: "string" },
      busca: { type: "string" },
    }),
  },
  {
    nome: "consultar_carteira",
    descricao: "Consulta débitos, créditos e vencidos da carteira.",
    parametros: objeto({
      clienteId: { type: "string" },
      somenteVencidos: { type: "boolean" },
      ordenar: { type: "string", description: "aberto ou vencido" },
    }),
  },
  {
    nome: "consultar_caixa",
    descricao: "Consulta se o caixa está aberto, entradas e saldo esperado da empresa ativa.",
    parametros: objeto({}),
  },
  {
    nome: "consultar_emissao_fiscal",
    descricao: "Lista notas rejeitadas ou aguardando reconciliação.",
    parametros: objeto({
      status: { type: "string" },
      emissaoId: { type: "string" },
    }),
  },
  {
    nome: "diagnosticar_nota",
    descricao: "Explica o status/motivo de um documento fiscal. Não retransmite.",
    parametros: objeto({
      emissaoId: { type: "string" },
      vendaId: { type: "string" },
    }),
  },
  {
    nome: "consultar_notificacoes",
    descricao: "Resume avisos ativos da Central de Notificações da empresa.",
    parametros: objeto({}),
  },
  {
    nome: "pesquisar_ncm",
    descricao: "Pesquisa NCM vigente na base oficial local. Não inventa código.",
    parametros: objeto({
      termos: { type: "string" },
      descricao: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "consultar_ncm",
    descricao: "Consulta um NCM específico na base oficial vigente.",
    parametros: objeto({
      codigo: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "validar_ncm",
    descricao: "Valida se o NCM existe e está vigente na data de referência.",
    parametros: objeto({
      codigo: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "sugerir_cest",
    descricao: "Sugere CEST a partir do NCM e da descrição. CEST não implica ST.",
    parametros: objeto({
      ncm: { type: "string" },
      descricao: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "consultar_cest",
    descricao: "Consulta/valida CEST na base oficial. Não assume ST.",
    parametros: objeto({
      codigo: { type: "string" },
      cest: { type: "string" },
      ncm: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "consultar_origem_mercadoria",
    descricao: "Explica códigos de origem. Não infere origem pela marca.",
    parametros: objeto({
      origemAtual: { type: "string" },
      origemInformada: { type: "string" },
      marca: { type: "string" },
    }),
  },
  {
    nome: "consultar_classificacao_ibs_cbs",
    descricao: "Valida CST IBS/CBS e cClassTrib oficiais do produto/grupo.",
    parametros: objeto({
      produtoId: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "classificar_produto_fiscal",
    descricao: "Classifica o fiscal do produto com o motor oficial. Não inventa NCM.",
    parametros: objeto({
      produtoId: { type: "string" },
      descricao: { type: "string" },
      descricaoComplementar: { type: "string" },
      marca: { type: "string" },
      categoria: { type: "string" },
      material: { type: "string" },
      composicao: { type: "string" },
      finalidade: { type: "string" },
      uso: { type: "string" },
      caracteristicasTecnicas: { type: "string" },
      origemInformadaUsuario: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "validar_fiscal_produto",
    descricao: "Compara o fiscal atual do produto com a base oficial vigente.",
    parametros: objeto({
      produtoId: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "analisar_operacao_fiscal",
    descricao: "Analisa a tributação de uma operação. Não emite documento.",
    parametros: objeto({
      produtoId: { type: "string" },
      tipoOperacao: { type: "string" },
      ufDestino: { type: "string" },
      destinatarioId: { type: "string" },
      contribuinteIcms: { type: "boolean" },
      consumidorFinal: { type: "boolean" },
      dataReferencia: { type: "string" },
      origemInformadaUsuario: { type: "string" },
    }),
  },
  {
    nome: "recomendar_grupo_fiscal",
    descricao: "Recomenda grupo fiscal existente só da empresa ativa.",
    parametros: objeto({ produtoId: { type: "string" } }),
  },
  {
    nome: "analisar_grupos_fiscais_produtos",
    descricao: "Análise em lote: revisão fiscal, NCM extinto, grupos sem IBS/CBS.",
    parametros: objeto({}),
  },
  {
    nome: "propor_atualizacao_fiscal",
    descricao: "Gera proposta de alteração fiscal persistida no servidor. Não grava no cadastro.",
    parametros: objeto({
      produtoId: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "propor_atualizacao_fiscal_produto",
    descricao: "Gera proposta de atualização fiscal do produto. Não grava até confirmação na interface.",
    parametros: objeto({
      produtoId: { type: "string" },
      dataReferencia: { type: "string" },
    }),
  },
  {
    nome: "propor_atribuicao_grupo_fiscal",
    descricao: "Propõe atribuir um grupo fiscal existente da empresa ativa ao produto. Não grava.",
    parametros: objeto({
      produtoId: { type: "string" },
    }),
  },
  {
    nome: "propor_criacao_grupo_fiscal",
    descricao: "Propõe criar um grupo fiscal novo só se nenhum existente for compatível. Não cria até confirmação.",
    parametros: objeto({
      produtoId: { type: "string" },
      nome: { type: "string" },
    }),
  },
  {
    nome: "propor_atualizacao_produto",
    descricao: "Propõe alterar descrição, categoria existente ou estoque mínimo. Não altera preço, custo nem estoque atual.",
    parametros: objeto({
      produtoId: { type: "string" },
      descricao: { type: "string" },
      categoriaId: { type: "string" },
      categoriaNome: { type: "string" },
      estoqueMinimo: { type: "number" },
    }),
  },
  {
    nome: "propor_acao_notificacao",
    descricao: "Propõe marcar avisos como lidos, dispensar ou adiar. Não executa ação financeira.",
    parametros: objeto({
      notificacaoId: { type: "string" },
      notificacaoIds: { type: "array", items: { type: "string" } },
      acao: { type: "string", description: "lida, dispensar ou adiar" },
      adiar: { type: "string", description: "1h, amanha ou 7d" },
    }),
  },
  {
    nome: "consultar_analitico",
    descricao:
      "Consulta analítica genérica da empresa ativa. Envie só métricas, dimensões e filtros do schema. O backend calcula. Não envie SQL, tabela, empresa_id nem join. Use reutilizarContexto em follow-ups.",
    parametros: objeto({
      metricas: {
        type: "array",
        items: { type: "string", enum: [...NOMES_METRICA_ANALITICA] },
      },
      dimensoes: {
        type: "array",
        items: { type: "string", enum: [...NOMES_DIMENSAO_ANALITICA] },
      },
      filtros: {
        type: "array",
        items: objeto(
          {
            campo: { type: "string", enum: [...CAMPOS_FILTRO_ANALITICO] },
            operador: { type: "string", enum: [...OPERADORES_FILTRO_ANALITICO] },
            valor: { type: ["string", "number", "boolean", "array"] },
          },
          ["campo", "operador", "valor"]
        ),
      },
      periodo,
      de: { type: "string", description: "YYYY-MM-DD" },
      ate: { type: "string", description: "YYYY-MM-DD" },
      comparacao: { type: "boolean" },
      ordenacao: objeto({
        metrica: { type: "string", enum: [...NOMES_METRICA_ANALITICA] },
        direcao: { type: "string", enum: ["asc", "desc"] },
      }),
      limite: { type: "number" },
      reutilizarContexto: { type: "boolean" },
    }, ["metricas"]),
  },
];

export async function executarFerramentaIa(
  nome: string,
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const mapa: Record<
    NomeFerramentaIa,
    (c: ContextoFerramentaIa, a: Record<string, unknown>) => Promise<ResultadoFerramentaIa>
  > = {
    consultar_vendas: consultarVendasIa,
    resumir_vendas_periodo: resumirVendasPeriodoIa,
    ranking_produtos: rankingProdutosIa,
    consultar_produto: consultarProdutoIa,
    consultar_estoque: consultarEstoqueIa,
    consultar_cliente: consultarClienteIa,
    consultar_carteira: consultarCarteiraIa,
    consultar_caixa: async (c) => consultarCaixaIa(c),
    consultar_emissao_fiscal: consultarEmissaoFiscalIa,
    diagnosticar_nota: diagnosticarNotaIa,
    consultar_notificacoes: async (c) => consultarNotificacoesIa(c),
    pesquisar_ncm: pesquisarNcmIa,
    consultar_ncm: consultarNcmIa,
    validar_ncm: validarNcmIa,
    sugerir_cest: sugerirCestIa,
    consultar_cest: consultarCestIa,
    consultar_origem_mercadoria: consultarOrigemMercadoriaIa,
    consultar_classificacao_ibs_cbs: consultarClassificacaoIbsCbsIa,
    classificar_produto_fiscal: classificarProdutoFiscalMotorIa,
    validar_fiscal_produto: validarFiscalProdutoMotorIa,
    analisar_operacao_fiscal: analisarOperacaoFiscalIa,
    recomendar_grupo_fiscal: recomendarGrupoFiscalIa,
    analisar_grupos_fiscais_produtos: async (c) => analisarGruposFiscaisProdutosIa(c),
    propor_atualizacao_fiscal: proporAtualizacaoFiscalProdutoIa,
    propor_atualizacao_fiscal_produto: proporAtualizacaoFiscalProdutoIa,
    propor_atribuicao_grupo_fiscal: proporAtribuicaoGrupoFiscalIa,
    propor_criacao_grupo_fiscal: proporCriacaoGrupoFiscalIa,
    propor_atualizacao_produto: proporAtualizacaoProdutoIa,
    propor_acao_notificacao: proporAcaoNotificacaoIa,
    consultar_analitico: consultarAnaliticoIa,
  };
  const fn = mapa[nome as NomeFerramentaIa];
  if (!fn) {
    return {
      ok: false,
      ferramenta: "consultar_vendas",
      erro: "Ferramenta não disponível.",
      codigo: "falha",
    };
  }
  return fn(ctx, args);
}
