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
    valor ?? ""
  ).trim();
}

function somenteDigitos(
  valor: unknown
) {
  return texto(
    valor
  ).replace(
    /\D/g,
    ""
  );
}

function cnpjValido(
  valor: string
) {
  const cnpj =
    somenteDigitos(
      valor
    );

  if (
    cnpj.length !==
    14
  ) {
    return false;
  }

  if (
    /^(\d)\1{13}$/.test(
      cnpj
    )
  ) {
    return false;
  }

  function calcular(
    base: string,
    pesos: number[]
  ) {
    const soma =
      base
        .split("")
        .reduce(
          (
            total,
            digito,
            index
          ) =>
            total +
            Number(
              digito
            ) *
            pesos[
              index
            ],
          0
        );

    const resto =
      soma % 11;

    return resto < 2
      ? 0
      : 11 -
          resto;
  }

  const primeiro =
    calcular(
      cnpj.slice(
        0,
        12
      ),
      [
        5,
        4,
        3,
        2,
        9,
        8,
        7,
        6,
        5,
        4,
        3,
        2,
      ]
    );

  if (
    primeiro !==
    Number(
      cnpj[12]
    )
  ) {
    return false;
  }

  const segundo =
    calcular(
      cnpj.slice(
        0,
        13
      ),
      [
        6,
        5,
        4,
        3,
        2,
        9,
        8,
        7,
        6,
        5,
        4,
        3,
        2,
      ]
    );

  return (
    segundo ===
    Number(
      cnpj[13]
    )
  );
}

export async function POST(
  request: NextRequest
) {
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: claimsError,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    claimsError ||
    !usuarioId
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
    data: userData,
    error: userError,
  } =
    await supabase
      .auth
      .getUser();

  const email =
    userData.user
      ?.email
      ?.trim()
      .toLowerCase() ??
    "";

  if (
    userError ||
    !email
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Não foi possível identificar o e-mail do usuário autenticado.",
      },
      401
    );
  }

  if (
    !userData.user
      ?.email_confirmed_at
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Confirme seu e-mail antes de cadastrar a empresa.",
        destino:
          "/confirmar-email",
      },
      403
    );
  }

  let body: {
    nome?: unknown;
    razao_social?: unknown;
    nome_fantasia?: unknown;
    cnpj?: unknown;
  };

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

  const nome =
    texto(
      body.nome
    );

  const razaoSocial =
    texto(
      body.razao_social
    );

  const nomeFantasia =
    texto(
      body.nome_fantasia
    );

  const cnpj =
    somenteDigitos(
      body.cnpj
    );

  if (
    nome.length < 2
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Informe o nome do responsável.",
      },
      422
    );
  }

  if (
    razaoSocial.length <
    2
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Informe a razão social.",
      },
      422
    );
  }

  if (
    nomeFantasia.length <
    2
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Informe o nome fantasia.",
      },
      422
    );
  }

  if (
    !cnpjValido(
      cnpj
    )
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "CNPJ inválido.",
      },
      422
    );
  }

  const admin =
    createAdminClient();

  const {
    data: vinculoAtual,
    error:
      vinculoAtualError,
  } =
    await admin
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id"
      )
      .eq(
        "usuario_id",
        String(
          usuarioId
        )
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .limit(1);

  if (
    vinculoAtualError
  ) {
    return resposta(
      {
        ok: false,
        erro:
          vinculoAtualError.message,
      },
      500
    );
  }

  if (
    (
      vinculoAtual ??
      []
    ).length > 0
  ) {
    return resposta(
      {
        ok: false,
        erro:
          "Este login já possui uma empresa principal ativa.",
        destino:
          "/painel",
      },
      409
    );
  }

  const {
    data,
    error,
  } =
    await admin.rpc(
      "rpc_criar_empresa_onboarding",
      {
        p_usuario_id:
          String(
            usuarioId
          ),
        p_email:
          email,
        p_nome:
          nome,
        p_razao_social:
          razaoSocial,
        p_nome_fantasia:
          nomeFantasia,
        p_cnpj:
          cnpj,
      }
    );

  if (
    error
  ) {
    const mensagem =
      error.message
        .replace(
          /^.*?:\s*/,
          ""
        )
        .trim();

    return resposta(
      {
        ok: false,
        erro:
          mensagem ||
          "Não foi possível criar a empresa.",
      },
      mensagem
        .toLowerCase()
        .includes(
          "já"
        )
        ? 409
        : 500
    );
  }

  return resposta(
    {
      ok: true,
      destino:
        "/painel",
      resultado:
        data,
      mensagem:
        "Empresa criada com sucesso.",
    },
    201
  );
}
