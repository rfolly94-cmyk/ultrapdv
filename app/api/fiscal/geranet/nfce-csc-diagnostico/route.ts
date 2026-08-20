import {
  NextResponse,
} from "next/server";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function GET() {
  let supabase: Awaited<
    ReturnType<
      typeof obterContextoAdministracaoUsuarios
    >
  >["supabase"];
  let admin: Awaited<
    ReturnType<
      typeof obterContextoAdministracaoUsuarios
    >
  >["admin"];
  let empresaId: string;

  try {
    const contexto =
      await obterContextoAdministracaoUsuarios({
        mensagemNaoAdmin:
          MENSAGEM_ADMIN_DIAGNOSTICO,
      });
    supabase = contexto.supabase;
    admin = contexto.admin;
    empresaId = contexto.empresaId;
  } catch (error) {
    if (
      error instanceof
      ErroAdministracaoUsuarios
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            error.message,
        },
        {
          status:
            error.status,
        }
      );
    }

    throw error;
  }

  const [
    fiscalResult,
    nfceResult,
    segredosResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "empresas_fiscal"
        )
        .select(
          "ambiente, uf, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      supabase
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

      admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      ),
    ]);

  const primeiroErro =
    fiscalResult.error ??
    nfceResult.error ??
    segredosResult.error;

  if (
    primeiroErro
  ) {
    return NextResponse.json(
      {
        ok: false,
        erro:
          primeiroErro.message,
      },
      {
        status: 500,
      }
    );
  }

  const fiscal =
    fiscalResult.data;

  const configs =
    nfceResult.data ??
    [];

  const config =
    configs.length ===
      1
      ? configs[0]
      : null;

  const segredos =
    (
      segredosResult.data ??
      {}
    ) as {
      csc?: unknown;
    };

  const ambiente =
    Number(
      fiscal?.ambiente
    ) === 1
      ? 1
      : 2;

  const idCsc =
    texto(
      config?.id_csc
    );

  const csc =
    texto(
      segredos.csc
    );

  const idValido =
    /^\d{1,6}$/.test(
      idCsc
    ) &&
    Number(
      idCsc
    ) > 0;

  return NextResponse.json({
    ok:
      Boolean(
        fiscal?.ativo
      ) &&
      configs.length ===
        1 &&
      Boolean(
        config
          ?.csc_configurado
      ) &&
      idValido &&
      Boolean(
        csc
      ),
    ambiente,
    ambiente_nome:
      ambiente === 1
        ? "PRODUCAO"
        : "HOMOLOGACAO",
    uf:
      texto(
        fiscal?.uf
      )
        .toUpperCase(),
    quantidade_configuracoes_nfce_ativas:
      configs.length,
    id_csc:
      idCsc ||
      null,
    id_csc_interno_geranet:
      idValido
        ? idCsc.padStart(
            5,
            "0"
          )
        : null,
    csc_configurado:
      Boolean(
        config
          ?.csc_configurado
      ),
    csc_presente_no_cofre:
      Boolean(
        csc
      ),
    csc_tamanho:
      csc.length,
    aviso:
      ambiente === 2
        ? "Ambiente 2 exige o CSC/ID CSC de HOMOLOGACAO da SEFAZ da UF emitente."
        : "Ambiente 1 exige o CSC/ID CSC de PRODUCAO da SEFAZ da UF emitente.",
    segredo_exposto:
      false,
  });
}
