import Link from "next/link";

import { obterContextoAdminPlataforma } from "@/lib/plataforma/contexto";
import { listarEmpresasPlataforma } from "@/lib/plataforma/empresas";
import {
  rotuloEmailConfirmado,
  rotuloProprietario,
} from "@/lib/plataforma/rotulos";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresas",
};

type PageProps = {
  searchParams: Promise<{
    q?: string;
    page?: string;
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
  }).format(data);
}

export default async function AdminEmpresasPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { admin } = await obterContextoAdminPlataforma();
  const lista = await listarEmpresasPlataforma(admin, {
    q: params.q ?? "",
    page: Number(params.page ?? "1"),
  });
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
          Empresas
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Empresas sem proprietário aparecem como Não definido. Não há
          inferência automática.
        </p>
      </div>

      <form className="flex gap-2" action="/admin-plataforma/empresas">
        <input
          name="q"
          defaultValue={lista.q}
          placeholder="Buscar por nome, CNPJ ou proprietário"
          className="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Buscar
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">CNPJ</th>
              <th className="px-4 py-3 font-medium">Proprietário</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">E-mail confirmado</th>
              <th className="px-4 py-3 font-medium">Usuários</th>
              <th className="px-4 py-3 font-medium">Criada em</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {lista.linhas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            )}
            {lista.linhas.map((linha) => (
              <tr key={linha.id} className="text-zinc-800">
                <td className="px-4 py-3 font-medium">{linha.nome}</td>
                <td className="px-4 py-3">{formatarCnpj(linha.cnpj)}</td>
                <td className="px-4 py-3">
                  {rotuloProprietario(linha.proprietario)}
                </td>
                <td className="px-4 py-3">
                  {linha.proprietario?.email || "—"}
                </td>
                <td className="px-4 py-3">
                  {linha.proprietario
                    ? rotuloEmailConfirmado(linha.proprietario.confirmado)
                    : "—"}
                </td>
                <td className="px-4 py-3">{linha.usuarios}</td>
                <td className="px-4 py-3">{formatarData(linha.createdAt)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin-plataforma/empresas/${linha.id}`}
                    className="font-medium text-zinc-900 underline"
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center gap-3 text-sm">
          {lista.page > 1 && (
            <Link
              href={`/admin-plataforma/empresas?q=${encodeURIComponent(lista.q)}&page=${lista.page - 1}`}
              className="underline"
            >
              Anterior
            </Link>
          )}
          <span className="text-zinc-500">
            Página {lista.page} de {totalPaginas}
          </span>
          {lista.page < totalPaginas && (
            <Link
              href={`/admin-plataforma/empresas?q=${encodeURIComponent(lista.q)}&page=${lista.page + 1}`}
              className="underline"
            >
              Próxima
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
