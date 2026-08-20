import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ErroAdministracaoUsuarios,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

export const metadata = {
  title: "Contabilidade",
};

export default async function ConfiguracoesContabilidadePage() {
  let contexto: Awaited<ReturnType<typeof obterContextoAdministracaoUsuarios>>;

  try {
    contexto = await obterContextoAdministracaoUsuarios();
  } catch (error) {
    if (error instanceof ErroAdministracaoUsuarios && error.status === 401) {
      redirect("/login");
    }
    redirect("/painel");
  }

  const { data: vinculos } = await contexto.admin
    .from("usuarios_empresas")
    .select("usuario_id, perfil, ativo")
    .eq("empresa_id", contexto.empresaId)
    .eq("perfil", "contador");

  const ids = [...new Set((vinculos ?? []).map((item) => item.usuario_id))];
  const { data: usuarios } = ids.length
    ? await contexto.admin
        .from("usuarios")
        .select("id, nome, email")
        .in("id", ids)
    : { data: [] };
  const usuarioPorId = new Map((usuarios ?? []).map((item) => [item.id, item]));

  return (
    <PageShell
      title="Acesso do contador"
      description="Usuários com perfil de contador nesta empresa."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Contabilidade" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
      actions={
        <a href="/configuracoes/usuarios" className="updv-btn updv-btn-primary">
          Vincular contador
        </a>
      }
    >
      <div className="updv-config">
        <p className="mb-4 text-[13px] text-zinc-600">
          O contador usa o mesmo login do UltraPDV. Vincule um usuário com perfil
          Contador em Usuários. Ele só acessa empresas com vínculo explícito e
          entra direto na Área da Contadora.
        </p>

        <DataTable minWidth={700}>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Perfil</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(vinculos ?? []).length === 0 && (
            <DataTableEmpty colSpan={4}>
              Nenhum contador vinculado a esta empresa.
            </DataTableEmpty>
          )}
          {(vinculos ?? []).map((vinculo) => {
            const usuario = usuarioPorId.get(vinculo.usuario_id);
            return (
              <tr key={vinculo.usuario_id}>
                <td>{usuario?.nome ?? "—"}</td>
                <td>{usuario?.email ?? "—"}</td>
                <td>Contador</td>
                <td>
                  <StatusBadge status={vinculo.ativo ? "ativo" : "inativo"} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      </div>
    </PageShell>
  );
}
