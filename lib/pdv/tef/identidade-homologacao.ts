import { hashSegredoVinculo, verificarProvaTef } from "@/lib/pdv/tef/prova";

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function aceitarVinculoIdentidadeHomologacao(input: {
  empresaSessaoId: string;
  dispositivoInformado: string;
  terminalInformadoId: string;
  dispositivoAutorizado: string;
  terminalAutorizadoId: string;
  chavePublica: string;
  chaveId: string;
  codigo: string;
  assinaturaPareamento: string;
}) {
  const codigo = input.codigo.trim().toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(codigo)) {
    return { ok: false as const, motivo: "Código de pareamento inválido." };
  }
  const empresa = input.empresaSessaoId.trim().toLowerCase();
  const dispositivo = input.dispositivoInformado.trim().toLowerCase();
  const terminal = input.terminalInformadoId.trim().toLowerCase();
  const chaveId = input.chaveId.trim().toLowerCase();
  if (dispositivo !== input.dispositivoAutorizado.trim().toLowerCase()) {
    return {
      ok: false as const,
      motivo: "A identidade não pertence ao computador autorizado nesta empresa.",
    };
  }
  if (terminal !== input.terminalAutorizadoId.trim().toLowerCase()) {
    return { ok: false as const, motivo: "A identidade não confere com o terminal autorizado." };
  }
  if (!ID.test(empresa) || !ID.test(dispositivo) || !ID.test(terminal) || !ID.test(chaveId)) {
    return { ok: false as const, motivo: "Os identificadores da identidade estão incompletos." };
  }
  if (!input.chavePublica.trim() || !input.assinaturaPareamento.trim()) {
    return {
      ok: false as const,
      motivo: "A chave gerada localmente ainda não foi comprovada pelo Connector de homologação.",
    };
  }
  const assinaturaValida = verificarProvaTef(
    input.chavePublica.trim(),
    {
      acao: "pareamento",
      desafio: hashSegredoVinculo(codigo),
      identificador: input.dispositivoInformado.trim(),
      valorCentavos: 0,
      nsu: "",
      autorizacao: "",
      rede: "",
      finalizacao: "",
      sucesso: true,
      codigo: "",
    },
    input.assinaturaPareamento.trim()
  );
  if (!assinaturaValida) {
    return {
      ok: false as const,
      motivo: "A chave gerada localmente ainda não foi comprovada pelo Connector de homologação.",
    };
  }
  return {
    ok: true as const,
    registro: {
      empresa_id: empresa,
      dispositivo_id: dispositivo,
      terminal_id: terminal,
      chave_publica: input.chavePublica.trim(),
      chave_id: chaveId,
    },
  };
}
