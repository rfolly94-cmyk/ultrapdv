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

function resposta(
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

async function contexto() {
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
      erro:
        resposta(
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
    error: vinculoError,
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

  if (
    vinculoError ||
    !vinculo
  ) {
    return {
      erro:
        resposta(
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
    ).toLowerCase();

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
      erro:
        resposta(
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

function normalizarBody(
  body: Body
) {
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
      "Código IBGE do município deve possuir 7 dígitos."
    );
  }

  return {
    cadastro: {
      nome_razao_social:
        nome,
      nome_fantasia:
        texto(
          body.nome_fantasia
        ) || null,
      cpf_cnpj:
        documento,
      inscricao_estadual:
        texto(
          body.inscricao_estadual
        ) || null,
      rntrc:
        texto(
          body.rntrc
        ) || null,
      telefone:
        texto(
          body.telefone
        ) || null,
      email:
        texto(
          body.email
        ) || null,
      logradouro:
        texto(
          body.logradouro
        ) || null,
      numero:
        texto(
          body.numero
        ) || null,
      complemento:
        texto(
          body.complemento
        ) || null,
      bairro:
        texto(
          body.bairro
        ) || null,
      municipio:
        texto(
          body.municipio
        ) || null,
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
    },
    veiculos:
      Array.isArray(
        body.veiculos
      )
        ? body.veiculos
            .map(
              (
                veiculo
              ) => ({
                id:
                  texto(
                    veiculo.id
                  ) ||
                  null,
                placa:
                  normalizarPlaca(
                    veiculo.placa
                  ),
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
              })
            )
        : [],
  };
}

export async function POST(
  request: NextRequest
) {
  const ctx =
    await contexto();

  if ("erro" in ctx) {
    return ctx.erro;
  }

  const admin =
    createAdminClient();

  try {
    const body =
      (await request
        .json()) as Body;

    const {
      cadastro,
      veiculos,
    } =
      normalizarBody(
        body
      );

    const {
      data: transportadora,
      error: insertError,
    } =
      await admin
        .from(
          "transportadoras"
        )
        .insert({
          empresa_id:
            ctx.empresaId,
          ...cadastro,
        })
        .select(
          "id"
        )
        .single();

    if (
      insertError ||
      !transportadora
    ) {
      const duplicada =
        insertError?.code ===
        "23505";

      return resposta(
        {
          ok: false,
          erro:
            duplicada
              ? "Já existe uma transportadora com este CNPJ/CPF nesta empresa."
              : insertError
                  ?.message ??
                "Não foi possível cadastrar a transportadora.",
        },
        duplicada
          ? 409
          : 422
      );
    }

    if (
      veiculos.length >
      0
    ) {
      const {
        error:
          veiculosError,
      } =
        await admin
          .from(
            "transportadoras_veiculos"
          )
          .insert(
            veiculos.map(
              (
                veiculo
              ) => ({
                empresa_id:
                  ctx.empresaId,
                transportadora_id:
                  transportadora.id,
                placa:
                  veiculo.placa,
                uf:
                  veiculo.uf,
                rntrc:
                  veiculo.rntrc,
                descricao:
                  veiculo.descricao,
                ativo:
                  veiculo.ativo,
              })
            )
          );

      if (
        veiculosError
      ) {
        await admin
          .from(
            "transportadoras"
          )
          .delete()
          .eq(
            "id",
            transportadora.id
          )
          .eq(
            "empresa_id",
            ctx.empresaId
          );

        return resposta(
          {
            ok: false,
            erro:
              `Transportadora não foi concluída porque houve erro nos veículos: ${veiculosError.message}`,
          },
          422
        );
      }
    }

    return resposta({
      ok: true,
      id:
        transportadora.id,
      mensagem:
        "Transportadora cadastrada com sucesso.",
    });
  } catch (error) {
    return resposta(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao cadastrar transportadora.",
      },
      400
    );
  }
}
