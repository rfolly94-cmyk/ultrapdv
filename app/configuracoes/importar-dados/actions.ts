"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { classificarLinhasClientes } from "@/lib/importacao/clientes";
import {
  executarLinhasClientes,
  executarLinhasProdutos,
} from "@/lib/importacao/executar";
import { classificarLinhasProdutos, type RelacionadoImportacao } from "@/lib/importacao/produtos";
import {
  CAMPOS_CLIENTE,
  CAMPOS_PRODUTO,
  LIMITES_IMPORTACAO,
  type CampoCliente,
  type CampoProduto,
  type ConfiguracaoImportacao,
  type ErroHistoricoImportacao,
  type LinhaPlanilha,
  type ResultadoPreviaImportacao,
} from "@/lib/importacao/tipos";

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil, empresas ( nome_fantasia )")
    .eq("usuario_id", String(usuarioId))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  await exigirEmpresaOperacionalOuRedirecionar(String(vinculo.empresa_id));

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  return {
    supabase,
    empresaId: String(vinculo.empresa_id),
    usuarioId: String(usuarioId),
    perfil: String(vinculo.perfil ?? ""),
    empresaNome: String(empresa?.nome_fantasia ?? ""),
  };
}

async function carregarTabela<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: string,
  select: string,
  empresaId: string
) {
  const pagina = 1000;
  let inicio = 0;
  const todos: T[] = [];

  while (true) {
    const { data, error } = await supabase
      .from(tabela)
      .select(select)
      .eq("empresa_id", empresaId)
      .range(inicio, inicio + pagina - 1);

    if (error) {
      throw new Error(error.message);
    }

    const lote = (data ?? []) as T[];
    todos.push(...lote);
    if (lote.length < pagina) {
      break;
    }
    inicio += pagina;
  }

  return todos.filter((item) => {
    const registro = item as { empresa_id?: string };
    return registro.empresa_id === empresaId;
  });
}

function sanitizarConfig(config: ConfiguracaoImportacao): ConfiguracaoImportacao {
  const colunas = Array.isArray(config.colunas)
    ? config.colunas.map((coluna) => String(coluna))
    : [];
  const camposProduto = Array.isArray(config.camposProduto)
    ? config.camposProduto.filter((campo): campo is CampoProduto =>
        (CAMPOS_PRODUTO as readonly string[]).includes(campo)
      )
    : [];
  const camposCliente = Array.isArray(config.camposCliente)
    ? config.camposCliente.filter((campo): campo is CampoCliente =>
        (CAMPOS_CLIENTE as readonly string[]).includes(campo)
      )
    : [];
  const campos = config.tipo === "clientes" ? camposCliente : camposProduto;
  const mapeamento: Record<string, string | null> = {};
  for (const campo of campos) {
    const coluna = config.mapeamento?.[campo];
    mapeamento[campo] = coluna && colunas.includes(coluna) ? coluna : null;
  }

  return {
    tipo: config.tipo === "clientes" ? "clientes" : "produtos",
    nomeArquivo: String(config.nomeArquivo ?? "").slice(0, 255),
    aba: String(config.aba ?? ""),
    linhaCabecalho: Math.max(1, Number(config.linhaCabecalho) || 1),
    colunas,
    camposProduto,
    camposCliente,
    mapeamento,
    regrasProdutos: {
      identificador:
        config.regrasProdutos?.identificador === "ean" ? "ean" : "codigo",
      existente:
        config.regrasProdutos?.existente === "ignorar" ||
        config.regrasProdutos?.existente === "erro"
          ? config.regrasProdutos.existente
          : "atualizar",
      categoriaAusente:
        config.regrasProdutos?.categoriaAusente === "sem" ||
        config.regrasProdutos?.categoriaAusente === "erro"
          ? config.regrasProdutos.categoriaAusente
          : "criar",
      marcaAusente:
        config.regrasProdutos?.marcaAusente === "sem" ||
        config.regrasProdutos?.marcaAusente === "erro"
          ? config.regrasProdutos.marcaAusente
          : "criar",
      gerarCodigoAutomatico: Boolean(config.regrasProdutos?.gerarCodigoAutomatico),
      importarEstoque:
        camposProduto.includes("estoque_atual") &&
        Boolean(mapeamento.estoque_atual),
      colunaQuantidade:
        camposProduto.includes("estoque_atual") && mapeamento.estoque_atual
          ? mapeamento.estoque_atual
          : null,
      quantidadeInvalida:
        config.regrasProdutos?.quantidadeInvalida === "zero" ||
        config.regrasProdutos?.quantidadeInvalida === "ignorar_estoque"
          ? config.regrasProdutos.quantidadeInvalida
          : "erro",
    },
    regrasClientes: {
      identificador:
        config.regrasClientes?.identificador === "email" ||
        config.regrasClientes?.identificador === "telefone"
          ? config.regrasClientes.identificador
          : "cpf_cnpj",
      existente:
        config.regrasClientes?.existente === "ignorar" ||
        config.regrasClientes?.existente === "erro"
          ? config.regrasClientes.existente
          : "atualizar",
    },
  };
}

export async function previaImportacaoAction(
  configBruta: ConfiguracaoImportacao,
  linhas: LinhaPlanilha[]
): Promise<{ ok: true; previa: ResultadoPreviaImportacao } | { ok: false; erro: string }> {
  try {
    const { supabase, empresaId } = await getContexto();
    const config = sanitizarConfig(configBruta);

    if (!Array.isArray(linhas) || linhas.length > LIMITES_IMPORTACAO.maxLinhas) {
      return {
        ok: false,
        erro: `A planilha ultrapassa o limite de ${LIMITES_IMPORTACAO.maxLinhas.toLocaleString("pt-BR")} linhas.`,
      };
    }

    if (config.tipo === "clientes") {
      const clientes = await carregarTabela<{
        id: string;
        empresa_id: string;
        nome: string;
        cpf_cnpj: string | null;
        email: string | null;
        telefone: string | null;
      }>(
        supabase,
        "clientes",
        "id, empresa_id, nome, cpf_cnpj, email, telefone",
        empresaId
      );
      return {
        ok: true,
        previa: classificarLinhasClientes({
          empresaId,
          linhas,
          config,
          clientes,
        }),
      };
    }

    const [produtos, categorias, marcas, estoques] = await Promise.all([
      carregarTabela<{
        id: string;
        empresa_id: string;
        codigo: string;
        codigo_barras: string | null;
        nome: string;
      }>(
        supabase,
        "produtos",
        "id, empresa_id, codigo, codigo_barras, nome",
        empresaId
      ),
      carregarTabela<RelacionadoImportacao>(
        supabase,
        "categorias",
        "id, empresa_id, nome, ativo",
        empresaId
      ),
      carregarTabela<RelacionadoImportacao>(
        supabase,
        "marcas",
        "id, empresa_id, nome, ativo",
        empresaId
      ),
      carregarTabela<{
        produto_id: string;
        empresa_id: string;
        quantidade: number | string;
      }>(
        supabase,
        "estoque_atual",
        "produto_id, empresa_id, quantidade",
        empresaId
      ),
    ]);

    const saldoPorProduto = new Map<string, number>();
    for (const item of estoques) {
      if (item.empresa_id !== empresaId) {
        continue;
      }
      saldoPorProduto.set(item.produto_id, Number(item.quantidade) || 0);
    }

    return {
      ok: true,
      previa: classificarLinhasProdutos({
        empresaId,
        linhas,
        config,
        produtos: produtos.map((produto) => ({
          ...produto,
          quantidade_atual:
            produto.empresa_id === empresaId
              ? (saldoPorProduto.get(produto.id) ?? 0)
              : 0,
        })),
        categorias,
        marcas,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      erro: error instanceof Error ? error.message : "Falha ao revisar a importação.",
    };
  }
}

export async function confirmarImportacaoAction(
  configBruta: ConfiguracaoImportacao,
  linhas: LinhaPlanilha[]
): Promise<
  | {
      ok: true;
      importacaoId: string;
      criados: number;
      atualizados: number;
      ignorados: number;
      erros: number;
      empresaNome: string;
    }
  | { ok: false; erro: string }
> {
  const { supabase, empresaId, usuarioId, perfil, empresaNome } =
    await getContexto();

  try {
    await exigirPermissao({
      modulo: "importacao_dados",
      acao:
        configBruta.tipo === "clientes"
          ? "importar_clientes"
          : "importar_produtos",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return { ok: false, erro: error.message };
    }
    throw error;
  }
  const config = sanitizarConfig(configBruta);
  let importacaoId: string | null = null;

  try {
    const previa = await previaImportacaoAction(config, linhas);
    if (!previa.ok) {
      return previa;
    }

    const { data: importacao, error: erroInsert } = await supabase
      .from("importacoes_dados")
      .insert({
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: config.tipo,
        nome_arquivo: config.nomeArquivo || "planilha",
        status: "processando",
        total_linhas: previa.previa.resumo.total,
        configuracao: {
          campos:
            config.tipo === "produtos" ? config.camposProduto : config.camposCliente,
          mapeamento: config.mapeamento,
          regras:
            config.tipo === "produtos" ? config.regrasProdutos : config.regrasClientes,
        },
      })
      .select("id")
      .maybeSingle();

    if (erroInsert || !importacao) {
      return {
        ok: false,
        erro: erroInsert?.message ?? "Não foi possível iniciar a importação.",
      };
    }

    importacaoId = String(importacao.id);

    const resultado =
      config.tipo === "clientes"
        ? await executarLinhasClientes({
            supabase,
            empresaId,
            linhas: previa.previa.linhas,
          })
        : await executarLinhasProdutos({
            supabase,
            empresaId,
            usuarioId,
            perfil,
            config,
            linhas: previa.previa.linhas,
            categorias: await carregarTabela<RelacionadoImportacao>(
              supabase,
              "categorias",
              "id, empresa_id, nome, ativo",
              empresaId
            ),
            marcas: await carregarTabela<RelacionadoImportacao>(
              supabase,
              "marcas",
              "id, empresa_id, nome, ativo",
              empresaId
            ),
            importacaoId,
          });

    if (resultado.erros.length > 0) {
      await supabase.from("importacoes_dados_erros").insert(
        resultado.erros.map((item) => ({
          empresa_id: empresaId,
          importacao_id: importacaoId,
          numero_linha: item.numero,
          dados: item.dados,
          erro: item.erro,
        }))
      );
    }

    const ignorados = previa.previa.resumo.ignorados;
    await supabase
      .from("importacoes_dados")
      .update({
        status: "concluida",
        total_criados: resultado.criados,
        total_atualizados: resultado.atualizados,
        total_ignorados: ignorados,
        total_erros: resultado.erros.length,
        finalizado_em: new Date().toISOString(),
      })
      .eq("id", importacaoId)
      .eq("empresa_id", empresaId);

    revalidatePath("/configuracoes/importar-dados");
    revalidatePath("/produtos");
    revalidatePath("/estoque");
    revalidatePath("/clientes");
    revalidatePath("/pdv");

    return {
      ok: true,
      importacaoId,
      criados: resultado.criados,
      atualizados: resultado.atualizados,
      ignorados,
      erros: resultado.erros.length,
      empresaNome,
    };
  } catch (error) {
    if (importacaoId) {
      await supabase
        .from("importacoes_dados")
        .update({
          status: "falhou",
          finalizado_em: new Date().toISOString(),
        })
        .eq("id", importacaoId)
        .eq("empresa_id", empresaId);
    }
    return {
      ok: false,
      erro: error instanceof Error ? error.message : "Falha ao confirmar a importação.",
    };
  }
}

export async function errosImportacaoAction(
  importacaoId: string
): Promise<{ ok: true; erros: ErroHistoricoImportacao[] } | { ok: false; erro: string }> {
  try {
    const { supabase, empresaId } = await getContexto();
    const { data, error } = await supabase
      .from("importacoes_dados_erros")
      .select("id, numero_linha, erro, dados")
      .eq("empresa_id", empresaId)
      .eq("importacao_id", importacaoId)
      .order("numero_linha")
      .limit(200);

    if (error) {
      return { ok: false, erro: error.message };
    }

    return {
      ok: true,
      erros: (data ?? []).map((item) => ({
        id: String(item.id),
        numero_linha: Number(item.numero_linha),
        erro: String(item.erro),
        dados:
          item.dados && typeof item.dados === "object"
            ? (item.dados as Record<string, unknown>)
            : {},
      })),
    };
  } catch (error) {
    return {
      ok: false,
      erro: error instanceof Error ? error.message : "Falha ao carregar erros.",
    };
  }
}
