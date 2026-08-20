import { MENSAGEM_NCM_INVALIDO } from "@/lib/produtos/dados-fiscais-produto";
import { UNIDADE_MEDIDA_PADRAO } from "@/lib/produtos/unidades-medida";
import {
  calcularAjusteEstoque,
  formatarAjusteEstoque,
  formatarQuantidadeEstoque,
  normalizarChaveNome,
  normalizarEan,
  normalizarNcm,
  normalizarUnidadeImportacao,
  parseMonetario,
  quantidadeEhInvalida,
  textoCelula,
} from "@/lib/importacao/normalizadores";
import type {
  CampoProduto,
  ConfiguracaoImportacao,
  LinhaPlanilha,
  LinhaRevisaoImportacao,
  ResumoImportacao,
  ResultadoPreviaImportacao,
} from "@/lib/importacao/tipos";

export type ProdutoExistenteImportacao = {
  id: string;
  empresa_id: string;
  codigo: string;
  codigo_barras: string | null;
  nome: string;
  quantidade_atual?: number;
};

export type RelacionadoImportacao = {
  id: string;
  empresa_id: string;
  nome: string;
  ativo: boolean;
};

function valorMapeado(
  linha: LinhaPlanilha,
  mapeamento: Record<string, string | null>,
  campo: string
) {
  const coluna = mapeamento[campo];
  if (!coluna) {
    return "";
  }
  return textoCelula(linha.valores[coluna]);
}

function campoMarcado(campos: CampoProduto[], campo: CampoProduto) {
  return campos.includes(campo);
}

export function detectarDuplicadosPlanilha(
  linhas: LinhaPlanilha[],
  mapeamento: Record<string, string | null>,
  campo: "codigo" | "ean"
) {
  const vistos = new Map<string, number>();
  const duplicadas = new Map<number, string>();

  for (const linha of linhas) {
    const valor =
      campo === "ean"
        ? normalizarEan(valorMapeado(linha, mapeamento, "ean"))
        : textoCelula(valorMapeado(linha, mapeamento, "codigo"));
    if (!valor) {
      continue;
    }
    const chave = campo === "ean" ? valor : valor;
    const anterior = vistos.get(chave);
    if (anterior) {
      duplicadas.set(
        linha.numero,
        campo === "ean"
          ? "EAN duplicado dentro da planilha"
          : "Código duplicado dentro da planilha"
      );
    } else {
      vistos.set(chave, linha.numero);
    }
  }

  return duplicadas;
}

function localizarRelacionado(
  nome: string,
  itens: RelacionadoImportacao[],
  empresaId: string
) {
  const chave = normalizarChaveNome(nome);
  if (!chave) {
    return null;
  }
  return (
    itens.find(
      (item) =>
        item.empresa_id === empresaId &&
        normalizarChaveNome(item.nome) === chave
    ) ?? null
  );
}

export function classificarLinhasProdutos(params: {
  empresaId: string;
  linhas: LinhaPlanilha[];
  config: ConfiguracaoImportacao;
  produtos: ProdutoExistenteImportacao[];
  categorias: RelacionadoImportacao[];
  marcas: RelacionadoImportacao[];
}): ResultadoPreviaImportacao {
  const { empresaId, linhas, config, produtos, categorias, marcas } = params;
  const campos = config.camposProduto;
  const map = config.mapeamento;
  const regras = config.regrasProdutos;

  const porCodigo = new Map<string, ProdutoExistenteImportacao>();
  const porEan = new Map<string, ProdutoExistenteImportacao>();
  for (const produto of produtos) {
    if (produto.empresa_id !== empresaId) {
      continue;
    }
    porCodigo.set(produto.codigo.trim(), produto);
    const ean = normalizarEan(produto.codigo_barras);
    if (ean) {
      porEan.set(ean, produto);
    }
  }

  const dupCodigo = campoMarcado(campos, "codigo")
    ? detectarDuplicadosPlanilha(linhas, map, "codigo")
    : new Map<number, string>();
  const dupEan = campoMarcado(campos, "ean")
    ? detectarDuplicadosPlanilha(linhas, map, "ean")
    : new Map<number, string>();

  const revisao: LinhaRevisaoImportacao[] = [];

  for (const linha of linhas) {
    const codigo = campoMarcado(campos, "codigo")
      ? textoCelula(valorMapeado(linha, map, "codigo"))
      : "";
    const ean = campoMarcado(campos, "ean")
      ? normalizarEan(valorMapeado(linha, map, "ean"))
      : "";
    const nome = campoMarcado(campos, "nome")
      ? textoCelula(valorMapeado(linha, map, "nome"))
      : "";
    const precoCusto = campoMarcado(campos, "preco_custo")
      ? parseMonetario(valorMapeado(linha, map, "preco_custo"))
      : null;
    const precoVenda = campoMarcado(campos, "preco_venda")
      ? parseMonetario(valorMapeado(linha, map, "preco_venda"))
      : null;
    const ncm = campoMarcado(campos, "ncm")
      ? normalizarNcm(valorMapeado(linha, map, "ncm"))
      : "";
    const unidadeBruta = campoMarcado(campos, "unidade")
      ? valorMapeado(linha, map, "unidade")
      : "";
    const unidade = campoMarcado(campos, "unidade")
      ? normalizarUnidadeImportacao(unidadeBruta)
      : UNIDADE_MEDIDA_PADRAO;
    const categoriaNome = campoMarcado(campos, "categoria")
      ? textoCelula(valorMapeado(linha, map, "categoria"))
      : "";
    const marcaNome = campoMarcado(campos, "marca")
      ? textoCelula(valorMapeado(linha, map, "marca"))
      : "";

    const selecionadosVazios = campos.every((campo) => {
      if (campo === "preco_custo") return precoCusto === null;
      if (campo === "preco_venda") return precoVenda === null;
      if (campo === "codigo") return !codigo;
      if (campo === "ean") return !ean;
      if (campo === "nome") return !nome;
      if (campo === "ncm") return !ncm;
      if (campo === "unidade") return !textoCelula(unidadeBruta);
      if (campo === "categoria") return !categoriaNome;
      if (campo === "marca") return !marcaNome;
      if (campo === "estoque_atual") {
        return !textoCelula(valorMapeado(linha, map, "estoque_atual"));
      }
      return true;
    });

    if (selecionadosVazios) {
      revisao.push({
        numero: linha.numero,
        situacao: "ignorado",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Linha sem dados suficientes nos campos selecionados",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    const dup =
      dupCodigo.get(linha.numero) || dupEan.get(linha.numero) || "";
    if (dup) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: precoVenda == null ? "" : String(precoVenda),
        observacao: dup,
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (campoMarcado(campos, "nome") && nome && nome.length < 2) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Informe o nome do produto.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (campoMarcado(campos, "preco_custo") && valorMapeado(linha, map, "preco_custo") && precoCusto === null) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Preço de custo inválido",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (campoMarcado(campos, "preco_venda") && valorMapeado(linha, map, "preco_venda") && precoVenda === null) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Preço de venda inválido",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (
      (precoCusto != null && precoCusto < 0) ||
      (precoVenda != null && precoVenda < 0)
    ) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Os preços não podem ser negativos.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (campoMarcado(campos, "ncm") && ncm && ncm.length !== 8) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: precoVenda == null ? "" : String(precoVenda),
        observacao: MENSAGEM_NCM_INVALIDO,
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (campoMarcado(campos, "unidade") && textoCelula(unidadeBruta) && !unidade) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo,
        descricao: nome,
        venda: "",
        observacao: "Unidade de medida inválida",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    let existente: ProdutoExistenteImportacao | null = null;
    if (regras.identificador === "codigo" && campoMarcado(campos, "codigo") && codigo) {
      existente = porCodigo.get(codigo) ?? null;
    } else if (regras.identificador === "ean" && campoMarcado(campos, "ean") && ean) {
      existente = porEan.get(ean) ?? null;
    }

    if (existente && existente.empresa_id !== empresaId) {
      existente = null;
    }

    if (existente && regras.existente === "ignorar") {
      revisao.push({
        numero: linha.numero,
        situacao: "ignorado",
        codigo: existente.codigo,
        descricao: nome || existente.nome,
        venda: precoVenda == null ? "" : String(precoVenda),
        observacao: "Produto já cadastrado — ignorado",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: existente.id,
      });
      continue;
    }

    if (existente && regras.existente === "erro") {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: existente.codigo,
        descricao: nome || existente.nome,
        venda: precoVenda == null ? "" : String(precoVenda),
        observacao: "Produto já cadastrado",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: existente.id,
      });
      continue;
    }

    if (!existente) {
      const temCodigo = Boolean(codigo) || regras.gerarCodigoAutomatico;
      const temNome = campoMarcado(campos, "nome") && nome.length >= 2;
      if (!temCodigo || !temNome) {
        revisao.push({
          numero: linha.numero,
          situacao: "erro",
          codigo,
          descricao: nome,
          venda: precoVenda == null ? "" : String(precoVenda),
          observacao: !temNome
            ? "Produto novo precisa de Descrição/Nome"
            : "Produto novo precisa de código ou geração automática",
          payload: {},
          quantidadeEstoque: null,
          ignorarEstoque: true,
          existenteId: null,
        });
        continue;
      }
    }

    let observacaoCategoria = "";
    if (campoMarcado(campos, "categoria") && categoriaNome) {
      const encontrada = localizarRelacionado(
        categoriaNome,
        categorias,
        empresaId
      );
      if (!encontrada) {
        if (regras.categoriaAusente === "erro") {
          revisao.push({
            numero: linha.numero,
            situacao: "erro",
            codigo,
            descricao: nome,
            venda: precoVenda == null ? "" : String(precoVenda),
            observacao: `Categoria não encontrada: ${categoriaNome}`,
            payload: {},
            quantidadeEstoque: null,
            ignorarEstoque: true,
            existenteId: existente?.id ?? null,
          });
          continue;
        }
        observacaoCategoria =
          regras.categoriaAusente === "criar"
            ? `Categoria será criada: ${categoriaNome}`
            : "Produto sem categoria";
      }
    }

    let observacaoMarca = "";
    if (campoMarcado(campos, "marca") && marcaNome) {
      const encontrada = localizarRelacionado(marcaNome, marcas, empresaId);
      if (!encontrada) {
        if (regras.marcaAusente === "erro") {
          revisao.push({
            numero: linha.numero,
            situacao: "erro",
            codigo,
            descricao: nome,
            venda: precoVenda == null ? "" : String(precoVenda),
            observacao: `Marca não encontrada: ${marcaNome}`,
            payload: {},
            quantidadeEstoque: null,
            ignorarEstoque: true,
            existenteId: existente?.id ?? null,
          });
          continue;
        }
        observacaoMarca =
          regras.marcaAusente === "criar"
            ? `Marca será criada: ${marcaNome}`
            : "Produto sem marca";
      }
    }

    let quantidadeEstoque: number | null = null;
    let ignorarEstoque = !campoMarcado(campos, "estoque_atual") || !map.estoque_atual;
    let avisoQtd = "";
    let detalheEstoque = "";
    const estoqueSistema = existente ? Number(existente.quantidade_atual ?? 0) || 0 : 0;
    let estoquePlanilha: number | null = null;
    let ajusteEstoque: number | null = null;
    let estoqueAposImportacao: number | null = null;

    if (!ignorarEstoque) {
      const bruto = valorMapeado(linha, map, "estoque_atual");
      const qtd = quantidadeEhInvalida(bruto);
      if (qtd.vazio) {
        estoquePlanilha = 0;
      } else if (qtd.invalida) {
        if (regras.quantidadeInvalida === "erro") {
          revisao.push({
            numero: linha.numero,
            situacao: "erro",
            codigo,
            descricao: nome,
            venda: precoVenda == null ? "" : String(precoVenda),
            observacao: "Quantidade inválida",
            payload: {},
            quantidadeEstoque: null,
            ignorarEstoque: true,
            existenteId: existente?.id ?? null,
          });
          continue;
        }
        if (regras.quantidadeInvalida === "zero") {
          estoquePlanilha = 0;
          avisoQtd = "Quantidade inválida considerada zero";
        } else {
          ignorarEstoque = true;
          avisoQtd = "Estoque desta linha será ignorado";
        }
      } else {
        estoquePlanilha = qtd.quantidade;
      }

      if (!ignorarEstoque && estoquePlanilha != null) {
        const calculo = calcularAjusteEstoque(estoqueSistema, estoquePlanilha);
        quantidadeEstoque = calculo.estoqueApos;
        ajusteEstoque = calculo.ajuste;
        estoqueAposImportacao = calculo.estoqueApos;
        detalheEstoque = [
          `Estoque atual: ${formatarQuantidadeEstoque(calculo.estoqueSistema)}`,
          `Estoque da planilha: ${formatarQuantidadeEstoque(calculo.estoquePlanilha)}`,
          `Ajuste: ${formatarAjusteEstoque(calculo.ajuste)}`,
          `Estoque após importação: ${formatarQuantidadeEstoque(calculo.estoqueApos)}`,
        ].join(" · ");
      }
    }

    const payload: Record<string, string | number | boolean | null> = {};
    if (campoMarcado(campos, "codigo") && codigo) payload.codigo = codigo;
    if (campoMarcado(campos, "ean") && ean) payload.codigo_barras = ean;
    if (campoMarcado(campos, "nome") && nome) payload.nome = nome;
    if (campoMarcado(campos, "preco_custo") && precoCusto != null) {
      payload.preco_custo = precoCusto;
    }
    if (campoMarcado(campos, "preco_venda") && precoVenda != null) {
      payload.preco_venda = precoVenda;
    }
    if (campoMarcado(campos, "ncm") && ncm) payload.ncm = ncm;
    if (campoMarcado(campos, "unidade") && textoCelula(unidadeBruta) && unidade) {
      payload.unidade_medida = unidade;
    } else if (campoMarcado(campos, "unidade") && !existente) {
      payload.unidade_medida = UNIDADE_MEDIDA_PADRAO;
    }
    if (campoMarcado(campos, "categoria") && categoriaNome) {
      payload.categoria_nome = categoriaNome;
    }
    if (campoMarcado(campos, "marca") && marcaNome) {
      payload.marca_nome = marcaNome;
    }

    const avisos = [observacaoCategoria, observacaoMarca, avisoQtd].filter(Boolean);
    const observacao = [avisos.join(" · "), detalheEstoque]
      .filter(Boolean)
      .join(" · ") || (existente ? "Será atualizado" : "Será criado");
    revisao.push({
      numero: linha.numero,
      situacao: existente
        ? avisos.length
          ? "aviso"
          : "atualizar"
        : avisos.length
          ? "aviso"
          : "criar",
      codigo: codigo || existente?.codigo || "",
      descricao: nome || existente?.nome || "",
      venda: precoVenda == null ? "" : String(precoVenda),
      observacao,
      payload,
      quantidadeEstoque: ignorarEstoque ? null : quantidadeEstoque,
      ignorarEstoque,
      existenteId: existente?.id ?? null,
      estoqueAtualSistema: ignorarEstoque ? null : estoqueSistema,
      estoquePlanilha: ignorarEstoque ? null : estoquePlanilha,
      ajusteEstoque: ignorarEstoque ? null : ajusteEstoque,
      estoqueAposImportacao: ignorarEstoque ? null : estoqueAposImportacao,
    });
  }

  const resumo = resumirLinhas(revisao);
  return { resumo, linhas: revisao };
}

export function resumirLinhas(linhas: LinhaRevisaoImportacao[]): ResumoImportacao {
  return linhas.reduce(
    (acc, linha) => {
      acc.total += 1;
      if (linha.situacao === "criar") acc.criar += 1;
      else if (linha.situacao === "atualizar") acc.atualizar += 1;
      else if (linha.situacao === "aviso") {
        acc.avisos += 1;
        if (linha.existenteId) acc.atualizar += 1;
        else acc.criar += 1;
      } else if (linha.situacao === "ignorado") acc.ignorados += 1;
      else acc.erros += 1;
      return acc;
    },
    { total: 0, criar: 0, atualizar: 0, ignorados: 0, erros: 0, avisos: 0 }
  );
}
