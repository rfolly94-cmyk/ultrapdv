import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { montarItemDevolucaoFornecedor } from "@/lib/fiscal/entrada/montar-item-devolucao";
import {
  COLUNAS_GRUPO_FISCAL_DEVOLUCAO,
  grupoFiscalDaEmpresaAtiva,
  grupoFiscalIdParaDevolucaoFornecedor,
  snapshotFiscalDevolucaoCongelado,
} from "@/lib/fiscal/entrada/resolver-grupo-fiscal-devolucao";
import {
  parseEmitenteNfeEntrada,
} from "@/lib/fiscal/entrada/parse-xml-nfe";
import { verificarDevolucaoFornecedor } from "@/lib/fiscal/entrada/verificar-devolucao";
import { devolucaoPodeEmitir } from "@/lib/fiscal/entrada/devolucao-status";
import {
  aplicarValorTotalNotaGeranet,
} from "@/lib/fiscal/geranet/diagnostico-total-nota";
import {
  avaliarBloqueioRascunhoFiscal,
  carregarEmissaoPorChaveIdempotencia,
  claimTentativaEmissaoFiscal,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
  snapshotItensDaTransmissao,
} from "@/lib/fiscal/emissao-tentativas";
import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  classificarRespostaEmitir,
  historicoErroTecnico,
  mensagemResultadoRemotoNaoConclusivo,
  MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
  persistirClassificacaoNaoAutorizada,
} from "@/lib/fiscal/geranet/classificar-emissao";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";
import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  montarDocumentosReferenciados,
  notaFiscalReferenciaGeranet,
  textoAutomaticoDocumentosReferenciados,
} from "@/lib/fiscal/nfe55/documentos-referenciados";
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";
import { mapearTransporteParaGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import { responsavelTecnicoDoCadastroFiscal } from "@/lib/fiscal/nfe55/responsavel-tecnico";
import {
  MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import { assertIdentidadeFiscalNfe } from "@/lib/fiscal/operacoes/resolver-natureza";
import { escolherNaturezaParaDevolucaoFornecedor } from "@/lib/fiscal/operacoes/resolver-natureza";
import { normalizarRegrasCfopDaEmpresaAtiva } from "@/lib/fiscal/operacoes/resolver-cfop";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function erro(
  mensagem: string,
  status = 422,
  extra?: Record<string, unknown>
) {
  return json({ ok: false, erro: mensagem, ...(extra ?? {}) }, status);
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function chaveIdempotenciaDevolucao(devolucaoId: string) {
  const bytes = createHash("sha256")
    .update(`ultrapdv:nfe55:devolucao-fornecedor:${devolucaoId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims();
    if (authError || !claimsData?.claims?.sub) {
      return erro("Não autenticado.", 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (!vinculo) {
      return erro("Empresa ativa não encontrada.", 403);
    }

    try {
      await exigirPermissao({ modulo: "fiscal", acao: "emitir_nfe" });
      await exigirEmpresaOperacional(String(vinculo.empresa_id));
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return erro(error.message, error.status);
      }
      if (error instanceof ErroAssinaturaRestrita) {
        return erro(error.message, 403);
      }
      throw error;
    }

    const empresaId = String(vinculo.empresa_id);
    const body = (await request.json().catch(() => ({}))) as {
      devolucao_id?: string;
    };
    const devolucaoId = texto(body.devolucao_id);

    if (!devolucaoId) {
      return erro("Informe a devolução.");
    }

    if (texto(request.headers.get("Idempotency-Key")) !== devolucaoId) {
      return erro(
        "O header Idempotency-Key deve conter o UUID da devolução.",
        400
      );
    }

    const { data: devolucao } = await supabase
      .from("fiscal_devolucoes_fornecedor")
      .select(
        `
        id, empresa_id, status, documento_entrada_id, natureza_id,
        chave_documento_origem, emissao_fiscal_id, tp_nf, fin_nfe,
        natureza_descricao, saida_estoque_processada_at, snapshot_fiscal,
        dados_transporte, informacao_complementar_usuario, informacao_adicional_fisco
      `
      )
      .eq("id", devolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
      return erro("Devolução não encontrada nesta empresa.", 404);
    }

    if (devolucao.saida_estoque_processada_at) {
      return erro("A saída desta devolução já foi processada.");
    }

    const [
      entradaResult,
      itensResult,
      empresaResult,
      fiscalResult,
      numeracoesResult,
      naturezasResult,
      regrasResult,
      segredosResult,
      csrtResult,
    ] = await Promise.all([
      supabase
        .from("fiscal_documentos_entrada")
        .select("id, empresa_id, xml_original, chave_acesso, status")
        .eq("id", devolucao.documento_entrada_id)
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("fiscal_devolucoes_fornecedor_itens")
        .select(
          `
          id, empresa_id, quantidade, valor_unitario_original, ncm, cest,
          produto_id, grupo_fiscal_id, cfop_resolvido, snapshot_fiscal,
          documento_entrada_item_id,
          fiscal_documentos_entrada_itens!documento_entrada_item_id (
            descricao_original, ean, unidade, dados_fiscais_original, ncm, cest,
            quantidade_xml, quantidade_entrada_efetivada, documento_entrada_id, numero_item
          )
        `
        )
        .eq("empresa_id", empresaId)
        .eq("devolucao_id", devolucaoId),
      supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, cnpj, ativo")
        .eq("id", empresaId)
        .maybeSingle(),
      supabase
        .from("empresas_fiscal")
        .select(
          `
          empresa_id, inscricao_estadual, telefone, email, logradouro, numero,
          complemento, bairro, cep, municipio, codigo_municipio_ibge, uf,
          tipo_atividade, codigo_regime_tributario, indicador_presenca_padrao,
          indicativo_intermediador_padrao, informacao_complementar_padrao,
          fuso_horario, ambiente, ativo,
          responsavel_tecnico_cnpj, responsavel_tecnico_contato,
          responsavel_tecnico_email, responsavel_tecnico_fone,
          responsavel_tecnico_id_csrt
        `
        )
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("fiscal_numeracoes")
        .select("id, modelo, ambiente, serie, proximo_numero, ativo")
        .eq("empresa_id", empresaId)
        .eq("modelo", "55")
        .eq("ativo", true),
      supabase
        .from("fiscal_naturezas_operacao")
        .select(
          "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
        )
        .eq("empresa_id", empresaId),
      supabase
        .from("fiscal_natureza_cfop_regras")
        .select(
          "empresa_id, natureza_id, grupo_fiscal_id, tipo_destino, cfop, ativo"
        )
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
      admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
      admin.rpc("obter_csrt_fiscal", { p_empresa_id: empresaId }),
    ]);

    const entrada = entradaResult.data;
    const empresa = empresaResult.data;
    const fiscal = fiscalResult.data;

    if (!entrada || !registroPertenceAEmpresaAtiva(entrada, empresaId)) {
      return erro("NF-e de entrada não encontrada nesta empresa.");
    }
    if (String(entrada.status) !== "entrada_concluida") {
      return erro("A NF-e de entrada original não está com entrada concluída.");
    }
    if (!empresa || String(empresa.id) !== empresaId || !fiscal) {
      return erro("Dados fiscais da empresa ativa incompletos.");
    }

    const naturezaEscolhida = escolherNaturezaParaDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      naturezaId: devolucao.natureza_id,
      naturezas: (naturezasResult.data ?? []) as NaturezaOperacaoFiscal[],
    });
    if (!naturezaEscolhida.ok) {
      return erro(naturezaEscolhida.mensagem);
    }

    const naturezaCongelada = {
      ...naturezaEscolhida.natureza,
      descricao:
        texto(devolucao.natureza_descricao) ||
        naturezaEscolhida.natureza.descricao,
      tp_nf: texto(devolucao.tp_nf) || naturezaEscolhida.natureza.tp_nf,
      fin_nfe: texto(devolucao.fin_nfe) || naturezaEscolhida.natureza.fin_nfe,
    };

    const emitenteXml = entrada.xml_original
      ? parseEmitenteNfeEntrada(String(entrada.xml_original))
      : null;

    const itens = itensResult.data ?? [];
    const produtoIds = itens.map((item) => item.produto_id).filter(Boolean);

    const entradaIdsItens = [
      ...new Set(
        itens
          .map((item) => {
            const original = Array.isArray(item.fiscal_documentos_entrada_itens)
              ? item.fiscal_documentos_entrada_itens[0]
              : item.fiscal_documentos_entrada_itens;
            return original?.documento_entrada_id
              ? String(original.documento_entrada_id)
              : "";
          })
          .filter(Boolean)
      ),
    ];
    const { data: entradasItens } =
      entradaIdsItens.length > 0
        ? await supabase
            .from("fiscal_documentos_entrada")
            .select("id, empresa_id, chave_acesso, numero, serie")
            .eq("empresa_id", empresaId)
            .in("id", entradaIdsItens)
        : { data: [] };
    const entradaOrigemPorId = new Map(
      (entradasItens ?? [])
        .filter((item) => registroPertenceAEmpresaAtiva(item, empresaId))
        .map((item) => [String(item.id), item])
    );
    const documentosReferenciados = montarDocumentosReferenciados(
      itens.map((item) => {
        const original = Array.isArray(item.fiscal_documentos_entrada_itens)
          ? item.fiscal_documentos_entrada_itens[0]
          : item.fiscal_documentos_entrada_itens;
        const origem = original?.documento_entrada_id
          ? entradaOrigemPorId.get(String(original.documento_entrada_id))
          : null;
        const snap = item.snapshot_fiscal as {
          chave_documento_origem?: string;
          numero_documento_origem?: string;
        } | null;
        return {
          chave:
            String(origem?.chave_acesso ?? snap?.chave_documento_origem ?? "") ||
            String(devolucao.chave_documento_origem),
          numero: origem?.numero ?? snap?.numero_documento_origem ?? null,
          serie: origem?.serie ?? null,
          numeroItem: Number(original?.numero_item ?? 0) || null,
          documentoEntradaId: original?.documento_entrada_id ?? null,
        };
      })
    );

    const { data: produtos, error: produtosError } = produtoIds.length
      ? await supabase
          .from("produtos")
          .select("id, empresa_id, codigo, nome, grupo_fiscal_id")
          .eq("empresa_id", empresaId)
          .in("id", produtoIds)
      : { data: [], error: null };

    if (produtosError) {
      return erro(produtosError.message);
    }

    const produtoPorId = new Map(
      (produtos ?? [])
        .filter((produto) => registroPertenceAEmpresaAtiva(produto, empresaId))
        .map((produto) => [String(produto.id), produto])
    );

    const grupoIds = [
      ...new Set(
        itens
          .map((item) => {
            const produto = produtoPorId.get(String(item.produto_id));
            return grupoFiscalIdParaDevolucaoFornecedor({
              empresaIdAtiva: empresaId,
              snapshotFiscal: item.snapshot_fiscal,
              grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
              produtoEmpresaId: produto?.empresa_id,
              produtoGrupoFiscalId: produto?.grupo_fiscal_id,
            }).grupoFiscalId;
          })
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const { data: grupos, error: gruposError } = grupoIds.length
      ? await supabase
          .from("grupos_fiscais")
          .select(COLUNAS_GRUPO_FISCAL_DEVOLUCAO)
          .eq("empresa_id", empresaId)
          .in("id", grupoIds)
      : { data: [], error: null };

    if (gruposError) {
      return erro(gruposError.message);
    }

    const grupoPorId = new Map(
      (grupos ?? [])
        .filter((grupo) => registroPertenceAEmpresaAtiva(grupo, empresaId))
        .map((grupo) => [String(grupo.id), grupo])
    );

    const ambienteNumero = Number(fiscal.ambiente) === 1 ? 1 : 2;
    const ambiente = ambienteNumero === 1 ? "1" : "2";
    let crt;
    try {
      crt = lerCodigoRegimeTributario(fiscal.codigo_regime_tributario);
    } catch (errorCrt) {
      return erro(
        errorCrt instanceof Error
          ? errorCrt.message
          : "CRT da empresa da emissão não está configurado."
      );
    }

    const verificacao = verificarDevolucaoFornecedor({
      empresaIdAtiva: empresaId,
      natureza: naturezaCongelada,
      chaveOrigem: String(devolucao.chave_documento_origem),
      ufEmpresa: fiscal.uf,
      emitente: emitenteXml,
      itens: itens.map((item) => {
        const original = Array.isArray(item.fiscal_documentos_entrada_itens)
          ? item.fiscal_documentos_entrada_itens[0]
          : item.fiscal_documentos_entrada_itens;
        const produto = produtoPorId.get(String(item.produto_id));
        const resolucaoGrupo = grupoFiscalIdParaDevolucaoFornecedor({
          empresaIdAtiva: empresaId,
          snapshotFiscal: item.snapshot_fiscal,
          grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
          produtoEmpresaId: produto?.empresa_id,
          produtoGrupoFiscalId: produto?.grupo_fiscal_id,
        });
        const grupo = grupoFiscalDaEmpresaAtiva(
          resolucaoGrupo.grupoFiscalId
            ? grupoPorId.get(resolucaoGrupo.grupoFiscalId)
            : null,
          empresaId
        );
        const icmsSnapshot = snapshotFiscalDevolucaoCongelado(
          item.snapshot_fiscal
        )
          ? String(
              (item.snapshot_fiscal as { icms_resolvido?: unknown })
                .icms_resolvido ?? ""
            ).trim() || null
          : null;
        return {
          id: String(item.id),
          descricao: original?.descricao_original || produto?.nome || "Item",
          quantidade: Number(item.quantidade),
          ncm: item.ncm || original?.ncm,
          cest: item.cest || original?.cest,
          ean: original?.ean,
          unidade: original?.unidade,
          codigoProduto: produto?.codigo,
          valorUnitario: Number(item.valor_unitario_original ?? 0),
          grupoFiscalId: grupo?.id ?? null,
          grupoFiscalNome: grupo?.nome,
          regraIcmsDevolucao: icmsSnapshot,
          icmsCstCsosnGrupo: grupo?.icms_cst_csosn,
          grupoFiscalEmpresaId: grupo?.empresa_id,
          produtoEmpresaId: produto?.empresa_id,
          quantidadeOriginal:
            Number(original?.quantidade_entrada_efetivada ?? 0) ||
            Number(original?.quantidade_xml ?? 0),
          dadosFiscaisOriginal: original?.dados_fiscais_original,
          cfopResolvido: item.cfop_resolvido,
        };
      }),
      regrasCfop: normalizarRegrasCfopDaEmpresaAtiva(
        regrasResult.data,
        empresaId
      ),
      codigoRegimeTributario: crt,
      ambiente,
      dataEmissao: new Date(),
      gruposIbs: Object.fromEntries(
        (grupos ?? []).map((grupo) => [
          String(grupo.id),
          {
            cstIbscbs: grupo.cst_ibscbs,
            classificacaoIbscbs: grupo.classificacao_ibscbs,
            aliquotaIbsUf: grupo.aliquota_ibs_uf,
            aliquotaIbsMunicipio: grupo.aliquota_ibs_municipio,
            aliquotaCbs: grupo.aliquota_cbs,
          },
        ])
      ),
    });

    if (!verificacao.ok) {
      return erro("A verificação fiscal bloqueou a emissão.", 422, {
        pendencias: verificacao.pendencias.map((item) => item.mensagem),
      });
    }

    if (
      !devolucaoPodeEmitir(String(devolucao.status)) &&
      !devolucao.emissao_fiscal_id
    ) {
      return erro(
        "Conclua a verificação fiscal antes de emitir a NF-e de devolução."
      );
    }

    const itensFiscais = [];
    for (const item of verificacao.itens) {
      const originalItem = itens.find((linha) => String(linha.id) === item.id);
      const original = originalItem
        ? Array.isArray(originalItem.fiscal_documentos_entrada_itens)
          ? originalItem.fiscal_documentos_entrada_itens[0]
          : originalItem.fiscal_documentos_entrada_itens
        : null;
      const produto = produtoPorId.get(String(originalItem?.produto_id));
      const resolucaoGrupo = grupoFiscalIdParaDevolucaoFornecedor({
        empresaIdAtiva: empresaId,
        snapshotFiscal: originalItem?.snapshot_fiscal,
        grupoFiscalIdItemDevolucao: originalItem?.grupo_fiscal_id,
        produtoEmpresaId: produto?.empresa_id,
        produtoGrupoFiscalId: produto?.grupo_fiscal_id,
      });
      const grupo = grupoFiscalDaEmpresaAtiva(
        resolucaoGrupo.grupoFiscalId
          ? grupoPorId.get(resolucaoGrupo.grupoFiscalId)
          : null,
        empresaId
      );
      const icmsSnapshot = snapshotFiscalDevolucaoCongelado(
        originalItem?.snapshot_fiscal
      )
        ? String(
            (originalItem?.snapshot_fiscal as { icms_resolvido?: unknown })
              ?.icms_resolvido ?? ""
          ).trim() || null
        : null;
      const montado = montarItemDevolucaoFornecedor({
        descricao: item.descricao,
        codigo: produto?.codigo || "0",
        ean: original?.ean,
        unidade: original?.unidade || "UN",
        ncm: item.ncm || "",
        cest: item.cest,
        cfop: item.cfop || "",
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        dadosFiscaisOriginal: original?.dados_fiscais_original,
        regraIcmsDevolucao: icmsSnapshot,
        icmsCstCsosnGrupo: grupo?.icms_cst_csosn,
        grupoFiscalNome: grupo?.nome,
        grupoFiscalEmpresaId: grupo?.empresa_id,
        produtoEmpresaId: produto?.empresa_id,
        empresaIdAtiva: empresaId,
        quantidadeOriginal:
          Number(original?.quantidade_entrada_efetivada ?? 0) ||
          Number(original?.quantidade_xml ?? 0),
        codigoRegimeTributario: crt,
        ambiente,
        dataEmissao: new Date(),
        ibs: grupo
          ? {
              cstIbscbs: grupo.cst_ibscbs,
              classificacaoIbscbs: grupo.classificacao_ibscbs,
              aliquotaIbsUf: grupo.aliquota_ibs_uf,
              aliquotaIbsMunicipio: grupo.aliquota_ibs_municipio,
              aliquotaCbs: grupo.aliquota_cbs,
            }
          : null,
        documentoFiscalReferenciado: (() => {
          const origem = original?.documento_entrada_id
            ? entradaOrigemPorId.get(String(original.documento_entrada_id))
            : null;
          const chave = String(
            origem?.chave_acesso ??
              (originalItem?.snapshot_fiscal as { chave_documento_origem?: string } | null)
                ?.chave_documento_origem ??
              devolucao.chave_documento_origem
          );
          const numeroItem = Number(original?.numero_item ?? 0);
          return chave.replace(/\D/g, "").length === 44 && numeroItem > 0
            ? { chaveAcesso: chave.replace(/\D/g, ""), numeroItem }
            : null;
        })(),
      });
      if (!montado.item) {
        return erro(
          montado.pendencias[0] ||
            "Não foi possível montar o item da devolução com os dados do XML original."
        );
      }
      itensFiscais.push(montado.item);
    }

    const numeracao = (numeracoesResult.data ?? []).find(
      (item) => Number(item.ambiente) === ambienteNumero
    );
    if (!numeracao) {
      return erro("Não há numeração de NF-e 55 ativa para o ambiente da empresa.");
    }

    if (segredosResult.error) {
      return erro("Não foi possível ler os segredos fiscais.", 500);
    }
    const segredos = Array.isArray(segredosResult.data)
      ? segredosResult.data[0]
      : segredosResult.data;
    const apiKey = texto(segredos?.geranet_api_key);
    const certificado = texto(segredos?.certificado_a1);
    const senhaCertificado = texto(segredos?.senha_certificado);
    if (!apiKey || !certificado || !senhaCertificado) {
      return erro("API Key/certificado/senha fiscal incompletos.");
    }

    const ufEmitente = texto(fiscal.uf).toUpperCase();
    const ieEmitente = texto(fiscal.inscricao_estadual);
    if (!/^[A-Z]{2}$/.test(ufEmitente) || !ieEmitente) {
      return erro("UF ou IE da empresa ativa incompletos.");
    }

    const chaveIdempotencia = chaveIdempotenciaDevolucao(devolucaoId);
    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      chaveIdempotencia
    );
    const bloqueioRascunho = avaliarBloqueioRascunhoFiscal(emissaoPrevia);
    if (bloqueioRascunho.tipo === "autorizada") {
      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({ status: "aguardando_saida" })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: bloqueioRascunho.emissao.id,
        chave: bloqueioRascunho.emissao.chave_acesso,
        protocolo: bloqueioRascunho.emissao.protocolo,
        mensagem: "Esta devolução já possui NF-e autorizada.",
      });
    }
    if (
      bloqueioRascunho.tipo === "bloquear" ||
      bloqueioRascunho.tipo === "inutilizacao" ||
      bloqueioRascunho.tipo === "inutilizada"
    ) {
      if (bloqueioRascunho.emissao.status === "aguardando_reconciliacao") {
        await admin
          .from("fiscal_devolucoes_fornecedor")
          .update({ status: "aguardando_reconciliacao" })
          .eq("id", devolucaoId)
          .eq("empresa_id", empresaId);
      }
      return erro(
        bloqueioRascunho.tipo === "bloquear"
          ? bloqueioRascunho.mensagem
          : bloqueioRascunho.tipo === "inutilizacao"
            ? "Conclua a inutilização da numeração anterior antes de emitir novamente."
            : "Esta emissão foi inutilizada e não pode receber novo rascunho fiscal.",
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const { data: reservaData, error: reservaError } = await admin.rpc(
      "rpc_reservar_emissao_fiscal",
      {
        p_empresa_id: empresaId,
        p_modelo: "55",
        p_serie: numeracao.serie,
        p_ambiente: ambienteNumero,
        p_chave_idempotencia: chaveIdempotencia,
        p_origem_tipo: "devolucao_fornecedor",
        p_origem_id: devolucaoId,
      }
    );

    if (reservaError) {
      return erro(`Falha ao reservar numeração NF-e: ${reservaError.message}`, 500);
    }
    const reserva = Array.isArray(reservaData) ? reservaData[0] : reservaData;
    if (!reserva?.emissao_id) {
      return erro("A reserva fiscal não retornou uma emissão válida.", 500);
    }
    const emissaoId = String(reserva.emissao_id);

    let identidadeFiscal: ReturnType<typeof assertIdentidadeFiscalNfe>;
    try {
      identidadeFiscal = assertIdentidadeFiscalNfe({
        naturezaId: naturezaCongelada.id,
        descricao: naturezaCongelada.descricao,
        tpNf: naturezaCongelada.tp_nf,
        finNfe: naturezaCongelada.fin_nfe,
      });
    } catch (errorIdentidade) {
      return erro(
        errorIdentidade instanceof Error
          ? errorIdentidade.message
          : MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        tipo_operacao_interno: "devolucao_fornecedor",
        natureza_id: identidadeFiscal.naturezaId,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
        chave_documento_origem: devolucao.chave_documento_origem,
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    await admin
      .from("fiscal_devolucoes_fornecedor")
      .update({
        emissao_fiscal_id: emissaoId,
        natureza_id: identidadeFiscal.naturezaId,
        natureza_descricao: identidadeFiscal.descricao,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
      })
      .eq("id", devolucaoId)
      .eq("empresa_id", empresaId);

    const { data: emissaoAtual, error: emissaoAtualError } = await admin
      .from("fiscal_emissoes")
      .select(
        "id, status, numero, serie, codigo_numerico, chave_acesso, protocolo, cstat, motivo, geranet_http_status, erro_comunicacao, resposta_resumo, tipo_operacao_interno, natureza_id, tp_nf, fin_nfe, chave_documento_origem"
      )
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (emissaoAtualError || !emissaoAtual) {
      return erro("Reserva criada, mas não foi possível reler a emissão.", 500, {
        emissao_id: emissaoId,
      });
    }

    if (emissaoAtual.status === "autorizada") {
      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({ status: "aguardando_saida" })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: emissaoId,
        chave: emissaoAtual.chave_acesso,
        protocolo: emissaoAtual.protocolo,
        mensagem: "Esta devolução já possui NF-e autorizada.",
      });
    }

    if (emissaoAtual.status === "aguardando_reconciliacao") {
      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({ status: "aguardando_reconciliacao" })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);
      return erro(MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO, 409, {
        emissao_id: emissaoId,
        status: emissaoAtual.status,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }

    if (emissaoAtual.status === "enviando") {
      return erro(MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO, 409, {
        emissao_id: emissaoId,
        status: emissaoAtual.status,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }

    const ieFornecedor = texto(emitenteXml?.ie);
    const indicadorIe =
      ieFornecedor && ieFornecedor.toUpperCase() !== "ISENTO" ? "1" : "9";

    const agora = new Date();
    let fusoHorario: string;
    try {
      fusoHorario = exigirFusoHorarioFiscalDaEmissao({
        empresaIdDaEmissao: empresaId,
        fiscal,
      });
    } catch (errorFuso) {
      return erro(
        errorFuso instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal da empresa não está configurado."
      );
    }

    const dataHora = formatarDataHoraGeranet(
      agora,
      fusoHorario
    );

    const totalItens = itensFiscais.reduce(
      (soma, item) => soma + Number(item.valorTotal ?? 0),
      0
    );

    const snapshot = (devolucao.snapshot_fiscal ?? {}) as {
      transporte?: unknown;
      informacao_complementar_usuario?: string | null;
      informacao_adicional_fisco?: string | null;
      documentos_referenciados?: Array<{ chave: string }>;
    };
    const transporteMapeado = mapearTransporteParaGeranet(
      snapshot.transporte ?? devolucao.dados_transporte
    );
    const chavesReferencia = documentosReferenciados.length
      ? documentosReferenciados
      : montarDocumentosReferenciados(
          (snapshot.documentos_referenciados ?? []).map((item) => ({
            chave: item.chave,
          }))
        );
    const textoRefs = textoAutomaticoDocumentosReferenciados(chavesReferencia);

    const payload = montarPayloadNfeGeranet({
      ambiente,
      ufEmitente,
      certificadoDigital: certificado,
      senhaCertificadoDigital: senhaCertificado,
      emitente: {
        logomarca: await obterLogomarcaFiscalHex(empresaId),
        cnpj: empresa.cnpj,
        inscricaoEstadual: ieEmitente,
        razaoSocial: empresa.razao_social,
        nomeFantasia: empresa.nome_fantasia,
        telefone: fiscal.telefone,
        email: fiscal.email,
        logradouro: fiscal.logradouro,
        numero: fiscal.numero,
        complemento: fiscal.complemento,
        bairro: fiscal.bairro,
        municipio: fiscal.municipio,
        codigoMunicipio: fiscal.codigo_municipio_ibge,
        uf: ufEmitente,
        cep: fiscal.cep,
        codigoRegimeTributario: crt,
        tipoAtividade: fiscal.tipo_atividade ?? "3",
        informacaoComplementar: fiscal.informacao_complementar_padrao,
      },
      destinatario: {
        cnpj: emitenteXml?.cnpj,
        inscricaoEstadual: indicadorIe === "1" ? ieFornecedor : "",
        razaoSocial: emitenteXml?.razaoSocial,
        consumidorFinal: "0",
        indicadorIEdestinatario: indicadorIe,
        telefone: emitenteXml?.telefone,
        logradouro: emitenteXml?.logradouro || "",
        numero: emitenteXml?.numero || "S/N",
        complemento: emitenteXml?.complemento,
        bairro: emitenteXml?.bairro || "",
        municipio: emitenteXml?.municipio || "",
        codigoMunicipio: emitenteXml?.codigoMunicipio || "",
        codigoPais: "1058",
        nomePais: "Brasil",
        uf: emitenteXml?.uf || "",
        cep: emitenteXml?.cep || "",
      },
      responsavelTecnico: responsavelTecnicoDoCadastroFiscal({
        fiscal,
        csrt: csrtResult.error ? null : csrtResult.data,
      }),
      config: {
        serie: emissaoAtual.serie,
        numeroNota: emissaoAtual.numero,
        codigoNumerico: texto(emissaoAtual.codigo_numerico),
        dataSaida: dataHora,
        dataEmissao: dataHora,
        fusoHorario,
        indicadorPresenca: texto(fiscal.indicador_presenca_padrao) || "9",
        indicativoIntermediador:
          texto(fiscal.indicativo_intermediador_padrao) || "0",
        naturezaOperacao: identidadeFiscal.descricao,
        tipo: identidadeFiscal.tpNf,
        finalidade: identidadeFiscal.finNfe,
        frete: transporteMapeado.modFrete,
        notaFiscalReferencia:
          notaFiscalReferenciaGeranet(chavesReferencia) ||
          String(devolucao.chave_documento_origem),
        informacaoAdicionalFisco: montarInformacaoAdicionalFisco({
          textoUsuario:
            snapshot.informacao_adicional_fisco ??
            devolucao.informacao_adicional_fisco,
        }),
        informacaoComplementar: montarInformacaoComplementarNfe({
          textosAutomaticos: [textoRefs],
          padraoEmpresa: fiscal.informacao_complementar_padrao,
          textoUsuario:
            snapshot.informacao_complementar_usuario ??
            devolucao.informacao_complementar_usuario,
        }),
      },
      transporte:
        transporteMapeado.modFrete === "9"
          ? null
          : {
              transportador: transporteMapeado.transportador,
              volumes: transporteMapeado.volumes,
            },
      pagamento: {
        troco: 0,
        detalhamento: [
          {
            tipo: "90",
            valor: 0,
            indicadorPagamento: "0",
          },
        ],
      },
      itens: itensFiscais,
    });

    aplicarValorTotalNotaGeranet({
      modelo: "55",
      nfe: payload.nfe,
      itensFiscais,
    });

    const claim = await claimTentativaEmissaoFiscal({
      admin,
      empresaId,
      emissaoId,
      usuarioId: String(claimsData.claims.sub),
      payload,
      snapshotItens: snapshotItensDaTransmissao(itensFiscais),
    });

    if (!claim.ok) {
      return erro(claim.mensagem, claim.motivo === "erro" ? 500 : 409, {
        emissao_id: emissaoId,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }

    const tentativaId = claim.tentativaId;

    await admin
      .from("fiscal_devolucoes_fornecedor")
      .update({ status: "enviando" })
      .eq("id", devolucaoId)
      .eq("empresa_id", empresaId);

    let resultadoGeranet: Awaited<ReturnType<typeof chamarGeranet>>;
    try {
      resultadoGeranet = await chamarGeranet({
        apiKey,
        endpoint: "/api/v1/nfe/emitir",
        payload,
        timeoutMs: 45_000,
      });
    } catch (e) {
      const persistencia = persistenciaFalhaComunicacaoEmitir(e);
      await admin
        .from("fiscal_emissoes")
        .update({
          status: persistencia.status,
          erro_comunicacao: persistencia.motivo,
          motivo: persistencia.motivo,
          resposta_resumo: {
            classificacao: persistencia.classificacaoResumo,
          },
          respondida_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        motivo: persistencia.motivo,
        resposta: {
          erro: persistencia.motivo,
          classificacao: persistencia.classificacaoResumo,
        },
        classificacaoInicial: persistencia.status,
      });

      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);

      return erro(
        persistencia.retransmitir
          ? `${persistencia.motivo} A mesma emissão pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("55"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id: emissaoId,
          status: persistencia.status,
          classificacao: persistencia.classificacaoResumo,
          podeConsultarNovamente: true,
          podeRetransmitir: persistencia.retransmitir,
        }
      );
    }

    const geranet = resultadoGeranet.dados;
    const chave = texto(geranet.chave);
    const protocolo = texto(geranet.protocolo);
    const situacao = texto(geranet.situacao).toLowerCase();
    const autorizado =
      resultadoGeranet.httpOk &&
      situacao === "sucesso" &&
      /^\d{44}$/.test(chave) &&
      protocolo.length > 0;

    if (autorizado) {
      await admin
        .from("fiscal_emissoes")
        .update({
          status: "autorizada",
          chave_acesso: chave,
          protocolo,
          cstat: texto(geranet.cstat) || null,
          motivo: texto(geranet.mensagem) || null,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          resposta_resumo: resultadoGeranet.resumo,
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          erro_comunicacao: null,
          respondida_at: new Date().toISOString(),
          autorizada_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: geranet.mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultadoGeranet.resumo,
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: "autorizada",
      });

      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({ status: "aguardando_saida" })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);

      return json({
        ok: true,
        autorizada: true,
        emissao_id: emissaoId,
        chave,
        protocolo,
        mensagem:
          "NF-e de devolução autorizada. O estoque ainda não foi movimentado.",
        valor_itens: totalItens,
      });
    }

    const classificacaoEmissao = classificarRespostaEmitir({
      httpOk: resultadoGeranet.httpOk,
      httpStatus: resultadoGeranet.httpStatus,
      situacao,
      cstat: geranet.cstat,
      mensagem: geranet.mensagem,
      chave,
      protocolo,
    });

    if (classificacaoEmissao !== "rejeitada") {
      const persistencia = persistirClassificacaoNaoAutorizada(
        classificacaoEmissao === "erro_envio"
          ? "erro_envio"
          : "aguardando_reconciliacao"
      );
      const motivoTecnico =
        texto(geranet.mensagem) || persistencia.mensagemPadrao;
      await admin
        .from("fiscal_emissoes")
        .update({
          status: persistencia.status,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          cstat: texto(geranet.cstat) || null,
          motivo: motivoTecnico,
          erro_comunicacao: motivoTecnico,
          resposta_resumo: {
            ...resultadoGeranet.resumo,
            classificacao: persistencia.classificacaoResumo,
            historico: [historicoErroTecnico(motivoTecnico)],
          },
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          respondida_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: motivoTecnico,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: {
          ...resultadoGeranet.resumo,
          classificacao: persistencia.classificacaoResumo,
        },
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: persistencia.status,
      });

      await admin
        .from("fiscal_devolucoes_fornecedor")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", devolucaoId)
        .eq("empresa_id", empresaId);

      return erro(
        persistencia.retransmitir
          ? `${motivoTecnico} A mesma emissão pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("55"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id: emissaoId,
          status: persistencia.status,
          classificacao: persistencia.classificacaoResumo,
          podeConsultarNovamente: true,
          podeRetransmitir: persistencia.retransmitir,
        }
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        status: "rejeitada",
        cstat: texto(geranet.cstat) || null,
        motivo: texto(geranet.mensagem) || "Documento rejeitado.",
        geranet_http_status: resultadoGeranet.httpStatus,
        geranet_situacao: texto(geranet.situacao) || null,
        respondida_at: new Date().toISOString(),
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: resultadoGeranet.httpStatus,
      cstat: geranet.cstat,
      motivo: geranet.mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: {
        classificacao: "rejeitada",
      },
      xmlHex: texto(geranet.xml) || null,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "rejeitada",
    });

    await admin
      .from("fiscal_devolucoes_fornecedor")
      .update({ status: "rejeitada" })
      .eq("id", devolucaoId)
      .eq("empresa_id", empresaId);

    return erro(texto(geranet.mensagem) || "NF-e de devolução rejeitada.", 422, {
      emissao_id: emissaoId,
      status: "rejeitada",
    });
  } catch (error) {
    return erro(
      error instanceof Error
        ? error.message
        : "Falha inesperada ao emitir a NF-e de devolução.",
      500
    );
  }
}
