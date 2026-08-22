import { redirect } from "next/navigation";

import {
  cadastrarMarca,
  editarMarca,
  excluirMarca,
} from "../actions";

import { createClient } from "@/lib/supabase/server";
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

export default async function MarcasPage({
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

  const { data: registros, error } = await supabase
    .from("marcas")
    .select("id, nome, ativo")
    .eq("empresa_id", vinculo.empresa_id)
    .order("ativo", { ascending: false })
    .order("nome");

  if (error) {
    throw new Error(error.message);
  }

  const registroEdicao = params.editar
    ? registros?.find((registro) => registro.id === params.editar)
    : null;
  const mostrarFormulario = Boolean(
    registroEdicao || params.novo || params.erro
  );

  return (
    <main className="updv-page">
      <PageHeader
        title="Marcas"
        description="Marcas usadas no cadastro de produtos."
        count={registros?.length ?? 0}
        breadcrumb={[
          { label: "Produtos", href: "/produtos" },
          { label: "Marcas" },
        ]}
        actions={
          <a href="/produtos/marcas?novo=1" className="updv-btn updv-btn-primary">
            Nova marca
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
            {registroEdicao ? "Editar marca" : "Nova marca"}
          </h2>

          <form
            action={registroEdicao ? editarMarca : cadastrarMarca}
            className="mt-3 grid gap-3 md:grid-cols-[1fr_160px_auto]"
          >
            {registroEdicao && (
              <input type="hidden" name="id" value={registroEdicao.id} />
            )}

            <div>
              <label className="block text-[13px] font-medium text-zinc-700">
                Nome
              </label>
              <input
                name="nome"
                defaultValue={registroEdicao?.nome ?? ""}
                required
                autoFocus
                className="updv-input mt-1 w-full"
              />
            </div>

            {registroEdicao && (
              <div>
                <label className="block text-[13px] font-medium text-zinc-700">
                  Status
                </label>
                <select
                  name="ativo"
                  defaultValue={registroEdicao.ativo ? "true" : "false"}
                  className="updv-select mt-1 w-full"
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </div>
            )}

            <div className="flex items-end gap-2">
              <button type="submit" className="updv-btn updv-btn-primary">
                {registroEdicao ? "Salvar" : "Cadastrar"}
              </button>
              <a href="/produtos/marcas" className="updv-btn updv-btn-ghost">
                Cancelar
              </a>
            </div>
          </form>
        </section>
      )}

      <DataTable minWidth={640}>
        <thead>
          <tr>
            <th>Ações</th>
            <th>Nome</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {registros?.map((registro) => (
            <tr key={registro.id}>
              <td>
                <RowActions
                  editHref={`/produtos/marcas?editar=${registro.id}`}
                  extra={
                    <form action={excluirMarca}>
                      <input type="hidden" name="id" value={registro.id} />
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
              <td className="font-medium">{registro.nome}</td>
              <td>
                <StatusBadge status={registro.ativo ? "ativo" : "inativo"} />
              </td>
            </tr>
          ))}
          {!registros?.length && (
            <DataTableEmpty colSpan={3}>
              Nenhum registro cadastrado.
            </DataTableEmpty>
          )}
        </tbody>
      </DataTable>
    </main>
  );
}
