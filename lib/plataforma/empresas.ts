import "server-only";

import type { User } from "@supabase/supabase-js";

import { contarConfirmacaoProprietarios } from "@/lib/plataforma/metricas";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 20;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function sanitizarBusca(valor: string) {
  return valor.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

async function mapaConfirmacao(
  admin: ReturnType<typeof createAdminClient>,
  usuarioIds: string[]
) {
  const unicos = [...new Set(usuarioIds.filter(Boolean))];
  const mapa = new Map<string, { email: string | null; confirmado: boolean; ultimoAcesso: string | null }>();

  await Promise.all(
    unicos.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) {
        mapa.set(id, { email: null, confirmado: false, ultimoAcesso: null });
        return;
      }
      const user = data.user as User;
      mapa.set(id, {
        email: user.email ?? null,
        confirmado: Boolean(user.email_confirmed_at),
        ultimoAcesso: user.last_sign_in_at ?? null,
      });
    })
  );

  return mapa;
}

export async function metricasPlataforma(
  admin: ReturnType<typeof createAdminClient>
) {
  const [
    empresas,
    usuarios,
    recentes,
    donos,
  ] = await Promise.all([
    admin.from("empresas").select("id", { count: "exact", head: true }),
    admin.from("usuarios").select("id", { count: "exact", head: true }),
    admin
      .from("empresas")
      .select("id, nome_fantasia, razao_social, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("empresas")
      .select("proprietario_usuario_id")
      .not("proprietario_usuario_id", "is", null),
  ]);

  const idsDonos = (donos.data ?? [])
    .map((linha) => String(linha.proprietario_usuario_id ?? ""))
    .filter(Boolean);
  const confirmacao = await mapaConfirmacao(admin, idsDonos);
  const { proprietariosConfirmados, proprietariosPendentes } =
    contarConfirmacaoProprietarios(idsDonos, (id) =>
      Boolean(confirmacao.get(id)?.confirmado)
    );

  return {
    totalEmpresas: empresas.count ?? 0,
    totalUsuarios: usuarios.count ?? 0,
    empresasRecentes: recentes.data ?? [],
    proprietariosConfirmados,
    proprietariosPendentes,
  };
}

export async function listarEmpresasPlataforma(
  admin: ReturnType<typeof createAdminClient>,
  {
    q = "",
    page = 1,
  }: {
    q?: string;
    page?: number;
  }
) {
  const busca = sanitizarBusca(q);
  const pagina = Number.isFinite(page) && page > 0 ? page : 1;
  const from = (pagina - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let idsDono: string[] = [];
  if (busca) {
    const { data } = await admin
      .from("usuarios")
      .select("id")
      .or(`nome.ilike.%${busca}%,email.ilike.%${busca}%`);
    idsDono = (data ?? []).map((linha) => String(linha.id));
  }

  let consulta = admin
    .from("empresas")
    .select(
      "id, razao_social, nome_fantasia, cnpj, created_at, proprietario_usuario_id",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (busca) {
    const donoFiltro =
      idsDono.length > 0
        ? `,proprietario_usuario_id.in.(${idsDono.join(",")})`
        : "";
    consulta = consulta.or(
      `razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%,cnpj.ilike.%${busca}%${donoFiltro}`
    );
  }

  const { data, count, error } = await consulta;
  if (error) {
    throw new Error(error.message);
  }

  const empresas = data ?? [];
  const empresaIds = empresas.map((empresa) => String(empresa.id));
  const donoIds = empresas
    .map((empresa) => String(empresa.proprietario_usuario_id ?? ""))
    .filter(Boolean);

  const [{ data: vinculos }, { data: donos }, confirmacao] = await Promise.all([
    empresaIds.length
      ? admin
          .from("usuarios_empresas")
          .select("empresa_id")
          .in("empresa_id", empresaIds)
      : Promise.resolve({ data: [] as Array<{ empresa_id: string }> }),
    donoIds.length
      ? admin.from("usuarios").select("id, nome, email").in("id", donoIds)
      : Promise.resolve({ data: [] as Array<{ id: string; nome: string | null; email: string | null }> }),
    mapaConfirmacao(admin, donoIds),
  ]);

  const contagem = new Map<string, number>();
  for (const vinculo of vinculos ?? []) {
    const id = String(vinculo.empresa_id);
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  const donoPorId = new Map(
    (donos ?? []).map((dono) => [String(dono.id), dono])
  );

  return {
    page: pagina,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
    q: busca,
    linhas: empresas.map((empresa) => {
      const donoId = empresa.proprietario_usuario_id
        ? String(empresa.proprietario_usuario_id)
        : "";
      const dono = donoId ? donoPorId.get(donoId) : null;
      const auth = donoId ? confirmacao.get(donoId) : null;
      return {
        id: String(empresa.id),
        nome: texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
        razaoSocial: texto(empresa.razao_social),
        cnpj: texto(empresa.cnpj),
        createdAt: String(empresa.created_at ?? ""),
        usuarios: contagem.get(String(empresa.id)) ?? 0,
        proprietario: dono
          ? {
              id: donoId,
              nome: texto(dono.nome) || "—",
              email: texto(dono.email || auth?.email),
              confirmado: Boolean(auth?.confirmado),
            }
          : null,
      };
    }),
  };
}

export async function detalheEmpresaPlataforma(
  admin: ReturnType<typeof createAdminClient>,
  empresaId: string
) {
  const { data: empresa, error } = await admin
    .from("empresas")
    .select(
      "id, razao_social, nome_fantasia, cnpj, created_at, proprietario_usuario_id"
    )
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!empresa) {
    return null;
  }

  const donoId = empresa.proprietario_usuario_id
    ? String(empresa.proprietario_usuario_id)
    : "";

  const [vinculos, fiscal, pix, catalogo, dono, confirmacao] = await Promise.all([
    admin
      .from("usuarios_empresas")
      .select("usuario_id, perfil, ativo, usuarios ( id, nome, email )")
      .eq("empresa_id", empresaId)
      .order("perfil"),
    admin
      .from("empresas_fiscal")
      .select("ativo, ambiente, uf")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    admin
      .from("integracoes_pix")
      .select("ativo, modo, provedor")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    admin
      .from("catalogo_config")
      .select("id, slug, ativo")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    donoId
      ? admin
          .from("usuarios")
          .select("id, nome, email")
          .eq("id", donoId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    mapaConfirmacao(admin, donoId ? [donoId] : []),
  ]);

  const authDono = donoId ? confirmacao.get(donoId) : null;
  const usuarios = (vinculos.data ?? []).map((vinculo) => {
    const usuario = Array.isArray(vinculo.usuarios)
      ? vinculo.usuarios[0]
      : vinculo.usuarios;
    return {
      id: String(vinculo.usuario_id),
      nome: texto(usuario?.nome) || "—",
      email: texto(usuario?.email),
      perfil: texto(vinculo.perfil),
      ativo: Boolean(vinculo.ativo),
    };
  });

  return {
    id: String(empresa.id),
    razaoSocial: texto(empresa.razao_social),
    nomeFantasia: texto(empresa.nome_fantasia),
    cnpj: texto(empresa.cnpj),
    createdAt: String(empresa.created_at ?? ""),
    proprietario: dono.data
      ? {
          id: donoId,
          nome: texto(dono.data.nome) || "—",
          email: texto(dono.data.email || authDono?.email),
          confirmado: Boolean(authDono?.confirmado),
          ultimoAcesso: authDono?.ultimoAcesso ?? null,
        }
      : null,
    usuarios,
    fiscal: fiscal.data
      ? {
          preparada: true,
          ativo: Boolean(fiscal.data.ativo),
          ambiente: fiscal.data.ambiente,
          uf: fiscal.data.uf,
        }
      : { preparada: false, ativo: false, ambiente: null, uf: null },
    pix: {
      configurado: Boolean(pix.data?.ativo || pix.data?.provedor),
      modo: pix.data?.modo ?? null,
    },
    catalogo: {
      configurado: Boolean(catalogo.data?.id),
      slug: catalogo.data?.slug ?? null,
    },
  };
}
