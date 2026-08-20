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
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_FUSO_NAO_CONFIGURADO,
  exigirFusoHorarioFiscalDaEmissao,
} from "@/lib/fiscal/fuso-horario-empresa";

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    { status }
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function POST(
  request: NextRequest
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

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

  const usuarioId =
    String(
      claims.claims.sub
    );

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
        String(usuarioId)
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
    ).toLowerCase();

  if (
    ![
      "administrador",
      "admin",
    ].includes(
      perfil
    )
  ) {
    return json(
      {
        ok: false,
        erro:
          "Somente administrador pode alterar o ambiente fiscal.",
      },
      403
    );
  }

  const body =
    await request
      .json()
      .catch(
        () => null
      ) as
      | {
          ambiente?: unknown;
          confirmar?: unknown;
          motivo?: unknown;
        }
      | null;

  if (!body) {
    return json(
      {
        ok: false,
        erro:
          "JSON inválido.",
      },
      400
    );
  }

  const ambienteNovo =
    Number(
      body.ambiente
    );

  if (
    ambienteNovo !== 1
  ) {
    return json(
      {
        ok: false,
        erro:
          "Esta rota libera apenas a virada controlada para Produção.",
      },
      400
    );
  }

  if (
    texto(
      body.confirmar
    ).toUpperCase() !==
    "PRODUCAO"
  ) {
    return json(
      {
        ok: false,
        erro:
          "Confirmação PRODUCAO ausente.",
      },
      400
    );
  }

  const motivo =
    texto(
      body.motivo
    );

  if (
    motivo.length <
      10 ||
    motivo.length >
      500
  ) {
    return json(
      {
        ok: false,
        erro:
          "Motivo da alteração de ambiente inválido.",
      },
      400
    );
  }

  const empresaId =
    vinculo.empresa_id;

  const [
    empresaResult,
    fiscalResult,
    nfceResult,
    numeracoesResult,
    sensiveisResult,
    segredosResult,
  ] =
    await Promise.all([
      admin
        .from(
          "empresas"
        )
        .select(
          "id, cnpj, ativo"
        )
        .eq(
          "id",
          empresaId
        )
        .maybeSingle(),

      admin
        .from(
          "empresas_fiscal"
        )
        .select(`
          empresa_id,
          ambiente,
          ativo,
          inscricao_estadual,
          uf,
          codigo_municipio_ibge,
          codigo_regime_tributario,
          natureza_operacao_padrao,
          fuso_horario
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      admin
        .from(
          "fiscal_nfce_config"
        )
        .select(
          "id, id_csc, csc_configurado, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "ativo",
          true
        ),

      admin
        .from(
          "fiscal_numeracoes"
        )
        .select(
          "id, modelo, ambiente, serie, proximo_numero, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "ambiente",
          1
        )
        .eq(
          "ativo",
          true
        )
        .in(
          "modelo",
          [
            "55",
            "65",
          ]
        ),

      admin
        .from(
          "fiscal_emissoes"
        )
        .select(
          "id, status"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .in(
          "status",
          [
            "reservada",
            "enviando",
            "erro_comunicacao",
            "aguardando_reconciliacao",
            "aguardando_transmissao_contingencia",
            "transmitindo_contingencia",
          ]
        )
        .limit(1),

      admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      ),
    ]);

  const primeiroErro =
    empresaResult.error ??
    fiscalResult.error ??
    nfceResult.error ??
    numeracoesResult.error ??
    sensiveisResult.error ??
    segredosResult.error;

  if (
    primeiroErro
  ) {
    return json(
      {
        ok: false,
        erro:
          primeiroErro.message,
      },
      500
    );
  }

  const empresa =
    empresaResult.data;

  const fiscal =
    registroPertenceAEmpresaAtiva(
      fiscalResult.data,
      empresaId
    )
      ? fiscalResult.data
      : null;

  if (
    !empresa ||
    !fiscal
  ) {
    return json(
      {
        ok: false,
        erro:
          "Empresa ou configuração fiscal não encontrada.",
      },
      409
    );
  }

  if (
    Number(
      fiscal.ambiente
    ) === 1
  ) {
    return json({
      ok: true,
      mensagem:
        "A empresa já está em Produção.",
    });
  }

  const bloqueios:
    string[] = [];

  const cnpj =
    texto(
      empresa.cnpj
    ).replace(
      /\D/g,
      ""
    );

  const ibge =
    texto(
      fiscal
        .codigo_municipio_ibge
    ).replace(
      /\D/g,
      ""
    );

  const crt =
    Number(
      fiscal
        .codigo_regime_tributario
    );

  if (
    !empresa.ativo ||
    cnpj.length !==
      14
  ) {
    bloqueios.push(
      "Empresa/CNPJ não está pronta."
    );
  }

  if (
    !fiscal.ativo ||
    !texto(
      fiscal
        .inscricao_estadual
    ) ||
    !/^[A-Z]{2}$/.test(
      texto(
        fiscal.uf
      ).toUpperCase()
    ) ||
    ibge.length !==
      7 ||
    ![
      1,
      2,
      3,
      4,
    ].includes(
      crt
    )
  ) {
    bloqueios.push(
      "Cadastro fiscal do emitente está incompleto."
    );
  }

  if (
    !texto(
      fiscal
        .natureza_operacao_padrao
    )
  ) {
    bloqueios.push(
      "Natureza padrão não configurada."
    );
  }

  try {
    exigirFusoHorarioFiscalDaEmissao({
      empresaIdDaEmissao: empresaId,
      fiscal,
    });
  } catch {
    bloqueios.push(
      MENSAGEM_FUSO_NAO_CONFIGURADO
    );
  }

  const segredos =
    (
      segredosResult.data ??
      {}
    ) as {
      geranet_api_key?: unknown;
      certificado_a1?: unknown;
      senha_certificado?: unknown;
      csc?: unknown;
    };

  if (
    !texto(
      segredos
        .geranet_api_key
    )
  ) {
    bloqueios.push(
      "API Key da Geranet ausente."
    );
  }

  if (
    !texto(
      segredos
        .certificado_a1
    ) ||
    !texto(
      segredos
        .senha_certificado
    )
  ) {
    bloqueios.push(
      "Certificado A1 ou senha ausente."
    );
  }

  const numeracoes =
    numeracoesResult.data ??
    [];

  const nfe =
    numeracoes.find(
      (item) =>
        String(
          item.modelo
        ) === "55"
    );

  if (
    !nfe ||
    Number(
      nfe.proximo_numero
    ) <= 0
  ) {
    bloqueios.push(
      "Numeração de Produção da NF-e 55 não configurada."
    );
  }

  const nfce =
    numeracoes.find(
      (item) =>
        String(
          item.modelo
        ) === "65"
    );

  const configs =
    nfceResult.data ??
    [];

  const config =
    configs.length ===
      1
      ? configs[0]
      : null;

  if (
    !nfce ||
    Number(
      nfce.proximo_numero
    ) <= 0
  ) {
    bloqueios.push(
      "Numeração de Produção da NFC-e 65 não configurada."
    );
  }

  if (
    configs.length !==
      1 ||
    !config
      ?.csc_configurado ||
    !texto(
      config?.id_csc
    ) ||
    !texto(
      segredos.csc
    )
  ) {
    bloqueios.push(
      "CSC/ID CSC da NFC-e não está pronto."
    );
  }

  if (
    (
      sensiveisResult.data ??
      []
    ).length >
    0
  ) {
    bloqueios.push(
      "Existe emissão fiscal em estado sensível."
    );
  }

  if (
    bloqueios.length >
    0
  ) {
    return json(
      {
        ok: false,
        erro:
          "A empresa ainda não está pronta para Produção.",
        bloqueios,
      },
      409
    );
  }

  const agora =
    new Date()
      .toISOString();

  const {
    error:
      ambienteError,
  } =
    await admin
      .from(
        "empresas_fiscal"
      )
      .update({
        ambiente:
          1,
        updated_at:
          agora,
      })
      .eq(
        "empresa_id",
        empresaId
      )
      .eq(
        "ambiente",
        fiscal.ambiente
      );

  if (
    ambienteError
  ) {
    return json(
      {
        ok: false,
        erro:
          ambienteError.message,
      },
      500
    );
  }

  const {
    error:
      auditoriaError,
  } =
    await admin
      .from(
        "fiscal_ambiente_alteracoes"
      )
      .insert({
        empresa_id:
          empresaId,
        ambiente_anterior:
          Number(
            fiscal.ambiente
          ) === 1
            ? 1
            : 2,
        ambiente_novo:
          1,
        motivo,
        usuario_id:
          usuarioId,
      });

  if (
    auditoriaError
  ) {
    // A mudança já ocorreu. Não faça rollback automático:
    // rollback poderia tornar uma emissão concorrente inconsistente.
    console.error(
      "[AUDITORIA AMBIENTE FISCAL]",
      auditoriaError.message
    );
  }

  return json({
    ok: true,
    ambiente:
      1,
    mensagem:
      "Ambiente fiscal alterado para PRODUÇÃO. As próximas emissões usarão as numerações de ambiente 1.",
  });
}
