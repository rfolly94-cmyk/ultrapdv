import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  ContingenciaWorkspace,
} from "@/components/fiscal/contingencia/contingencia-workspace";

export const dynamic =
  "force-dynamic";

export default async function ContingenciaFiscalPage() {
  const supabase =
    await createClient();

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
    configResult,
    emissoesResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "empresas"
        )
        .select(
          "id, razao_social, nome_fantasia"
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
          "fiscal_contingencia_config"
        )
        .select(`
          empresa_id,
          nfce_offline_habilitada,
          justificativa_padrao,
          updated_at
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      supabase
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          origem_tipo,
          origem_id,
          modelo,
          serie,
          numero,
          ambiente,
          status,
          tipo_emissao,
          contingencia_justificativa,
          contingencia_gerada_at,
          contingencia_transmitida_at,
          contingencia_tentativas,
          contingencia_erro,
          chave_acesso,
          protocolo,
          cstat,
          motivo,
          xml_contingencia_hex,
          pdf_contingencia_hex,
          created_at,
          autorizada_at
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "tipo_emissao",
          "contingencia_offline"
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(100),
    ]);

  const primeiroErro =
    empresaResult.error ??
    fiscalResult.error ??
    configResult.error ??
    emissoesResult.error;

  if (primeiroErro) {
    throw new Error(
      primeiroErro.message
    );
  }

  const fiscal =
    fiscalResult.data;

  const ambiente =
    Number(
      fiscal?.ambiente
    ) === 1
      ? "1"
      : "2";

  return (
    <ContingenciaWorkspace
      empresaNome={
        empresaResult.data
          ?.nome_fantasia ||
        empresaResult.data
          ?.razao_social ||
        "Empresa ativa"
      }
      ambiente={
        ambiente
      }
      uf={
        String(
          fiscal?.uf ??
          ""
        )
          .trim()
          .toUpperCase()
      }
      perfil={
        String(
          vinculo.perfil ??
          ""
        )
      }
      config={{
        habilitada:
          Boolean(
            configResult.data
              ?.nfce_offline_habilitada
          ),
        justificativa:
          configResult.data
            ?.justificativa_padrao ||
          "Indisponibilidade temporária de comunicação com a SEFAZ.",
      }}
      emissoes={
        (
          emissoesResult.data ??
          []
        ).map(
          (item) => ({
            ...item,
            serie:
              Number(
                item.serie
              ),
            numero:
              String(
                item.numero
              ),
            contingencia_tentativas:
              Number(
                item
                  .contingencia_tentativas ??
                0
              ),
            tem_xml:
              Boolean(
                item
                  .xml_contingencia_hex
              ),
            tem_pdf:
              Boolean(
                item
                  .pdf_contingencia_hex
              ),
          })
        )
      }
    />
  );
}
