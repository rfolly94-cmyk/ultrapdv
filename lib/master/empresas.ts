import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { exigirMaster } from "@/lib/master/exigir-master";
import {
  empresaPodeOperar,
  rotuloStatusAssinatura,
  statusAssinaturaValido,
} from "@/lib/assinatura/empresa-pode-operar";
import type { StatusAssinatura } from "@/lib/assinatura/tipos";
import { obterLimite } from "@/lib/plataforma/recursos/resolver";
import {
  detalheEventoAuditoriaEmpresa,
  rotuloPerfilEmpresa,
} from "@/lib/master/apresentacao-empresa";
import type { EmpresaMasterDetalheDados } from "@/lib/master/empresa-tipos";

const PAGE_SIZE = 20;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function sanitizarBusca(valor: string) {
  return valor.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function uuidOuVazio(valor: string) {
  const id = texto(valor);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  )
    ? id
    : "";
}

function numeroOuNulo(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function valorContratado(
  contratado: unknown,
  catalogo: unknown
) {
  return numeroOuNulo(contratado) ?? numeroOuNulo(catalogo);
}

function inicioMesSaoPauloIso() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((item) => item.type === "year")?.value ?? "1970";
  const mes = partes.find((item) => item.type === "month")?.value ?? "01";
  return `${ano}-${mes}-01T00:00:00-03:00`;
}

async function contarSeguro(
  admin: SupabaseClient,
  tabela: string,
  aplicar: (consulta: any) => any
) {
  try {
    const { count, error } = await aplicar(
      admin.from(tabela).select("id", {
        count: "exact",
        head: true,
      })
    );
    if (error) {
      return null;
    }
    return count ?? 0;
  } catch {
    return null;
  }
}

async function contarUsuariosPorEmpresas(
  admin: SupabaseClient,
  empresaIds: string[]
) {
  const mapa = new Map<string, number>();
  if (empresaIds.length === 0) {
    return mapa;
  }

  const { data, error } = await admin
    .from("usuarios_empresas")
    .select("empresa_id")
    .in("empresa_id", empresaIds);

  if (error) {
    return mapa;
  }

  for (const linha of data ?? []) {
    const id = String(linha.empresa_id ?? "");
    if (!id) {
      continue;
    }
    mapa.set(id, (mapa.get(id) ?? 0) + 1);
  }

  return mapa;
}

type PlanoJoin = { nome?: string | null; valor_mensal?: number | null } | null;

function desaninharPlano(valor: unknown): PlanoJoin {
  if (Array.isArray(valor)) {
    return (valor[0] ?? null) as PlanoJoin;
  }
  return (valor ?? null) as PlanoJoin;
}

export type EmpresaMasterListaLinha = {
  id: string;
  nome: string;
  cnpj: string;
  plano: string;
  status: string;
  rotuloStatus: string;
  valorContratado: number | null;
  usuarios: number | null;
  vencimento: string | null;
  cadastro: string;
  operacional: boolean;
};

export async function metricasMaster() {
  const { admin } = await exigirMaster();
  const { data: assinaturas, error } = await admin
    .from("assinaturas_empresas")
    .select("status, planos ( valor_mensal )");

  if (error) {
    throw new Error(error.message);
  }

  const linhas = assinaturas ?? [];
  const contar = (status: StatusAssinatura) =>
    linhas.filter((item) => item.status === status).length;

  const receita = linhas
    .filter((item) => item.status === "ativa" || item.status === "trial")
    .reduce((total, item) => {
      const plano = Array.isArray(item.planos) ? item.planos[0] : item.planos;
      const valor = Number(
        (plano as { valor_mensal?: number } | null)?.valor_mensal ?? 0
      );
      return total + (Number.isFinite(valor) ? valor : 0);
    }, 0);

  const { count: totalEmpresas } = await admin
    .from("empresas")
    .select("id", { count: "exact", head: true });

  return {
    empresas: totalEmpresas ?? linhas.length,
    ativas: contar("ativa"),
    trial: contar("trial"),
    carencia: contar("carencia"),
    suspensas: contar("suspensa"),
    canceladas: contar("cancelada"),
    receitaMensalEstimada: receita,
  };
}

export async function listarEmpresasMaster({
  q = "",
  status = "",
  planoId = "",
  page = 1,
}: {
  q?: string;
  status?: string;
  planoId?: string;
  page?: number;
}) {
  const { admin } = await exigirMaster();
  const busca = sanitizarBusca(q);
  const filtro = statusAssinaturaValido(status) ? status : "";
  const plano = uuidOuVazio(planoId);
  const pagina = Number.isFinite(page) && page > 0 ? page : 1;
  const from = (pagina - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const porAssinatura = Boolean(filtro || plano);
  let linhas: EmpresaMasterListaLinha[] = [];
  let total = 0;

  if (porAssinatura) {
    let consulta = admin
      .from("assinaturas_empresas")
      .select(
        "status, vencimento_em, liberado_ate, carencia_ate, valor_mensal_contratado, planos ( nome, valor_mensal ), empresas ( id, razao_social, nome_fantasia, cnpj, created_at )",
        { count: "exact" }
      )
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (filtro) {
      consulta = consulta.eq("status", filtro);
    }
    if (plano) {
      consulta = consulta.eq("plano_id", plano);
    }
    if (busca) {
      consulta = consulta.or(
        `empresas.razao_social.ilike.%${busca}%,empresas.nome_fantasia.ilike.%${busca}%,empresas.cnpj.ilike.%${busca}%`
      );
    }

    const { data, count, error } = await consulta;
    if (error) {
      throw new Error(error.message);
    }
    total = count ?? 0;
    linhas = (data ?? [])
      .map((linha) => {
        const empresa = Array.isArray(linha.empresas)
          ? linha.empresas[0]
          : linha.empresas;
        if (!empresa) {
          return null;
        }
        const planoJoin = desaninharPlano(linha.planos);
        const assinatura = {
          empresa_id: String(empresa.id),
          status: String((linha.status ?? filtro) || "ativa"),
          vencimento_em: linha.vencimento_em
            ? String(linha.vencimento_em)
            : null,
          liberado_ate: linha.liberado_ate ? String(linha.liberado_ate) : null,
          carencia_ate: linha.carencia_ate ? String(linha.carencia_ate) : null,
        };
        return {
          id: String(empresa.id),
          nome:
            texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
          cnpj: texto(empresa.cnpj),
          plano: planoJoin?.nome ? String(planoJoin.nome) : "—",
          status: assinatura.status,
          rotuloStatus: rotuloStatusAssinatura(assinatura),
          valorContratado: valorContratado(
            linha.valor_mensal_contratado,
            planoJoin?.valor_mensal
          ),
          usuarios: null as number | null,
          vencimento: assinatura.vencimento_em,
          cadastro: String(empresa.created_at ?? ""),
          operacional: empresaPodeOperar(assinatura),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  } else {
    let consulta = admin
      .from("empresas")
      .select(
        "id, razao_social, nome_fantasia, cnpj, created_at, assinaturas_empresas ( status, vencimento_em, liberado_ate, carencia_ate, valor_mensal_contratado, planos ( nome, valor_mensal ) )",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (busca) {
      consulta = consulta.or(
        `razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%,cnpj.ilike.%${busca}%`
      );
    }

    const { data, count, error } = await consulta;
    if (error) {
      throw new Error(error.message);
    }
    total = count ?? 0;
    linhas = (data ?? []).map((empresa) => {
      const assinaturaRaw = Array.isArray(empresa.assinaturas_empresas)
        ? empresa.assinaturas_empresas[0]
        : empresa.assinaturas_empresas;
      const planoJoin = assinaturaRaw
        ? desaninharPlano(assinaturaRaw.planos)
        : null;
      const assinatura = assinaturaRaw
        ? {
            empresa_id: String(empresa.id),
            status: String(assinaturaRaw.status ?? "ativa"),
            vencimento_em: assinaturaRaw.vencimento_em
              ? String(assinaturaRaw.vencimento_em)
              : null,
            liberado_ate: assinaturaRaw.liberado_ate
              ? String(assinaturaRaw.liberado_ate)
              : null,
            carencia_ate: assinaturaRaw.carencia_ate
              ? String(assinaturaRaw.carencia_ate)
              : null,
          }
        : null;

      return {
        id: String(empresa.id),
        nome:
          texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
        cnpj: texto(empresa.cnpj),
        plano: planoJoin?.nome ? String(planoJoin.nome) : "—",
        status: assinatura?.status || "ativa",
        rotuloStatus: rotuloStatusAssinatura(assinatura),
        valorContratado: valorContratado(
          assinaturaRaw?.valor_mensal_contratado,
          planoJoin?.valor_mensal
        ),
        usuarios: null,
        vencimento: assinatura?.vencimento_em ?? null,
        cadastro: String(empresa.created_at ?? ""),
        operacional: empresaPodeOperar(assinatura),
      };
    });
  }

  const contagens = await contarUsuariosPorEmpresas(
    admin,
    linhas.map((item) => item.id)
  );

  return {
    page: pagina,
    pageSize: PAGE_SIZE,
    total,
    q: busca,
    status: filtro,
    planoId: plano,
    linhas: linhas.map((item) => ({
      ...item,
      usuarios: contagens.get(item.id) ?? 0,
    })),
  };
}

export async function detalheEmpresaMaster(
  empresaId: string
): Promise<EmpresaMasterDetalheDados | null> {
  const { admin, usuarioId } = await exigirMaster();
  const id = texto(empresaId);
  const { data: empresa, error } = await admin
    .from("empresas")
    .select("id, razao_social, nome_fantasia, cnpj, created_at, ativo")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!empresa) {
    return null;
  }

  const inicioMes = inicioMesSaoPauloIso();

  const [
    { data: assinatura },
    { data: planos },
    { data: eventos },
    { data: vinculos },
    produtos,
    clientes,
    vendasMes,
    nfceMes,
    nfeMes,
  ] = await Promise.all([
    admin
      .from("assinaturas_empresas")
      .select(
        "id, empresa_id, plano_id, status, inicio_em, vencimento_em, carencia_ate, liberado_ate, suspenso_em, cancelado_em, observacao, valor_mensal_contratado, planos ( nome, valor_mensal, dias_teste )"
      )
      .eq("empresa_id", id)
      .maybeSingle(),
    admin
      .from("planos")
      .select("id, nome, valor_mensal, ativo")
      .order("ordem"),
    admin
      .from("plataforma_auditoria")
      .select("id, acao, metadados, criado_em, admin_usuario_id")
      .eq("empresa_id", id)
      .order("criado_em", { ascending: false })
      .limit(50),
    admin
      .from("usuarios_empresas")
      .select("usuario_id, perfil, principal, ativo")
      .eq("empresa_id", id)
      .order("principal", { ascending: false }),
    contarSeguro(admin, "produtos", (consulta) => consulta.eq("empresa_id", id)),
    contarSeguro(admin, "clientes", (consulta) => consulta.eq("empresa_id", id)),
    contarSeguro(admin, "vendas", (consulta) =>
      consulta
        .eq("empresa_id", id)
        .eq("status", "finalizada")
        .or(
          `finalizada_at.gte.${inicioMes},and(finalizada_at.is.null,created_at.gte.${inicioMes})`
        )
    ),
    contarSeguro(admin, "fiscal_emissoes", (consulta) =>
      consulta
        .eq("empresa_id", id)
        .eq("modelo", "65")
        .eq("status", "autorizada")
        .gte("autorizada_at", inicioMes)
    ),
    contarSeguro(admin, "fiscal_emissoes", (consulta) =>
      consulta
        .eq("empresa_id", id)
        .eq("modelo", "55")
        .eq("status", "autorizada")
        .gte("autorizada_at", inicioMes)
    ),
  ]);

  const plano = assinatura ? desaninharPlano(assinatura.planos) : null;
  const planoId = assinatura?.plano_id ? String(assinatura.plano_id) : null;

  const { data: limitesPlano } = planoId
    ? await admin
        .from("planos_limites")
        .select("chave, valor")
        .eq("plano_id", planoId)
    : { data: [] };

  const limites = (limitesPlano ?? []).map((item) => ({
    chave: texto(item.chave),
    valor: item.valor == null ? null : Number(item.valor),
  }));

  const assinaturaEntitlement = assinatura
    ? {
        empresa_id: id,
        plano_id: planoId,
        status: String(assinatura.status),
      }
    : null;

  const usuarioIds = [
    ...new Set(
      (vinculos ?? [])
        .map((item) => texto(item.usuario_id))
        .filter(Boolean)
    ),
  ];
  const adminIds = [
    ...new Set(
      (eventos ?? [])
        .map((item) => texto(item.admin_usuario_id))
        .filter(Boolean)
    ),
  ];
  const pessoasIds = [...new Set([...usuarioIds, ...adminIds])];

  const { data: pessoas } =
    pessoasIds.length > 0
      ? await admin
          .from("usuarios")
          .select("id, nome, email")
          .in("id", pessoasIds)
      : { data: [] };

  const pessoasPorId = new Map(
    (pessoas ?? []).map((item) => [
      String(item.id),
      {
        nome: texto(item.nome),
        email: texto(item.email),
      },
    ])
  );

  const usuarios = (vinculos ?? []).map((vinculo) => {
    const pessoa = pessoasPorId.get(texto(vinculo.usuario_id));
    const perfil = texto(vinculo.perfil);
    return {
      id: texto(vinculo.usuario_id),
      nome: pessoa?.nome || "—",
      email: pessoa?.email || "—",
      perfil,
      rotuloPerfil: rotuloPerfilEmpresa(perfil) || "—",
      principal: Boolean(vinculo.principal),
      ativo: Boolean(vinculo.ativo),
    };
  });

  return {
    masterUsuarioId: usuarioId,
    empresa: {
      id: String(empresa.id),
      nomeFantasia: texto(empresa.nome_fantasia),
      razaoSocial: texto(empresa.razao_social),
      cnpj: texto(empresa.cnpj),
      cadastro: String(empresa.created_at ?? ""),
    },
    assinatura: assinatura
      ? {
          id: String(assinatura.id),
          empresa_id: id,
          plano_id: planoId,
          status: String(assinatura.status),
          inicio_em: assinatura.inicio_em ? String(assinatura.inicio_em) : null,
          vencimento_em: assinatura.vencimento_em
            ? String(assinatura.vencimento_em)
            : null,
          carencia_ate: assinatura.carencia_ate
            ? String(assinatura.carencia_ate)
            : null,
          liberado_ate: assinatura.liberado_ate
            ? String(assinatura.liberado_ate)
            : null,
          suspenso_em: assinatura.suspenso_em
            ? String(assinatura.suspenso_em)
            : null,
          cancelado_em: assinatura.cancelado_em
            ? String(assinatura.cancelado_em)
            : null,
          observacao: assinatura.observacao
            ? String(assinatura.observacao)
            : null,
          plano_nome: plano?.nome ? String(plano.nome) : null,
          plano_valor_mensal:
            plano && "valor_mensal" in plano
              ? numeroOuNulo(plano.valor_mensal)
              : null,
          valor_mensal_contratado: valorContratado(
            assinatura.valor_mensal_contratado,
            plano && "valor_mensal" in plano ? plano.valor_mensal : null
          ),
          dias_teste:
            plano && "dias_teste" in plano
              ? numeroOuNulo((plano as { dias_teste?: unknown }).dias_teste)
              : null,
        }
      : null,
    planos: (planos ?? []).map((item) => ({
      id: String(item.id),
      nome: String(item.nome),
      valorMensal: numeroOuNulo(item.valor_mensal),
      ativo: Boolean(item.ativo),
    })),
    uso: {
      usuarios: usuarios.length,
      produtos,
      clientes,
      vendasMes,
      nfceMes,
      nfeMes,
      limiteUsuarios: obterLimite({
        empresaId: id,
        chave: "usuarios",
        assinatura: assinaturaEntitlement,
        limitesDoPlano: limites,
      }),
      limiteFiliais: obterLimite({
        empresaId: id,
        chave: "filiais",
        assinatura: assinaturaEntitlement,
        limitesDoPlano: limites,
      }),
    },
    usuarios,
    historico: (eventos ?? []).map((item) => {
      const dados = (item.metadados ?? {}) as Record<string, unknown>;
      const adminId = texto(item.admin_usuario_id);
      const adminPessoa = pessoasPorId.get(adminId);
      return {
        id: String(item.id),
        tipo: String(item.acao),
        dados,
        detalhe: detalheEventoAuditoriaEmpresa(dados),
        administrador: adminPessoa?.nome || adminPessoa?.email || "",
        createdAt: String(item.criado_em ?? ""),
      };
    }),
  };
}

export async function listarPlanosMaster() {
  const { admin } = await exigirMaster();
  const { data, error } = await admin
    .from("planos")
    .select("id, nome, descricao, valor_mensal, ativo, ordem")
    .order("ordem");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => ({
    id: String(item.id),
    nome: String(item.nome),
    descricao: item.descricao ? String(item.descricao) : "",
    valorMensal: item.valor_mensal == null ? null : Number(item.valor_mensal),
    ativo: Boolean(item.ativo),
    ordem: Number(item.ordem ?? 0),
  }));
}
