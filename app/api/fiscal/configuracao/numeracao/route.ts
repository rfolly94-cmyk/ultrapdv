import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

type Body = {
  modelo?: unknown;
  ambiente?: unknown;
  serie?: unknown;
  ultima_nota?: unknown;
  nova_serie?: unknown;
};

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

function inteiro(
  valor: unknown
) {
  const numero =
    Number(valor);

  return Number.isInteger(
    numero
  )
    ? numero
    : NaN;
}

function texto(
  valor: unknown
) {
  return String(
    valor ??
    ""
  ).trim();
}

function serieValida(
  serie: number
) {
  return (
    (
      serie >= 1 &&
      serie <= 889
    ) ||
    (
      serie >= 920 &&
      serie <= 969
    )
  );
}

export async function POST(
  request: NextRequest
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  try {
    const {
      data: claims,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claims?.claims?.sub
    ) {
      return json(
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
    } =
      await supabase
        .from(
          "usuarios_empresas"
        )
        .select(
          "empresa_id, perfil"
        )
        .eq(
          "usuario_id",
          String(claims.claims.sub)
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

    if (!vinculo) {
      return json(
        {
          ok: false,
          erro:
            "Empresa ativa não encontrada.",
        },
        403
      );
    }

    const perfil =
      texto(
        vinculo.perfil
      )
        .toLowerCase();

    if (
      ![
        "administrador",
        "admin",
        "gerente",
      ].includes(
        perfil
      )
    ) {
      return json(
        {
          ok: false,
          erro:
            "Seu perfil não pode alterar a numeração fiscal.",
        },
        403
      );
    }

    const body =
      (await request
        .json()) as Body;

    const modelo =
      texto(
        body.modelo
      );

    if (
      modelo !== "55" &&
      modelo !== "65"
    ) {
      return json(
        {
          ok: false,
          erro:
            "Modelo fiscal inválido.",
        },
        400
      );
    }

    const ambiente =
      inteiro(
        body.ambiente
      );

    if (
      ambiente !== 1 &&
      ambiente !== 2
    ) {
      return json(
        {
          ok: false,
          erro:
            "Ambiente fiscal inválido.",
        },
        400
      );
    }

    const serie =
      inteiro(
        body.serie
      );

    if (
      !Number.isInteger(
        serie
      ) ||
      !serieValida(
        serie
      )
    ) {
      return json(
        {
          ok: false,
          erro:
            "Série inválida. Use 1–889 ou 920–969.",
        },
        400
      );
    }

    const ultimaNota =
      inteiro(
        body.ultima_nota
      );

    if (
      !Number.isInteger(
        ultimaNota
      ) ||
      ultimaNota < 0 ||
      ultimaNota >
        999_999_998
    ) {
      return json(
        {
          ok: false,
          erro:
            "Último número utilizado inválido.",
        },
        400
      );
    }

    const novaSerie =
      body.nova_serie ===
      true;

    if (
      novaSerie &&
      ultimaNota !== 0
    ) {
      return json(
        {
          ok: false,
          erro:
            "Uma série nova deve começar com último número 0.",
        },
        400
      );
    }

    const empresaId =
      vinculo.empresa_id;

    const proximoNumero =
      ultimaNota + 1;

    const {
      data: maiorEmissao,
      error:
        maiorEmissaoError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(
          "numero, status"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "modelo",
          modelo
        )
        .eq(
          "ambiente",
          ambiente
        )
        .eq(
          "serie",
          serie
        )
        .order(
          "numero",
          {
            ascending:
              false,
          }
        )
        .limit(1);

    if (
      maiorEmissaoError
    ) {
      return json(
        {
          ok: false,
          erro:
            `Não foi possível validar o histórico fiscal: ${maiorEmissaoError.message}`,
        },
        500
      );
    }

    const maiorNumeroInterno =
      maiorEmissao?.[0]
        ? Number(
            maiorEmissao[0]
              .numero
          )
        : 0;

    if (
      Number.isFinite(
        maiorNumeroInterno
      ) &&
      maiorNumeroInterno >=
        proximoNumero
    ) {
      return json(
        {
          ok: false,
          erro:
            `O UltraPDV já possui o número ${maiorNumeroInterno} nesta série e neste ambiente. Configure no mínimo o próximo número ${maiorNumeroInterno + 1}.`,
        },
        409
      );
    }

    const {
      data: alvo,
      error: alvoError,
    } =
      await admin
        .from(
          "fiscal_numeracoes"
        )
        .select(`
          id,
          proximo_numero,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "modelo",
          modelo
        )
        .eq(
          "ambiente",
          ambiente
        )
        .eq(
          "serie",
          serie
        )
        .maybeSingle();

    if (
      alvoError
    ) {
      return json(
        {
          ok: false,
          erro:
            alvoError.message,
        },
        500
      );
    }

    if (
      alvo &&
      Number(
        alvo.proximo_numero
      ) >
        proximoNumero
    ) {
      // Correção manual segura:
      // só permite reduzir a sequência quando NÃO existe nenhuma
      // emissão já reservada/gerada com número >= ao próximo desejado.
      const {
        data:
          emissaoConflitante,
        error:
          emissaoConflitanteError,
      } =
        await admin
          .from(
            "fiscal_emissoes"
          )
          .select(
            "numero, status"
          )
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "modelo",
            modelo
          )
          .eq(
            "ambiente",
            ambiente
          )
          .eq(
            "serie",
            serie
          )
          .gte(
            "numero",
            proximoNumero
          )
          .order(
            "numero",
            {
              ascending:
                true,
            }
          )
          .limit(1);

      if (
        emissaoConflitanteError
      ) {
        return json(
          {
            ok: false,
            erro:
              `Não foi possível validar a redução da sequência: ${emissaoConflitanteError.message}`,
          },
          500
        );
      }

      if (
        emissaoConflitante &&
        emissaoConflitante.length >
          0
      ) {
        return json(
          {
            ok: false,
            erro:
              `Não é possível reduzir para ${proximoNumero}: já existe a emissão nº ${emissaoConflitante[0].numero} nesta série e ambiente.`,
          },
          409
        );
      }
    }

    // Desativa somente outras séries do MESMO modelo e MESMO ambiente.
    const {
      error:
        desativarError,
    } =
      await admin
        .from(
          "fiscal_numeracoes"
        )
        .update({
          ativo: false,
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "modelo",
          modelo
        )
        .eq(
          "ambiente",
          ambiente
        )
        .neq(
          "serie",
          serie
        );

    if (
      desativarError
    ) {
      return json(
        {
          ok: false,
          erro:
            `Falha ao desativar séries anteriores: ${desativarError.message}`,
        },
        500
      );
    }

    const proximoFinal =
      proximoNumero;

    if (alvo) {
      const {
        error,
      } =
        await admin
          .from(
            "fiscal_numeracoes"
          )
          .update({
            proximo_numero:
              proximoFinal,
            ativo:
              true,
          })
          .eq(
            "id",
            alvo.id
          )
          .eq(
            "empresa_id",
            empresaId
          );

      if (error) {
        return json(
          {
            ok: false,
            erro:
              `Falha ao atualizar a numeração: ${error.message}`,
          },
          500
        );
      }
    } else {
      const {
        error,
      } =
        await admin
          .from(
            "fiscal_numeracoes"
          )
          .insert({
            empresa_id:
              empresaId,
            modelo,
            ambiente,
            serie,
            proximo_numero:
              proximoFinal,
            ativo:
              true,
          });

      if (error) {
        return json(
          {
            ok: false,
            erro:
              error.code ===
              "23505"
                ? "Já existe uma configuração concorrente para este modelo/ambiente. Atualize a página e confira a numeração."
                : `Falha ao criar a numeração: ${error.message}`,
          },
          error.code ===
            "23505"
            ? 409
            : 500
        );
      }
    }

    return json({
      ok: true,
      modelo,
      ambiente,
      serie,
      ultima_nota:
        ultimaNota,
      proximo_numero:
        proximoFinal,
      mensagem:
        `${modelo === "55" ? "NF-e" : "NFC-e"} — ${ambiente === 1 ? "Produção" : "Homologação"} — série ${serie}: próximo número ${proximoFinal}.`,
    });
  } catch (
    error
  ) {
    console.error(
      "[NUMERAÇÃO FISCAL POR AMBIENTE]",
      error
    );

    return json(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao salvar a numeração fiscal.",
      },
      500
    );
  }
}
