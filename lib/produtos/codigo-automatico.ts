export const MENSAGEM_CODIGO_AUTOMATICO_FALHOU =
  "Não foi possível gerar o código automático do produto.";

export const MENSAGEM_CODIGO_OBRIGATORIO =
  "Informe o código do produto.";

export function mensagemCodigoDuplicado(codigo: string) {
  return `Já existe um produto com o código ${codigo} nesta empresa.`;
}

export function ehCodigoNumericoSequencia(
  codigo: string | null | undefined
) {
  return /^[0-9]{1,18}$/.test(String(codigo ?? "").trim());
}

export function proximoCodigoNumerico(
  codigos: Array<string | null | undefined>
) {
  let maximo = BigInt(0);

  for (const codigo of codigos) {
    const texto = String(codigo ?? "").trim();

    if (!ehCodigoNumericoSequencia(texto)) {
      continue;
    }

    const valor = BigInt(texto);
    if (valor > maximo) {
      maximo = valor;
    }
  }

  return String(maximo + BigInt(1));
}

export function formMarcouCodigoAutomatico(formData: FormData) {
  return String(formData.get("codigo_automatico") ?? "") === "1";
}
