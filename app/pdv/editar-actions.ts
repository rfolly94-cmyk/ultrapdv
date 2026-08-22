"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validarPixNaFinalizacaoComercial } from "@/lib/pagamentos/pix/modo-ativo-servidor";
import { ehFormaPix } from "@/lib/pagamentos/pix/local-regras";
import { avaliarTetoPagamentosNoServidor } from "@/lib/pdv/validar-teto-servidor";
import { validarFormaPixNovaVenda } from "@/lib/pdv/formas-pagamento-checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ErroAssinaturaRestrita } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirEmpresaOperacional } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirEdicaoPdv, resultadoNegacaoPdv } from "@/lib/pdv/acesso-operacao";

type Resultado =
  | {
      ok: true;
      vendaId: string;
      numero: number;
      valorTotalCentavos: number;
    }
  | {
      ok: false;
      erro: string;
      codigo?: "RECURSO_NAO_CONTRATADO";
    };

function uuidValido(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function centavosParaDecimal(valor: number) {
  return Math.round(valor) / 100;
}

function revalidarVendaEditada(vendaId: string) {
  revalidatePath(`/vendas/${vendaId}`);
  revalidatePath(`/vendas/${vendaId}/nfe`);
  revalidatePath(`/vendas/${vendaId}/nfce`);
  revalidatePath("/vendas");
  revalidatePath(`/pdv/editar/${vendaId}`);
  revalidatePath(`/pdv/imprimir/recibo/${vendaId}`);
}

type EditarVendaPdvInput = {
  vendaId: string;
  clienteId: string | null;
  descontoCentavos: number;
  trocoCentavos: number;
  itens: Array<{
    vendaItemId: string | null;
    produtoId: string;
    quantidade: number;
  }>;
  pagamentos: Array<{
    formaPagamentoId: string;
    valorCentavos: number;
    pixLocalRecebimentoId?: string | null;
  }>;
};

export async function editarVendaPdv(
  input: EditarVendaPdvInput
): Promise<Resultado> {
  try {
    const supabase =
      await createClient();

    const {
      data: claimsData,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claimsData?.claims?.sub
    ) {
      redirect("/login");
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
      redirect("/onboarding");
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
      await exigirEdicaoPdv({
        empresaId: String(vinculo.empresa_id),
        origem: "editarVendaPdv",
      });
    } catch (error) {
      const negacao = resultadoNegacaoPdv(error);
      if (negacao) {
        return negacao;
      }
      throw error;
    }

    if (!uuidValido(input.vendaId)) {
      return {
        ok: false,
        erro: "Venda inválida.",
      };
    }

    if (
      input.clienteId &&
      !uuidValido(input.clienteId)
    ) {
      return {
        ok: false,
        erro: "Cliente inválido.",
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
        erro: "Desconto inválido.",
      };
    }

    if (
      !Number.isInteger(
        input.trocoCentavos
      ) ||
      input.trocoCentavos < 0
    ) {
      return {
        ok: false,
        erro: "Troco inválido.",
      };
    }

    if (
      !Array.isArray(input.itens) ||
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
        erro: "Informe o pagamento.",
      };
    }

    const itens = input.itens.map(
      (item) => {
        if (
          !uuidValido(item.produtoId) ||
          !Number.isInteger(
            item.quantidade
          ) ||
          item.quantidade <= 0 ||
          (
            item.vendaItemId !== null &&
            !uuidValido(
              item.vendaItemId
            )
          )
        ) {
          throw new Error(
            "Item da venda inválido."
          );
        }

        return {
          venda_item_id:
            item.vendaItemId,
          produto_id: item.produtoId,
          quantidade: item.quantidade,
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
            pagamento.valorCentavos <= 0
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
            quantidade_parcelas: 1,
            indicador_pagamento: "0",
            ...(pagamento.pixLocalRecebimentoId
              ? {
                  pix_local_recebimento_id:
                    pagamento.pixLocalRecebimentoId,
                }
              : {}),
          };
        }
      );

    const teto = await avaliarTetoPagamentosNoServidor({
      supabase,
      empresaId: vinculo.empresa_id,
      itens: input.itens,
      descontoCentavos: input.descontoCentavos,
      pagamentos: input.pagamentos,
    });

    if (!teto.ok) {
      return {
        ok: false,
        erro: teto.erro,
      };
    }

    const { data: pagamentosAtuais } = await supabase
      .from("vendas_pagamentos")
      .select("forma_pagamento_id, valor")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("venda_id", input.vendaId)
      .eq("status", "confirmado");

    const formaIds = [
      ...new Set([
        ...input.pagamentos.map((pagamento) => pagamento.formaPagamentoId),
        ...(pagamentosAtuais ?? [])
          .map((pagamento) => String(pagamento.forma_pagamento_id ?? ""))
          .filter((id) => uuidValido(id)),
      ]),
    ];
    const { data: formasCheckout, error: erroFormas } = await supabase
      .from("formas_pagamento")
      .select("id, tipo, codigo, nome, permite_fiado")
      .eq("empresa_id", vinculo.empresa_id)
      .in("id", formaIds);

    if (erroFormas || !formasCheckout) {
      return {
        ok: false,
        erro: "Não foi possível validar as formas de pagamento.",
      };
    }

    const formaPorId = new Map(
      formasCheckout.map((forma) => [forma.id, forma] as const)
    );

    for (const pagamento of input.pagamentos) {
      try {
        validarFormaPixNovaVenda(
          formaPorId.get(pagamento.formaPagamentoId) ?? null
        );
      } catch (error) {
        return {
          ok: false,
          erro:
            error instanceof Error
              ? error.message
              : "Forma de pagamento PIX inválida.",
        };
      }
    }

    const pixOriginalCentavos = (pagamentosAtuais ?? []).reduce(
      (total, pagamento) => {
        const forma = formaPorId.get(String(pagamento.forma_pagamento_id));
        if (!ehFormaPix(forma ?? null)) {
          return total;
        }
        return total + Math.round(Number(pagamento.valor ?? 0) * 100);
      },
      0
    );
    const pixNovoCentavos = input.pagamentos.reduce((total, pagamento) => {
      const forma = formaPorId.get(pagamento.formaPagamentoId);
      if (!ehFormaPix(forma ?? null)) {
        return total;
      }
      return total + pagamento.valorCentavos;
    }, 0);
    const pixMantidoDaVenda =
      pixNovoCentavos > 0 && pixNovoCentavos === pixOriginalCentavos;

    if (!pixMantidoDaVenda) {
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
    }

    const { data, error } =
      await supabase.rpc(
        "rpc_editar_venda_pdv",
        {
          p_empresa_id:
            vinculo.empresa_id,
          p_venda_id:
            input.vendaId,
          p_cliente_id:
            input.clienteId,
          p_desconto:
            centavosParaDecimal(
              input.descontoCentavos
            ),
          p_troco:
            centavosParaDecimal(
              teto.trocoCentavos
            ),
          p_itens: itens,
          p_pagamentos: pagamentos,
        }
      );

    if (error) {
      console.error(
        "ERRO RPC EDITAR VENDA:",
        error
      );

      return {
        ok: false,
        erro:
          error.message ||
          "Não foi possível alterar a venda.",
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
          "A alteração foi processada, mas o retorno ficou incompleto.",
      };
    }

    if (!pixMantidoDaVenda && pagamentos.some((pagamento) => pagamento.pix_local_recebimento_id)) {
      const admin = createAdminClient();
      const vinculoPix = {
        p_empresa_id: vinculo.empresa_id,
        p_venda_id: input.vendaId,
        p_pagamentos: pagamentos,
      };
      const local = await admin.rpc("pix_local_vincular_na_finalizacao", vinculoPix);
      if (local.error) {
        revalidarVendaEditada(input.vendaId);
        return { ok: false, erro: local.error.message };
      }
      const geranet = await admin.rpc("pix_geranet_vincular_na_finalizacao", vinculoPix);
      if (geranet.error) {
        revalidarVendaEditada(input.vendaId);
        return { ok: false, erro: geranet.error.message };
      }
    }

    revalidarVendaEditada(input.vendaId);

    return {
      ok: true,
      vendaId: String(
        registro.venda_id
      ),
      numero: Number(
        registro.numero
      ),
      valorTotalCentavos:
        Math.round(
          Number(
            registro.valor_total ?? 0
          ) * 100
        ),
    };
  } catch (error) {
    console.error(
      "ERRO EDITAR VENDA PDV:",
      error
    );

    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao alterar a venda.",
    };
  }
}

