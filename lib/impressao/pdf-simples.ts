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

function streamPagina(input: {
  linhas: string[];
  largura: number;
  altura: number;
  fonte: number;
  margem: number;
  leading: number;
}) {
  let y = input.altura - input.margem - input.fonte;
  const ops = ["BT", `/F1 ${input.fonte} Tf`];
  for (const linhaBruta of input.linhas) {
    if (y < input.margem) {
      break;
    }
    ops.push(
      `1 0 0 1 ${input.margem} ${y.toFixed(1)} Tm (${escapar(linhaBruta).slice(0, 86)}) Tj`
    );
    y -= input.leading;
  }
  ops.push("ET");
  return ops.join("\n");
}

export function gerarPdfSimples(input: {
  papel: PapelImpressao;
  linhas: string[];
}): Uint8Array {
  const pagina = TAMANHOS[input.papel] ?? TAMANHOS.a4;
  const fonte = input.papel === "a4" ? 11 : 9;
  const margem = input.papel === "a4" ? 48 : 14;
  const leading = fonte + 4;
  const linhasPorPagina = Math.max(
    1,
    Math.floor((pagina.altura - margem * 2 - fonte) / leading) + 1
  );
  const linhas = input.linhas.slice(0, linhasPorPagina * 20);
  const blocos: string[][] = [];
  for (let i = 0; i < Math.max(linhas.length, 1); i += linhasPorPagina) {
    blocos.push(linhas.slice(i, i + linhasPorPagina));
  }

  const streams = blocos.map((bloco) =>
    streamPagina({
      linhas: bloco,
      largura: pagina.largura,
      altura: pagina.altura,
      fonte,
      margem,
      leading,
    })
  );

  const n = streams.length;
  const kids = streams.map((_, i) => `${3 + i} 0 R`).join(" ");
  const objetos: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
  ];
  for (let i = 0; i < n; i += 1) {
    const conteudoId = 3 + n + i;
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagina.largura} ${pagina.altura}] /Contents ${conteudoId} 0 R /Resources << /Font << /F1 ${3 + 2 * n} 0 R >> >> >>`
    );
  }
  for (const stream of streams) {
    objetos.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    );
  }
  objetos.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

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
