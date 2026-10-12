"use server";

import { redirect } from "next/navigation";

import {
  ativarAssistenteTefSessao,
  avaliarAssistenteTefSessao,
  prepararInstalacaoAssistenteSessao,
  salvarRascunhoAssistenteSessao,
  type ObservacaoAssistente,
} from "@/lib/pdv/tef/assistente-sessao";
import { ErroTef, salvarConfigTefSessao, autorizarPareamentoTefSessao, concluirPareamentoTefSessao, diagnosticarRecuperacaoTefSessao, prepararSincronizacaoVinculoTefSessao, recuperarAutorizacaoTefSessao, revogarTerminalTefSessao, verificarComputadorTefSessao } from "@/lib/pdv/tef/servico";

export async function salvarTefEmpresa(formData: FormData) {
  const ambiente = formData.get("ambiente") === "producao" ? "producao" : "homologacao";
  try {
    await salvarConfigTefSessao({
      habilitado: formData.get("habilitado") === "on",
      ambiente,
      estabelecimento: String(formData.get("estabelecimento") ?? ""),
      pontoCaptura: String(formData.get("pontoCaptura") ?? ""),
      permitirOperacaoManual:
        formData.get("permitir_operacao_manual_informada") === "1"
          ? formData.get("permitir_operacao_manual") === "on"
          : undefined,
    });
  } catch (error) {
    const mensagem =
      error instanceof ErroTef ? error.message : "Não foi possível salvar o TEF.";
    redirect(`/configuracoes/financeiro/tef?erro=${encodeURIComponent(mensagem)}`);
  }
  redirect("/configuracoes/financeiro/tef?sucesso=1");
}

export async function autorizarPareamentoEmpresa(codigo: string) {
  try {
    return await autorizarPareamentoTefSessao(codigo);
  } catch (error) {
    throw new Error(error instanceof ErroTef ? error.message : "Não foi possível autorizar o pareamento.");
  }
}

export async function concluirPareamentoEmpresa(input: {
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinaturaPareamento: string;
}) {
  try {
    return await concluirPareamentoTefSessao(input);
  } catch (error) {
    throw new Error(error instanceof ErroTef ? error.message : "Não foi possível concluir o pareamento.");
  }
}

export async function prepararSincronizacaoConnector(input: {
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  assinaturaPareamento: string;
}) {
  try {
    return await prepararSincronizacaoVinculoTefSessao({
      codigo: input.codigo,
      dispositivoId: input.dispositivoId,
      chavePublica: input.chavePublica,
      assinaturaPareamento: input.assinaturaPareamento,
    });
  } catch (error) {
    return {
      efeito: "recusar" as const,
      motivo: error instanceof ErroTef ? error.message : "Não foi possível preparar a sincronização.",
      vinculo: null,
      ativaEmpresa: false as const,
      executaInstalacao: false as const,
      revogaChave: false as const,
      gravaBanco: false as const,
    };
  }
}

const RECUSA_RECUPERACAO = {
  efeito: "recusar" as const,
  vinculo: null,
  gerarChave: false as const,
  executaInstalacao: false as const,
};

export async function diagnosticarRecuperacaoConnector(input: {
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinaturaIdentidade: string;
}) {
  try {
    return await diagnosticarRecuperacaoTefSessao(input);
  } catch (error) {
    throw new Error(
      error instanceof ErroTef ? error.message : "Não foi possível comparar as chaves deste computador."
    );
  }
}

export async function recuperarAutorizacaoConnector(input: {
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinaturaPareamento: string;
  perdaConfirmada: boolean;
}) {
  try {
    return await recuperarAutorizacaoTefSessao(input);
  } catch (error) {
    return {
      ...RECUSA_RECUPERACAO,
      motivo: error instanceof ErroTef ? error.message : "Não foi possível recuperar a autorização.",
    };
  }
}

export async function verificarComputadorTef(dispositivoId: string) {
  try {
    return await verificarComputadorTefSessao(dispositivoId);
  } catch (error) {
    throw new Error(
      error instanceof ErroTef ? error.message : "Não foi possível consultar o terminal."
    );
  }
}

export async function revogarTerminalEmpresa(terminalId: string) {
  try {
    return await revogarTerminalTefSessao(terminalId);
  } catch (error) {
    throw new Error(error instanceof ErroTef ? error.message : "Não foi possível revogar o terminal.");
  }
}

export async function salvarRascunhoAssistente(input: {
  cnpjConfirmado: string;
  credenciamentoConfirmado: boolean;
  ambienteAutorizado: string;
  pontoCaptura: string;
  estabelecimento: string;
  parametrosOficiais: string;
  adquirentes: string[];
  pinpadExigido: boolean;
  etapa: string;
  servidorHomologacao: string;
  servidorProducao: string;
  servidorConfirmado: boolean;
}) {
  try {
    return await salvarRascunhoAssistenteSessao(input);
  } catch (error) {
    return {
      ok: false as const,
      etapa: "credenciamento" as const,
      pendencias: [error instanceof ErroTef ? error.message : "Não foi possível salvar o andamento."],
    };
  }
}

export async function validarAssistente(observacao: ObservacaoAssistente) {
  try {
    const avaliacao = await avaliarAssistenteTefSessao(observacao);
    return { ok: true as const, avaliacao };
  } catch (error) {
    return {
      ok: false as const,
      erro: error instanceof ErroTef ? error.message : "Não foi possível validar a instalação.",
    };
  }
}

export async function prepararInstalacaoAssistente(input: {
  confirmacaoExplicita: boolean;
  dispositivoId: string;
  credencialInformada: boolean;
  autorizacaoExplicitaReset: boolean;
  proposta: { pontoCaptura: string; ambiente: string; servidor: string } | null;
}) {
  try {
    return await prepararInstalacaoAssistenteSessao({
      confirmacaoExplicita: input.confirmacaoExplicita === true,
      dispositivoId: input.dispositivoId,
      credencialInformada: input.credencialInformada === true,
      autorizacaoExplicitaReset: input.autorizacaoExplicitaReset === true,
      proposta: input.proposta,
    });
  } catch (error) {
    return {
      ok: false as const,
      efeito: "recusar" as const,
      motivo: error instanceof ErroTef ? error.message : "Não foi possível preparar a instalação.",
      atual: null,
    };
  }
}

export async function ativarAssistente(observacao: ObservacaoAssistente) {
  try {
    return await ativarAssistenteTefSessao(observacao);
  } catch (error) {
    return {
      ok: false as const,
      efeito: "recusar" as const,
      motivo: "erro",
      mensagens: [error instanceof ErroTef ? error.message : "Não foi possível ativar o TEF."],
    };
  }
}
