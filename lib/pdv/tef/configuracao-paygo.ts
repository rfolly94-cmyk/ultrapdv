import { digitosCnpj, etapasInstalacaoComercial } from "@/lib/pdv/tef/assistente-instalacao";
import { comporServidorPayGo, separarServidorPayGo, validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export type AmbientePayGo = "homologacao" | "producao";

export type EstadoConfiguracaoPayGo = {
  habilitado: boolean;
  ambiente: AmbientePayGo | "";
  estabelecimento: string;
  cnpjInstalacao: string;
  cnpjProducao: string;
  pontoCaptura: string;
  pontoHomologacao: string;
  servidorHomologacao: string;
  servidorProducao: string;
  permitirOperacaoManual: boolean;
  instalacaoHomologacaoConfirmada: boolean;
  instalacaoProducaoConfirmada: boolean;
};

export type EnvioConfiguracaoPayGo = {
  habilitado: boolean;
  ambiente: AmbientePayGo;
  estabelecimento: string;
  cnpjInstalacao: string;
  pontoCaptura: string;
  servidor: string;
  permitirOperacaoManual?: boolean;
};

export function montarServidorFormulario(host: string, porta: string) {
  const composto = comporServidorPayGo(host, porta);
  if (composto.ok) {
    return composto.servidor;
  }
  const hostname = String(host ?? "").trim();
  const numero = String(porta ?? "").trim();
  if (!hostname && !numero) {
    return "";
  }
  if (comporServidorPayGo(hostname, "").ok && numero) {
    return `${hostname}:${numero}`;
  }
  if (!numero) {
    return hostname;
  }
  const separador = hostname.lastIndexOf(":");
  if (separador > 0 && hostname.slice(separador + 1) === numero) {
    return hostname;
  }
  const base = separador > 0 ? hostname.slice(0, separador) : hostname;
  return `${base}:${numero}`;
}

export function camposAoSelecionarAmbiente(
  estado: Pick<EstadoConfiguracaoPayGo, "servidorHomologacao" | "servidorProducao">,
  ambiente: AmbientePayGo
) {
  const bruto = ambiente === "producao" ? estado.servidorProducao : estado.servidorHomologacao;
  return separarServidorPayGo(bruto);
}

export function codigoAmbientePayGo(ambiente: AmbientePayGo) {
  return ambiente === "homologacao" ? 1 : 0;
}

export function nomeAmbientePayGo(ambiente: AmbientePayGo) {
  return ambiente === "homologacao" ? "ENVRMNT_TEST" : "ENVRMNT_PROD";
}

function cnpjValido(valor: string) {
  const digitos = digitosCnpj(valor);
  if (!/^\d{14}$/.test(digitos)) return "";
  const digito = (base: string, pesos: number[]) => {
    const soma = pesos.reduce((total, peso, indice) => total + Number(base[indice]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digitos[12]) === primeiro && Number(digitos[13]) === segundo ? digitos : "";
}

function hostDe(servidor: string) {
  const validado = validarServidorPayGo(servidor);
  if (!validado.ok) return "";
  return validado.servidor.slice(0, validado.servidor.lastIndexOf(":")).toLowerCase();
}

export function descreverFormularioPayGo(estado: EstadoConfiguracaoPayGo) {
  const ambiente: AmbientePayGo = estado.ambiente === "producao" ? "producao" : "homologacao";
  const campos = camposAoSelecionarAmbiente(estado, ambiente);
  const servidorBruto = ambiente === "producao" ? estado.servidorProducao : estado.servidorHomologacao;
  const ponto = ambiente === "producao" ? estado.pontoCaptura : estado.pontoHomologacao;
  const confirmada =
    ambiente === "producao"
      ? estado.instalacaoProducaoConfirmada === true
      : estado.instalacaoHomologacaoConfirmada === true;
  return {
    habilitado: estado.habilitado,
    ambiente,
    estabelecimento: estado.estabelecimento,
    cnpjInstalacao: digitosCnpj(
      ambiente === "producao" ? estado.cnpjProducao : estado.cnpjInstalacao
    ),
    pontoCaptura: ponto,
    pontoProducao: estado.pontoCaptura,
    pontoHomologacao: estado.pontoHomologacao,
    host: campos.host,
    porta: campos.porta,
    servidorBruto: validarServidorPayGo(servidorBruto).ok ? servidorBruto.trim() : "",
    associacaoTravada: confirmada,
    avisoAssociacao: confirmada
      ? "A instalação deste ambiente foi confirmada. O ponto e o servidor permanecem associados."
      : "",
    ambienteCodigo: codigoAmbientePayGo(ambiente),
    ambienteBiblioteca: nomeAmbientePayGo(ambiente),
    temCampoAutcap: false,
  };
}

export function validarConfiguracaoPayGo(estado: EstadoConfiguracaoPayGo, envio: EnvioConfiguracaoPayGo) {
  const ambiente: AmbientePayGo = envio.ambiente === "producao" ? "producao" : "homologacao";
  const mensagens: string[] = [];
  const cnpj = cnpjValido(envio.cnpjInstalacao);
  if (!digitosCnpj(envio.cnpjInstalacao)) mensagens.push("Informe o CNPJ de instalação.");
  else if (!cnpj) mensagens.push("CNPJ de instalação inválido.");
  const ponto = envio.pontoCaptura.trim();
  if (!ponto) mensagens.push("Informe o ponto de captura.");
  else if (!/^[A-Za-z0-9._-]{1,40}$/.test(ponto)) mensagens.push("Ponto de captura inválido.");
  const servidor = validarServidorPayGo(envio.servidor);
  if (!servidor.ok) mensagens.push(servidor.motivo);
  const producaoPonto = estado.pontoCaptura.trim();
  const producaoHost = hostDe(estado.servidorProducao);
  const homologacaoHost = hostDe(ambiente === "homologacao" ? envio.servidor : estado.servidorHomologacao);
  if (ambiente === "homologacao" && servidor.ok && producaoHost && hostDe(servidor.servidor) === producaoHost) {
    mensagens.push("O servidor de homologação precisa ser diferente do servidor de produção desta empresa.");
  }
  if (ambiente === "producao" && servidor.ok && homologacaoHost && hostDe(servidor.servidor) === homologacaoHost) {
    mensagens.push("O servidor de produção precisa ser diferente do servidor de homologação desta empresa.");
  }
  const confirmada =
    ambiente === "producao"
      ? estado.instalacaoProducaoConfirmada === true
      : estado.instalacaoHomologacaoConfirmada === true;
  const pontoAtual = ambiente === "producao" ? producaoPonto : estado.pontoHomologacao.trim();
  const servidorAtual = validarServidorPayGo(
    ambiente === "producao" ? estado.servidorProducao : estado.servidorHomologacao
  );
  if (
    confirmada &&
    ((ponto && ponto !== pontoAtual) ||
      (servidor.ok && (!servidorAtual.ok || servidor.servidor !== servidorAtual.servidor)))
  ) {
    mensagens.push("A instalação deste ambiente foi confirmada. O ponto e o servidor permanecem associados.");
  }
  return {
    ok: mensagens.length === 0,
    mensagens,
    ambiente,
    ambienteCodigo: codigoAmbientePayGo(ambiente),
    ambienteBiblioteca: nomeAmbientePayGo(ambiente),
    executaInstalacao: false as const,
    executaTransacao: false as const,
  };
}

export function persistirConfiguracaoPayGo(
  estado: EstadoConfiguracaoPayGo,
  envio: EnvioConfiguracaoPayGo
):
  | { ok: true; associacao: "gravar" | "preservar"; estado: EstadoConfiguracaoPayGo }
  | { ok: false; erro: string } {
  const estabelecimento = envio.estabelecimento.trim().slice(0, 40);
  const ambiente: AmbientePayGo = envio.ambiente === "producao" ? "producao" : "homologacao";
  if (digitosCnpj(envio.cnpjInstalacao) && !cnpjValido(envio.cnpjInstalacao)) {
    return { ok: false, erro: "CNPJ de instalação inválido." };
  }
  const validacao = validarConfiguracaoPayGo(estado, envio);
  if (envio.habilitado) {
    if (!validacao.ok) return { ok: false, erro: validacao.mensagens[0] ?? "Configuração incompleta." };
    if (!estabelecimento) return { ok: false, erro: "Informe o estabelecimento." };
  } else {
    const bloqueio = validacao.mensagens.find((mensagem) => /diferente|confirmada|inválid/i.test(mensagem));
    if (bloqueio) return { ok: false, erro: bloqueio };
  }
  const servidor = validarServidorPayGo(envio.servidor);
  const ponto = envio.pontoCaptura.trim().slice(0, 40);
  const cnpj = cnpjValido(envio.cnpjInstalacao) || digitosCnpj(envio.cnpjInstalacao).slice(0, 14);
  if (envio.habilitado && !servidor.ok) return { ok: false, erro: servidor.motivo };
  return {
    ok: true,
    associacao: "gravar",
    estado: {
      habilitado: envio.habilitado,
      ambiente,
      estabelecimento,
      cnpjInstalacao: ambiente === "homologacao" ? cnpj : digitosCnpj(estado.cnpjInstalacao),
      cnpjProducao: ambiente === "producao" ? cnpj : digitosCnpj(estado.cnpjProducao),
      pontoCaptura: ambiente === "producao" ? ponto : estado.pontoCaptura.trim(),
      pontoHomologacao: ambiente === "homologacao" ? ponto : estado.pontoHomologacao.trim(),
      servidorHomologacao:
        ambiente === "homologacao" && servidor.ok ? servidor.servidor : estado.servidorHomologacao,
      servidorProducao: ambiente === "producao" && servidor.ok ? servidor.servidor : estado.servidorProducao,
      permitirOperacaoManual: envio.permitirOperacaoManual ?? estado.permitirOperacaoManual,
      instalacaoHomologacaoConfirmada: estado.instalacaoHomologacaoConfirmada === true,
      instalacaoProducaoConfirmada: estado.instalacaoProducaoConfirmada === true,
    },
  };
}

const POSID_PAYGO = /^[A-Za-z0-9._-]{1,40}$/;
const DISPOSITIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function posidConformeContrato(valor: string) {
  return POSID_PAYGO.test(valor.trim());
}

export function selecionarPontoDoAmbiente(input: {
  ambiente: string;
  pontoCapturaProducao: string;
  pontoHomologacao: string;
}) {
  const producao = input.pontoCapturaProducao.trim();
  const homologacao = input.pontoHomologacao.trim();
  if (input.ambiente === "homologacao") {
    if (!posidConformeContrato(homologacao)) {
      return {
        ok: false as const,
        codigo: "ponto-homologacao" as const,
        erro: "O ponto de homologação não está gravado.",
        pontoCapturaAtivo: "",
      };
    }
    return { ok: true as const, pontoCapturaAtivo: homologacao };
  }
  if (input.ambiente === "producao") {
    if (!posidConformeContrato(producao)) {
      return {
        ok: false as const,
        codigo: "ponto-producao" as const,
        erro: "O ponto de produção não está gravado.",
        pontoCapturaAtivo: "",
      };
    }
    return { ok: true as const, pontoCapturaAtivo: producao };
  }
  return {
    ok: false as const,
    codigo: "ambiente" as const,
    erro: "O ambiente oficial da empresa não está definido.",
    pontoCapturaAtivo: "",
  };
}

export function terminalExclusivoHomologacao(input: {
  empresaId: string;
  empresaOrigem: string;
  identificador: string;
  pontoHomologacao: string;
  servidorHomologacao: string;
  servidorProducao: string;
}) {
  if (!input.empresaId || input.empresaId !== input.empresaOrigem) {
    return {
      ok: false as const,
      codigo: "empresa" as const,
      erro: "A homologação só usa o ponto desta empresa.",
    };
  }
  const homologacao = input.pontoHomologacao.trim();
  const identificador = input.identificador.trim();
  if (!posidConformeContrato(homologacao) || identificador !== homologacao) {
    return {
      ok: false as const,
      codigo: "ponto" as const,
      erro: "A homologação precisa do ponto gravado em ponto_homologacao.",
    };
  }
  const servidor = validarServidorPayGo(input.servidorHomologacao);
  if (!servidor.ok) {
    return { ok: false as const, codigo: "servidor" as const, erro: "Informe o servidor PayGo da homologação." };
  }
  const producaoHost = hostDe(input.servidorProducao);
  if (producaoHost && hostDe(servidor.servidor) === producaoHost) {
    return {
      ok: false as const,
      codigo: "servidor" as const,
      erro: "O servidor de homologação precisa ser diferente do servidor de produção desta empresa.",
    };
  }
  return { ok: true as const, posid: homologacao, terminalCodigo: homologacao };
}

export function autorizarComputadorHomologacao(input: {
  empresaId: string;
  dispositivoId: string;
  posid: string;
  terminais: { empresaId: string; dispositivoId: string; ativo?: boolean; codigo?: string }[];
}) {
  const informado = input.dispositivoId.trim();
  if (!DISPOSITIVO.test(informado) || informado === input.posid.trim()) {
    return {
      ok: false as const,
      codigo: "dispositivo" as const,
      erro: "Este computador não está autorizado para o TEF desta empresa.",
    };
  }
  const terminal = input.terminais.find(
    (item) => item.ativo !== false && item.dispositivoId.toLowerCase() === informado.toLowerCase()
  );
  if (!terminal) {
    return {
      ok: false as const,
      codigo: "dispositivo" as const,
      erro: "Este computador não está autorizado para o TEF desta empresa.",
    };
  }
  if (terminal.empresaId !== input.empresaId) {
    return {
      ok: false as const,
      codigo: "empresa" as const,
      erro: "A homologação só usa o terminal desta empresa.",
    };
  }
  const terminalCodigo = String(terminal.codigo ?? "").trim();
  if (!terminalCodigo) {
    return {
      ok: false as const,
      codigo: "terminal" as const,
      erro: "O computador autorizado não tem terminal lógico desta empresa.",
    };
  }
  return { ok: true as const, dispositivoId: terminal.dispositivoId, terminalCodigo };
}

export function legendaPontoVinculo(input: {
  pontoVinculo: string;
  pontoProducao: string;
  pontoHomologacao: string;
}) {
  const ponto = input.pontoVinculo.trim();
  const producao = input.pontoProducao.trim();
  const homologacao = input.pontoHomologacao.trim();
  if (producao && ponto === producao && ponto !== homologacao) {
    return "Ponto de produção do vínculo";
  }
  if (homologacao && ponto === homologacao && ponto !== producao) {
    return "Ponto de homologação do vínculo";
  }
  if (ponto && producao && homologacao && ponto === producao && ponto === homologacao) {
    return "Ponto repetido nos dois ambientes";
  }
  return "Ponto gravado no vínculo";
}

export function cnpjHomologacaoRepeteProducao(cnpjHomologacao: string, cnpjProducao: string) {
  const homologacao = digitosCnpj(cnpjHomologacao);
  const producao = digitosCnpj(cnpjProducao);
  return Boolean(homologacao && producao && homologacao === producao);
}

export function credencialPayGoDoAmbiente(input: {
  ambiente: AmbientePayGo | "";
  pontoCaptura: string;
  pontoHomologacao: string;
  servidorHomologacao: string;
  servidorProducao: string;
  cnpjHomologacao: string;
  cnpjProducao: string;
  cnpjTerminal?: string;
}):
  | {
      ok: true;
      ambiente: AmbientePayGo;
      ponto: string;
      servidor: string;
      cnpj: string;
      cnpjDoTerminal: boolean;
    }
  | { ok: false; erro: string } {
  if (input.ambiente !== "homologacao" && input.ambiente !== "producao") {
    return { ok: false, erro: "O ambiente oficial da empresa não está definido." };
  }
  if (input.ambiente === "homologacao") {
    const ponto = input.pontoHomologacao.trim();
    const servidor = validarServidorPayGo(input.servidorHomologacao);
    const cnpj = cnpjValido(input.cnpjHomologacao);
    if (!posidConformeContrato(ponto)) {
      return { ok: false, erro: "Informe o ponto de captura da homologação." };
    }
    if (!servidor.ok) return { ok: false, erro: "Informe o servidor PayGo da homologação." };
    if (hostDe(input.servidorProducao) && hostDe(servidor.servidor) === hostDe(input.servidorProducao)) {
      return {
        ok: false,
        erro: "O servidor de homologação precisa ser diferente do servidor de produção desta empresa.",
      };
    }
    if (!cnpj) return { ok: false, erro: "Informe o CNPJ de instalação da homologação." };
    return { ok: true, ambiente: "homologacao", ponto, servidor: servidor.servidor, cnpj, cnpjDoTerminal: false };
  }
  const ponto = input.pontoCaptura.trim();
  const servidor = validarServidorPayGo(input.servidorProducao);
  const cnpjTela = cnpjValido(input.cnpjProducao);
  const cnpjTerminal = cnpjValido(input.cnpjTerminal ?? "");
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(ponto)) {
    return { ok: false, erro: "Informe o ponto de captura da produção." };
  }
  if (!servidor.ok) return { ok: false, erro: "Informe o servidor PayGo da produção." };
  const cnpj = cnpjTela || cnpjTerminal;
  if (!cnpj) return { ok: false, erro: "Informe o CNPJ de instalação da produção." };
  return {
    ok: true,
    ambiente: "producao",
    ponto,
    servidor: servidor.servidor,
    cnpj,
    cnpjDoTerminal: !cnpjTela,
  };
}

export function descreverTerminaisVinculados(
  terminais: { codigo: string; dispositivoId: string }[]
) {
  if (terminais.length === 0) {
    return { vazio: true as const, texto: "Nenhum terminal vinculado a esta empresa.", itens: [] };
  }
  return {
    vazio: false as const,
    texto: "",
    itens: terminais.map((terminal) => ({
      codigo: terminal.codigo,
      texto: terminal.dispositivoId
        ? `${terminal.codigo} · computador vinculado`
        : `${terminal.codigo} · sem computador`,
    })),
  };
}

export function descreverStatusConnector(input: {
  connectorEncontrado: boolean;
  terminalVinculado: boolean;
  credenciamentoNecessario: boolean;
  credenciamentoOk: boolean;
  pinpadVerificado: boolean;
}) {
  return etapasInstalacaoComercial({
    connectorEncontrado: input.connectorEncontrado,
    terminalVinculado: input.terminalVinculado,
    credenciamentoNecessario: input.credenciamentoNecessario,
    credenciamentoOk: input.credenciamentoOk,
    pinpadVerificado: input.pinpadVerificado,
    ambienteEfetivoConfirmado: false,
    pontoConfirmado: input.credenciamentoOk,
    servidorConfirmado: input.credenciamentoOk,
  });
}
