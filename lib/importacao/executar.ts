import type { SupabaseClient } from "@supabase/supabase-js";

import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

import { avaliarStatusFiscalProduto } from "@/lib/fiscal/status-fiscal-produto";
import { payloadAtualizacaoFiscalProduto } from "@/lib/produtos/dados-fiscais-produto";
import { UNIDADE_MEDIDA_PADRAO } from "@/lib/produtos/unidades-medida";
import { normalizarChaveNome } from "@/lib/importacao/normalizadores";
import type {
  RelacionadoImportacao,
} from "@/lib/importacao/produtos";
import type {
  ConfiguracaoImportacao,
  LinhaRevisaoImportacao,
} from "@/lib/importacao/tipos";

type RelCache = Map<string, { id: string; nome: string }>;

async function garantirRelacionado(
  supabase: SupabaseClient,
  tabela: "categorias" | "marcas",
  empresaId: string,
  nome: string,
  existentes: RelacionadoImportacao[],
  cache: RelCache,
  modo: "criar" | "sem"
) {
  const chave = normalizarChaveNome(nome);
  if (!chave) {
    return null;
  }
  const cached = cache.get(chave);
  if (cached) {
    return cached.id;
  }
  const encontrado = existentes.find(
    (item) =>
      item.empresa_id === empresaId && normalizarChaveNome(item.nome) === chave
  );
  if (encontrado) {
    cache.set(chave, { id: encontrado.id, nome: encontrado.nome });
    return encontrado.id;
  }
  if (modo !== "criar") {
    return null;
  }

  const { data, error } = await supabase
    .from(tabela)
    .insert({ empresa_id: empresaId, nome: nome.trim(), ativo: true })
    .select("id, nome")
    .maybeSingle();

  if (error?.code === "23505") {
    const { data: existente } = await supabase
      .from(tabela)
      .select("id, nome")
      .eq("empresa_id", empresaId)
      .ilike("nome", nome.trim())
      .maybeSingle();
    if (existente) {
      cache.set(chave, existente);
      existentes.push({
        id: existente.id,
        empresa_id: empresaId,
        nome: existente.nome,
        ativo: true,
      });
      return existente.id;
    }
  }

  if (error || !data) {
    throw new Error(error?.message ?? `Não foi possível criar ${tabela}.`);
  }

  cache.set(chave, data);
  existentes.push({
    id: data.id,
    empresa_id: empresaId,
    nome: data.nome,
    ativo: true,
  });
  return data.id;
}

async function gravarFiscal(
  supabase: SupabaseClient,
  empresaId: string,
  produtoId: string,
  ncm: string | null
) {
  const ncmTexto = ncm ? String(ncm) : "";
  const status = avaliarStatusFiscalProduto({ ncm: ncmTexto, grupo: null });
  const payload = payloadAtualizacaoFiscalProduto(
    { ncm: ncmTexto, cest: "", origemProduto: "0" },
    status.ok
  );

  const { data, error } = await supabase
    .from("produtos_fiscal")
    .update(payload)
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Configuração fiscal do produto não encontrada nesta empresa.");
  }
}

async function gravarEstoque(
  supabase: SupabaseClient,
  empresaId: string,
  produtoId: string,
  quantidade: number,
  importacaoId: string
) {
  const { error } = await supabase.rpc("rpc_movimentar_estoque_produto", {
    p_empresa_id: empresaId,
    p_produto_id: produtoId,
    p_operacao: "AJUSTE",
    p_quantidade: quantidade,
    p_observacao: `Importação ${importacaoId}`,
  });

  if (error) {
    throw new Error(error.message);
  }

  await supabase
    .from("estoque_movimentacoes")
    .update({ origem: "IMPORTACAO" })
    .eq("empresa_id", empresaId)
    .eq("produto_id", produtoId)
    .eq("origem", "AJUSTE_MANUAL")
    .eq("observacao", `Importação ${importacaoId}`);
}

function patchSomenteMarcados(
  payload: Record<string, string | number | boolean | null>
) {
  const saida: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of Object.entries(payload)) {
    if (chave.endsWith("_nome") || chave === "ncm" || chave.startsWith("estoque")) {
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

export async function executarLinhasProdutos(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  perfil: string;
  config: ConfiguracaoImportacao;
  linhas: LinhaRevisaoImportacao[];
  categorias: RelacionadoImportacao[];
  marcas: RelacionadoImportacao[];
  importacaoId: string;
}) {
  const {
    supabase,
    empresaId,
    config,
    linhas,
    categorias,
    marcas,
    importacaoId,
  } = params;
  const cacheCat: RelCache = new Map();
  const cacheMarca: RelCache = new Map();
  let criados = 0;
  let atualizados = 0;
  const erros: Array<{ numero: number; erro: string; dados: Record<string, unknown> }> =
    [];

  const precisaEstoque = linhas.some(
    (linha) =>
      (linha.situacao === "criar" ||
        linha.situacao === "atualizar" ||
        linha.situacao === "aviso") &&
      !linha.ignorarEstoque &&
      linha.quantidadeEstoque != null &&
      Number(linha.quantidadeEstoque) !== Number(linha.estoqueAtualSistema ?? 0)
  );

  if (precisaEstoque) {
    try {
      await exigirPermissao({ modulo: "estoque", acao: "importar_estoque" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  for (const linha of linhas) {
    if (linha.situacao === "ignorado" || linha.situacao === "erro") {
      if (linha.situacao === "erro") {
        erros.push({
          numero: linha.numero,
          erro: linha.observacao,
          dados: linha.payload,
        });
      }
      continue;
    }

    try {
      let categoriaId: string | null | undefined;
      let marcaId: string | null | undefined;
      const categoriaNome = String(linha.payload.categoria_nome ?? "");
      const marcaNome = String(linha.payload.marca_nome ?? "");

      if ("categoria_nome" in linha.payload) {
        categoriaId = categoriaNome
          ? await garantirRelacionado(
              supabase,
              "categorias",
              empresaId,
              categoriaNome,
              categorias,
              cacheCat,
              config.regrasProdutos.categoriaAusente === "criar" ? "criar" : "sem"
            )
          : null;
      }

      if ("marca_nome" in linha.payload) {
        marcaId = marcaNome
          ? await garantirRelacionado(
              supabase,
              "marcas",
              empresaId,
              marcaNome,
              marcas,
              cacheMarca,
              config.regrasProdutos.marcaAusente === "criar" ? "criar" : "sem"
            )
          : null;
      }

      const patch = patchSomenteMarcados(linha.payload);
      if (categoriaId !== undefined) patch.categoria_id = categoriaId;
      if (marcaId !== undefined) patch.marca_id = marcaId;

      let produtoId = linha.existenteId;

      if (produtoId) {
        if (Object.keys(patch).length > 0) {
          const { data, error } = await supabase
            .from("produtos")
            .update(patch)
            .eq("id", produtoId)
            .eq("empresa_id", empresaId)
            .select("id")
            .maybeSingle();
          if (error) {
            throw new Error(error.message);
          }
          if (!data) {
            throw new Error("Produto não encontrado nesta empresa.");
          }
        } else {
          const { data } = await supabase
            .from("produtos")
            .select("id")
            .eq("id", produtoId)
            .eq("empresa_id", empresaId)
            .maybeSingle();
          if (!data) {
            throw new Error("Produto não encontrado nesta empresa.");
          }
        }
        atualizados += 1;
      } else {
        const gerarCodigo =
          config.regrasProdutos.gerarCodigoAutomatico && !patch.codigo;

        if (gerarCodigo) {
          const { data, error } = await supabase.rpc("rpc_cadastrar_produto", {
            p_empresa_id: empresaId,
            p_codigo: "",
            p_codigo_barras:
              patch.codigo_barras == null ? null : String(patch.codigo_barras),
            p_nome: String(patch.nome ?? ""),
            p_descricao: null,
            p_categoria_id: patch.categoria_id ?? null,
            p_marca_id: patch.marca_id ?? null,
            p_grupo_fiscal_id: null,
            p_unidade_medida: String(patch.unidade_medida ?? UNIDADE_MEDIDA_PADRAO),
            p_preco_custo: Number(patch.preco_custo ?? 0),
            p_preco_venda: Number(patch.preco_venda ?? 0),
            p_estoque_inicial: 0,
          });
          if (error) {
            throw new Error(error.message);
          }
          const registro = Array.isArray(data) ? data[0] : data;
          produtoId = registro?.produto_id ? String(registro.produto_id) : null;
        } else {
          const { data, error } = await supabase
            .from("produtos")
            .insert({
              empresa_id: empresaId,
              codigo: String(patch.codigo ?? ""),
              codigo_barras: patch.codigo_barras ?? null,
              nome: String(patch.nome ?? ""),
              descricao: null,
              categoria_id: patch.categoria_id ?? null,
              marca_id: patch.marca_id ?? null,
              unidade_medida: String(patch.unidade_medida ?? UNIDADE_MEDIDA_PADRAO),
              tipo_item: "00",
              preco_custo: Number(patch.preco_custo ?? 0),
              preco_venda: Number(patch.preco_venda ?? 0),
              ativo: true,
            })
            .select("id")
            .maybeSingle();
          if (error) {
            throw new Error(error.message);
          }
          produtoId = data?.id ?? null;
        }

        if (!produtoId) {
          throw new Error("Não foi possível criar o produto.");
        }
        criados += 1;
      }

      if ("ncm" in linha.payload && produtoId) {
        await gravarFiscal(
          supabase,
          empresaId,
          produtoId,
          linha.payload.ncm == null ? null : String(linha.payload.ncm)
        );
      }

      if (
        produtoId &&
        !linha.ignorarEstoque &&
        linha.quantidadeEstoque != null
      ) {
        const saldoAtual = linha.existenteId
          ? Number(linha.estoqueAtualSistema ?? 0)
          : 0;
        const saldoDesejado = Number(linha.quantidadeEstoque);
        if (saldoDesejado !== saldoAtual) {
          await gravarEstoque(
            supabase,
            empresaId,
            produtoId,
            saldoDesejado,
            importacaoId
          );
        }
      }
    } catch (error) {
      erros.push({
        numero: linha.numero,
        erro: error instanceof Error ? error.message : "Falha ao gravar a linha",
        dados: linha.payload,
      });
    }
  }

  return { criados, atualizados, erros };
}

export async function executarLinhasClientes(params: {
  supabase: SupabaseClient;
  empresaId: string;
  linhas: LinhaRevisaoImportacao[];
}) {
  const { supabase, empresaId, linhas } = params;
  let criados = 0;
  let atualizados = 0;
  const erros: Array<{ numero: number; erro: string; dados: Record<string, unknown> }> =
    [];

  for (const linha of linhas) {
    if (linha.situacao === "ignorado" || linha.situacao === "erro") {
      if (linha.situacao === "erro") {
        erros.push({
          numero: linha.numero,
          erro: linha.observacao,
          dados: linha.payload,
        });
      }
      continue;
    }

    try {
      if (linha.existenteId) {
        const { data, error } = await supabase
          .from("clientes")
          .update(linha.payload)
          .eq("id", linha.existenteId)
          .eq("empresa_id", empresaId)
          .select("id")
          .maybeSingle();
        if (error) {
          throw new Error(
            error.code === "23505"
              ? "Já existe um cliente com esse CPF/CNPJ."
              : error.message
          );
        }
        if (!data) {
          throw new Error("Cliente não encontrado nesta empresa.");
        }
        atualizados += 1;
      } else {
        const { error } = await supabase.from("clientes").insert({
          tipo_pessoa: linha.payload.tipo_pessoa ?? "F",
          nome: String(linha.payload.nome ?? ""),
          saldo_devedor: 0,
          limite_credito: Number(linha.payload.limite_credito ?? 0),
          consumidor_final:
            linha.payload.consumidor_final === undefined
              ? true
              : Boolean(linha.payload.consumidor_final),
          ativo: linha.payload.ativo === undefined ? true : Boolean(linha.payload.ativo),
          ...linha.payload,
          empresa_id: empresaId,
        });
        if (error) {
          throw new Error(
            error.code === "23505"
              ? "Já existe um cliente com esse CPF/CNPJ."
              : error.message
          );
        }
        criados += 1;
      }
    } catch (error) {
      erros.push({
        numero: linha.numero,
        erro: error instanceof Error ? error.message : "Falha ao gravar a linha",
        dados: linha.payload,
      });
    }
  }

  return { criados, atualizados, erros };
}
