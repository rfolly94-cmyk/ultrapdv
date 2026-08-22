import { redirect } from "next/navigation";

import {
  cadastrarGrupoFiscal,
  editarGrupoFiscal,
  excluirGrupoFiscal,
} from "../actions";

import { createClient } from "@/lib/supabase/server";
import { GrupoFiscalForm } from "./grupo-fiscal-form";
import { ProdutosModuleTabs } from "@/components/produtos/produtos-module-tabs";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { PageAlert } from "@/components/ui/page-alert";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
    editar?: string;
    novo?: string;
  }>;
};

export default async function GruposFiscaisPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "produtos"
  );
  if (!plano.permitido) {
    return null;
  }

  const {
    data: fiscalEmpresa,
    error: fiscalEmpresaError,
  } = await supabase
    .from("empresas_fiscal")
    .select("codigo_regime_tributario")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  if (fiscalEmpresaError) {
    throw new Error(
      fiscalEmpresaError.message
    );
  }

  const crt =
    fiscalEmpresa?.codigo_regime_tributario ??
    null;

  const tipoIcms:
    | "CSOSN"
    | "CST"
    | "AMBOS" =
    crt === 1 || crt === 4
      ? "CSOSN"
      : crt === 2 || crt === 3
        ? "CST"
        : "AMBOS";

  const { data: grupos, error } = await supabase
    .from("grupos_fiscais")
    .select(`
      id,
      nome,
      descricao,
      ativo,
      cfop_interno,
      cfop_interestadual,
      icms_cst_csosn,
      icms_aliquota,
      pis_cst,
      pis_aliquota,
      cofins_cst,
      cofins_aliquota,
      ipi_aplicavel,
      ipi_cst,
      ipi_aliquota,
      ipi_enquadramento,
      cst_ibscbs,
      classificacao_ibscbs,
      aliquota_ibs_uf,
      aliquota_ibs_municipio,
      aliquota_cbs,
      percentual_reducao_ibs_uf,
      percentual_reducao_ibs_municipio,
      percentual_reducao_cbs,
      ibscbs_manual
    `)
    .eq("empresa_id", vinculo.empresa_id)
    .order("ativo", { ascending: false })
    .order("nome");

  if (error) {
    throw new Error(error.message);
  }

  const [
    {
      data: cstsIbscbs,
      error: cstsIbscbsError,
    },
    {
      data: classificacoesIbscbs,
      error: classificacoesIbscbsError,
    },
  ] = await Promise.all([
    supabase
      .from("fiscal_cst_ibscbs_catalogo")
      .select(
        "codigo, descricao, permite_nfe, permite_nfce"
      )
      .eq("ativo", true)
      .or(
        "permite_nfe.eq.true,permite_nfce.eq.true"
      )
      .order("codigo"),

    supabase
      .from("fiscal_cclasstrib_catalogo")
      .select(`
        codigo,
        cst_codigo,
        descricao,
        percentual_reducao_ibs,
        percentual_reducao_cbs,
        permite_nfe,
        permite_nfce
      `)
      .eq("ativo", true)
      .or(
        "permite_nfe.eq.true,permite_nfce.eq.true"
      )
      .order("codigo"),
  ]);

  if (cstsIbscbsError) {
    throw new Error(
      cstsIbscbsError.message
    );
  }

  if (classificacoesIbscbsError) {
    throw new Error(
      classificacoesIbscbsError.message
    );
  }

  const grupoEdicao = params.editar
    ? grupos?.find(
        (grupo) =>
          grupo.id === params.editar
      )
    : null;

  const mostrarFormulario = Boolean(
    grupoEdicao || params.novo || params.erro
  );

  return (
    <main className="updv-page">
      <PageHeader
        title="Grupos Fiscais"
        description="Grupos fiscais usados nos produtos da empresa."
        count={grupos?.length ?? 0}
        breadcrumb={[
          { label: "Produtos", href: "/produtos" },
          { label: "Grupos Fiscais" },
        ]}
        actions={
          <a
            href="/produtos/grupos-fiscais?novo=1"
            className="updv-btn updv-btn-primary"
          >
            Novo grupo
          </a>
        }
      />
      <ProdutosModuleTabs />

      {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}
      {params.sucesso && (
        <PageAlert type="sucesso">{params.sucesso}</PageAlert>
      )}

      {mostrarFormulario && (
        <section className="mx-4 mt-3 rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="text-[15px] font-semibold">
            {grupoEdicao ? "Editar grupo fiscal" : "Novo grupo fiscal"}
          </h2>

          <GrupoFiscalForm
            grupo={grupoEdicao}
            action={
              grupoEdicao ? editarGrupoFiscal : cadastrarGrupoFiscal
            }
            tipoIcms={tipoIcms}
            cstsIbscbs={cstsIbscbs ?? []}
            classificacoesIbscbs={classificacoesIbscbs ?? []}
          />

          <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
            CFOP, ICMS, PIS, COFINS, IPI, CST IBS/CBS e cClassTrib são
            escolhidos em listas controladas pelo sistema.
          </div>
          <a
            href="/produtos/grupos-fiscais"
            className="updv-btn updv-btn-ghost mt-3"
          >
            Cancelar
          </a>
        </section>
      )}

      <DataTable minWidth={880}>
        <thead>
          <tr>
            <th>Ações</th>
            <th>Nome</th>
            <th>Status</th>
            <th>Fiscal</th>
            <th>CFOP</th>
          </tr>
        </thead>
        <tbody>
          {grupos?.map((grupo) => {
            const fiscalConfigurado =
              !!grupo.cfop_interno &&
              !!grupo.icms_cst_csosn &&
              !!grupo.pis_cst &&
              !!grupo.cofins_cst &&
              !!grupo.cst_ibscbs &&
              !!grupo.classificacao_ibscbs;

            return (
              <tr key={grupo.id}>
                <td>
                  <RowActions
                    editHref={`/produtos/grupos-fiscais?editar=${grupo.id}`}
                    extra={
                      <form action={excluirGrupoFiscal}>
                        <input type="hidden" name="id" value={grupo.id} />
                        <button
                          type="submit"
                          className="updv-btn-row text-red-600"
                        >
                          Excluir
                        </button>
                      </form>
                    }
                  />
                </td>
                <td className="font-medium">{grupo.nome}</td>
                <td>
                  <StatusBadge status={grupo.ativo ? "ativo" : "inativo"} />
                </td>
                <td>
                  <StatusBadge
                    status={fiscalConfigurado ? "ativo" : "pendente"}
                  >
                    {fiscalConfigurado
                      ? "Configurado"
                      : "Pendente"}
                  </StatusBadge>
                </td>
                <td>{grupo.cfop_interno ?? "—"}</td>
              </tr>
            );
          })}
          {!grupos?.length && (
            <DataTableEmpty colSpan={5}>
              Nenhum grupo fiscal cadastrado.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>
    </main>
  );
}
