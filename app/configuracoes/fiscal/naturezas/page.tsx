import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  ROTULOS_FIN_NFE,
  ROTULOS_TIPO_OPERACAO,
  ROTULOS_TP_NF,
  ehCodigoTipoOperacaoInterno,
  ehFinNfeSuportada,
  ehTpNf,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { PageAlert } from "@/components/ui/page-alert";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

import {
  alternarNaturezaOperacao,
  definirNaturezaPadrao,
  salvarNaturezaOperacao,
} from "./actions";
import { NaturezaOperacaoForm } from "./natureza-operacao-form";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
    editar?: string;
    novo?: string;
  }>;
};

export default async function NaturezasOperacaoPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const { data: naturezas, error } = await supabase
    .from("fiscal_naturezas_operacao")
    .select(`
      id,
      empresa_id,
      tipo_operacao_interno,
      descricao,
      tp_nf,
      fin_nfe,
      padrao,
      ativo
    `)
    .eq("empresa_id", vinculo.empresa_id)
    .order("tipo_operacao_interno")
    .order("padrao", { ascending: false })
    .order("descricao");

  if (error) {
    throw new Error(error.message);
  }

  const [
    gruposResult,
    regrasResult,
  ] = await Promise.all([
    supabase
      .from("grupos_fiscais")
      .select(`
        id,
        empresa_id,
        nome,
        ativo,
        cfop_interno,
        cfop_interestadual
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("fiscal_natureza_cfop_regras")
      .select(`
        empresa_id,
        natureza_id,
        grupo_fiscal_id,
        tipo_destino,
        cfop,
        ativo
      `)
      .eq("empresa_id", vinculo.empresa_id),
  ]);

  if (gruposResult.error) {
    throw new Error(gruposResult.error.message);
  }

  if (regrasResult.error) {
    throw new Error(regrasResult.error.message);
  }

  const lista = filtrarRegistrosDaEmpresaAtiva(
    (naturezas ?? []) as NaturezaOperacaoFiscal[],
    vinculo.empresa_id
  );
  const gruposFiscais = filtrarRegistrosDaEmpresaAtiva(
    gruposResult.data ?? [],
    vinculo.empresa_id
  );
  const regrasCfop = filtrarRegistrosDaEmpresaAtiva(
    regrasResult.data ?? [],
    vinculo.empresa_id
  );
  const naturezaEdicao = params.editar
    ? lista.find((item) => item.id === params.editar) ?? null
    : null;
  const mostrarFormulario = Boolean(
    naturezaEdicao || params.novo || params.erro
  );
  const sessaoPermissoes = await obterPermissoesSessao();
  const podeEditar = Boolean(
    sessaoPermissoes &&
      temPermissao(sessaoPermissoes.permissoes, "fiscal", "configurar_fiscal")
  );

  return (
    <div className="updv-config">
      <div className="mb-4 flex justify-end">
        {podeEditar ? (
          <a
            href="/configuracoes/fiscal/naturezas?novo=1"
            className="updv-btn updv-btn-primary"
          >
            Nova natureza
          </a>
        ) : null}
      </div>

      {params.erro ? (
        <PageAlert type="erro" className="mb-4">
          {params.erro}
        </PageAlert>
      ) : null}
      {params.sucesso ? (
        <PageAlert type="sucesso" className="mb-4">
          {params.sucesso}
        </PageAlert>
      ) : null}

      {mostrarFormulario && podeEditar && (
        <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4">
          <NaturezaOperacaoForm
            natureza={naturezaEdicao}
            action={salvarNaturezaOperacao}
            gruposFiscais={gruposFiscais.map((grupo) => ({
              id: grupo.id,
              nome: grupo.nome || "Grupo fiscal",
              ativo: grupo.ativo !== false,
              cfop_interno: grupo.cfop_interno,
              cfop_interestadual: grupo.cfop_interestadual,
            }))}
            regrasCfop={
              naturezaEdicao
                ? regrasCfop
                    .filter(
                      (regra) =>
                        regra.natureza_id === naturezaEdicao.id &&
                        Boolean(regra.grupo_fiscal_id) &&
                        Boolean(regra.cfop) &&
                        (regra.tipo_destino === "interna" ||
                          regra.tipo_destino === "interestadual")
                    )
                    .map((regra) => ({
                      grupo_fiscal_id: String(regra.grupo_fiscal_id),
                      tipo_destino: regra.tipo_destino as
                        | "interna"
                        | "interestadual",
                      cfop: String(regra.cfop),
                      ativo: regra.ativo !== false,
                    }))
                : []
            }
          />
        </div>
      )}

      <div className="rounded-md border border-zinc-200 bg-white">
        <DataTable minWidth={880}>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Tipo interno</th>
              <th>tpNF</th>
              <th>finNFe</th>
              <th>Padrão</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 ? (
              <DataTableEmpty colSpan={7}>
                Nenhuma natureza cadastrada. A migration inicial cria a
                natureza de venda a partir de natureza_operacao_padrao.
              </DataTableEmpty>
            ) : (
              lista.map((natureza) => (
                <tr key={natureza.id}>
                  <td>{natureza.descricao}</td>
                  <td>
                    {ehCodigoTipoOperacaoInterno(
                      natureza.tipo_operacao_interno
                    )
                      ? ROTULOS_TIPO_OPERACAO[natureza.tipo_operacao_interno]
                      : natureza.tipo_operacao_interno}
                  </td>
                  <td>
                    {ehTpNf(natureza.tp_nf)
                      ? ROTULOS_TP_NF[natureza.tp_nf]
                      : natureza.tp_nf}
                  </td>
                  <td>
                    {ehFinNfeSuportada(natureza.fin_nfe)
                      ? ROTULOS_FIN_NFE[natureza.fin_nfe]
                      : natureza.fin_nfe}
                  </td>
                  <td>{natureza.padrao ? "Sim" : "—"}</td>
                  <td>
                    <StatusBadge
                      status={natureza.ativo ? "ativo" : "inativo"}
                    />
                  </td>
                  <td>
                    {podeEditar && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <a
                          href={`/configuracoes/fiscal/naturezas?editar=${natureza.id}`}
                          className="updv-btn-row"
                        >
                          Editar
                        </a>
                        {!natureza.padrao && natureza.ativo && (
                          <form action={definirNaturezaPadrao}>
                            <input type="hidden" name="id" value={natureza.id} />
                            <button type="submit" className="updv-btn-row">
                              Tornar padrão
                            </button>
                          </form>
                        )}
                        <form action={alternarNaturezaOperacao}>
                          <input type="hidden" name="id" value={natureza.id} />
                          <input
                            type="hidden"
                            name="ativo"
                            value={natureza.ativo ? "false" : "true"}
                          />
                          <button type="submit" className="updv-btn-row">
                            {natureza.ativo ? "Desativar" : "Ativar"}
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}
