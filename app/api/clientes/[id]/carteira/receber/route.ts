import {
  NextRequest,
  NextResponse,
} from "next/server";

import { aplicarCors, respostaOptions } from "@/lib/api/cors-mobile";
import { mensagemErroCaixaOperacao } from "@/lib/caixa/mensagens";
import {
  exigirOperacaoCarteira,
  respostaNegacaoCarteira,
} from "@/lib/carteira/acesso-operacao";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import {
  createClient,
} from "@/lib/supabase/server";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type Modo =
  | "TOTAL"
  | "PARCIAL"
  | "ITENS";

type Body = {
  forma_pagamento_id?: string;
  modo?: Modo;
  valor?: number | null;
  item_ids?: string[];
  observacao?: string | null;
  idempotency_key?: string;
};

function resposta(
  body: unknown,
  status = 200
) {
  return aplicarCors(
    NextResponse.json(body, { status }),
    "POST, OPTIONS"
  );
}

export async function OPTIONS() {
  return respostaOptions("POST, OPTIONS");
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  const {
    id: clienteId,
  } =
    await context.params;

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
    return resposta(
      {
        ok: false,
        erro:
          "Não autenticado.",
      },
      401
    );
  }

  const {
    data: vinculo,
    error: vinculoError,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id"
      )
      .eq(
        "usuario_id",
        String(claimsData.claims.sub)
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  if (
    vinculoError ||
    !vinculo
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Empresa ativa não encontrada.",
      },
      403
    );
  }

  try {
    await exigirOperacaoCarteira({
      empresaId: String(vinculo.empresa_id),
      acao: "receber_carteira",
      origem: "POST /api/clientes/[id]/carteira/receber",
    });
  } catch (error) {
    const negacao = respostaNegacaoCarteira(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

  const {
    data: cliente,
    error: clienteError,
  } =
    await supabase
      .from("clientes")
      .select("id")
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "id",
        clienteId
      )
      .maybeSingle();

  if (
    clienteError ||
    !cliente
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Cliente não encontrado.",
      },
      404
    );
  }

  let body: Body;

  try {
    body =
      await request.json();
  } catch {
    return resposta(
      {
        ok: false,
        erro:
          "JSON inválido.",
      },
      400
    );
  }

  const formaPagamentoId =
    String(
      body.forma_pagamento_id ??
      ""
    ).trim();

  const modo =
    String(
      body.modo ??
      ""
    )
      .trim()
      .toUpperCase() as Modo;

  const itemIds =
    Array.isArray(
      body.item_ids
    )
      ? Array.from(
          new Set(
            body.item_ids
              .map(
                (id) =>
                  String(id)
                    .trim()
              )
              .filter(Boolean)
          )
        )
      : [];

  const observacao =
    String(
      body.observacao ??
      ""
    ).trim() || null;

  const idempotencyKey =
    String(
      body.idempotency_key ??
      ""
    ).trim();

  if (!formaPagamentoId) {
    return resposta(
      {
        ok: false,
        erro:
          "Selecione a forma de pagamento.",
      },
      400
    );
  }

  if (
    ![
      "TOTAL",
      "PARCIAL",
      "ITENS",
    ].includes(modo)
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Modo de recebimento inválido.",
      },
      400
    );
  }

  if (!idempotencyKey) {
    return resposta(
      {
        ok: false,
        erro:
          "Chave de idempotência ausente.",
      },
      400
    );
  }

  let valor:
    | number
    | null =
    null;

  if (
    modo ===
    "PARCIAL"
  ) {
    valor =
      Number(
        body.valor
      );

    if (
      !Number.isFinite(
        valor
      ) ||
      valor <= 0
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Informe um valor parcial maior que zero.",
        },
        400
      );
    }
  }

  if (
    modo ===
      "ITENS" &&
    itemIds.length ===
      0
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Selecione ao menos um item.",
      },
      400
    );
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "rpc_receber_carteira_com_caixa",
      {
        p_empresa_id:
          vinculo.empresa_id,
        p_cliente_id:
          clienteId,
        p_forma_pagamento_id:
          formaPagamentoId,
        p_modo:
          modo,
        p_valor:
          valor,
        p_item_ids:
          itemIds,
        p_observacao:
          observacao,
        p_idempotency_key:
          idempotencyKey,
      }
    );

  if (error) {
    return resposta(
      {
        ok: false,
        erro:
          mensagemErroCaixaOperacao(error.message) || error.message,
      },
      422
    );
  }

  const resultado =
    Array.isArray(data)
      ? data[0]
      : data;

  return resposta({
    ok: true,
    resultado,
  });
}
