import path from "node:path";

export function perfilSessaoAtiva(biblioteca) {
  if (!biblioteca || typeof biblioteca !== "object") return "";
  const homologacao = biblioteca.homologacao === true;
  const producao = biblioteca.producao === true;
  if (homologacao === producao) return "";
  return producao ? "producao" : "homologacao";
}

export function decidirPerfilExecucao(entrada = {}) {
  const solicitado = entrada.ambiente === "producao" || entrada.ambiente === "homologacao" ? entrada.ambiente : "";
  const vinculo =
    entrada.vinculoAmbiente === "producao" || entrada.vinculoAmbiente === "homologacao"
      ? entrada.vinculoAmbiente
      : "";
  const sessao = entrada.sessao === "producao" || entrada.sessao === "homologacao" ? entrada.sessao : "";
  if (!solicitado) {
    return {
      ok: false,
      codigo: "perfil",
      ambiente: "",
      mensagem: "A venda precisa do ambiente gravado e da autorização do servidor. Nenhum comando foi enviado.",
    };
  }
  if (sessao && sessao !== solicitado) {
    const ocupada = sessao === "producao" ? "produção" : "homologação";
    return {
      ok: false,
      codigo: "sessao",
      ambiente: sessao,
      mensagem: `A sessão ativa está em ${ocupada}. O ambiente não foi trocado. Nenhuma cobrança foi iniciada.`,
    };
  }
  if (solicitado === "producao" && entrada.producaoHabilitada !== true) {
    return {
      ok: false,
      codigo: "producao",
      ambiente: "",
      mensagem:
        "A produção não está habilitada. O vínculo comercial do Connector não inicia cobrança. Nenhum comando foi enviado.",
    };
  }
  return {
    ok: true,
    codigo: "perfil",
    ambiente: solicitado,
    vinculoIgnorado: Boolean(vinculo) && vinculo !== solicitado,
    mensagem: "",
  };
}

export function arquivoEtapaDaVenda(raiz, escopo = {}) {
  const empresa = String(escopo.empresaId ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  const terminal = String(escopo.terminalCodigo ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const dispositivo = String(escopo.dispositivoId ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!empresa || !terminal) return path.join(String(raiz ?? ""), "tef-journal-etapa-venda.json");
  return path.join(String(raiz ?? ""), `tef-journal-etapa.${empresa}.${terminal}.${dispositivo || "sem-dispositivo"}.json`);
}

export function journalsDoPerfil(raizHomologacao, diretorioProducao, ambiente, escopo = {}) {
  if (ambiente === "producao") {
    const producao = [path.join(String(diretorioProducao ?? ""), "tef-journal-venda.json")];
    if (escopo.empresaId && escopo.terminalCodigo) producao.push(arquivoEtapaDaVenda(diretorioProducao, escopo));
    return producao;
  }
  const raiz = String(raizHomologacao ?? "");
  const arquivos = [
    path.join(raiz, "tef-journal-teste-nativo.json"),
    path.join(raiz, "tef-journal-venda-100.json"),
    path.join(raiz, "tef-journal-resultado-desconhecido.json"),
    path.join(raiz, "tef-journal-etapa-venda.json"),
  ];
  if (escopo.empresaId && escopo.terminalCodigo) arquivos.push(arquivoEtapaDaVenda(raiz, escopo));
  return arquivos;
}
