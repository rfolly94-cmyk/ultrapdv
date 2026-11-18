export type CapturaBiblioteca = {
  promptBiblioteca: string;
  mascara: string;
  tiposEntrada: number;
  tamanhoMinimo: number;
  tamanhoMaximo: number;
  valorMinimo: number;
  valorMaximo: number;
  validacaoDado: number;
  aceitaNulo: boolean;
  valorInicial: string;
  teclasAtalho: boolean;
  mensagemValidacao: string;
  mensagemConfirmacao: string;
  mensagemDadoMaior: string;
  mensagemDadoMenor: string;
  itemInicial: number;
  mensagemPrevia: string;
  tipoEntradaCodigoBarras: number;
  sugestaoJournal: boolean;
  vendas?: VendaOriginal[];
};

export type VendaOriginal = {
  chave: string;
  valorCentavos: number;
  data: string;
  referencia: string;
  requisicao: string;
  texto: string;
};

const TIPOS: Record<number, string> = {
  1: "Menu de opções",
  2: "Entrada digitada",
  3: "Dados do cartão",
  5: "Digitação no PinPad",
  6: "Senha no PinPad",
  9: "Cartão com chip offline",
  10: "Cartão com chip online",
  11: "Confirmação no PinPad",
  12: "Código de barras",
  13: "Remoção do cartão",
  14: "Comando do PinPad",
  16: "Confirmação positiva no PinPad",
  17: "Validação de senha",
  18: "Mensagem de processamento",
  19: "Teste de chaves",
  20: "QR Code",
};

export function capturaDaResposta(resposta: Record<string, unknown>): CapturaBiblioteca | null {
  const aninhada = resposta.captura && typeof resposta.captura === "object" ? (resposta.captura as Record<string, unknown>) : null;
  const fonte = aninhada ?? resposta;
  const presente = aninhada !== null || typeof fonte.tiposEntrada === "number" || typeof fonte.mascara === "string" || typeof fonte.promptBiblioteca === "string";
  if (!presente) return null;
  const oculto = resposta.oculto === true || fonte.oculto === true;
  return {
    promptBiblioteca: texto(fonte.promptBiblioteca),
    mascara: texto(fonte.mascara),
    tiposEntrada: numero(fonte.tiposEntrada),
    tamanhoMinimo: numero(fonte.tamanhoMinimo),
    tamanhoMaximo: numero(fonte.tamanhoMaximo),
    valorMinimo: numero(fonte.valorMinimo),
    valorMaximo: numero(fonte.valorMaximo),
    validacaoDado: numero(fonte.validacaoDado),
    aceitaNulo: fonte.aceitaNulo === true,
    valorInicial: oculto ? "" : texto(fonte.valorInicial),
    teclasAtalho: fonte.teclasAtalho === true,
    mensagemValidacao: texto(fonte.mensagemValidacao),
    mensagemConfirmacao: texto(fonte.mensagemConfirmacao),
    mensagemDadoMaior: texto(fonte.mensagemDadoMaior),
    mensagemDadoMenor: texto(fonte.mensagemDadoMenor),
    itemInicial: numero(fonte.itemInicial),
    mensagemPrevia: texto(fonte.mensagemPrevia),
    tipoEntradaCodigoBarras: numero(fonte.tipoEntradaCodigoBarras),
    sugestaoJournal: fonte.sugestaoJournal === true,
    vendas: vendasDaResposta(fonte.vendas),
  };
}

type CampoOficial = {
  nome: string;
  origem: string;
  exemplo: string;
  enviado: string;
  formato: "ddmmaa" | "mmaa" | "hora" | "centavos" | "texto" | "autenticacao";
  sensivel?: boolean;
};

const CAMPOS: Record<number, CampoOficial> = {
  0x32: { nome: "Número da requisição", origem: "REQNUM da transação. Não é o NSU do provedor nem o número da venda no UltraPDV.", exemplo: "000321", enviado: "000321", formato: "texto" },
  0x3d: { nome: "Data da primeira parcela", origem: "Data de vencimento da primeira parcela ou do pré-datado.", exemplo: "18/11/2026", enviado: "181126", formato: "ddmmaa" },
  0x44: { nome: "Referência PayGo", origem: "Referência da transação na infraestrutura PayGo.", exemplo: "000111", enviado: "000111", formato: "texto" },
  0x45: { nome: "Referência do provedor", origem: "NSU do host, referência do provedor. Não é a referência PayGo.", exemplo: "000789", enviado: "000789", formato: "texto" },
  0x46: { nome: "Código de autorização", origem: "Código de autorização impresso no comprovante, com 6 caracteres.", exemplo: "012345", enviado: "012345", formato: "texto" },
  0x25: { nome: "Valor total", origem: "Valor da operação em reais. Com expoente 2, R$ 2,00 é enviado como 200 e R$ 0,02 como 2.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x49: { nome: "Desconto", origem: "Desconto em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x4a: { nome: "Saque", origem: "Valor do saque em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x4d: { nome: "Taxa de embarque", origem: "Taxa de embarque em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x4e: { nome: "Gorjeta", origem: "Gorjeta em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x4f: { nome: "Valor da primeira parcela", origem: "Valor da primeira parcela em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x50: { nome: "Valor das demais parcelas", origem: "Valor das demais parcelas em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x57: { nome: "Data da transação original", origem: "Data da venda original impressa no comprovante TEF. O calendário usa dia, mês e ano, e a biblioteca recebe DDMMAA.", exemplo: "18/11/2026", enviado: "181126", formato: "ddmmaa" },
  0x58: { nome: "NSU da transação original", origem: "NSU impresso no comprovante. Não é o código de autorização nem o REQNUM.", exemplo: "000123", enviado: "000123", formato: "texto" },
  0x60: { nome: "Valor da transação original", origem: "Valor da venda original em reais. R$ 2,00 é enviado como 200. R$ 0,02 é enviado como 2. O mesmo número não é multiplicado outra vez.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0x62: { nome: "Código de autorização da transação original", origem: "Código de autorização da venda original, com até 6 caracteres. Não é o NSU.", exemplo: "012345", enviado: "012345", formato: "texto" },
  0x72: { nome: "Número da solicitação original", origem: "REQNUM da venda original. Não é o NSU do provedor.", exemplo: "000321", enviado: "000321", formato: "texto" },
  0x73: { nome: "Hora da transação original", origem: "Hora impressa no comprovante da venda original.", exemplo: "15:30:45", enviado: "153045", formato: "hora" },
  0x78: { nome: "Referência local (REF)", origem: "Informe o número que consta como REF no comprovante TEF original. Não informe NSU, autorização, REQNUM ou identificador da aplicação do cartão.", exemplo: "52", enviado: "52", formato: "texto" },
  0xbf06: { nome: "Valor devido", origem: "Valor devido em reais, no mesmo expoente do valor total.", exemplo: "R$ 2,00", enviado: "200", formato: "centavos" },
  0xc2: { nome: "Vencimento do cartão", origem: "Mês e ano de vencimento do cartão.", exemplo: "12/2026", enviado: "1226", formato: "mmaa" },
  0xf5: { nome: "Senha do lojista", origem: "Autenticação do lojista pedida pela biblioteca. O valor não é exibido nos detalhes técnicos.", exemplo: "", enviado: "", formato: "autenticacao", sensivel: true },
  0xf6: { nome: "Senha técnica", origem: "Autenticação técnica pedida pela biblioteca. O valor não é exibido nos detalhes técnicos.", exemplo: "", enviado: "", formato: "autenticacao", sensivel: true },
  0xfe: { nome: "Código de autorização original", origem: "Código de autorização da venda que será cancelada, com 6 caracteres. Não é o NSU.", exemplo: "012345", enviado: "012345", formato: "texto" },
};

export function tituloCaptura(tipoDado: number | null, identificador: number | null, captura: CapturaBiblioteca | null, prompt: string) {
  const campo = identificador === null ? undefined : CAMPOS[identificador];
  if (campo) return campo.nome;
  if (tipoDado === 17) return "Autenticação pedida pela biblioteca";
  const biblioteca = captura?.promptBiblioteca.trim() || "";
  if (biblioteca) return biblioteca;
  const visivel = prompt.trim();
  if (visivel && !captura) return visivel;
  const nome = TIPOS[tipoDado ?? -1] ?? "Solicitação da biblioteca";
  const codigo = identificador === null ? "" : ` 0x${identificador.toString(16).toUpperCase()}`;
  return `${nome}${codigo}`;
}

export function descreverCampo(identificador: number | null, tipoDado: number | null, captura: CapturaBiblioteca | null) {
  const campo = identificador === null ? undefined : CAMPOS[identificador];
  const formato = resolverFormato(identificador, captura?.validacaoDado ?? 0);
  return {
    nome: campo?.nome || tituloCaptura(tipoDado, identificador, captura, ""),
    origem: campo?.origem || "Informação pedida pela biblioteca para esta operação.",
    exemplo: campo?.exemplo || (formato === "ddmmaa" ? "18/11/2026" : formato === "mmaa" ? "12/2026" : ""),
    enviadoExemplo: campo?.enviado || "",
    formato,
    sensivel: campo?.sensivel === true || tipoDado === 17,
  };
}

export function orientacaoCaptura(tipoDado: number | null, captura: CapturaBiblioteca | null) {
  if (!captura) {
    return ["A biblioteca ainda não enviou máscara, limite ou tipo de caractere. Confira o título antes de enviar."];
  }
  const linhas = [`Tipo de captura: ${TIPOS[tipoDado ?? -1] ?? `código ${tipoDado}`}.`];
  if (captura.mensagemPrevia) linhas.push(captura.mensagemPrevia);
  if (captura.mascara) linhas.push(`Máscara: ${captura.mascara}. O valor enviado não inclui os símbolos da máscara.`);
  if (tipoDado === 2) linhas.push(textoEntrada(captura.tiposEntrada));
  if (captura.tamanhoMinimo > 0 || captura.tamanhoMaximo > 0) {
    linhas.push(`Caracteres: ${captura.tamanhoMinimo > 0 ? `mínimo ${captura.tamanhoMinimo}` : "sem mínimo"}${captura.tamanhoMaximo > 0 ? `, máximo ${captura.tamanhoMaximo}` : ""}.`);
  }
  if (captura.tiposEntrada === 1 && (captura.valorMinimo > 0 || captura.valorMaximo > 0)) {
    linhas.push(`Faixa numérica: ${captura.valorMinimo > 0 ? `mínimo ${captura.valorMinimo}` : "sem mínimo"}${captura.valorMaximo > 0 ? `, máximo ${captura.valorMaximo}` : ""}.`);
  }
  linhas.push(textoValidacao(captura.validacaoDado));
  linhas.push(captura.aceitaNulo ? "Este dado é opcional." : "Este dado é obrigatório.");
  if (captura.sugestaoJournal) linhas.push("O valor inicial veio da venda original. Confira antes de enviar.");
  if (tipoDado === 12) linhas.push(textoCodigoBarras(captura.tipoEntradaCodigoBarras));
  return linhas;
}

export function semMascara(entrada: string, mascara: string) {
  const textoEntrada = entrada.trim();
  if (!mascara.includes("@")) return textoEntrada;
  const literais = new Set([...mascara].filter((caractere) => caractere !== "@"));
  return [...textoEntrada].filter((caractere) => !literais.has(caractere)).join("");
}

export function prepararValorCaptura(entrada: string, tipoDado: number | null, identificador: number | null, captura: CapturaBiblioteca | null) {
  const formato = resolverFormato(identificador, captura?.validacaoDado ?? 0);
  if (formato === "conflito") {
    return { ok: false, valor: "", erro: "A validação devolvida pela biblioteca diverge do formato do dicionário. O valor não foi enviado." };
  }
  if (formato === "ddmmaa") return resultadoData(dataDdmmaa(entrada));
  if (formato === "mmaa") return resultadoData(dataMmaa(entrada));
  if (formato === "hora") return resultadoData(horaHhmmss(entrada));
  if (formato === "centavos") return centavos(entrada);
  if (!captura || tipoDado === null) {
    const valor = entrada.trim();
    if (!valor) return { ok: false, valor: "", erro: "Informe o dado pedido pela biblioteca." };
    return { ok: true, valor, erro: "" };
  }
  if (tipoDado === 2 && captura.tiposEntrada === 0) {
    if (!captura.valorInicial && !captura.aceitaNulo) {
      return { ok: false, valor: "", erro: captura.mensagemValidacao || "A biblioteca não permitiu editar este dado." };
    }
    return { ok: true, valor: captura.valorInicial, erro: "" };
  }
  const util = semMascara(entrada, captura.mascara);
  if (!util && captura.aceitaNulo) return { ok: true, valor: "", erro: "" };
  if (tipoDado === 2 && !caracteresAceitos(util, captura.tiposEntrada)) {
    return { ok: false, valor: "", erro: captura.mensagemValidacao || "O dado contém caracteres que a biblioteca não aceita." };
  }
  if (captura.tamanhoMinimo > 0 && util.length < captura.tamanhoMinimo) {
    return { ok: false, valor: "", erro: captura.mensagemDadoMenor || "O dado tem menos caracteres do que a biblioteca pediu." };
  }
  if (captura.tamanhoMaximo > 0 && util.length > captura.tamanhoMaximo) {
    return { ok: false, valor: "", erro: captura.mensagemDadoMaior || "O dado tem mais caracteres do que a biblioteca pediu." };
  }
  if (tipoDado === 2 && captura.tiposEntrada === 1 && (captura.valorMinimo > 0 || captura.valorMaximo > 0)) {
    const numero = Number(util);
    if (!/^\d+$/.test(util) || !Number.isSafeInteger(numero)) {
      return { ok: false, valor: "", erro: captura.mensagemValidacao || "O dado numérico não cabe na faixa informada pela biblioteca." };
    }
    if (captura.valorMinimo > 0 && numero < captura.valorMinimo) {
      return { ok: false, valor: "", erro: captura.mensagemDadoMenor || "O valor é menor do que o mínimo informado pela biblioteca." };
    }
    if (captura.valorMaximo > 0 && numero > captura.valorMaximo) {
      return { ok: false, valor: "", erro: captura.mensagemDadoMaior || "O valor é maior do que o máximo informado pela biblioteca." };
    }
  }
  const motivo = validar(captura.validacaoDado, util);
  if (motivo) return { ok: false, valor: "", erro: captura.mensagemValidacao || motivo };
  return { ok: true, valor: util, erro: "" };
}

function resolverFormato(identificador: number | null, validacao: number): CampoOficial["formato"] | "conflito" | "nativo" {
  const dicionario = identificador === null ? undefined : CAMPOS[identificador]?.formato;
  const pedido = validacao === 4 ? "mmaa" : validacao === 5 ? "ddmmaa" : undefined;
  if (dicionario && pedido && dicionario !== pedido) return "conflito";
  if (pedido === "ddmmaa" || pedido === "mmaa") return pedido;
  if (dicionario === "ddmmaa" || dicionario === "mmaa" || dicionario === "hora" || dicionario === "centavos") return dicionario;
  return "nativo";
}

function resultadoData(resultado: { ok: boolean; valor: string; erro: string }) {
  return resultado;
}

export function dataDdmmaa(entrada: string) {
  const partes = partesData(entrada.trim());
  if (!partes) return { ok: false, valor: "", erro: "Informe a data como DD/MM/AAAA. Exemplo: 18/11/2026." };
  if (partes.ano < 2000 || partes.ano > 2099 || !diaExiste(partes.dia, partes.mes, partes.ano)) {
    return { ok: false, valor: "", erro: "A data não existe." };
  }
  return { ok: true, valor: dois(partes.dia) + dois(partes.mes) + dois(partes.ano % 100), erro: "" };
}

export function dataMmaa(entrada: string) {
  const texto = entrada.trim();
  let mes = 0;
  let ano = 0;
  if (/^\d{2}\/\d{4}$/.test(texto)) {
    mes = Number(texto.slice(0, 2));
    ano = Number(texto.slice(3));
  } else if (/^\d{4}-\d{2}$/.test(texto)) {
    ano = Number(texto.slice(0, 4));
    mes = Number(texto.slice(5));
  } else if (/^\d{4}$/.test(texto)) {
    mes = Number(texto.slice(0, 2));
    ano = 2000 + Number(texto.slice(2));
  } else {
    return { ok: false, valor: "", erro: "Informe o mês e o ano como MM/AAAA. Exemplo: 12/2026." };
  }
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2099) return { ok: false, valor: "", erro: "O mês ou o ano não existe." };
  return { ok: true, valor: dois(mes) + dois(ano % 100), erro: "" };
}

function horaHhmmss(entrada: string) {
  const texto = entrada.trim();
  let hora = 0;
  let minuto = 0;
  let segundo = 0;
  if (/^\d{2}:\d{2}:\d{2}$/.test(texto)) {
    hora = Number(texto.slice(0, 2));
    minuto = Number(texto.slice(3, 5));
    segundo = Number(texto.slice(6, 8));
  } else if (/^\d{6}$/.test(texto)) {
    hora = Number(texto.slice(0, 2));
    minuto = Number(texto.slice(2, 4));
    segundo = Number(texto.slice(4, 6));
  } else {
    return { ok: false, valor: "", erro: "Informe a hora como HH:MM:SS. Exemplo: 15:30:45." };
  }
  if (hora > 23 || minuto > 59 || segundo > 59) return { ok: false, valor: "", erro: "A hora não existe." };
  return { ok: true, valor: dois(hora) + dois(minuto) + dois(segundo), erro: "" };
}

export function exibirReais(centavosInteiros: number) {
  const absoluto = Math.abs(Math.trunc(centavosInteiros));
  const inteiro = Math.trunc(absoluto / 100).toString();
  const frac = (absoluto % 100).toString().padStart(2, "0");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${milhar},${frac}`;
}

export function valorDaVenda(venda: VendaOriginal, identificador: number | null) {
  if (identificador === 0x25 || identificador === 0x60) return venda.valorCentavos > 0 ? exibirReais(venda.valorCentavos) : "";
  if (identificador === 0x57) return venda.data;
  if (identificador === 0x78) return venda.referencia;
  if (identificador === 0x72) return venda.requisicao;
  return "";
}

export function repasseCentavos(valor: string) {
  return /^\d+$/.test(valor) ? valor.replace(/^0+(?=\d)/, "") : valor;
}

function centavos(entrada: string) {
  const texto = entrada.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!texto) return { ok: false, valor: "", erro: "Informe o valor em reais, como 2,00." };
  if (/^\d+$/.test(texto)) return escalarReais(texto, "00");
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  const partes = normal.split(".");
  if (partes.length !== 2 || !/^\d+$/.test(partes[0]) || !/^\d{1,2}$/.test(partes[1])) {
    return { ok: false, valor: "", erro: "Informe o valor em reais, como 12.345,67." };
  }
  const frac = partes[1].length === 1 ? `${partes[1]}0` : partes[1];
  return escalarReais(partes[0], frac);
}

function escalarReais(inteiro: string, frac: string) {
  const reais = inteiro.replace(/^0+(?=\d)/, "") || "0";
  const centavosInteiros = `${reais}${frac}`.replace(/^0+(?=\d)/, "");
  if (centavosInteiros.length > 12) return { ok: false, valor: "", erro: "O valor excede as 12 posições do dicionário." };
  return { ok: true, valor: centavosInteiros, erro: "" };
}

function vendasDaResposta(valor: unknown): VendaOriginal[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const venda = item as Record<string, unknown>;
    const chave = texto(venda.chave);
    const data = texto(venda.data);
    const referencia = texto(venda.referencia);
    const requisicao = texto(venda.requisicao);
    const rotulo = texto(venda.texto);
    const valorCentavos = numero(venda.valorCentavos);
    if (!chave || chave.length > 80 || !/^\d{2}\/\d{2}\/\d{4}$/.test(data)) return [];
    if (referencia.length > 50 || requisicao.length > 20 || valorCentavos < 0) return [];
    return [{ chave, valorCentavos, data, referencia, requisicao, texto: rotulo.slice(0, 120) }];
  }).slice(0, 20);
}

function partesData(texto: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return { dia: Number(texto.slice(0, 2)), mes: Number(texto.slice(3, 5)), ano: Number(texto.slice(6)) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return { dia: Number(texto.slice(8)), mes: Number(texto.slice(5, 7)), ano: Number(texto.slice(0, 4)) };
  if (/^\d{8}$/.test(texto)) return { dia: Number(texto.slice(0, 2)), mes: Number(texto.slice(2, 4)), ano: Number(texto.slice(4)) };
  if (/^\d{6}$/.test(texto)) return { dia: Number(texto.slice(0, 2)), mes: Number(texto.slice(2, 4)), ano: 2000 + Number(texto.slice(4)) };
  return null;
}

function diaExiste(dia: number, mes: number, ano: number) {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const limite = mes === 2 ? (ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(mes) ? 30 : 31;
  return dia <= limite;
}

function dois(valor: number) {
  return String(valor).padStart(2, "0");
}

function caracteresAceitos(valor: string, tipos: number) {
  if (tipos === 1) return /^\d+$/.test(valor);
  if (tipos === 2) return /^\p{L}+$/u.test(valor);
  if (tipos === 3) return /^[\p{L}\d]+$/u.test(valor);
  if (tipos === 7) return valor.length > 0;
  return true;
}

function validar(validacao: number, valor: string) {
  if (validacao === 1 && !valor) return "A biblioteca não aceita este dado vazio.";
  if (validacao === 2 && !modulo10(valor)) return "O dígito verificador não confere.";
  if (validacao === 3 && !cpf(valor) && !cnpj(valor)) return "O CPF ou CNPJ não confere.";
  if (validacao === 4 && !/^\d{4}$/.test(valor)) return "A data não está no formato MMAA.";
  if (validacao === 5 && !/^\d{6}$/.test(valor)) return "A data não está no formato DDMMAA.";
  return "";
}

function modulo10(valor: string) {
  if (!/^\d{2,}$/.test(valor)) return false;
  let soma = 0;
  let alternar = false;
  for (let i = valor.length - 1; i >= 0; i -= 1) {
    let digito = Number(valor[i]);
    if (alternar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    alternar = !alternar;
  }
  return soma % 10 === 0;
}

function cpf(valor: string) {
  if (!/^\d{11}$/.test(valor) || new Set(valor).size === 1) return false;
  return digito(valor, 9, [10, 9, 8, 7, 6, 5, 4, 3, 2]) && digito(valor, 10, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
}

function cnpj(valor: string) {
  if (!/^\d{14}$/.test(valor) || new Set(valor).size === 1) return false;
  return digito(valor, 12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && digito(valor, 13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

function digito(valor: string, posicao: number, pesos: number[]) {
  const soma = pesos.reduce((total, peso, indice) => total + Number(valor[indice]) * peso, 0);
  const resto = soma % 11;
  return Number(valor[posicao]) === (resto < 2 ? 0 : 11 - resto);
}

function textoEntrada(tipos: number) {
  if (tipos === 0) return "A biblioteca envia o valor inicial e não permite edição.";
  if (tipos === 1) return "Somente números.";
  if (tipos === 2) return "Somente letras.";
  if (tipos === 3) return "Números e letras.";
  if (tipos === 7) return "Números, letras e caracteres especiais.";
  return "A biblioteca não descreveu a restrição de caracteres deste campo.";
}

function textoValidacao(validacao: number) {
  if (validacao === 2) return "Validação: dígito verificador módulo 10.";
  if (validacao === 3) return "Validação: CPF ou CNPJ.";
  if (validacao === 4) return "Formato: MMAA. Exemplo: 1226.";
  if (validacao === 5) return "Formato: DDMMAA. Exemplo: 181126.";
  if (validacao === 6) return "A biblioteca pede que o dado seja digitado duas vezes.";
  return "Sem validação adicional informada pela biblioteca.";
}

function textoCodigoBarras(tipo: number) {
  const digitado = (tipo & 1) === 1;
  const lido = (tipo & 2) === 2;
  if (digitado && lido) return "O código de barras pode ser digitado ou lido.";
  if (lido) return "O código de barras deve ser lido.";
  if (digitado) return "O código de barras deve ser digitado, com os dígitos verificadores.";
  return "A biblioteca não informou o meio de entrada do código de barras.";
}

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.replace(/\0/g, "").trim() : "";
}

function numero(valor: unknown) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}
