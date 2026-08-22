import "server-only";

import { exigirMaster } from "@/lib/master/exigir-master";
import {
  detalheEventoAuditoriaEmpresa,
  ROTULOS_EVENTO_EMPRESA,
} from "@/lib/master/apresentacao-empresa";
import {
  mesesDashboard,
  montarDashboardMaster,
  type DashboardMasterPainelDados,
  type EventoDashboardMaster,
} from "@/lib/master/dashboard-calculo";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numeroOuNulo(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function nomeEmpresa(fantasia: unknown, razao: unknown) {
  return texto(fantasia) || texto(razao) || "Empresa";
}

export async function carregarDashboardMaster(
  mesesParam?: string | null
): Promise<DashboardMasterPainelDados> {
  const { admin } = await exigirMaster();
  const meses = mesesDashboard(mesesParam);

  const [{ data: empresas, error: empresasError }, { data: assinaturas, error: assinaturasError }, { data: eventos, error: eventosError }] =
    await Promise.all([
      admin
        .from("empresas")
        .select("id, nome_fantasia, razao_social, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("assinaturas_empresas")
        .select(
          "empresa_id, plano_id, status, vencimento_em, valor_mensal_contratado, planos ( id, nome, valor_mensal )"
        ),
      admin
        .from("plataforma_auditoria")
        .select("id, acao, metadados, criado_em, admin_usuario_id, empresa_id")
        .order("criado_em", { ascending: false })
        .limit(8),
    ]);

  if (empresasError) {
    throw new Error(empresasError.message);
  }
  if (assinaturasError) {
    throw new Error(assinaturasError.message);
  }
  if (eventosError) {
    throw new Error(eventosError.message);
  }

  const empresasMapa = new Map(
    (empresas ?? []).map((item) => [
      String(item.id),
      {
        id: String(item.id),
        nome: nomeEmpresa(item.nome_fantasia, item.razao_social),
        cadastro: String(item.created_at ?? ""),
      },
    ])
  );

  const calculado = montarDashboardMaster({
    empresas: [...empresasMapa.values()],
    assinaturas: (assinaturas ?? []).map((item) => {
      const plano = Array.isArray(item.planos) ? item.planos[0] : item.planos;
      return {
        empresaId: String(item.empresa_id),
        planoId: item.plano_id ? String(item.plano_id) : null,
        planoNome: plano?.nome ? String(plano.nome) : null,
        status: texto(item.status),
        vencimentoEm: item.vencimento_em ? String(item.vencimento_em) : null,
        valorMensalContratado: numeroOuNulo(item.valor_mensal_contratado),
        valorCatalogo: numeroOuNulo(
          (plano as { valor_mensal?: unknown } | null)?.valor_mensal
        ),
      };
    }),
    meses,
  });

  const adminIds = [
    ...new Set(
      (eventos ?? [])
        .map((item) => texto(item.admin_usuario_id))
        .filter(Boolean)
    ),
  ];
  const { data: admins } =
    adminIds.length > 0
      ? await admin.from("usuarios").select("id, nome, email").in("id", adminIds)
      : { data: [] };
  const adminsPorId = new Map(
    (admins ?? []).map((item) => [
      String(item.id),
      texto(item.nome) || texto(item.email),
    ])
  );

  const atividade: EventoDashboardMaster[] = (eventos ?? []).map((item) => {
    const dados = (item.metadados ?? {}) as Record<string, unknown>;
    const empresaId = item.empresa_id ? String(item.empresa_id) : null;
    return {
      id: String(item.id),
      quando: String(item.criado_em ?? ""),
      tipo: texto(item.acao),
      rotulo: ROTULOS_EVENTO_EMPRESA[texto(item.acao)] || texto(item.acao),
      empresaId,
      empresaNome: empresaId
        ? empresasMapa.get(empresaId)?.nome || "Empresa"
        : "",
      detalhe: detalheEventoAuditoriaEmpresa(dados),
      administrador: adminsPorId.get(texto(item.admin_usuario_id)) || "",
    };
  });

  return {
    ...calculado,
    meses,
    atividade,
  };
}
