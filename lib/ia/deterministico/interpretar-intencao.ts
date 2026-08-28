import type { ContextoDeterministicoAssistente } from "../tipos";
import { ignorarEmpresaIdDoCliente } from "../contexto";
import { extrairBuscaDeterministica } from "./entidade";
import { DEFINICOES_INTENCAO } from "./intencoes";
import { normalizarTextoDeterministico, textoSemPeriodo } from "./normalizar";
import { extrairPeriodoDeterministico } from "./periodo";
import type {
  ContextoInterpretacaoDeterministica,
  DefinicaoIntencao,
  IntencaoResolvida,
} from "./tipos";

const LIMIAR = 12;

const EXIGE_ANALITICO_ABERTO = [
  /\bmas\b/,
  /\bganhando menos\b/,
  /\bdinheiro parado\b/,
  /\bo que piorou\b/,
  /\bproxima compra\b/,
  /\bpriorizar\b/,
  /\bvend(e|em|endo).{0,48}(acab|baixo|atras|margem)/,
  /\bcompr.{0,40}(atras|vencid)/,
];

const EXIGE_IA = [
  /\b(o que voce recomenda|o que recomenda|me recomenda|sugere que eu)\b/,
  /\bclassifique\b/,
  /\bcorrija (o )?fiscal\b/,
  /\bme explique\b/,
  /\bcomo (devo|posso) (classificar|corrigir|melhorar)\b/,
  /\bpor que (isso|as vendas|o faturamento)\b/,
];

const FOLLOWUP_CLIENTE = /^(e )?(o |quanto (esta |ta )?)?(vencido|aberto|credito|limite|debito)\b/;
const FOLLOWUP_PRODUTO = /^(e )?(o |qual )?(preco|estoque|ncm|cest|codigo|grupo)\b/;
const FOLLOWUP_NOVO_ALVO =
  /^(e (a |o |as |os )?)([a-zá-ú0-9][a-zá-ú0-9 .'-]{0,40})$/;

function pontuar(texto: string, definicao: DefinicaoIntencao) {
  let pontos = 0;
  for (const padrao of definicao.padroes) {
    if (padrao.re.test(texto)) {
      pontos += padrao.pontos;
    }
  }
  return pontos;
}

function contextoMesmaEmpresa(
  ctx: ContextoInterpretacaoDeterministica
): ContextoDeterministicoAssistente | null {
  const anterior = ctx.anterior;
  if (!anterior?.empresaId || anterior.empresaId !== ctx.empresaId) {
    return null;
  }
  return anterior;
}

export function interpretarIntencaoDeterministica(
  pergunta: string,
  ctx: ContextoInterpretacaoDeterministica
): IntencaoResolvida | null {
  const normalizado = normalizarTextoDeterministico(pergunta);
  if (!normalizado) {
    return null;
  }

  const { periodo, trecho } = extrairPeriodoDeterministico(normalizado);
  const semPeriodo = textoSemPeriodo(normalizado, trecho);
  const busca =
    extrairBuscaDeterministica(semPeriodo) ??
    extrairBuscaDeterministica(normalizado);
  const anterior = contextoMesmaEmpresa(ctx);

  let melhor: { definicao: DefinicaoIntencao; pontos: number } | null = null;
  for (const definicao of DEFINICOES_INTENCAO) {
    if (definicao.requerContexto === "cliente" && !(anterior?.clienteId || ctx.clienteIdTela || busca)) {
      continue;
    }
    if (definicao.requerContexto === "produto" && !(anterior?.produtoId || ctx.produtoIdTela || busca)) {
      continue;
    }
    const pontos = pontuar(normalizado, definicao);
    if (pontos <= 0) {
      continue;
    }
    if (!melhor || pontos > melhor.pontos) {
      melhor = { definicao, pontos };
    }
  }

  if (anterior?.clienteId && FOLLOWUP_CLIENTE.test(normalizado)) {
    const carteiraCliente = DEFINICOES_INTENCAO.find((item) => item.nome === "carteira.cliente");
    if (carteiraCliente && (!melhor || melhor.pontos < 20)) {
      melhor = { definicao: carteiraCliente, pontos: 20 };
    }
  }
  if (anterior?.produtoId && FOLLOWUP_PRODUTO.test(normalizado)) {
    const produto = DEFINICOES_INTENCAO.find((item) => item.nome === "produto.consulta");
    if (produto && (!melhor || melhor.pontos < 20)) {
      melhor = { definicao: produto, pontos: 20 };
    }
  }

  if (
    anterior &&
    (anterior.intencao.startsWith("carteira.") || anterior.intencao.startsWith("clientes.")) &&
    !FOLLOWUP_CLIENTE.test(normalizado)
  ) {
    const matchAlvo = normalizado.match(FOLLOWUP_NOVO_ALVO);
    const alvo = String(matchAlvo?.[3] ?? "").trim();
    if (
      alvo &&
      alvo !== "estoque" &&
      alvo !== "caixa" &&
      alvo !== "produto" &&
      alvo !== "venda"
    ) {
      const carteiraCliente = DEFINICOES_INTENCAO.find((item) => item.nome === "carteira.cliente");
      if (carteiraCliente && (!melhor || melhor.pontos < 22)) {
        melhor = { definicao: carteiraCliente, pontos: 22 };
        const bruto = carteiraCliente.args({
          periodo,
          busca: alvo,
          clienteId: null,
          produtoId: null,
        });
        return {
          nome: carteiraCliente.nome,
          confianca: 22,
          periodo,
          busca: alvo,
          clienteId: null,
          produtoId: null,
          foco: carteiraCliente.nome,
          ferramenta: carteiraCliente.ferramenta,
          encadear: carteiraCliente.encadear ?? [],
          args: ignorarEmpresaIdDoCliente(bruto),
        };
      }
    }
  }

  if (!melhor || melhor.pontos < LIMIAR) {
    return null;
  }

  const exigeIa = EXIGE_IA.some((re) => re.test(normalizado));
  const exigeAnalitico = EXIGE_ANALITICO_ABERTO.some((re) => re.test(normalizado));
  if (exigeAnalitico) {
    return null;
  }
  const operacionalForte =
    melhor.pontos >= 16 &&
    (melhor.definicao.nome.startsWith("vendas.") ||
      melhor.definicao.nome.startsWith("carteira.") ||
      melhor.definicao.nome.startsWith("estoque.") ||
      melhor.definicao.nome.startsWith("caixa.") ||
      melhor.definicao.nome.startsWith("navegacao.") ||
      melhor.definicao.nome.startsWith("notificacoes.") ||
      melhor.definicao.nome === "fiscal.diagnostico" ||
      melhor.definicao.nome === "fiscal.notas_rejeitadas");
  if (exigeIa && !operacionalForte) {
    return null;
  }

  const clienteId =
    (melhor.definicao.nome.startsWith("carteira.") ||
    melhor.definicao.nome.startsWith("clientes.")
      ? anterior?.clienteId ?? ctx.clienteIdTela ?? null
      : null) || null;
  const produtoId =
    melhor.definicao.nome.startsWith("produto.") ||
    melhor.definicao.nome.startsWith("fiscal.")
      ? anterior?.produtoId ?? ctx.produtoIdTela ?? null
      : null;

  const bruto = melhor.definicao.args({
    periodo,
    busca,
    clienteId: busca ? null : clienteId,
    produtoId: busca ? null : produtoId,
  });
  if (melhor.definicao.nome === "vendas.abrir") {
    const numero = normalizado.match(/venda\s+(\d+)/)?.[1];
    if (numero) {
      bruto.numero = numero;
    }
  }
  const args = ignorarEmpresaIdDoCliente(bruto);

  return {
    nome: melhor.definicao.nome,
    confianca: melhor.pontos,
    periodo,
    busca,
    clienteId: typeof args.clienteId === "string" ? args.clienteId : clienteId,
    produtoId: typeof args.produtoId === "string" ? args.produtoId : produtoId,
    foco: melhor.definicao.nome,
    ferramenta: melhor.definicao.ferramenta,
    encadear: melhor.definicao.encadear ?? [],
    args,
  };
}
