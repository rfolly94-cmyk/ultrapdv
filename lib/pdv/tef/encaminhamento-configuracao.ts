export type PedidoProducao =
  | {
      ok: true;
      comando: "instalar" | "configurar" | "pinpad" | "situacao" | "responder";
      finalidade: "instalacao_producao" | "configuracao_producao" | "pinpad_producao" | "consulta_producao";
      operacaoNativa: "PWOPER_INSTALL" | "PWOPER_CONFIG" | "";
      chave: string;
    }
  | { ok: false; erro: string };

export function chaveDaOperacao(operacao: "instalar" | "configurar") {
  const aleatorio = globalThis.crypto.randomUUID();
  return operacao === "configurar" ? `cfg:${aleatorio}` : `ins:${aleatorio}`;
}

export function montarPedidoProducao(entrada: {
  comando?: unknown;
  chave?: unknown;
  operacao?: unknown;
}): PedidoProducao {
  const comando = typeof entrada.comando === "string" ? entrada.comando : "";
  const chave = typeof entrada.chave === "string" ? entrada.chave : "";
  if (comando === "configurar") {
    if (!chave.startsWith("cfg:")) {
      return { ok: false, erro: "A configuração precisa de uma chave própria. A instalação não foi iniciada." };
    }
    return {
      ok: true,
      comando: "configurar",
      finalidade: "configuracao_producao",
      operacaoNativa: "PWOPER_CONFIG",
      chave,
    };
  }
  if (comando === "instalar") {
    if (!chave.startsWith("ins:")) {
      return { ok: false, erro: "A instalação precisa de uma chave própria. A configuração não foi iniciada." };
    }
    return {
      ok: true,
      comando: "instalar",
      finalidade: "instalacao_producao",
      operacaoNativa: "PWOPER_INSTALL",
      chave,
    };
  }
  if (comando === "responder") {
    if (entrada.operacao === "configurar" && chave.startsWith("cfg:")) {
      return {
        ok: true,
        comando: "responder",
        finalidade: "configuracao_producao",
        operacaoNativa: "PWOPER_CONFIG",
        chave,
      };
    }
    if (entrada.operacao === "instalar" && chave.startsWith("ins:")) {
      return {
        ok: true,
        comando: "responder",
        finalidade: "instalacao_producao",
        operacaoNativa: "PWOPER_INSTALL",
        chave,
      };
    }
    return { ok: false, erro: "A resposta não está vinculada à operação aberta. Nenhuma instalação foi iniciada." };
  }
  if (comando === "pinpad") {
    return { ok: true, comando: "pinpad", finalidade: "pinpad_producao", operacaoNativa: "", chave: "" };
  }
  if (comando === "situacao") {
    return { ok: true, comando: "situacao", finalidade: "consulta_producao", operacaoNativa: "", chave: "" };
  }
  return { ok: false, erro: "Comando de produção não reconhecido. Nenhuma cobrança foi iniciada." };
}
