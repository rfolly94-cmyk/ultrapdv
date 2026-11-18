export function decidirTeclaMenuAdministrativo(input: {
  tecla: string;
  menuAberto: boolean;
  resultadoAberto: boolean;
  aguardando: boolean;
}) {
  if (input.tecla !== "Escape" || input.aguardando) {
    return { acao: "ignorar" as const };
  }
  if (input.menuAberto) {
    return { acao: "cancelar-menu" as const };
  }
  if (input.resultadoAberto) {
    return { acao: "sair" as const };
  }
  return { acao: "ignorar" as const };
}

export function pedidoCancelamentoMenu() {
  return { comando: "responder" as const, valor: "", cancelar: true as const };
}

export function estadoDoPontoAposOperacao(codigo: string) {
  if (codigo === "ponto_nao_instalado") return "ausente" as const;
  if (codigo === "ponto_instalado" || codigo === "instalada") return "instalado" as const;
  return "inalterado" as const;
}

export function mensagemMenuAdministrativo(resposta: { codigo?: string; erro?: string } | null) {
  if (!resposta || resposta.codigo !== "interrompida") return "";
  return (resposta.erro ?? "").trim();
}

export function campoDigitadoAdministrativo(tipoDado: number | null | undefined) {
  return tipoDado === 2 || tipoDado === 12 || tipoDado === 17;
}

export function capturaDeValor(identificador: number | null | undefined) {
  return identificador === 0x25 || identificador === 0x60;
}

export function promptTemMascaraDeValor(prompt: string) {
  return /@+(?:[.,]@+)*/.test(prompt);
}

export function promptValorVisivel(prompt: string) {
  return prompt
    .replace(/R\$\s*@+(?:[.,]@+)*/g, " ")
    .replace(/@+(?:[.,]@+)*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function valorSemCaracteresEspeciais(valor: string) {
  return valor.replace(/\D/g, "");
}
