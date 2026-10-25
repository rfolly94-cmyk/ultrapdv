export const TAMANHO_PW_GETDATA = 12500;
export const CAPACIDADE_PW_GETDATA = 9;
export const LIMITE_OPCOES_MENU = 40;
export const OFFSET_IDENTIFICADOR = 0;
export const OFFSET_TIPO = 2;
export const OFFSET_PROMPT = 3;
export const TAMANHO_PROMPT = 84;
export const OFFSET_QUANTIDADE_MENU = 87;
export const OFFSET_TEXTO_MENU = 88;
export const TAMANHO_TEXTO_MENU = 41;
export const OFFSET_VALOR_MENU = 1728;
export const TAMANHO_VALOR_MENU = 256;

export function lerCampoFixo(buffer, inicio, tamanho) {
  let fim = inicio;
  const limite = inicio + tamanho;
  while (fim < limite && buffer[fim] !== 0) fim += 1;
  return buffer.toString("latin1", inicio, fim);
}

export function lerCapturaPwGetData(buffer, indice = 0) {
  const base = indice * TAMANHO_PW_GETDATA;
  if (!Buffer.isBuffer(buffer) || buffer.length < base + TAMANHO_PW_GETDATA) {
    return { ok: false, codigo: "BUFFER", opcoes: [], valores: [] };
  }
  const identificador = buffer.readUInt16LE(base + OFFSET_IDENTIFICADOR);
  const tipo = buffer.readUInt8(base + OFFSET_TIPO);
  const prompt = lerCampoFixo(buffer, base + OFFSET_PROMPT, TAMANHO_PROMPT);
  const quantidade = buffer.readUInt8(base + OFFSET_QUANTIDADE_MENU);
  if (quantidade > LIMITE_OPCOES_MENU) {
    return { ok: false, codigo: "QUANTIDADE", wIdentificador: identificador, bTipoDeDado: tipo, opcoes: [], valores: [] };
  }
  const opcoes = [];
  const valores = [];
  for (let item = 0; item < quantidade; item += 1) {
    opcoes.push(lerCampoFixo(buffer, base + OFFSET_TEXTO_MENU + item * TAMANHO_TEXTO_MENU, TAMANHO_TEXTO_MENU));
    valores.push(lerCampoFixo(buffer, base + OFFSET_VALOR_MENU + item * TAMANHO_VALOR_MENU, TAMANHO_VALOR_MENU));
  }
  const incompleto = tipo === 1 && (quantidade < 1 || opcoes.some((texto, item) => texto.length === 0 || valores[item].length === 0));
  return {
    ok: !incompleto,
    codigo: incompleto ? "MENU_INCOMPLETO" : "ok",
    wIdentificador: identificador,
    bTipoDeDado: tipo,
    szPrompt: prompt,
    bNumOpcoesMenu: quantidade,
    vszTextoMenu: opcoes,
    vszValorMenu: valores,
    identificador,
    tipo,
    prompt,
    opcoes,
    valores,
  };
}

export function lerCapturasPwGetData(buffer, capacidade, informada) {
  const total = Number(informada);
  if (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > CAPACIDADE_PW_GETDATA) {
    return { ok: false, codigo: "CAPACIDADE", quantidade: 0, capturas: [] };
  }
  if (!Number.isInteger(total) || total < 0 || total > capacidade) {
    return { ok: false, codigo: "QUANTIDADE", quantidade: 0, capturas: [] };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < capacidade * TAMANHO_PW_GETDATA) {
    return { ok: false, codigo: "BUFFER", quantidade: 0, capturas: [] };
  }
  const capturas = [];
  for (let indice = 0; indice < total; indice += 1) {
    const item = lerCapturaPwGetData(buffer, indice);
    capturas.push(item);
    if (item.codigo === "MENU_INCOMPLETO") {
      return { ok: false, codigo: "MENU_INCOMPLETO", quantidade: total, capturas };
    }
  }
  return { ok: true, codigo: "ok", quantidade: total, capturas };
}

export function escreverMenuPwGetData(destino, indice = 0, menu = {}) {
  const textos = Array.isArray(menu.textos) ? menu.textos : [];
  const valores = Array.isArray(menu.valores) ? menu.valores : [];
  const quantidade = Math.min(textos.length, valores.length, LIMITE_OPCOES_MENU);
  if (Buffer.isBuffer(destino)) {
    const base = indice * TAMANHO_PW_GETDATA;
    if (destino.length < base + TAMANHO_PW_GETDATA) return { ok: false, codigo: "BUFFER" };
    destino.fill(0, base, base + TAMANHO_PW_GETDATA);
    destino.writeUInt16LE(Number(menu.identificador) || 0, base + OFFSET_IDENTIFICADOR);
    destino.writeUInt8(1, base + OFFSET_TIPO);
    destino.write(String(menu.prompt ?? ""), base + OFFSET_PROMPT, TAMANHO_PROMPT, "latin1");
    destino.writeUInt8(quantidade, base + OFFSET_QUANTIDADE_MENU);
    for (let item = 0; item < quantidade; item += 1) {
      destino.write(
        String(textos[item]),
        base + OFFSET_TEXTO_MENU + item * TAMANHO_TEXTO_MENU,
        TAMANHO_TEXTO_MENU,
        "latin1"
      );
      destino.write(
        String(valores[item]),
        base + OFFSET_VALOR_MENU + item * TAMANHO_VALOR_MENU,
        TAMANHO_VALOR_MENU,
        "latin1"
      );
    }
    return { ok: true, codigo: "ok" };
  }
  if (Array.isArray(destino)) {
    destino[indice] = {
      identificador: menu.identificador,
      prompt: menu.prompt,
      textos,
      valores,
      opcoes: textos,
    };
    return { ok: true, codigo: "ok" };
  }
  return { ok: false, codigo: "BUFFER" };
}
