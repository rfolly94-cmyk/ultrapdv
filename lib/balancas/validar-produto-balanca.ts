import { produtoElegivelBalanca } from "./elegivel";
import {
  departamentoEfetivoBalanca,
  departamentoPadraoDaConfiguracao,
} from "./departamento";
import { layoutToledoMgv7Implementado, validarItemToledoMgv7 } from "./adapters/toledo-mgv7";
import {
  ROTULO_STATUS_PRODUTO_BALANCA,
  type ConfiguracaoBalanca,
  type ProblemaCargaBalanca,
  type ProdutoElegivelBalanca,
  type ProdutoVinculadoBalanca,
  type ResumoValidacaoCargaBalanca,
  type StatusProdutoBalanca,
} from "./tipos";

export function configuracaoBalancaCompleta(
  config: Pick<
    ConfiguracaoBalanca,
    "nome" | "fabricante" | "layout" | "tipoIntegracao" | "ativo"
  > | null
) {
  if (!config) {
    return false;
  }

  return Boolean(
    config.ativo &&
      config.nome.trim() &&
      config.fabricante &&
      config.tipoIntegracao &&
      String(config.layout ?? "").trim()
  );
}

function pluDuplicadoNaEmpresa(
  produto: ProdutoElegivelBalanca,
  todos: ProdutoElegivelBalanca[]
) {
  const plu = String(produto.plu ?? "").trim();
  if (!plu) {
    return false;
  }

  return todos.some(
    (outro) =>
      outro.produtoId !== produto.produtoId &&
      outro.empresaId === produto.empresaId &&
      String(outro.plu ?? "").trim() === plu
  );
}

export function validarProdutoBalanca(
  produto: ProdutoElegivelBalanca,
  todos: ProdutoElegivelBalanca[],
  config: ConfiguracaoBalanca | null
): ProdutoVinculadoBalanca {
  const problemas: string[] = [];
  let status: StatusProdutoBalanca = "pronto";

  if (!produtoElegivelBalanca(produto.unidade)) {
    return {
      ...produto,
      enviarBalanca: false,
      status: "nao_vinculado",
      problemas: ["Somente produtos em KG entram na carga da balança."],
    };
  }

  if (!produto.enviarBalanca) {
    return {
      ...produto,
      status: "nao_vinculado",
      problemas: [],
    };
  }

  const plu = String(produto.plu ?? "").trim();
  const descricao = String(
    produto.descricaoBalanca ?? produto.nome ?? ""
  ).trim();
  const preco = Number(produto.precoVenda);

  if (!plu) {
    status = "plu_ausente";
    problemas.push("Informe o PLU/código da balança.");
  } else if (pluDuplicadoNaEmpresa(produto, todos)) {
    status = "plu_duplicado";
    problemas.push("Este PLU já está em outro produto da mesma empresa.");
  }

  if (!descricao) {
    if (status === "pronto") {
      status = "descricao_invalida";
    }
    problemas.push("Informe a descrição para balança.");
  }

  if (!Number.isFinite(preco) || preco <= 0) {
    if (status === "pronto") {
      status = "preco_invalido";
    }
    problemas.push("O preço de venda precisa ser maior que zero.");
  }

  if (
    config &&
    layoutToledoMgv7Implementado(String(config.layout ?? "").trim())
  ) {
    const departamentoEfetivo = departamentoEfetivoBalanca(
      produto.departamento,
      departamentoPadraoDaConfiguracao(config)
    );
    const problemasMgv7 = validarItemToledoMgv7({
      plu,
      descricao,
      preco,
      validadeDias:
        produto.validadeEtiquetaDias == null
          ? null
          : Number(produto.validadeEtiquetaDias),
      departamento: departamentoEfetivo.valor,
    });

    for (const problema of problemasMgv7) {
      if (problemas.includes(problema)) {
        continue;
      }
      problemas.push(problema);
      if (status !== "pronto") {
        continue;
      }
      if (problema.includes("PLU")) {
        status = "plu_invalido";
      } else if (problema.includes("departamento")) {
        status = "departamento_invalido";
      } else if (problema.includes("validade")) {
        status = "validade_invalida";
      } else if (problema.includes("preço") || problema.includes("Preço")) {
        status = "preco_invalido";
      } else {
        status = "descricao_invalida";
      }
    }
  }

  if (status === "pronto" && !configuracaoBalancaCompleta(config)) {
    status = "configuracao_incompleta";
    problemas.push(
      "Complete nome, fabricante, layout e tipo de integração da balança."
    );
  }

  return {
    ...produto,
    status,
    problemas,
  };
}

export function validarProdutosBalanca(
  produtos: ProdutoElegivelBalanca[],
  config: ConfiguracaoBalanca | null
): ProdutoVinculadoBalanca[] {
  const daEmpresa = produtos.filter(
    (produto) =>
      !config || produto.empresaId === config.empresaId
  );

  return daEmpresa.map((produto) =>
    validarProdutoBalanca(produto, daEmpresa, config)
  );
}

export function resumirValidacaoCarga(
  vinculados: ProdutoVinculadoBalanca[]
): ResumoValidacaoCargaBalanca {
  const problemas: ProblemaCargaBalanca[] = [];
  let validos = 0;
  let comErro = 0;

  for (const item of vinculados) {
    if (item.status === "nao_vinculado") {
      continue;
    }

    if (item.status === "pronto") {
      validos += 1;
      continue;
    }

    comErro += 1;
    problemas.push({
      produtoId: item.produtoId,
      codigo: item.codigo,
      nome: item.nome,
      plu: item.plu,
      status: item.status,
      detalhe:
        item.problemas[0] ?? ROTULO_STATUS_PRODUTO_BALANCA[item.status],
    });
  }

  return {
    encontrados: vinculados.length,
    validos,
    comErro,
    problemas,
  };
}

export type FiltroVinculoBalanca =
  | "todos"
  | "vinculados"
  | "nao_vinculados"
  | "com_erro";

function normalizarBusca(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function filtrarProdutosVinculados(
  itens: ProdutoVinculadoBalanca[],
  filtro: FiltroVinculoBalanca,
  busca = "",
  departamento: string | null = null,
  departamentoPadrao: string | null = null
) {
  const termo = normalizarBusca(busca);
  const depto = String(departamento ?? "").trim();

  return itens.filter((item) => {
    if (filtro === "vinculados" && !item.enviarBalanca) {
      return false;
    }
    if (filtro === "nao_vinculados" && item.enviarBalanca) {
      return false;
    }
    if (
      filtro === "com_erro" &&
      (item.status === "pronto" || item.status === "nao_vinculado")
    ) {
      return false;
    }
    if (depto) {
      const efetivo = departamentoEfetivoBalanca(
        item.departamento,
        departamentoPadrao
      );
      const proprio = String(item.departamento ?? "").trim();
      if (efetivo.valor !== depto && proprio !== depto) {
        return false;
      }
    }
    if (!termo) {
      return true;
    }

    return (
      normalizarBusca(item.nome).includes(termo) ||
      normalizarBusca(item.codigo).includes(termo) ||
      normalizarBusca(item.plu ?? "").includes(termo)
    );
  });
}
