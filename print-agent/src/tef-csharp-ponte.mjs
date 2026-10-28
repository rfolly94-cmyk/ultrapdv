import path from "node:path";

const COMANDOS_FINANCEIROS = new Set(["vender", "instalar", "configurar", "cancelar", "confirmar"]);

export function diretorioEmpresaTef(raiz, empresaId, terminalId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(empresaId ?? "")) || !/^[0-9a-f-]{36}$/i.test(String(terminalId ?? ""))) {
    throw new Error("EMPRESA_INVALIDA");
  }
  const base = path.resolve(raiz);
  if (/\\PGWebLib(\\Data)?$/i.test(base) || base.toLowerCase().includes(`${path.sep}pgweblib${path.sep}data`)) {
    throw new Error("DIRETORIO_COMPARTILHADO");
  }
  const diretorio = path.resolve(base, empresaId.replace(/-/g, ""), terminalId.replace(/-/g, ""), "Data");
  const relativo = path.relative(base, diretorio);
  if (relativo.startsWith("..") || path.isAbsolute(relativo)) {
    throw new Error("DIRETORIO_INVALIDO");
  }
  return { raiz: base, diretorio };
}

export function diretorioProducaoEmpresaTef(raiz, empresaId, terminalId) {
  const homologacao = diretorioEmpresaTef(raiz, empresaId, terminalId);
  const diretorio = path.resolve(homologacao.raiz, empresaId.replace(/-/g, ""), terminalId.replace(/-/g, ""), "producao", "Data");
  const raizJournals = path.resolve(homologacao.raiz, "producao");
  if (diretorio === homologacao.diretorio || diretorio.startsWith(homologacao.diretorio + path.sep)) {
    throw new Error("DIRETORIO_HOMOLOGACAO");
  }
  return { raiz: homologacao.raiz, diretorio, raizJournals, homologacao: homologacao.diretorio };
}

export function respostaImediataDeInterrupcao(sessao, corpo) {
  return Boolean(sessao && corpo?.comando === "responder" && corpo.cancelar === true && sessao.aguardando === true);
}

export function continuarCaptura(sessao, corpo) {
  if (!sessao || corpo?.comando !== "responder") {
    return {
      continuar: false,
      codigo: "SESSAO_AUSENTE",
      erro: "A captura não está mais aberta. Nenhuma nova cobrança foi iniciada.",
    };
  }
  const informada = typeof corpo.operacaoNativa === "string" ? corpo.operacaoNativa : "";
  if (informada && sessao.operacaoNativa && informada !== sessao.operacaoNativa) {
    return {
      continuar: false,
      codigo: "OPERACAO_DIVERGENTE",
      erro: "A resposta pertence a outra operação. Nenhuma instalação foi iniciada.",
    };
  }
  const chave = typeof corpo.chave === "string" ? corpo.chave : "";
  if (chave && sessao.chave && chave !== sessao.chave) {
    return {
      continuar: false,
      codigo: "CHAVE_DIVERGENTE",
      erro: "A chave não pertence à operação aberta. Nenhuma instalação foi iniciada.",
    };
  }
  return {
    continuar: true,
    valor: typeof corpo.valor === "string" ? corpo.valor : "",
    cancelar: corpo.cancelar === true,
  };
}

export function normalizarRespostaMotor(bruto, sessao) {
  const resposta = bruto && typeof bruto === "object" ? bruto : {};
  const captura = resposta.tipo === "captura";
  const nativo = resposta.nativo === true;
  const confirmada = resposta.confirmada === true;
  const recebido = !captura && nativo && confirmada && resposta.pagamentoRecebido === true && resposta.simulado !== true;
  const opcoes = Array.isArray(resposta.opcoes)
    ? resposta.opcoes
        .filter((opcao) => opcao && typeof opcao === "object")
        .map((opcao) => ({
          texto: typeof opcao.texto === "string" ? opcao.texto : "",
          valor: typeof opcao.valor === "string" ? opcao.valor : "",
        }))
    : [];
  return {
    ok: recebido,
    fase: captura ? "captura" : "resultado",
    sessao: captura ? sessao : null,
    pagamentoRecebido: recebido,
    confirmada,
    nativo,
    simulado: resposta.simulado === true,
    codigo: typeof resposta.codigo === "string" ? resposta.codigo : captura ? "aguardando_dado" : "MOTOR_SEM_RESPOSTA",
    erro: typeof resposta.erro === "string" ? resposta.erro : typeof resposta.prompt === "string" ? resposta.prompt : "Nenhum pagamento foi recebido.",
    prompt: typeof resposta.prompt === "string" ? resposta.prompt : "",
    identificador: typeof resposta.identificador === "number" ? resposta.identificador : null,
    tipoDado: typeof resposta.tipoDado === "number" ? resposta.tipoDado : null,
    oculto: resposta.oculto === true,
    opcoes,
    chave: typeof resposta.chave === "string" ? resposta.chave : null,
    codigoNativo: typeof resposta.codigoNativo === "number" ? resposta.codigoNativo : null,
    servidorValidado: resposta.servidorValidado === true,
    referenciaInstalacao: typeof resposta.referenciaInstalacao === "string" ? resposta.referenciaInstalacao : "",
    vendaId: typeof resposta.vendaId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resposta.vendaId) ? resposta.vendaId : null,
    fiscal: fiscalDoMotor(resposta.fiscal),
    comprovantes: comprovantesDoMotor(resposta, recebido),
    qrcode: textoVia(resposta.qrCode),
  };
}

function textoFiscal(valor, limite) {
  const texto = typeof valor === "string" ? valor.replace(/[\r\n]/g, "").trim() : "";
  if (!texto || texto.length > limite || /^\d{13,19}$/.test(texto)) return null;
  return texto;
}

function cnpjFiscal(valor) {
  const digitos = typeof valor === "string" ? valor.replace(/\D/g, "") : "";
  return digitos.length === 14 ? digitos : null;
}

function fiscalDoMotor(bruto) {
  const fiscal = bruto && typeof bruto === "object" ? bruto : null;
  if (!fiscal) return null;
  const autorizacao = textoFiscal(fiscal.autorizacao, 20);
  const bandeiraNome = textoFiscal(fiscal.bandeiraNome, 40);
  const rede = textoFiscal(fiscal.rede, 40);
  const instituicao = textoFiscal(fiscal.instituicao, 40);
  const cnpjCredenciadora = cnpjFiscal(fiscal.cnpjCredenciadora);
  const cnpjRecebedor = cnpjFiscal(fiscal.cnpjRecebedor);
  if (!autorizacao && !bandeiraNome && !rede && !instituicao && !cnpjCredenciadora && !cnpjRecebedor) return null;
  return { autorizacao, bandeiraNome, rede, instituicao, cnpjCredenciadora, cnpjRecebedor };
}

function textoVia(valor) {
  if (typeof valor !== "string") return "";
  const texto = valor.replace(/\0/g, "");
  if (!texto.trim() || texto.length > 4096) return "";
  return texto;
}

function comprovantesDoMotor(bruto, confirmada) {
  if (!confirmada) return null;
  const vias = bruto?.comprovantes;
  if (!vias || typeof vias !== "object") return null;
  const viaEstabelecimento = textoVia(vias.viaEstabelecimento);
  const viaCliente = textoVia(vias.viaCliente);
  const rede = textoFiscal(vias.rede, 40) || "";
  const quando = typeof vias.quando === "string" ? vias.quando.trim() : "";
  if (!viaEstabelecimento || !viaCliente || !rede || !quando) return null;
  if (viaEstabelecimento === viaCliente) return null;
  return { viaEstabelecimento, viaCliente, rede, quando };
}

function chaveVenda(valor) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(debito|credito|pix):\d+$/i.test(String(valor ?? ""));
}

export function pedidoLocalDoMotor(corpo, caminhos) {
  const pedido = corpo && typeof corpo === "object" ? { ...corpo } : { comando: "status" };
  delete pedido.autorizacao;
  delete pedido.ponto;
  delete pedido.servidor;
  if (pedido.comando === "cancelar" && !chaveVenda(pedido.chave)) {
    return { bloqueado: true };
  }
  if (pedido.ambiente === 0 || pedido.ambiente === "producao") {
    const finalidade = pedido.finalidade;
    const comando = pedido.comando;
    const vendaAutorizada = finalidade === "venda_producao" && (comando === "vender" || comando === "confirmar" || comando === "cancelar");
    const permitido =
      (finalidade === "instalacao_producao" && comando === "instalar") ||
      (finalidade === "configuracao_producao" && comando === "configurar") ||
      (finalidade === "pinpad_producao" && comando === "pinpad") ||
      (finalidade === "consulta_producao" && comando === "situacao") ||
      (finalidade === "vinculo_producao" && comando === "vincular") ||
      vendaAutorizada;
    if (!permitido) {
      return { bloqueado: true };
    }
    const chave = typeof pedido.chave === "string" ? pedido.chave : "";
    if (comando === "configurar" && (!chave.startsWith("cfg:") || pedido.operacaoNativa === "PWOPER_INSTALL")) {
      return { bloqueado: true };
    }
    if (comando === "instalar" && (!chave.startsWith("ins:") || pedido.operacaoNativa === "PWOPER_CONFIG")) {
      return { bloqueado: true };
    }
    const producao = diretorioProducaoEmpresaTef(caminhos.raiz, pedido.empresaId, pedido.terminalId);
    const journalsConfiguracao = path.resolve(producao.raizJournals, "configuracao");
    const configuracao = comando === "configurar";
    return {
      bloqueado: false,
      pedido: {
        ...pedido,
        comando: comando === "vincular" ? "vincular" : configuracao ? "configurar" : comando === "instalar" ? "instalar" : comando,
        operacaoNativa: configuracao ? "PWOPER_CONFIG" : comando === "instalar" ? "PWOPER_INSTALL" : "",
        ambiente: 0,
        diretorio: producao.diretorio,
        raizJournals: configuracao ? journalsConfiguracao : producao.raizJournals,
        raizJournalsAlheia: configuracao ? producao.raizJournals : comando === "instalar" ? journalsConfiguracao : "",
        ponto: "",
        servidor: "",
        autorizaPinPadProducao: finalidade === "pinpad_producao",
        autorizaVendaProducao: vendaAutorizada,
        servidorComercialValidado: pedido.servidorComercialValidado === true,
      },
    };
  }
  if (!COMANDOS_FINANCEIROS.has(pedido.comando) && pedido.comando !== "recuperar" && pedido.comando !== "situacao" && pedido.comando !== "pinpad" && pedido.comando !== "vincular") {
    return { bloqueado: false, pedido };
  }
  const locais = diretorioEmpresaTef(caminhos.raiz, pedido.empresaId, pedido.terminalId);
  return {
    bloqueado: false,
    pedido: {
      ...pedido,
      ambiente: 1,
      diretorio: locais.diretorio,
      raizJournals: locais.raiz,
      ponto: "",
    },
  };
}
