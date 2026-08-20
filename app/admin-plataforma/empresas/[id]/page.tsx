import { notFound } from "next/navigation";
import Link from "next/link";

import { registrarAuditoriaPlataforma } from "@/lib/plataforma/auditoria";
import { obterContextoAdminPlataforma } from "@/lib/plataforma/contexto";
import { detalheEmpresaPlataforma } from "@/lib/plataforma/empresas";
import {
  rotuloEmailConfirmado,
  rotuloProprietario,
} from "@/lib/plataforma/rotulos";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatarCnpj(valor: string) {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) {
    return valor || "—";
  }
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

function formatarData(valor: string) {
  if (!valor) {
    return "—";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `Empresa ${id.slice(0, 8)}` };
}

export default async function AdminEmpresaDetalhePage({
  params,
}: PageProps) {
  const { id } = await params;
  const { admin, usuarioId } = await obterContextoAdminPlataforma();
  const detalhe = await detalheEmpresaPlataforma(admin, id);

  if (!detalhe) {
    notFound();
  }

  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: "empresa.detalhe.visualizar",
    empresaId: detalhe.id,
    metadados: { origem: "admin-plataforma" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin-plataforma/empresas"
          className="text-sm text-zinc-500 underline"
        >
          ← Empresas
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-950">
          {detalhe.nomeFantasia || detalhe.razaoSocial || "Empresa"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {detalhe.razaoSocial} · {formatarCnpj(detalhe.cnpj)}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Empresa</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Criada em</dt>
              <dd>{formatarData(detalhe.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">CNPJ</dt>
              <dd>{formatarCnpj(detalhe.cnpj)}</dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Proprietário</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Nome</dt>
              <dd>{rotuloProprietario(detalhe.proprietario)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">E-mail</dt>
              <dd>{detalhe.proprietario?.email || "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">E-mail confirmado</dt>
              <dd>
                {detalhe.proprietario
                  ? rotuloEmailConfirmado(detalhe.proprietario.confirmado)
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Último acesso</dt>
              <dd>
                {detalhe.proprietario?.ultimoAcesso
                  ? formatarData(detalhe.proprietario.ultimoAcesso)
                  : "—"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">
            Configuração fiscal
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Preparada</dt>
              <dd>{detalhe.fiscal.preparada ? "Sim" : "Não"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Ativo</dt>
              <dd>{detalhe.fiscal.ativo ? "Sim" : "Não"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Ambiente</dt>
              <dd>{detalhe.fiscal.ambiente ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">UF</dt>
              <dd>{detalhe.fiscal.uf ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Integrações</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">PIX configurado?</dt>
              <dd>{detalhe.pix.configurado ? "Sim" : "Não"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Modo PIX</dt>
              <dd>{detalhe.pix.modo ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Catálogo configurado?</dt>
              <dd>{detalhe.catalogo.configurado ? "Sim" : "Não"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Slug do catálogo</dt>
              <dd>{detalhe.catalogo.slug ?? "—"}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">Usuários</h2>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Perfil</th>
              <th className="px-4 py-3 font-medium">Ativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {detalhe.usuarios.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  Nenhum usuário vinculado.
                </td>
              </tr>
            )}
            {detalhe.usuarios.map((usuario) => (
              <tr key={usuario.id}>
                <td className="px-4 py-3">{usuario.nome}</td>
                <td className="px-4 py-3">{usuario.email || "—"}</td>
                <td className="px-4 py-3">{usuario.perfil}</td>
                <td className="px-4 py-3">{usuario.ativo ? "Sim" : "Não"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
