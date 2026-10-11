"use server";

import { redirect } from "next/navigation";

import {
  ativarAssistenteTefSessao,
  avaliarAssistenteTefSessao,
  salvarRascunhoAssistenteSessao,
  type ObservacaoAssistente,
} from "@/lib/pdv/tef/assistente-sessao";
import { ErroTef, salvarConfigTefSessao, autorizarPareamentoTefSessao, concluirPareamentoTefSessao, revogarTerminalTefSessao, verificarComputadorTefSessao } from "@/lib/pdv/tef/servico";

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
