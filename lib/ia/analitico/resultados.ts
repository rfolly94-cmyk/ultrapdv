import { situacaoEstoque } from "@/lib/relatorios/calculo";
import { chaveDiaSaoPaulo, dataVenda } from "@/lib/relatorios/periodo";
import { arredondarMoeda } from "../periodo";
import { graoDaConsulta } from "./dimensoes";
import { compararFiltro } from "./filtros";
import { metricaAnalitica } from "./metricas";
import type { FontesAnaliticas, ProdutoFonte, VendaFonte } from "./fontes-modelo";
import type {
  ConsultaAnalitica,
  ContextoAnaliticoAssistente,
  FiltroAnalitico,
  LinhaAnalitica,
  NomeMetricaAnalitica,
  ResultadoAnalitico,
} from "./tipos";

type Acc = {
  id: string;
  nome: string;
  faturamento: number;
  vendaIds: Set<string>;
  quantidade_vendida: number;
  desconto: number;
  custo_vendido: number;
  custoInformado: boolean;
  estoque_atual: number;
  estoque_minimo: number;
  valor_estoque_custo: number;
  valor_estoque_venda: number;
  quantidade_produtos: number;
  produtos_zerados: number;
  produtos_negativos: number;
  produtos_abaixo_minimo: number;
  saldo_aberto: number;
  saldo_vencido: number;
  recebimentos: number;
  quantidade_devedores: number;
  ultima_compra_ms: number;
  ativo: boolean;
  situacao: string;
  categoria_id: string | null;
  marca_id: string | null;
};

function semanaIso(chaveDia: string) {
  const [ano, mes, dia] = chaveDia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dow = data.getUTCDay() || 7;
  data.setUTCDate(data.getUTCDate() + 4 - dow);
  const inicio = new Date(Date.UTC(data.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((data.getTime() - inicio.getTime()) / 86400000 + 1) / 7);
  return `${data.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

function chaveTempo(dimensao: string, iso: string) {
  const dia = chaveDiaSaoPaulo(iso);
  if (dimensao === "dia") return dia;
  if (dimensao === "mes") return dia.slice(0, 7);
  if (dimensao === "ano") return dia.slice(0, 4);
  return semanaIso(dia);
}

function vazio(id: string, nome: string): Acc {
  return {
    id,
    nome,
    faturamento: 0,
    vendaIds: new Set(),
    quantidade_vendida: 0,
    desconto: 0,
    custo_vendido: 0,
    custoInformado: false,
    estoque_atual: 0,
    estoque_minimo: 0,
    valor_estoque_custo: 0,
    valor_estoque_venda: 0,
    quantidade_produtos: 0,
    produtos_zerados: 0,
    produtos_negativos: 0,
    produtos_abaixo_minimo: 0,
    saldo_aberto: 0,
    saldo_vencido: 0,
    recebimentos: 0,
    quantidade_devedores: 0,
    ultima_compra_ms: 0,
    ativo: true,
    situacao: "com",
    categoria_id: null,
    marca_id: null,
  };
}

function obter(mapa: Map<string, Acc>, id: string, nome: string) {
  const atual = mapa.get(id) ?? vazio(id, nome);
  mapa.set(id, atual);
  return atual;
}

function produtoPorId(fontes: FontesAnaliticas) {
  return new Map(fontes.produtos.map((item) => [item.id, item]));
}

function chaveEntidade(
  consulta: ConsultaAnalitica,
  params: {
    produto?: ProdutoFonte | null;
    venda?: VendaFonte | null;
    forma?: string | null;
    iso?: string | null;
  }
) {
  const dim = consulta.dimensoes[0];
  if (!dim) {
    return { id: "empresa", nome: "Empresa" };
  }
  if (dim === "produto") {
    return {
      id: params.produto?.id ?? "sem-produto",
      nome: params.produto?.nome ?? "Produto",
    };
  }
  if (dim === "categoria") {
    const id = params.produto?.categoria_id ?? "sem-categoria";
    return { id, nome: id === "sem-categoria" ? "Sem categoria" : id };
  }
  if (dim === "marca") {
    const id = params.produto?.marca_id ?? "sem-marca";
    return { id, nome: id === "sem-marca" ? "Sem marca" : id };
  }
  if (dim === "cliente") {
    const id = params.venda?.cliente_id ?? "sem-cliente";
    return { id, nome: id };
  }
  if (dim === "vendedor") {
    const id = params.venda?.usuario_id ?? "sem-vendedor";
    return { id, nome: id };
  }
  if (dim === "forma_pagamento") {
    const id = params.forma ?? "sem-forma";
    return { id, nome: id };
  }
  const iso = params.iso ?? params.venda?.created_at ?? "";
  const id = chaveTempo(dim, iso);
  return { id, nome: id };
}

function aplicarVendas(
  consulta: ConsultaAnalitica,
  fontes: FontesAnaliticas,
  anterior: boolean
) {
  const mapa = new Map<string, Acc>();
  const produtos = produtoPorId(fontes);
  const vendas = anterior ? fontes.vendasAnterior : fontes.vendas;
  const itens = anterior ? fontes.itensAnterior : fontes.itens;
  const pagamentos = anterior ? fontes.pagamentosAnterior : fontes.pagamentos;
  const vendasPorId = new Map(vendas.map((item) => [item.id, item]));
  const grao = graoDaConsulta(consulta.dimensoes);

  if (grao === "forma_pagamento") {
    for (const pag of pagamentos) {
      const venda = vendasPorId.get(pag.venda_id);
      if (!venda) continue;
      const forma =
        String(pag.forma_pagamento_nome ?? "").trim() ||
        String(pag.forma_pagamento_codigo ?? "").trim() ||
        "Pagamento";
      const chave = chaveEntidade(consulta, { venda, forma });
      const acc = obter(mapa, chave.id, chave.nome);
      acc.faturamento += Number(pag.valor ?? 0);
      acc.vendaIds.add(venda.id);
    }
    return mapa;
  }

  if (grao === "produto" || grao === "categoria" || grao === "marca") {
    for (const item of itens) {
      const venda = vendasPorId.get(item.venda_id);
      if (!venda) continue;
      const produto = produtos.get(String(item.produto_id ?? ""));
      const chave = chaveEntidade(consulta, {
        produto: produto ?? {
          id: String(item.produto_id ?? "sem-produto"),
          empresa_id: fontes.empresaId,
          nome: String(item.produto_nome ?? "Produto"),
          categoria_id: null,
          marca_id: null,
          preco_custo: 0,
          preco_venda: 0,
          ativo: true,
        },
        venda,
      });
      const acc = obter(mapa, chave.id, produto?.nome ?? chave.nome);
      acc.faturamento += Number(item.valor_total ?? 0);
      acc.quantidade_vendida += Number(item.quantidade ?? 0);
      acc.vendaIds.add(venda.id);
      if (produto) {
        acc.categoria_id = produto.categoria_id;
        acc.marca_id = produto.marca_id;
        acc.ativo = produto.ativo;
        const custo = produto.preco_custo * Number(item.quantidade ?? 0);
        acc.custo_vendido += custo;
        if (produto.preco_custo > 0) {
          acc.custoInformado = true;
        }
      }
    }
    return mapa;
  }

  for (const venda of vendas) {
    const iso = dataVenda(venda);
    const chave = chaveEntidade(consulta, { venda, iso });
    const acc = obter(mapa, chave.id, chave.nome);
    acc.faturamento += venda.valor_total;
    acc.desconto += venda.desconto;
    acc.vendaIds.add(venda.id);
    const ms = new Date(iso).getTime();
    if (ms > acc.ultima_compra_ms) {
      acc.ultima_compra_ms = ms;
    }
  }
  for (const item of itens) {
    const venda = vendasPorId.get(item.venda_id);
    if (!venda) continue;
    const iso = dataVenda(venda);
    const chave = chaveEntidade(consulta, { venda, iso });
    const acc = obter(mapa, chave.id, chave.nome);
    acc.quantidade_vendida += Number(item.quantidade ?? 0);
    const produto = produtos.get(String(item.produto_id ?? ""));
    if (produto) {
      acc.custo_vendido += produto.preco_custo * Number(item.quantidade ?? 0);
      if (produto.preco_custo > 0) {
        acc.custoInformado = true;
      }
    }
  }
  return mapa;
}

function aplicarEstoque(consulta: ConsultaAnalitica, fontes: FontesAnaliticas, mapa: Map<string, Acc>) {
  const grao = graoDaConsulta(consulta.dimensoes);
  if (!["empresa", "produto", "categoria", "marca"].includes(grao)) {
    return;
  }
  const produtos = produtoPorId(fontes);
  for (const produto of fontes.produtos) {
    if (!produto.ativo && grao !== "produto") {
      continue;
    }
    const pos = fontes.estoque.get(produto.id);
    const quantidade = pos?.quantidade ?? 0;
    const minimo = pos?.minimo ?? 0;
    const situacao = situacaoEstoque({ quantidade, estoqueMinimo: minimo });
    const chave = chaveEntidade(consulta, { produto });
    const nome =
      grao === "categoria"
        ? fontes.categorias.get(produto.categoria_id ?? "") ?? "Sem categoria"
        : grao === "marca"
          ? fontes.marcas.get(produto.marca_id ?? "") ?? "Sem marca"
          : produto.nome;
    const acc = obter(mapa, chave.id, grao === "produto" ? produto.nome : nome);
    acc.estoque_atual += quantidade;
    acc.estoque_minimo += minimo;
    acc.valor_estoque_custo += quantidade * produto.preco_custo;
    acc.valor_estoque_venda += quantidade * produto.preco_venda;
    acc.quantidade_produtos += 1;
    acc.categoria_id = produto.categoria_id;
    acc.marca_id = produto.marca_id;
    acc.ativo = produto.ativo;
    acc.situacao = situacao;
    if (situacao === "sem") acc.produtos_zerados += 1;
    if (situacao === "negativo") acc.produtos_negativos += 1;
    if (situacao === "baixo") acc.produtos_abaixo_minimo += 1;
    if (grao === "produto") {
      acc.situacao = situacao;
    }
  }
  void produtos;
}

function aplicarCarteira(consulta: ConsultaAnalitica, fontes: FontesAnaliticas, mapa: Map<string, Acc>, anterior: boolean) {
  const grao = graoDaConsulta(consulta.dimensoes);
  if (grao !== "empresa" && grao !== "cliente") {
    return;
  }
  const recebimentos = anterior ? fontes.recebimentosAnterior : fontes.recebimentos;
  if (grao === "empresa") {
    const acc = obter(mapa, "empresa", "Empresa");
    for (const [id, carteira] of fontes.carteira) {
      acc.saldo_aberto += carteira.debitoAberto;
      acc.saldo_vencido += carteira.vencido;
      if (carteira.debitoAberto > 0) {
        acc.quantidade_devedores += 1;
      }
      void id;
    }
    for (const item of recebimentos) {
      acc.recebimentos += item.valor;
    }
    return;
  }
  for (const [id, cliente] of fontes.clientes) {
    const carteira = fontes.carteira.get(id);
    const acc = obter(mapa, id, cliente.nome);
    acc.saldo_aberto = carteira?.debitoAberto ?? 0;
    acc.saldo_vencido = carteira?.vencido ?? 0;
    acc.quantidade_devedores = acc.saldo_aberto > 0 ? 1 : 0;
    acc.ativo = cliente.ativo;
  }
  for (const item of recebimentos) {
    const cliente = fontes.clientes.get(item.cliente_id);
    const acc = obter(mapa, item.cliente_id, cliente?.nome ?? "Cliente");
    acc.recebimentos += item.valor;
  }
}

function passarFiltro(acc: Acc, filtros: FiltroAnalitico[]) {
  for (const filtro of filtros) {
    let atual: number | string | boolean | null = null;
    if (filtro.campo === "produto_id" || filtro.campo === "ids") atual = acc.id;
    else if (filtro.campo === "categoria_id") atual = acc.categoria_id;
    else if (filtro.campo === "marca_id") atual = acc.marca_id;
    else if (filtro.campo === "cliente_id") atual = acc.id;
    else if (filtro.campo === "forma_pagamento") atual = acc.nome;
    else if (filtro.campo === "estoque_atual") atual = acc.estoque_atual;
    else if (filtro.campo === "estoque_minimo") atual = acc.estoque_minimo;
    else if (filtro.campo === "saldo_vencido") atual = acc.saldo_vencido;
    else if (filtro.campo === "ativo") atual = acc.ativo;
    else if (filtro.campo === "situacao_estoque") atual = acc.situacao;
    if (!compararFiltro(atual, filtro.operador, filtro.valor)) {
      return false;
    }
  }
  return true;
}

function valorMetrica(
  nome: NomeMetricaAnalitica,
  acc: Acc,
  extra: { dias: number; faturamentoTotal: number; faturamentoAnterior: number | null }
): number | string | null {
  const qtdVendas = acc.vendaIds.size;
  const ticket = qtdVendas > 0 ? acc.faturamento / qtdVendas : 0;
  const margem = acc.faturamento - acc.custo_vendido;
  switch (nome) {
    case "faturamento":
    case "valor_comprado":
      return arredondarMoeda(acc.faturamento);
    case "quantidade_vendas":
    case "quantidade_compras":
      return qtdVendas;
    case "quantidade_vendida":
      return acc.quantidade_vendida;
    case "ticket_medio":
    case "ticket_cliente":
      return arredondarMoeda(ticket);
    case "desconto":
      return arredondarMoeda(acc.desconto);
    case "custo_vendido":
      return arredondarMoeda(acc.custo_vendido);
    case "margem_bruta":
      return arredondarMoeda(margem);
    case "margem_percentual":
      return acc.faturamento > 0 ? arredondarMoeda((margem / acc.faturamento) * 100) : null;
    case "estoque_atual":
      return acc.estoque_atual;
    case "estoque_minimo":
      return acc.estoque_minimo;
    case "valor_estoque_custo":
    case "valor_imobilizado":
      return arredondarMoeda(acc.valor_estoque_custo);
    case "valor_estoque_venda":
      return arredondarMoeda(acc.valor_estoque_venda);
    case "quantidade_produtos":
      return acc.quantidade_produtos;
    case "produtos_zerados":
      return acc.produtos_zerados;
    case "produtos_negativos":
      return acc.produtos_negativos;
    case "produtos_abaixo_minimo":
      return acc.produtos_abaixo_minimo;
    case "saldo_aberto":
      return arredondarMoeda(acc.saldo_aberto);
    case "saldo_vencido":
      return arredondarMoeda(acc.saldo_vencido);
    case "recebimentos":
      return arredondarMoeda(acc.recebimentos);
    case "quantidade_devedores":
      return acc.quantidade_devedores;
    case "ultima_compra":
      return acc.ultima_compra_ms || null;
    case "giro_estoque":
      return acc.estoque_atual > 0 ? arredondarMoeda(acc.quantidade_vendida / acc.estoque_atual) : null;
    case "cobertura_estoque_dias": {
      const media = extra.dias > 0 ? acc.quantidade_vendida / extra.dias : 0;
      return media > 0 ? arredondarMoeda(acc.estoque_atual / media) : null;
    }
    case "participacao_no_faturamento":
      return extra.faturamentoTotal > 0
        ? arredondarMoeda((acc.faturamento / extra.faturamentoTotal) * 100)
        : null;
    case "crescimento_periodo":
      return extra.faturamentoAnterior && extra.faturamentoAnterior !== 0
        ? arredondarMoeda(((acc.faturamento - extra.faturamentoAnterior) / extra.faturamentoAnterior) * 100)
        : extra.faturamentoAnterior === 0 && acc.faturamento > 0
          ? 100
          : extra.faturamentoAnterior == null
            ? null
            : 0;
    case "inadimplencia_cliente":
      return acc.saldo_aberto > 0
        ? arredondarMoeda((acc.saldo_vencido / acc.saldo_aberto) * 100)
        : null;
    default:
      return null;
  }
}

function numero(valor: number | string | null | undefined) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function calcularResultadoAnalitico(
  consulta: ConsultaAnalitica,
  fontes: FontesAnaliticas
): ResultadoAnalitico {
  const avisos = [...fontes.avisos];
  const dadosIncompletos = [...fontes.dadosIncompletos];
  const permitidas = consulta.metricas.filter((nome) => {
    const def = metricaAnalitica(nome);
    return def && !fontes.dominiosNegados.includes(def.dominio);
  });
  const atual = aplicarVendas(consulta, fontes, false);
  aplicarEstoque(consulta, fontes, atual);
  aplicarCarteira(consulta, fontes, atual, false);
  if (graoDaConsulta(consulta.dimensoes) === "empresa") {
    const acc = obter(atual, "empresa", "Empresa");
    if (fontes.caixa) {
      acc.nome = fontes.caixa.aberto ? "Caixa aberto" : "Caixa fechado";
    }
  }
  if (consulta.dimensoes[0] === "categoria") {
    for (const acc of atual.values()) {
      acc.nome = fontes.categorias.get(acc.id) ?? acc.nome;
    }
  }
  if (consulta.dimensoes[0] === "marca") {
    for (const acc of atual.values()) {
      acc.nome = fontes.marcas.get(acc.id) ?? acc.nome;
    }
  }
  if (consulta.dimensoes[0] === "cliente") {
    for (const acc of atual.values()) {
      acc.nome = fontes.clientes.get(acc.id)?.nome ?? acc.nome;
    }
  }
  if (consulta.dimensoes[0] === "vendedor") {
    for (const acc of atual.values()) {
      acc.nome = fontes.vendedores.get(acc.id) ?? (acc.id === "sem-vendedor" ? "Sem vendedor" : acc.nome);
    }
  }

  const filtradas = [...atual.values()].filter((acc) => passarFiltro(acc, consulta.filtros));
  const faturamentoTotal = filtradas.reduce((soma, acc) => soma + acc.faturamento, 0);

  let anterior = new Map<string, Acc>();
  if (consulta.comparacao) {
    anterior = aplicarVendas(consulta, fontes, true);
    aplicarCarteira(consulta, fontes, anterior, true);
    avisos.push("Estoque, carteira em aberto e caixa são posição atual, não série histórica.");
  }

  const extraBase = {
    dias: fontes.janela.dias,
    faturamentoTotal,
    faturamentoAnterior: null as number | null,
  };

  const linhasTodas: LinhaAnalitica[] = filtradas.map((acc) => {
    const accAnt = anterior.get(acc.id);
    extraBase.faturamentoAnterior = accAnt ? accAnt.faturamento : consulta.comparacao ? 0 : null;
    const valores: LinhaAnalitica["valores"] = {};
    const comparacao: LinhaAnalitica["comparacao"] = consulta.comparacao ? {} : undefined;
    for (const metrica of permitidas) {
      if (metrica === "entradas" && fontes.caixa) {
        valores[metrica] = acc.id === "empresa" ? arredondarMoeda(fontes.caixa.entradas) : null;
        continue;
      }
      if (metrica === "saidas" && fontes.caixa) {
        valores[metrica] = acc.id === "empresa" ? arredondarMoeda(fontes.caixa.saidas) : null;
        continue;
      }
      if (metrica === "saldo_esperado") {
        valores[metrica] =
          acc.id === "empresa" ? (fontes.caixa?.saldoAtual ?? null) : null;
        continue;
      }
      if (metrica === "produtos_revisao_fiscal") {
        valores[metrica] = acc.id === "empresa" ? fontes.fiscal?.revisao ?? 0 : null;
        continue;
      }
      if (metrica === "grupos_fiscais_incompativeis") {
        valores[metrica] = acc.id === "empresa" ? fontes.fiscal?.gruposIncompativeis ?? 0 : null;
        continue;
      }
      if (metrica === "notas_rejeitadas") {
        valores[metrica] = acc.id === "empresa" ? fontes.fiscal?.notasRejeitadas ?? 0 : null;
        continue;
      }
      valores[metrica] = valorMetrica(metrica, acc, extraBase);
      if (comparacao && accAnt && metricaAnalitica(metrica)?.dominio === "vendas") {
        const atualN = numero(valorMetrica(metrica, acc, extraBase));
        const anteriorN = numero(
          valorMetrica(metrica, accAnt, {
            ...extraBase,
            faturamentoTotal: accAnt.faturamento,
            faturamentoAnterior: null,
          })
        );
        const delta =
          atualN != null && anteriorN != null ? arredondarMoeda(atualN - anteriorN) : null;
        const deltaPercentual =
          atualN != null && anteriorN != null && anteriorN !== 0
            ? arredondarMoeda(((atualN - anteriorN) / anteriorN) * 100)
            : null;
        comparacao[metrica] = { atual: atualN, anterior: anteriorN, delta, deltaPercentual };
      }
    }
    if (!acc.custoInformado && permitidas.some((item) => ["custo_vendido", "margem_bruta", "margem_percentual"].includes(item))) {
      dadosIncompletos.push(`Custo de cadastro ausente em ${acc.nome}.`);
    }
    return { id: acc.id, nome: acc.nome, valores, comparacao };
  });

  const ordenacao = consulta.ordenacao;
  linhasTodas.sort((a, b) => {
    const metrica = ordenacao?.metrica ?? permitidas[0] ?? "faturamento";
    const av = numero(a.valores[metrica]) ?? 0;
    const bv = numero(b.valores[metrica]) ?? 0;
    return ordenacao?.direcao === "asc" ? av - bv : bv - av;
  });

  const linhas = linhasTodas.slice(0, consulta.limite);
  const resumo: ResultadoAnalitico["resumo"] = {};
  if (graoDaConsulta(consulta.dimensoes) === "empresa" && linhas[0]) {
    Object.assign(resumo, linhas[0].valores);
  } else {
    for (const metrica of permitidas) {
      const tipo = metricaAnalitica(metrica)?.tipo;
      if (tipo === "percentual" || tipo === "data") {
        continue;
      }
      resumo[metrica] = arredondarMoeda(
        filtradas.reduce((soma, acc) => {
          const valor = numero(valorMetrica(metrica, acc, extraBase));
          return soma + (valor ?? 0);
        }, 0)
      );
    }
    resumo.linhas = filtradas.length;
  }

  const grao = graoDaConsulta(consulta.dimensoes);
  const contexto: ContextoAnaliticoAssistente = {
    empresaId: fontes.empresaId,
    periodo: consulta.periodo,
    dimensoes: consulta.dimensoes,
    metricas: permitidas,
    entidadeTipo: grao,
    entidadeIds: linhas.map((item) => item.id).filter((id) => id !== "empresa"),
  };

  const unicosIncompletos = [...new Set(dadosIncompletos)].slice(0, 5);
  if (fontes.dominiosNegados.length && permitidas.length === 0) {
    avisos.push("Nenhuma métrica desta consulta pôde ser calculada com as permissões atuais.");
  }

  return {
    periodo: {
      rotulo: fontes.janela.rotulo,
      inicio: fontes.janela.inicio.toISOString(),
      fim: fontes.janela.fim.toISOString(),
    },
    comparacao: fontes.janelaAnterior
      ? {
          rotulo: fontes.janelaAnterior.rotulo,
          metricas: grao === "empresa" ? linhas[0]?.comparacao ?? {} : {},
        }
      : null,
    resumo,
    linhas: grao === "empresa" ? [] : linhas,
    avisos: [...new Set(avisos)],
    dadosIncompletos: unicosIncompletos,
    contexto,
  };
}
