import "server-only";

import { exigirMaster } from "@/lib/master/exigir-master";
import {
  empresaPodeOperar,
  rotuloStatusAssinatura,
  statusAssinaturaValido,
} from "@/lib/assinatura/empresa-pode-operar";
import type { StatusAssinatura } from "@/lib/assinatura/tipos";

const PAGE_SIZE = 20;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function sanitizarBusca(valor: string) {
  return valor.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

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
      const valor = Number((plano as { valor_mensal?: number } | null)?.valor_mensal ?? 0);
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
  page = 1,
}: {
  q?: string;
  status?: string;
  page?: number;
}) {
  const { admin } = await exigirMaster();
  const busca = sanitizarBusca(q);
  const filtro = statusAssinaturaValido(status) ? status : "";
  const pagina = Number.isFinite(page) && page > 0 ? page : 1;
  const from = (pagina - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  if (filtro) {
    let consulta = admin
      .from("assinaturas_empresas")
      .select(
        "status, vencimento_em, liberado_ate, carencia_ate, planos ( nome ), empresas ( id, razao_social, nome_fantasia, cnpj, created_at )",
        { count: "exact" }
      )
      .eq("status", filtro)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (busca) {
      consulta = consulta.or(
        `empresas.razao_social.ilike.%${busca}%,empresas.nome_fantasia.ilike.%${busca}%,empresas.cnpj.ilike.%${busca}%`
      );
    }

    const { data, count, error } = await consulta;
    if (error) {
      throw new Error(error.message);
    }

    return {
      page: pagina,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
      q: busca,
      status: filtro,
      linhas: (data ?? [])
        .map((linha) => {
          const empresa = Array.isArray(linha.empresas)
            ? linha.empresas[0]
            : linha.empresas;
          if (!empresa) {
            return null;
          }
          const plano = Array.isArray(linha.planos) ? linha.planos[0] : linha.planos;
          const assinatura = {
            status: String(linha.status ?? filtro),
            vencimento_em: linha.vencimento_em ? String(linha.vencimento_em) : null,
            liberado_ate: linha.liberado_ate ? String(linha.liberado_ate) : null,
            carencia_ate: linha.carencia_ate ? String(linha.carencia_ate) : null,
          };
          return {
            id: String(empresa.id),
            nome: texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
            cnpj: texto(empresa.cnpj),
            plano: plano?.nome ? String(plano.nome) : "—",
            status: assinatura.status,
            rotuloStatus: rotuloStatusAssinatura(assinatura),
            vencimento: assinatura.vencimento_em,
            cadastro: String(empresa.created_at ?? ""),
            operacional: empresaPodeOperar(assinatura),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  }

  let consulta = admin
    .from("empresas")
    .select(
      "id, razao_social, nome_fantasia, cnpj, created_at, assinaturas_empresas ( status, vencimento_em, liberado_ate, carencia_ate, planos ( nome ) )",
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

  return {
    page: pagina,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
    q: busca,
    status: filtro,
    linhas: (data ?? []).map((empresa) => {
      const assinaturaRaw = Array.isArray(empresa.assinaturas_empresas)
        ? empresa.assinaturas_empresas[0]
        : empresa.assinaturas_empresas;
      const plano = assinaturaRaw
        ? Array.isArray(assinaturaRaw.planos)
          ? assinaturaRaw.planos[0]
          : assinaturaRaw.planos
        : null;
      const assinatura = assinaturaRaw
        ? {
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
        nome: texto(empresa.nome_fantasia || empresa.razao_social) || "Empresa",
        cnpj: texto(empresa.cnpj),
        plano: plano?.nome ? String(plano.nome) : "—",
        status: assinatura?.status || "ativa",
        rotuloStatus: rotuloStatusAssinatura(assinatura),
        vencimento: assinatura?.vencimento_em,
        cadastro: String(empresa.created_at ?? ""),
        operacional: empresaPodeOperar(assinatura),
      };
    }),
  };
}

export async function detalheEmpresaMaster(empresaId: string) {
  const { admin, usuarioId } = await exigirMaster();
  const { data: empresa, error } = await admin
    .from("empresas")
    .select("id, razao_social, nome_fantasia, cnpj, created_at, ativo")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!empresa) {
    return null;
  }

  const [{ data: assinatura }, { data: planos }, { data: eventos }] =
    await Promise.all([
      admin
        .from("assinaturas_empresas")
        .select(
          "id, empresa_id, plano_id, status, inicio_em, vencimento_em, carencia_ate, liberado_ate, suspenso_em, cancelado_em, observacao, planos ( nome, valor_mensal )"
        )
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      admin.from("planos").select("id, nome, valor_mensal, ativo").order("ordem"),
      admin
        .from("plataforma_auditoria")
        .select("id, acao, metadados, criado_em")
        .eq("empresa_id", empresaId)
        .order("criado_em", { ascending: false })
        .limit(50),
    ]);

  const plano = assinatura
    ? Array.isArray(assinatura.planos)
      ? assinatura.planos[0]
      : assinatura.planos
    : null;

  return {
    masterUsuarioId: usuarioId,
    empresa: {
      id: String(empresa.id),
      nomeFantasia: texto(empresa.nome_fantasia),
      razaoSocial: texto(empresa.razao_social),
      cnpj: texto(empresa.cnpj),
      cadastro: String(empresa.created_at ?? ""),
      ativo: Boolean(empresa.ativo),
    },
    assinatura: assinatura
      ? {
          id: String(assinatura.id),
          empresa_id: empresaId,
          plano_id: assinatura.plano_id ? String(assinatura.plano_id) : null,
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
          observacao: assinatura.observacao ? String(assinatura.observacao) : null,
          plano_nome: plano?.nome ? String(plano.nome) : null,
          plano_valor_mensal:
            plano?.valor_mensal == null ? null : Number(plano.valor_mensal),
        }
      : null,
    planos: (planos ?? []).map((item) => ({
      id: String(item.id),
      nome: String(item.nome),
      valorMensal: item.valor_mensal == null ? null : Number(item.valor_mensal),
      ativo: Boolean(item.ativo),
    })),
    historico: (eventos ?? []).map((item) => ({
      id: String(item.id),
      tipo: String(item.acao),
      dados: (item.metadados ?? {}) as Record<string, unknown>,
      createdAt: String(item.criado_em ?? ""),
    })),
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
