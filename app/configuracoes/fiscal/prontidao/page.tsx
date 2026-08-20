import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  ProntidaoProducaoWorkspace,
} from "@/components/fiscal/prontidao-producao-workspace";
import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  checkFusoHorarioProntidao,
  checkNaturezaProntidao,
} from "@/lib/fiscal/fuso-horario-empresa";

export const dynamic =
  "force-dynamic";

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export default async function ProntidaoFiscalPage() {
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
    redirect("/login");
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
    redirect(
      "/onboarding"
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
    configContingenciaResult,
    segredosResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "empresas"
        )
        .select(
          "id, razao_social, nome_fantasia, cnpj, ativo"
        )
        .eq(
          "id",
          empresaId
        )
        .maybeSingle(),

      supabase
        .from(
          "empresas_fiscal"
        )
        .select(`
          empresa_id,
          ambiente,
          ativo,
          inscricao_estadual,
          uf,
          municipio,
          codigo_municipio_ibge,
          codigo_regime_tributario,
          perfil_ipi,
          natureza_operacao_padrao,
          fuso_horario
        `)
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

      supabase
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

      supabase
        .from(
          "fiscal_emissoes"
        )
        .select(
          "id, modelo, serie, numero, ambiente, status, origem_id"
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
        .limit(50),

      supabase
        .from(
          "fiscal_contingencia_config"
        )
        .select(
          "nfce_offline_habilitada, justificativa_padrao"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

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
    sensiveisResult.error;

  if (
    primeiroErro
  ) {
    throw new Error(
      primeiroErro.message
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

  const {
    data: naturezaVendaBruta,
  } =
    await supabase
      .from(
        "fiscal_naturezas_operacao"
      )
      .select(
        "id, empresa_id, descricao, tp_nf, fin_nfe, padrao, ativo, tipo_operacao_interno"
      )
      .eq(
        "empresa_id",
        empresaId
      )
      .eq(
        "tipo_operacao_interno",
        "venda"
      )
      .eq(
        "padrao",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  const naturezaVenda =
    registroPertenceAEmpresaAtiva(
      naturezaVendaBruta,
      empresaId
    )
      ? naturezaVendaBruta
      : null;

  const nfceConfigs =
    nfceResult.data ??
    [];

  const numeracoes =
    numeracoesResult.data ??
    [];

  const sensiveis =
    sensiveisResult.data ??
    [];

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

  const nfceConfig =
    nfceConfigs.length ===
      1
      ? nfceConfigs[0]
      : null;

  const numeracaoNfe =
    numeracoes.find(
      (item) =>
        String(
          item.modelo
        ) === "55"
    ) ??
    null;

  const numeracaoNfce =
    numeracoes.find(
      (item) =>
        String(
          item.modelo
        ) === "65"
    ) ??
    null;

  const crt =
    Number(
      fiscal
        ?.codigo_regime_tributario
    );

  const cnpj =
    texto(
      empresa?.cnpj
    ).replace(
      /\D/g,
      ""
    );

  const ibge =
    texto(
      fiscal
        ?.codigo_municipio_ibge
    ).replace(
      /\D/g,
      ""
    );

  const checks = [
    {
      codigo:
        "empresa",
      titulo:
        "Empresa ativa",
      ok:
        Boolean(
          empresa?.ativo
        ) &&
        cnpj.length ===
          14,
      detalhe:
        empresa?.ativo
          ? `CNPJ ${
              cnpj.length ===
              14
                ? "válido no formato"
                : "incompleto"
            }.`
          : "Empresa ausente ou inativa.",
      obrigatorio:
        true,
    },
    {
      codigo:
        "fiscal",
      titulo:
        "Cadastro fiscal do emitente",
      ok:
        Boolean(
          fiscal?.ativo
        ) &&
        Boolean(
          texto(
            fiscal
              ?.inscricao_estadual
          )
        ) &&
        /^[A-Z]{2}$/.test(
          texto(
            fiscal?.uf
          ).toUpperCase()
        ) &&
        ibge.length ===
          7 &&
        [
          1,
          2,
          3,
          4,
        ].includes(
          crt
        ),
      detalhe:
        `IE ${
          texto(
            fiscal
              ?.inscricao_estadual
          ) ||
          "—"
        } · UF ${
          texto(
            fiscal?.uf
          ) ||
          "—"
        } · IBGE ${
          ibge ||
          "—"
        } · CRT ${
          Number.isFinite(
            crt
          )
            ? crt
            : "—"
        }.`,
      obrigatorio:
        true,
    },
    {
      codigo:
        "geranet",
      titulo:
        "Integração Geranet",
      ok:
        Boolean(
          texto(
            segredos
              .geranet_api_key
          )
        ),
      detalhe:
        texto(
          segredos
            .geranet_api_key
        )
          ? "API Key presente no cofre fiscal."
          : "API Key da Geranet não encontrada.",
      obrigatorio:
        true,
    },
    {
      codigo:
        "certificado",
      titulo:
        "Certificado A1",
      ok:
        Boolean(
          texto(
            segredos
              .certificado_a1
          )
        ) &&
        Boolean(
          texto(
            segredos
              .senha_certificado
          )
        ),
      detalhe:
        texto(
          segredos
            .certificado_a1
        )
          ? "Certificado e senha estão armazenados."
          : "Certificado A1 ausente.",
      obrigatorio:
        true,
    },
    {
      codigo:
        "nfe",
      titulo:
        "NF-e modelo 55",
      ok:
        Boolean(
          numeracaoNfe
        ) &&
        Number(
          numeracaoNfe
            ?.proximo_numero
        ) >
          0,
      detalhe:
        numeracaoNfe
          ? `Produção · série ${numeracaoNfe.serie} · próximo nº ${numeracaoNfe.proximo_numero}.`
          : "Numeração de produção NF-e ainda não configurada.",
      obrigatorio:
        true,
    },
    {
      codigo:
        "nfce",
      titulo:
        "NFC-e modelo 65",
      ok:
        nfceConfigs.length ===
          1 &&
        Boolean(
          nfceConfig
            ?.csc_configurado
        ) &&
        Boolean(
          texto(
            nfceConfig
              ?.id_csc
          )
        ) &&
        Boolean(
          texto(
            segredos.csc
          )
        ) &&
        Boolean(
          numeracaoNfce
        ) &&
        Number(
          numeracaoNfce
            ?.proximo_numero
        ) >
          0,
      detalhe:
        nfceConfigs.length !==
          1
          ? "Deve existir exatamente uma configuração NFC-e ativa."
          : !nfceConfig
              ?.csc_configurado ||
            !texto(
              nfceConfig
                ?.id_csc
            ) ||
            !texto(
              segredos.csc
            )
            ? "CSC / ID CSC da NFC-e ainda não está completamente configurado."
            : numeracaoNfce
              ? `CSC configurado · produção série ${numeracaoNfce.serie} · próximo nº ${numeracaoNfce.proximo_numero}.`
              : "Numeração de produção NFC-e ainda não configurada.",
      obrigatorio:
        true,
    },
    checkNaturezaProntidao(
      naturezaVenda,
      empresaId
    ),
    checkFusoHorarioProntidao(
      fiscal,
      empresaId
    ),
    {
      codigo:
        "pendencias",
      titulo:
        "Nenhum documento fiscal em estado sensível",
      ok:
        sensiveis.length ===
        0,
      detalhe:
        sensiveis.length ===
        0
          ? "Nenhuma reserva, transmissão ou reconciliação pendente."
          : `${sensiveis.length} emissão(ões) precisam ser resolvidas antes da virada.`,
      obrigatorio:
        true,
    },
    {
      codigo:
        "contingencia",
      titulo:
        "Contingência NFC-e",
      ok:
        Boolean(
          configContingenciaResult
            .data
            ?.nfce_offline_habilitada
        ),
      detalhe:
        configContingenciaResult
          .data
          ?.nfce_offline_habilitada
          ? "Contingência NFC-e está habilitada."
          : "Recomendado habilitar contingência antes da produção.",
      obrigatorio:
        false,
    }
  ];

  const bloqueadores =
    checks.filter(
      (item) =>
        item.obrigatorio &&
        !item.ok
    );

  return (
    <ProntidaoProducaoWorkspace
      empresaNome={
        empresa
          ?.nome_fantasia ||
        empresa
          ?.razao_social ||
        "Empresa ativa"
      }
      ambienteAtual={
        Number(
          fiscal?.ambiente
        ) === 1
          ? 1
          : 2
      }
      checks={
        checks
      }
      bloqueadores={
        bloqueadores.length
      }
      perfil={
        String(
          vinculo.perfil ??
          ""
        )
      }
    />
  );
}
