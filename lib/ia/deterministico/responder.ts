import { ignorarEmpresaIdDoCliente } from "../contexto";
import { executarFerramentaIa } from "../ferramentas/registro";
import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import type {
  AcaoAssistente,
  ContextoDeterministicoAssistente,
  NomeFerramentaIa,
} from "../tipos";
import { interpretarIntencaoDeterministica } from "./interpretar-intencao";
import { montarRespostaDeterministica } from "./respostas";
import type { ContextoInterpretacaoDeterministica, IntencaoResolvida } from "./tipos";

function str(valor: unknown) {
  const saida = String(valor ?? "").trim();
  return saida || null;
}

function primeiroIdNome(lista: unknown): { id: string | null; nome: string | null } {
  if (!Array.isArray(lista) || !lista[0] || typeof lista[0] !== "object") {
    return { id: null, nome: null };
  }
  const item = lista[0] as Record<string, unknown>;
  return {
    id: str(item.id) ?? str(item.clienteId) ?? str(item.produtoId),
    nome: str(item.nome),
  };
}

async function detalharSeListaUnica(
  ctx: ContextoFerramentaIa,
  ferramenta: NomeFerramentaIa,
  resultado: Awaited<ReturnType<typeof executarFerramentaIa>>
) {
  if (ferramenta !== "consultar_produto" && ferramenta !== "consultar_cliente") {
    return resultado;
  }
  const itens = resultado.dados?.itens;
  if (!resultado.ok || !Array.isArray(itens) || itens.length !== 1) {
    return resultado;
  }
  const id = str((itens[0] as Record<string, unknown>).id);
  if (!id) {
    return resultado;
  }
  return executarFerramentaIa(
    ferramenta,
    ctx,
    ignorarEmpresaIdDoCliente(
      ferramenta === "consultar_produto" ? { produtoId: id } : { clienteId: id }
    )
  );
}

function contextoDaResposta(
  ctx: ContextoFerramentaIa,
  intencao: IntencaoResolvida,
  dados: Record<string, unknown>
): ContextoDeterministicoAssistente {
  const cliente = primeiroIdNome(dados.clientes ?? dados.itens);
  const produto = dados.nome
    ? { id: str(dados.id), nome: str(dados.nome) }
    : primeiroIdNome(dados.itens);
  return {
    empresaId: ctx.empresaId,
    intencao: intencao.nome,
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    produtoId: produto.id,
    produtoNome: produto.nome,
    periodo: intencao.periodo,
  };
}

export async function responderDeterministico(params: {
  ctx: ContextoFerramentaIa;
  pergunta: string;
  interpretacao: ContextoInterpretacaoDeterministica;
}): Promise<{
  texto: string;
  acoes: AcaoAssistente[];
  contextoDeterministico: ContextoDeterministicoAssistente;
} | null> {
  const intencao = interpretarIntencaoDeterministica(
    params.pergunta,
    params.interpretacao
  );
  if (!intencao) {
    return null;
  }

  const args = ignorarEmpresaIdDoCliente({ ...intencao.args });
  let resultado = await executarFerramentaIa(intencao.ferramenta, params.ctx, args);
  resultado = await detalharSeListaUnica(params.ctx, intencao.ferramenta, resultado);

  for (const proxima of intencao.encadear) {
    if (!resultado.ok) {
      break;
    }
    const dados = resultado.dados ?? {};
    let extra: Record<string, unknown> = { ...args };
    if (proxima === "validar_ncm") {
      const ncm = str(dados.ncm);
      if (!ncm) {
        break;
      }
      extra = { codigo: ncm };
    }
    if (proxima === "consultar_vendas") {
      const cliente = primeiroIdNome(dados.itens);
      extra = {
        periodo: intencao.periodo,
        ...(cliente.id ? { clienteId: cliente.id } : {}),
      };
    }
    const encadeado = await executarFerramentaIa(
      proxima,
      params.ctx,
      ignorarEmpresaIdDoCliente(extra)
    );
    if (!encadeado.ok) {
      break;
    }
    resultado = {
      ...encadeado,
      acoes: [...(resultado.acoes ?? []), ...(encadeado.acoes ?? [])],
      dados: {
        ...dados,
        ...encadeado.dados,
        itens: dados.itens ?? encadeado.dados?.itens,
        clientes: dados.clientes ?? encadeado.dados?.clientes,
        ...(proxima === "validar_ncm" ? { ncmVigente: encadeado.dados } : {}),
      },
    };
  }

  return {
    texto: montarRespostaDeterministica(intencao, resultado),
    acoes: resultado.acoes ?? [],
    contextoDeterministico: contextoDaResposta(
      params.ctx,
      intencao,
      resultado.dados ?? {}
    ),
  };
}
