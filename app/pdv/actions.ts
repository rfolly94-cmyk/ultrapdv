"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validarPixNaFinalizacaoComercial } from "@/lib/pagamentos/pix/modo-ativo-servidor";
import { avaliarTetoPagamentosNoServidor } from "@/lib/pdv/validar-teto-servidor";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { ErroAssinaturaRestrita } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirEmpresaOperacional } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import {
  exigirOperacaoPdv,
  resultadoNegacaoPdv,
} from "@/lib/pdv/acesso-operacao";
import { mensagemErroFinalizacaoPublica } from "@/lib/pdv/mensagem-erro-publica";
import {
  buscarCaixaAbertoEmpresa,
} from "@/lib/caixa/sessao-aberta";
import { controleCaixaAtivo } from "@/lib/caixa/controle-servidor";
import { deveUsarLivroCaixa } from "@/lib/caixa/controle";
import { MENSAGEM_CAIXA_FECHADO_FINALIZAR } from "@/lib/caixa/mensagens";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_CLIENTE_DOCUMENTO_EXIGE_CLIENTE,
  resolverDocumentoDestinatarioPdv,
} from "@/lib/fiscal/destinatario/documento";
import {
  lerSnapshotDestinatarioFiscal,
  origemSnapshotAInicializar,
  snapshotDestinatarioParaPersistir,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { mesclarSnapshotOperacao } from "@/lib/fiscal/nfe55/pagamentos-rascunho";

export type FinalizarVendaPdvInput = {
  idempotencyKey: string;
  clienteId: string | null;
  descontoCentavos: number;
  trocoCentavos: number;
  freteCentavos?: number;
  acrescimoCentavos?: number;
  observacao?: string | null;
  catalogoPedidoId?: string | null;
  itens: Array<{
    produtoId: string;
    quantidade: number;
  }>;
  pagamentos: Array<{
    formaPagamentoId: string;
    valorCentavos: number;
    pixLocalRecebimentoId?: string | null;
  }>;
  cpfNaNota?: string | null;
  usarDocumentoClienteNaNota?: boolean;
};

export type FinalizarVendaPdvResultado =
  | {
      ok: true;
      vendaId: string;
      numero: number;
      valorTotalCentavos: number;
    }
  | {
      ok: false;
      erro: string;
      codigo?:
        | "RECURSO_NAO_CONTRATADO"
        | "NAO_AUTENTICADO"
        | "SEM_EMPRESA"
        | "CAIXA_FECHADO";
    };

export type OpcoesFinalizacaoVendaPdv = {
  /**
   * PDV web (`finalizarVendaPdv`) e Nova NF-e → Venda nova: true.
   * UltraPDV Mobile (`POST /api/pdv/finalizar`): omitir/false nesta fase.
   * Futuro Caixa mobile: passar true e vincular a venda à sessão.
   */
  exigirCaixaAberto?: boolean;
};

function uuidValido(
  valor: string
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

function centavosParaDecimal(
  valor: number
) {
  return (
    Math.round(valor) /
    100
  );
}

export async function executarFinalizacaoVendaPdv(
  input: FinalizarVendaPdvInput,
  opcoes?: OpcoesFinalizacaoVendaPdv
): Promise<FinalizarVendaPdvResultado> {
  try {
    const supabase =
      await createClient();

    const {
      data: claimsData,
      error: authError,
    } =
      await obterClaimsSessao(supabase);

    if (
      authError ||
      !claimsData?.claims?.sub
    ) {
      return {
        ok: false,
        erro: "Não autenticado.",
        codigo: "NAO_AUTENTICADO",
      };
    }

    const { data: vinculo } =
      await supabase
        .from("usuarios_empresas")
        .select("empresa_id")
        .eq("usuario_id", String(claimsData.claims.sub))
        .eq("principal", true)
        .eq("ativo", true)
        .maybeSingle();

    if (!vinculo) {
      return {
        ok: false,
        erro:
          "Nenhuma empresa ativa encontrada. Conclua o acesso no UltraPDV web.",
        codigo: "SEM_EMPRESA",
      };
    }

    try {
      await exigirEmpresaOperacional(String(vinculo.empresa_id));
    } catch (error) {
      if (error instanceof ErroAssinaturaRestrita) {
        return { ok: false, erro: error.message };
      }
      throw error;
    }

    try {
      await exigirOperacaoPdv({
        empresaId: String(vinculo.empresa_id),
        acao: "finalizar_venda",
        origem: "finalizarVendaPdv",
      });
    } catch (error) {
      const negacao = resultadoNegacaoPdv(error);
      if (negacao) {
        return negacao;
      }
      throw error;
    }

    if (input.descontoCentavos > 0) {
      try {
        await exigirPermissao({ modulo: "pdv", acao: "aplicar_desconto" });
      } catch (error) {
        if (error instanceof ErroPermissao) {
          return { ok: false, erro: error.message };
        }
        throw error;
      }
    }

    if (
      !uuidValido(
        input.idempotencyKey
      )
    ) {
      return {
        ok: false,
        erro:
          "Chave de idempotência inválida.",
      };
    }

    if (
      input.clienteId &&
      !uuidValido(
        input.clienteId
      )
    ) {
      return {
        ok: false,
        erro:
          "Cliente inválido.",
      };
    }

    if (
      !Number.isInteger(
        input.descontoCentavos
      ) ||
      input.descontoCentavos < 0
    ) {
      return {
        ok: false,
        erro:
          "Desconto inválido.",
      };
    }

    const freteCentavos = input.freteCentavos ?? 0;
    const acrescimoCentavos = input.acrescimoCentavos ?? 0;
    if (!Number.isInteger(freteCentavos) || freteCentavos < 0) {
      return { ok: false, erro: "Frete inválido." };
    }
    if (!Number.isInteger(acrescimoCentavos) || acrescimoCentavos < 0) {
      return { ok: false, erro: "Acréscimo inválido." };
    }

    if (
      !Number.isInteger(
        input.trocoCentavos
      ) ||
      input.trocoCentavos < 0
    ) {
      return {
        ok: false,
        erro:
          "Troco inválido.",
      };
    }

    if (
      !Array.isArray(
        input.itens
      ) ||
      input.itens.length === 0
    ) {
      return {
        ok: false,
        erro:
          "Adicione ao menos um produto.",
      };
    }

    if (
      !Array.isArray(
        input.pagamentos
      ) ||
      input.pagamentos.length === 0
    ) {
      return {
        ok: false,
        erro:
          "Informe o pagamento.",
      };
    }

    const itens =
      input.itens.map(
        (item) => {
          if (
            !uuidValido(
              item.produtoId
            ) ||
            !Number.isInteger(
              item.quantidade
            ) ||
            item.quantidade <= 0
          ) {
            throw new Error(
              "Item da venda inválido."
            );
          }

          // NÃO enviamos valor_unitario.
          // O banco usa produtos.preco_venda.
          return {
            produto_id:
              item.produtoId,
            quantidade:
              item.quantidade,
            desconto: 0,
            acrescimo: 0,
          };
        }
      );

    const pagamentos =
      input.pagamentos.map(
        (pagamento) => {
          if (
            !uuidValido(
              pagamento.formaPagamentoId
            ) ||
            !Number.isInteger(
              pagamento.valorCentavos
            ) ||
            pagamento.valorCentavos <=
              0
          ) {
            throw new Error(
              "Pagamento inválido."
            );
          }

          if (
            pagamento.pixLocalRecebimentoId &&
            !uuidValido(pagamento.pixLocalRecebimentoId)
          ) {
            throw new Error("Recebimento PIX Local inválido.");
          }

          return {
            forma_pagamento_id:
              pagamento.formaPagamentoId,
            valor:
              centavosParaDecimal(
                pagamento.valorCentavos
              ),
            quantidade_parcelas:
              1,
            indicador_pagamento:
              "0",
            ...(pagamento.pixLocalRecebimentoId
              ? {
                  pix_local_recebimento_id:
                    pagamento.pixLocalRecebimentoId,
                }
              : {}),
          };
        }
      );

    const idsFormas = Array.from(
      new Set(input.pagamentos.map((item) => item.formaPagamentoId))
    );
    const { data: formasPagamento } = await supabase
      .from("formas_pagamento")
      .select("id, permite_fiado")
      .eq("empresa_id", vinculo.empresa_id)
      .in("id", idsFormas);

    if (formasPagamento?.some((forma) => forma.permite_fiado)) {
      try {
        await exigirPermissao({ modulo: "pdv", acao: "usar_fiado" });
      } catch (error) {
        if (error instanceof ErroPermissao) {
          return { ok: false, erro: error.message };
        }
        throw error;
      }
    }

    if (
      input.catalogoPedidoId &&
      uuidValido(input.catalogoPedidoId)
    ) {
      const { data: pedidoOrigem } =
        await supabase
          .from("catalogo_pedidos")
          .select("id, status, venda_id")
          .eq(
            "empresa_id",
            vinculo.empresa_id
          )
          .eq(
            "id",
            input.catalogoPedidoId
          )
          .maybeSingle();

      if (!pedidoOrigem) {
        return {
          ok: false,
          erro:
            "Pedido online não encontrado.",
        };
      }

      if (
        pedidoOrigem.venda_id ||
        pedidoOrigem.status ===
          "CONVERTIDO"
      ) {
        return {
          ok: false,
          erro:
            "Este pedido já foi convertido em outra venda.",
        };
      }

      if (
        pedidoOrigem.status ===
        "CANCELADO"
      ) {
        return {
          ok: false,
          erro:
            "Este pedido foi cancelado.",
        };
      }
    }

    const teto = await avaliarTetoPagamentosNoServidor({
      supabase,
      empresaId: vinculo.empresa_id,
      itens: input.itens,
      descontoCentavos: input.descontoCentavos,
      freteCentavos,
      acrescimoCentavos,
      pagamentos: input.pagamentos,
    });

    if (!teto.ok) {
      return {
        ok: false,
        erro: teto.erro,
      };
    }

    const pixModo = await validarPixNaFinalizacaoComercial({
      supabase,
      empresaId: vinculo.empresa_id,
      pagamentos: input.pagamentos,
    });

    if (!pixModo.ok) {
      return {
        ok: false,
        erro: pixModo.erro,
      };
    }

    const fluxoExigeCaixa = opcoes?.exigirCaixaAberto === true;
    const controleAtivo = fluxoExigeCaixa
      ? await controleCaixaAtivo(supabase, String(vinculo.empresa_id))
      : false;
    const usarLivroCaixa = deveUsarLivroCaixa({
      controleAtivo,
      fluxoExigeCaixa,
    });

    if (usarLivroCaixa) {
      const caixaAberto = await buscarCaixaAbertoEmpresa(
        supabase,
        String(vinculo.empresa_id)
      );
      if (!caixaAberto) {
        return {
          ok: false,
          erro: MENSAGEM_CAIXA_FECHADO_FINALIZAR,
          codigo: "CAIXA_FECHADO",
        };
      }
    }

    let documentoCliente: string | null = null;
    if (input.usarDocumentoClienteNaNota) {
      if (!input.clienteId) {
        return {
          ok: false,
          erro: MENSAGEM_CLIENTE_DOCUMENTO_EXIGE_CLIENTE,
        };
      }

      const { data: clienteDocumento } = await supabase
        .from("clientes")
        .select("id, empresa_id, cpf_cnpj")
        .eq("empresa_id", vinculo.empresa_id)
        .eq("id", input.clienteId)
        .maybeSingle();

      if (
        !clienteDocumento ||
        !registroPertenceAEmpresaAtiva(clienteDocumento, vinculo.empresa_id)
      ) {
        return {
          ok: false,
          erro: MENSAGEM_CLIENTE_DOCUMENTO_EXIGE_CLIENTE,
        };
      }

      documentoCliente = clienteDocumento.cpf_cnpj ?? null;
    }

    const documentoFiscal = resolverDocumentoDestinatarioPdv({
      cpfNaNota: input.usarDocumentoClienteNaNota ? null : input.cpfNaNota,
      usarDocumentoClienteNaNota: Boolean(input.usarDocumentoClienteNaNota),
      documentoCliente,
    });

    if (!documentoFiscal.ok) {
      return { ok: false, erro: documentoFiscal.erro };
    }

    // PDV web e Nova NF-e → Venda nova: exigirCaixaAberto true.
    // Só usa o livro se o controle da empresa estiver ativo.
    // Mobile omite a flag e permanece em rpc_finalizar_venda.
    const rpcFinalizacao = usarLivroCaixa
      ? "rpc_finalizar_venda_com_caixa"
      : "rpc_finalizar_venda";

    const {
      data,
      error,
    } = await supabase.rpc(
      rpcFinalizacao,
      {
        p_empresa_id:
          vinculo.empresa_id,
        p_idempotency_key:
          input.idempotencyKey,
        p_cliente_id:
          input.clienteId,
        p_tipo_venda:
          "balcao",
        p_modelo_fiscal_intencao:
          null,
        p_desconto:
          centavosParaDecimal(
            input.descontoCentavos
          ),
        p_acrescimo: centavosParaDecimal(acrescimoCentavos),
        p_frete: centavosParaDecimal(freteCentavos),
        p_troco:
          centavosParaDecimal(
            teto.trocoCentavos
          ),
        p_observacao:
          input.observacao?.trim() ||
          null,
        p_itens: itens,
        p_pagamentos:
          pagamentos,
      }
    );

    if (error) {
      console.error(
        "ERRO RPC FINALIZAR VENDA:",
        error
      );

      return {
        ok: false,
        erro: mensagemErroFinalizacaoPublica(
          error.message ||
            "Não foi possível finalizar a venda."
        ),
      };
    }

    const registro =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      !registro?.venda_id ||
      registro.numero === null ||
      registro.numero === undefined
    ) {
      return {
        ok: false,
        erro:
          "A venda foi processada, mas o retorno ficou incompleto.",
      };
    }

    const { data: vendaSnapshot } = await supabase
      .from("vendas")
      .select("id, empresa_id, snapshot_fiscal")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("id", registro.venda_id)
      .maybeSingle();

    if (
      vendaSnapshot &&
      registroPertenceAEmpresaAtiva(vendaSnapshot, vinculo.empresa_id)
    ) {
      const snapAtual = lerSnapshotDestinatarioFiscal(
        vendaSnapshot.snapshot_fiscal
      );
      if (!snapAtual.documentoDefinido) {
        const patchDestinatario = snapshotDestinatarioParaPersistir({
          consumidorFinal: true,
          origem: origemSnapshotAInicializar({ origemVenda: "pdv" }),
          indicadorIe: "9",
          documento: documentoFiscal.documento
            ? {
                numero: documentoFiscal.documento.numero,
                tipo: documentoFiscal.documento.tipo,
                origem: documentoFiscal.documento.origem,
              }
            : null,
        });
        const { error: snapErro } = await supabase
          .from("vendas")
          .update({
            snapshot_fiscal: mesclarSnapshotOperacao(
              vendaSnapshot.snapshot_fiscal,
              patchDestinatario
            ),
          })
          .eq("empresa_id", vinculo.empresa_id)
          .eq("id", registro.venda_id);

        if (snapErro) {
          return {
            ok: false,
            erro:
              "A venda foi registrada, mas não foi possível gravar o destinatário fiscal.",
          };
        }
      }
    }

    if (
      input.catalogoPedidoId &&
      uuidValido(input.catalogoPedidoId)
    ) {
      const agora = new Date().toISOString();
      const usuarioId = String(claimsData.claims.sub);

      let { data: vinculado, error: erroVinculo } = await supabase
        .from("catalogo_pedidos")
        .update({
          status: "CONVERTIDO",
          venda_id: registro.venda_id,
          convertido_em: agora,
          convertido_por: usuarioId,
          updated_at: agora,
        })
        .eq("empresa_id", vinculo.empresa_id)
        .eq("id", input.catalogoPedidoId)
        .is("venda_id", null)
        .in("status", ["NOVO", "EM_ATENDIMENTO", "ACEITO"])
        .select("id")
        .maybeSingle();

      if (erroVinculo) {
        const fallback = await supabase
          .from("catalogo_pedidos")
          .update({
            status: "CONVERTIDO",
            venda_id: registro.venda_id,
            updated_at: agora,
          })
          .eq("empresa_id", vinculo.empresa_id)
          .eq("id", input.catalogoPedidoId)
          .is("venda_id", null)
          .in("status", ["NOVO", "EM_ATENDIMENTO", "ACEITO"])
          .select("id")
          .maybeSingle();

        vinculado = fallback.data;
      }

      if (!vinculado) {
        console.error(
          "VENDA CRIADA SEM VINCULO AO PEDIDO ONLINE:",
          input.catalogoPedidoId,
          registro.venda_id
        );
      }
    }

    return {
      ok: true,
      vendaId:
        String(
          registro.venda_id
        ),
      numero:
        Number(
          registro.numero
        ),
      valorTotalCentavos:
        Math.round(
          Number(
            registro.valor_total ??
              0
          ) * 100
        ),
    };
  } catch (error) {
    console.error(
      "ERRO FINALIZAR VENDA PDV:",
      error
    );

    return {
      ok: false,
      erro: mensagemErroFinalizacaoPublica(error),
    };
  }
}

export async function finalizarVendaPdv(
  input: FinalizarVendaPdvInput
): Promise<FinalizarVendaPdvResultado> {
  const resultado = await executarFinalizacaoVendaPdv(input, {
    exigirCaixaAberto: true,
  });

  if (!resultado.ok && resultado.codigo === "NAO_AUTENTICADO") {
    redirect("/login");
  }

  if (!resultado.ok && resultado.codigo === "SEM_EMPRESA") {
    redirect("/onboarding");
  }

  if (resultado.ok) {
    revalidatePath("/caixa");
  }

  return resultado;
}
