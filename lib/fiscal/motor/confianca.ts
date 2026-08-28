import type { ConfiancaMotor } from "./tipos";

export type EvidenciaConfianca = {
  id: string;
  presente: boolean;
  peso: "alta" | "media" | "baixa";
  motivo: string;
};

export function avaliarConfianca(evidencias: EvidenciaConfianca[]): {
  confianca: ConfiancaMotor;
  motivo: string;
} {
  const presentes = evidencias.filter((item) => item.presente);
  const altas = presentes.filter((item) => item.peso === "alta").length;
  const medias = presentes.filter((item) => item.peso === "media").length;
  const ausentesCriticas = evidencias.filter(
    (item) => !item.presente && item.peso === "alta"
  );

  if (ausentesCriticas.length > 0) {
    return {
      confianca: "baixa",
      motivo: `Confiança baixa: ${ausentesCriticas[0]?.motivo}`,
    };
  }
  if (altas >= 2 && medias >= 1) {
    return {
      confianca: "alta",
      motivo: presentes.map((item) => item.motivo).slice(0, 3).join("; "),
    };
  }
  if (altas >= 1 || medias >= 2) {
    return {
      confianca: "media",
      motivo: presentes[0]?.motivo ?? "Evidência parcial.",
    };
  }
  if (presentes.length > 0) {
    return {
      confianca: "baixa",
      motivo: presentes[0]?.motivo ?? "Evidência fraca.",
    };
  }
  return {
    confianca: "nenhuma",
    motivo: "Não há evidência suficiente para classificar.",
  };
}
