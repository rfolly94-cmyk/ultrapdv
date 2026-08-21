import type { PapelImpressao } from "./tipos";

const TAMANHOS: Record<PapelImpressao, { largura: number; altura: number }> = {
  "58mm": { largura: 164, altura: 520 },
  "80mm": { largura: 226, altura: 620 },
  a4: { largura: 595, altura: 842 },
};

function escapar(texto: string) {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

export function gerarPdfSimples(input: {
  papel: PapelImpressao;
  linhas: string[];
}): Uint8Array {
  const pagina = TAMANHOS[input.papel] ?? TAMANHOS.a4;
  const fonte = input.papel === "a4" ? 11 : 9;
  const margem = input.papel === "a4" ? 48 : 14;
  const leading = fonte + 4;
  let y = pagina.altura - margem - fonte;
  const ops = ["BT", `/F1 ${fonte} Tf`];

  for (const linhaBruta of input.linhas.slice(0, 70)) {
    if (y < margem) {
      break;
    }
    ops.push(
      `1 0 0 1 ${margem} ${y.toFixed(1)} Tm (${escapar(linhaBruta).slice(0, 86)}) Tj`
    );
    y -= leading;
  }
  ops.push("ET");
  const stream = ops.join("\n");

  const objetos: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagina.largura} ${pagina.altura}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let corpo = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objetos.length; i += 1) {
    offsets.push(Buffer.byteLength(corpo));
    corpo += `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(corpo);
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i += 1) {
    corpo += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(corpo, "latin1"));
}

export function linhasTesteImpressao(input: {
  empresaNome: string;
  tipoRotulo: string;
  impressora: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  const data = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(agora);

  return [
    "UltraPDV",
    "Teste de impressao",
    "",
    `Empresa: ${input.empresaNome || "-"}`,
    `Data/hora: ${data}`,
    `Tipo: ${input.tipoRotulo}`,
    `Impressora: ${input.impressora || "-"}`,
    "",
    "Documento de teste. Sem valor fiscal.",
  ];
}
