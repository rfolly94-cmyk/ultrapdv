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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type VeiculoBody = {
  id?: unknown;
  placa?: unknown;
  uf?: unknown;
  rntrc?: unknown;
  descricao?: unknown;
  ativo?: unknown;
};

type Body = {
  nome_razao_social?: unknown;
  nome_fantasia?: unknown;
  cpf_cnpj?: unknown;
  inscricao_estadual?: unknown;
  rntrc?: unknown;
  telefone?: unknown;
  email?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  municipio?: unknown;
  codigo_municipio_ibge?: unknown;
  uf?: unknown;
  cep?: unknown;
  ativo?: unknown;
  veiculos?: VeiculoBody[];
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

function texto(
  valor: unknown
) {
  return String(
    valor ??
    ""
  ).trim();
}

function digitos(
  valor: unknown
) {
  return texto(valor)
    .replace(/\D/g, "");
}

function normalizarUf(
  valor: unknown
) {
  const retorno =
    texto(valor)
      .toUpperCase();

  if (!retorno) {
    return null;
  }

  if (
    !/^[A-Z]{2}$/.test(
      retorno
    )
  ) {
    throw new Error(
      "UF deve possuir 2 letras."
    );
  }

  return retorno;
}

function normalizarPlaca(
  valor: unknown
) {
  const placa =
    texto(valor)
      .toUpperCase()
      .replace(
        /[^A-Z0-9]/g,
        ""
      );

  if (
    !/^[A-Z0-9]{7}$/.test(
      placa
    )
  ) {
    throw new Error(
      "Placa deve possuir 7 caracteres."
    );
  }

  return placa;
}

async function empresaPermitida() {
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
    return {
      response:
        json(
          {
            ok: false,
            erro:
              "Não autenticado.",
          },
          401
        ),
    };
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

  if (!vinculo) {
    return {
      response:
        json(
          {
            ok: false,
            erro:
              "Empresa ativa não encontrada.",
          },
          403
        ),
    };
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
    return {
      response:
        json(
          {
            ok: false,
            erro:
              "Seu perfil não pode gerenciar transportadoras.",
          },
          403
        ),
    };
  }

  return {
    empresaId:
      vinculo.empresa_id,
  };
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id,
  } =
    await context.params;

  const ctx =
    await empresaPermitida();

  if (
    "response" in ctx
  ) {
    return ctx.response;
  }

  const admin =
    createAdminClient();

  try {
    const body =
      (await request
        .json()) as Body;

    const documento =
      digitos(
        body.cpf_cnpj
      );

    if (
      documento.length !==
        11 &&
      documento.length !==
        14
    ) {
      throw new Error(
        "CNPJ/CPF deve possuir 11 ou 14 dígitos."
      );
    }

    const nome =
      texto(
        body.nome_razao_social
      );

    if (!nome) {
      throw new Error(
        "Nome / Razão Social é obrigatório."
      );
    }

    const cep =
      digitos(
        body.cep
      );

    if (
      cep &&
      cep.length !== 8
    ) {
      throw new Error(
        "CEP deve possuir 8 dígitos."
      );
    }

    const codigoIbge =
      digitos(
        body.codigo_municipio_ibge
      );

    if (
      codigoIbge &&
      codigoIbge.length !==
        7
    ) {
      throw new Error(
        "Código IBGE deve possuir 7 dígitos."
      );
    }

    const {
      data: existente,
      error:
        existenteError,
    } =
      await admin
        .from(
          "transportadoras"
        )
        .select(
          "id"
        )
        .eq(
          "id",
          id
        )
        .eq(
          "empresa_id",
          ctx.empresaId
        )
        .maybeSingle();

    if (
      existenteError ||
      !existente
    ) {
      return json(
        {
          ok: false,
          erro:
            "Transportadora não encontrada.",
        },
        404
      );
    }

    const {
      error: updateError,
    } =
      await admin
        .from(
          "transportadoras"
        )
        .update({
          nome_razao_social:
            nome,
          nome_fantasia:
            texto(
              body.nome_fantasia
            ) ||
            null,
          cpf_cnpj:
            documento,
          inscricao_estadual:
            texto(
              body.inscricao_estadual
            ) ||
            null,
          rntrc:
            texto(
              body.rntrc
            ) ||
            null,
          telefone:
            texto(
              body.telefone
            ) ||
            null,
          email:
            texto(
              body.email
            ) ||
            null,
          logradouro:
            texto(
              body.logradouro
            ) ||
            null,
          numero:
            texto(
              body.numero
            ) ||
            null,
          complemento:
            texto(
              body.complemento
            ) ||
            null,
          bairro:
            texto(
              body.bairro
            ) ||
            null,
          municipio:
            texto(
              body.municipio
            ) ||
            null,
          codigo_municipio_ibge:
            codigoIbge ||
            null,
          uf:
            normalizarUf(
              body.uf
            ),
          cep:
            cep ||
            null,
          ativo:
            body.ativo !==
            false,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          id
        )
        .eq(
          "empresa_id",
          ctx.empresaId
        );

    if (
      updateError
    ) {
      return json(
        {
          ok: false,
          erro:
            updateError.code ===
            "23505"
              ? "Já existe outra transportadora com este CNPJ/CPF."
              : updateError.message,
        },
        422
      );
    }

    // Marca veículos antigos como inativos; os enviados abaixo serão reativados/upsertados.
    const {
      error:
        inativarError,
    } =
      await admin
        .from(
          "transportadoras_veiculos"
        )
        .update({
          ativo: false,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "empresa_id",
          ctx.empresaId
        )
        .eq(
          "transportadora_id",
          id
        );

    if (
      inativarError
    ) {
      return json(
        {
          ok: false,
          erro:
            inativarError.message,
        },
        422
      );
    }

    const veiculos =
      Array.isArray(
        body.veiculos
      )
        ? body.veiculos
        : [];

    for (
      const veiculo of
      veiculos
    ) {
      const placa =
        normalizarPlaca(
          veiculo.placa
        );

      const payload = {
        empresa_id:
          ctx.empresaId,
        transportadora_id:
          id,
        placa,
        uf:
          normalizarUf(
            veiculo.uf
          ),
        rntrc:
          texto(
            veiculo.rntrc
          ) ||
          null,
        descricao:
          texto(
            veiculo.descricao
          ) ||
          null,
        ativo:
          veiculo.ativo !==
          false,
        updated_at:
          new Date()
            .toISOString(),
      };

      const veiculoId =
        texto(
          veiculo.id
        );

      if (veiculoId) {
        const {
          error,
        } =
          await admin
            .from(
              "transportadoras_veiculos"
            )
            .update(
              payload
            )
            .eq(
              "id",
              veiculoId
            )
            .eq(
              "empresa_id",
              ctx.empresaId
            )
            .eq(
              "transportadora_id",
              id
            );

        if (error) {
          return json(
            {
              ok: false,
              erro:
                error.code ===
                "23505"
                  ? `A placa ${placa} já está cadastrada.`
                  : error.message,
            },
            422
          );
        }
      } else {
        const {
          error,
        } =
          await admin
            .from(
              "transportadoras_veiculos"
            )
            .insert(
              payload
            );

        if (error) {
          return json(
            {
              ok: false,
              erro:
                error.code ===
                "23505"
                  ? `A placa ${placa} já está cadastrada.`
                  : error.message,
            },
            422
          );
        }
      }
    }

    return json({
      ok: true,
      mensagem:
        "Transportadora alterada com sucesso.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao alterar transportadora.",
      },
      400
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  const {
    id,
  } =
    await context.params;

  const ctx =
    await empresaPermitida();

  if (
    "response" in ctx
  ) {
    return ctx.response;
  }

  const admin =
    createAdminClient();

  const agora =
    new Date()
      .toISOString();

  const {
    error: veiculosError,
  } =
    await admin
      .from(
        "transportadoras_veiculos"
      )
      .update({
        ativo: false,
        updated_at:
          agora,
      })
      .eq(
        "empresa_id",
        ctx.empresaId
      )
      .eq(
        "transportadora_id",
        id
      );

  if (
    veiculosError
  ) {
    return json(
      {
        ok: false,
        erro:
          veiculosError.message,
      },
      422
    );
  }

  const {
    error,
  } =
    await admin
      .from(
        "transportadoras"
      )
      .update({
        ativo: false,
        updated_at:
          agora,
      })
      .eq(
        "id",
        id
      )
      .eq(
        "empresa_id",
        ctx.empresaId
      );

  if (error) {
    return json(
      {
        ok: false,
        erro:
          error.message,
      },
      422
    );
  }

  return json({
    ok: true,
    mensagem:
      "Transportadora desativada com sucesso.",
  });
}
