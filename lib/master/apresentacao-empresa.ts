import { PERFIS_USUARIO_LABEL } from "@/lib/usuarios/perfis";
import { rotuloLimite } from "@/lib/plataforma/recursos/resolver";

export const ROTULOS_EVENTO_EMPRESA: Record<string, string> = {
  empresa_ativada: "Empresa reativada",
  empresa_suspensa: "Empresa suspensa",
  empresa_carencia: "Empresa em carência",
  empresa_liberada_temporariamente: "Liberação temporária",
  plano_alterado: "Plano alterado",
  assinatura_cancelada: "Assinatura cancelada",
  vencimento_alterado: "Assinatura alterada",
};

export function formatarCnpjMaster(valor: string) {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) {
    return valor || "—";
  }
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

export function rotuloPerfilEmpresa(perfil: string) {
  const chave = perfil.trim().toLowerCase();
  return PERFIS_USUARIO_LABEL[chave as keyof typeof PERFIS_USUARIO_LABEL] ?? perfil;
}

export function rotuloUsoComLimite(
  usado: number,
  limite: number | null,
  singular: string,
  plural: string
) {
  const unidade = usado === 1 ? singular : plural;
  if (limite == null) {
    return {
      principal: `${usado} ${unidade}`,
      complemento: rotuloLimite(null),
    };
  }
  return {
    principal: `${usado} / ${limite}`,
    complemento: null as string | null,
  };
}

export function detalheEventoAuditoriaEmpresa(dados: Record<string, unknown>) {
  const planoDe = textoCurto(dados.plano_de);
  const planoPara = textoCurto(dados.plano_para);
  const motivo = textoCurto(dados.motivo);
  const partes: string[] = [];

  if (planoDe || planoPara) {
    partes.push(`${planoDe || "—"} → ${planoPara || "—"}`);
  }
  if (motivo) {
    partes.push(`Motivo: ${motivo}`);
  }

  return partes.join(" · ");
}

function textoCurto(valor: unknown) {
  const texto = String(valor ?? "").trim();
  if (!texto || texto === "null" || texto === "undefined") {
    return "";
  }
  return texto;
}
