"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { produtoElegivelBalanca } from "@/lib/balancas/elegivel";
import { TAMANHO_MAX_DESCRICAO_BALANCA } from "@/lib/balancas/dados-produto";
import {
  departamentoInformado,
  departamentoNumericoBalanca,
} from "@/lib/balancas/departamento";
import { atribuirPluComRetry, precisaGerarPluVinculo } from "@/lib/balancas/plu";
import { exportarBalanca } from "@/lib/balancas/exportar-balanca";
import { layoutExportacaoImplementado } from "@/lib/balancas/adapters";
import {
  lerEtiquetaDoFormulario,
  normalizarConfiguracaoBalancaJson,
} from "@/lib/balancas/etiqueta";
import {
  lerSelecaoModeloDoFormulario,
  tiposIntegracaoDoModelo,
} from "@/lib/balancas/modelos";
import {
  FABRICANTES_BALANCA,
  MENSAGEM_EXPORTACAO_COM_INVALIDOS,
  TIPOS_INTEGRACAO_BALANCA,
  type ConfiguracaoBalanca,
  type FabricanteBalanca,
  type ProdutoElegivelBalanca,
  type ResumoValidacaoCargaBalanca,
  type TipoIntegracaoBalanca,
} from "@/lib/balancas/tipos";
import {
  resumirValidacaoCarga,
  validarProdutosBalanca,
} from "@/lib/balancas/validar-produto-balanca";
import {
  MENSAGEM_VINCULO_DUPLICADO,
  MENSAGEM_VINCULO_OUTRA_EMPRESA,
  vinculoMesmaEmpresa,
  type VinculoProdutoConfiguracao,
} from "@/lib/balancas/vinculo";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  MENSAGEM_BALANCA_MIGRATION,
  tabelaBalancaIndisponivel,
} from "@/lib/balancas/schema";
import { createClient } from "@/lib/supabase/server";

type Falha = { ok: false; erro: string };
type OkMensagem = { ok: true; mensagem?: string; id?: string };
type Resultado = OkMensagem | Falha;

function mensagemErroBalanca(error: { message?: string; code?: string }) {
  if (tabelaBalancaIndisponivel(error)) {
    return MENSAGEM_BALANCA_MIGRATION;
  }
  return error.message ?? "Não foi possível concluir a operação.";
}

function revalidarBalancas() {
  revalidatePath("/configuracoes/balancas");
  revalidatePath("/produtos");
}

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);
  await exigirEmpresaOperacionalOuRedirecionar(empresaId);

  return { supabase, empresaId };
}

async function exigirEdicao() {
  try {
    await exigirPermissao({
      modulo: "configuracoes",
      acao: "editar_empresa",
    });
    return null;
  } catch (error) {
    if (error instanceof ErroPermissao && error.status === 401) {
      redirect("/login");
    }
    if (error instanceof ErroPermissao) {
      return { ok: false as const, erro: error.message };
    }
    throw error;
  }
}

function fabricanteValido(valor: string): valor is FabricanteBalanca {
  return FABRICANTES_BALANCA.some((item) => item.value === valor);
}

function tipoIntegracaoValido(valor: string): valor is TipoIntegracaoBalanca {
  return TIPOS_INTEGRACAO_BALANCA.some((item) => item.value === valor);
}

function mapearConfiguracao(
  registro: Record<string, unknown>
): ConfiguracaoBalanca {
  const fabricante = String(registro.fabricante ?? "outro");
  const tipo = String(registro.tipo_integracao ?? "arquivo");

  return {
    id: String(registro.id),
    empresaId: String(registro.empresa_id),
    nome: String(registro.nome ?? ""),
    fabricante: fabricanteValido(fabricante) ? fabricante : "outro",
    modelo: registro.modelo ? String(registro.modelo) : null,
    layout: registro.layout ? String(registro.layout) : null,
    tipoIntegracao: tipoIntegracaoValido(tipo) ? tipo : "arquivo",
    configuracao: normalizarConfiguracaoBalancaJson(registro.configuracao),
    ativo: registro.ativo !== false,
  };
}

function lerDadosConfiguracao(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const fabricante = String(formData.get("fabricante") ?? "").trim();
  const tipoIntegracao = String(formData.get("tipo_integracao") ?? "").trim();
  const ativo = formData.get("ativo") === "1";

  if (!nome) {
    return { ok: false as const, erro: "Informe o nome da balança." };
  }
  if (!fabricanteValido(fabricante)) {
    return { ok: false as const, erro: "Selecione o fabricante." };
  }
  if (!tipoIntegracaoValido(tipoIntegracao)) {
    return { ok: false as const, erro: "Selecione o tipo de integração." };
  }

  const selecao = lerSelecaoModeloDoFormulario(formData, fabricante);
  const tiposModelo = tiposIntegracaoDoModelo(selecao.modelo);
  if (!tiposModelo.includes(tipoIntegracao)) {
    return {
      ok: false as const,
      erro: "Este tipo de integração não é compatível com o modelo.",
    };
  }

  const departamentoBruto = departamentoInformado(
    formData.get("departamento_padrao")
  );
  let departamentoPadrao: string | null = null;
  if (departamentoBruto) {
    departamentoPadrao = departamentoNumericoBalanca(departamentoBruto);
    if (!departamentoPadrao) {
      return {
        ok: false as const,
        erro: "Informe o departamento numérico da balança (01 a 99).",
      };
    }
  }

  return {
    ok: true as const,
    dados: {
      nome,
      fabricante,
      modelo: selecao.modeloNome,
      layout: selecao.layout,
      tipo_integracao: tipoIntegracao,
      configuracao: {
        etiqueta: lerEtiquetaDoFormulario(formData),
        modeloId: selecao.modeloId,
        formato: selecao.formato,
        etiquetaManual: selecao.etiquetaManual,
        departamentoPadrao,
      },
      ativo,
    },
  };
}

export async function listarConfiguracoesBalanca(): Promise<
  { ok: true; configs: ConfiguracaoBalanca[] } | Resultado
> {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirPermissao({ modulo: "configuracoes", acao: "acessar" });
  } catch (error) {
    if (error instanceof ErroPermissao && error.status === 401) {
      redirect("/login");
    }
    if (error instanceof ErroPermissao) {
      return { ok: false, erro: error.message };
    }
    throw error;
  }

  const { data, error } = await supabase
    .from("balancas_configuracoes")
    .select(
      "id, empresa_id, nome, fabricante, modelo, layout, tipo_integracao, configuracao, ativo, created_at, updated_at"
    )
    .eq("empresa_id", empresaId)
    .order("nome");

  if (error) {
    return { ok: false, erro: mensagemErroBalanca(error) };
  }

  return {
    ok: true,
    configs: (data ?? []).map((item) =>
      mapearConfiguracao(item as Record<string, unknown>)
    ),
  };
}

async function carregarConfiguracaoDaEmpresa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  configId: string
) {
  const { data, error } = await supabase
    .from("balancas_configuracoes")
    .select(
      "id, empresa_id, nome, fabricante, modelo, layout, tipo_integracao, configuracao, ativo"
    )
    .eq("empresa_id", empresaId)
    .eq("id", configId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapearConfiguracao(data as Record<string, unknown>);
}

export async function salvarConfiguracaoBalanca(
  formData: FormData
): Promise<Resultado & { id?: string }> {
  const negacao = await exigirEdicao();
  if (negacao) {
    return negacao;
  }

  const { supabase, empresaId } = await getContexto();
  const id = String(formData.get("id") ?? "").trim();
  const lido = lerDadosConfiguracao(formData);
  if (!lido.ok) {
    return lido;
  }

  if (id) {
    const atual = await carregarConfiguracaoDaEmpresa(
      supabase,
      empresaId,
      id
    );
    if (!atual) {
      return { ok: false, erro: "Balança não encontrada nesta empresa." };
    }

    const { error } = await supabase
      .from("balancas_configuracoes")
      .update(lido.dados)
      .eq("empresa_id", empresaId)
      .eq("id", id);

    if (error) {
      return { ok: false, erro: mensagemErroBalanca(error) };
    }

    revalidarBalancas();
    return { ok: true, mensagem: "Balança atualizada.", id };
  }

  const { data, error } = await supabase
    .from("balancas_configuracoes")
    .insert({
      empresa_id: empresaId,
      ...lido.dados,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      erro: error
        ? mensagemErroBalanca(error)
        : "Não foi possível salvar.",
    };
  }

  revalidarBalancas();
  return {
    ok: true,
    mensagem: "Balança cadastrada.",
    id: String(data.id),
  };
}

export async function excluirConfiguracaoBalanca(
  configId: string
): Promise<Resultado> {
  const negacao = await exigirEdicao();
  if (negacao) {
    return negacao;
  }

  const { supabase, empresaId } = await getContexto();
  const id = String(configId ?? "").trim();
  if (!id) {
    return { ok: false, erro: "Balança inválida." };
  }

  const atual = await carregarConfiguracaoDaEmpresa(
    supabase,
    empresaId,
    id
  );
  if (!atual) {
    return { ok: false, erro: "Balança não encontrada nesta empresa." };
  }

  const { error } = await supabase
    .from("balancas_configuracoes")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("id", id);

  if (error) {
    return { ok: false, erro: mensagemErroBalanca(error) };
  }

  revalidarBalancas();
  return { ok: true, mensagem: "Balança excluída." };
}

export async function listarProdutosVinculadosBalanca(configId: string) {
  const { supabase, empresaId } = await getContexto();

  try {
    await exigirPermissao({ modulo: "configuracoes", acao: "acessar" });
  } catch (error) {
    if (error instanceof ErroPermissao && error.status === 401) {
      redirect("/login");
    }
    if (error instanceof ErroPermissao) {
      return { ok: false as const, erro: error.message };
    }
    throw error;
  }

  const config = await carregarConfiguracaoDaEmpresa(
    supabase,
    empresaId,
    String(configId ?? "").trim()
  );
  if (!config) {
    return { ok: false as const, erro: "Balança não encontrada nesta empresa." };
  }

  const [
    { data: produtos, error: erroProdutos },
    { data: dadosGerais, error: erroDados },
    { data: vinculosConfig, error: erroVinculos },
  ] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, empresa_id, codigo, nome, unidade_medida, preco_venda, ativo")
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
      supabase
        .from("produtos_balancas")
        .select(
          "produto_id, plu, descricao_balanca, validade_etiqueta_dias, tara_padrao, departamento, mensagem"
        )
        .eq("empresa_id", empresaId),
      supabase
        .from("balancas_configuracoes_produtos")
        .select("produto_id, enviar_balanca, balanca_configuracao_id, empresa_id")
        .eq("empresa_id", empresaId)
        .eq("balanca_configuracao_id", config.id),
    ]);

  if (erroProdutos) {
    return { ok: false as const, erro: erroProdutos.message };
  }
  if (erroDados) {
    return { ok: false as const, erro: mensagemErroBalanca(erroDados) };
  }
  if (erroVinculos) {
    return { ok: false as const, erro: mensagemErroBalanca(erroVinculos) };
  }

  const dadosPorProduto = new Map(
    (dadosGerais ?? []).map((item) => [item.produto_id, item])
  );
  const vinculos: VinculoProdutoConfiguracao[] = (vinculosConfig ?? []).map(
    (item) => ({
      empresaId: String(item.empresa_id),
      configuracaoId: String(item.balanca_configuracao_id),
      produtoId: String(item.produto_id),
      enviarBalanca: item.enviar_balanca !== false,
    })
  );
  const vinculadoPorProduto = new Set(
    vinculos
      .filter((item) => item.enviarBalanca)
      .map((item) => item.produtoId)
  );

  const elegiveis: ProdutoElegivelBalanca[] = (produtos ?? [])
    .filter((produto) => produtoElegivelBalanca(produto.unidade_medida))
    .map((produto) => {
      const dados = dadosPorProduto.get(produto.id);
      return {
        produtoId: String(produto.id),
        empresaId: String(produto.empresa_id),
        codigo: String(produto.codigo ?? ""),
        nome: String(produto.nome ?? ""),
        unidade: String(produto.unidade_medida ?? ""),
        precoVenda: Number(produto.preco_venda ?? 0),
        configuracaoId: config.id,
        enviarBalanca: vinculadoPorProduto.has(String(produto.id)),
        plu: dados?.plu ? String(dados.plu) : null,
        descricaoBalanca: dados?.descricao_balanca
          ? String(dados.descricao_balanca)
          : String(produto.nome ?? ""),
        validadeEtiquetaDias:
          dados?.validade_etiqueta_dias == null
            ? null
            : Number(dados.validade_etiqueta_dias),
        taraPadrao:
          dados?.tara_padrao == null ? null : Number(dados.tara_padrao),
        departamento: dados?.departamento ? String(dados.departamento) : null,
        mensagem: dados?.mensagem ? String(dados.mensagem) : null,
      };
    });

  for (const item of elegiveis) {
    if (
      !precisaGerarPluVinculo({
        vinculado: item.enviarBalanca,
        plu: item.plu,
      })
    ) {
      continue;
    }

    const plu = await garantirPluAoVincular({
      supabase,
      empresaId,
      produtoId: item.produtoId,
      nomeProduto: item.nome,
    });
    if (plu.ok) {
      item.plu = plu.plu;
    }
  }

  const vinculados = validarProdutosBalanca(elegiveis, config);
  const paraExportar = vinculados.filter((item) => item.enviarBalanca);

  return {
    ok: true as const,
    config,
    vinculados,
    resumo: resumirValidacaoCarga(vinculados),
    resumoExportacao: resumirValidacaoCarga(paraExportar),
  };
}

async function garantirPluAoVincular(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  produtoId: string;
  nomeProduto: string;
}) {
  const descricaoPadrao = params.nomeProduto.trim().slice(
    0,
    TAMANHO_MAX_DESCRICAO_BALANCA
  );

  return atribuirPluComRetry({
    lerPluAtual: async () => {
      const { data, error } = await params.supabase
        .from("produtos_balancas")
        .select("plu")
        .eq("empresa_id", params.empresaId)
        .eq("produto_id", params.produtoId)
        .maybeSingle();

      if (error) {
        throw new Error(mensagemErroBalanca(error));
      }
      const plu = String(data?.plu ?? "").trim();
      return plu || null;
    },
    listarPlusDaEmpresa: async () => {
      const { data, error } = await params.supabase
        .from("produtos_balancas")
        .select("plu")
        .eq("empresa_id", params.empresaId);

      if (error) {
        throw new Error(mensagemErroBalanca(error));
      }

      return (data ?? [])
        .map((item) => String(item.plu ?? "").trim())
        .filter(Boolean);
    },
    gravarNovoPlu: async (plu) => {
      const { data: atual, error: erroLeitura } = await params.supabase
        .from("produtos_balancas")
        .select("produto_id")
        .eq("empresa_id", params.empresaId)
        .eq("produto_id", params.produtoId)
        .maybeSingle();

      if (erroLeitura) {
        throw new Error(mensagemErroBalanca(erroLeitura));
      }

      const { error } = atual
        ? await params.supabase
            .from("produtos_balancas")
            .update({ plu })
            .eq("empresa_id", params.empresaId)
            .eq("produto_id", params.produtoId)
        : await params.supabase.from("produtos_balancas").insert({
            empresa_id: params.empresaId,
            produto_id: params.produtoId,
            plu,
            descricao_balanca: descricaoPadrao || null,
          });

      if (!error) {
        return "ok" as const;
      }
      if (error.code === "23505") {
        return "colisao" as const;
      }
      throw new Error(mensagemErroBalanca(error));
    },
  });
}

export async function definirVinculoProdutoBalanca(input: {
  configId: string;
  produtoId: string;
  vinculado: boolean;
}): Promise<Resultado> {
  const negacao = await exigirEdicao();
  if (negacao) {
    return negacao;
  }

  const { supabase, empresaId } = await getContexto();
  const configId = String(input.configId ?? "").trim();
  const produtoId = String(input.produtoId ?? "").trim();

  const config = await carregarConfiguracaoDaEmpresa(
    supabase,
    empresaId,
    configId
  );
  if (!config) {
    return { ok: false, erro: "Balança não encontrada nesta empresa." };
  }

  const { data: produto, error: erroProduto } = await supabase
    .from("produtos")
    .select("id, empresa_id, unidade_medida, nome")
    .eq("empresa_id", empresaId)
    .eq("id", produtoId)
    .maybeSingle();

  if (erroProduto) {
    return { ok: false, erro: erroProduto.message };
  }
  if (!produto) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }
  if (!produtoElegivelBalanca(produto.unidade_medida)) {
    return {
      ok: false,
      erro: "Somente produtos em KG podem ser vinculados à balança.",
    };
  }
  if (
    !vinculoMesmaEmpresa({
      empresaIdSessao: empresaId,
      empresaIdConfig: config.empresaId,
      empresaIdProduto: String(produto.empresa_id),
    })
  ) {
    return { ok: false, erro: MENSAGEM_VINCULO_OUTRA_EMPRESA };
  }

  if (input.vinculado) {
    const plu = await garantirPluAoVincular({
      supabase,
      empresaId,
      produtoId,
      nomeProduto: String(produto.nome ?? ""),
    });
    if (!plu.ok) {
      return plu;
    }

    const { error } = await supabase
      .from("balancas_configuracoes_produtos")
      .upsert(
        {
          empresa_id: empresaId,
          balanca_configuracao_id: config.id,
          produto_id: produtoId,
          enviar_balanca: true,
        },
        { onConflict: "balanca_configuracao_id,produto_id" }
      );

    if (error) {
      if (error.code === "23505") {
        return { ok: false, erro: MENSAGEM_VINCULO_DUPLICADO };
      }
      return { ok: false, erro: mensagemErroBalanca(error) };
    }
  } else {
    const { error } = await supabase
      .from("balancas_configuracoes_produtos")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("balanca_configuracao_id", config.id)
      .eq("produto_id", produtoId);

    if (error) {
      return { ok: false, erro: mensagemErroBalanca(error) };
    }
  }

  revalidarBalancas();
  return {
    ok: true,
    mensagem: input.vinculado
      ? "Produto vinculado a esta balança."
      : "Produto desvinculado desta balança.",
  };
}

export async function validarExportacaoBalanca(configId: string): Promise<
  | {
      ok: true;
      resumo: ResumoValidacaoCargaBalanca;
      layoutImplementado: boolean;
    }
  | Resultado
> {
  const carga = await listarProdutosVinculadosBalanca(configId);
  if (!carga.ok) {
    return carga;
  }

  return {
    ok: true,
    resumo: carga.resumoExportacao,
    layoutImplementado: layoutExportacaoImplementado(
      carga.config.fabricante,
      carga.config.layout
    ),
  };
}

export async function exportarCargaBalanca(input: {
  configId: string;
  somenteValidos: boolean;
}): Promise<
  | {
      ok: true;
      nomeArquivo: string;
      conteudo: string;
      mime: string;
      resumo: ResumoValidacaoCargaBalanca;
    }
  | Falha
> {
  const negacao = await exigirEdicao();
  if (negacao) {
    return negacao;
  }

  const carga = await listarProdutosVinculadosBalanca(input.configId);
  if (!carga.ok) {
    return carga;
  }

  if (carga.resumoExportacao.comErro > 0 && !input.somenteValidos) {
    return { ok: false, erro: MENSAGEM_EXPORTACAO_COM_INVALIDOS };
  }

  const arquivo = exportarBalanca({
    config: carga.config,
    vinculados: carga.vinculados.filter((item) => item.enviarBalanca),
    somenteValidos: input.somenteValidos,
  });

  if (!arquivo.ok) {
    return arquivo;
  }

  return {
    ...arquivo,
    resumo: carga.resumoExportacao,
  };
}
