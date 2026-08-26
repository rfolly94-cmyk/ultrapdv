import type { PapelImpressao } from "./tipos";
import { caixaLogoTermica, prepararImagemPdf } from "./pdf-imagem";
import type { LogoPdfRecibo } from "./logo-recibo";

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
  logo?: { x: number; y: number; w: number; h: number } | null;
}) {
  const ops: string[] = [];
  if (input.logo) {
    ops.push("q");
    ops.push(
      `${input.logo.w.toFixed(1)} 0 0 ${input.logo.h.toFixed(1)} ${input.logo.x.toFixed(1)} ${input.logo.y.toFixed(1)} cm`
    );
    ops.push("/Im1 Do");
    ops.push("Q");
  }

  let y = input.logo
    ? input.logo.y - input.leading
    : input.altura - input.margem - input.fonte;
  ops.push("BT", `/F1 ${input.fonte} Tf`);
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

function montarPdf(objetos: Buffer[]) {
  const partes: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  let tamanho = partes[0].length;

  for (let i = 0; i < objetos.length; i += 1) {
    offsets.push(tamanho);
    const bloco = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      objetos[i],
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    partes.push(bloco);
    tamanho += bloco.length;
  }

  const startxref = tamanho;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  partes.push(Buffer.from(xref, "latin1"));
  return new Uint8Array(Buffer.concat(partes));
}

export function gerarPdfSimples(input: {
  papel: PapelImpressao;
  linhas: string[];
  logo?: LogoPdfRecibo | null;
}): Uint8Array {
  const pagina = TAMANHOS[input.papel] ?? TAMANHOS.a4;
  const fonte = input.papel === "a4" ? 11 : 9;
  const margem = input.papel === "a4" ? 48 : 14;
  const leading = fonte + 4;
  const imagem = input.logo?.bytes
    ? prepararImagemPdf(input.logo.bytes, input.logo.mime)
    : null;
  const caixa = imagem
    ? caixaLogoTermica({
        papel: input.papel,
        larguraPx: imagem.larguraPx,
        alturaPx: imagem.alturaPx,
        larguraPagina: pagina.largura,
        margem,
        alinhamento: input.logo?.alinhamento,
      })
    : null;
  const logoH = caixa ? caixa.h + 8 : 0;
  const linhasPorPagina = Math.max(
    1,
    Math.floor((pagina.altura - margem * 2 - fonte) / leading) + 1
  );
  const linhasPrimeira = Math.max(
    1,
    Math.floor((pagina.altura - margem * 2 - fonte - logoH) / leading) + 1
  );
  const linhas = input.linhas.slice(0, linhasPorPagina * 20);
  const blocos: string[][] = [];
  if (linhas.length === 0) {
    blocos.push([]);
  } else {
    blocos.push(linhas.slice(0, linhasPrimeira));
    for (let i = linhasPrimeira; i < linhas.length; i += linhasPorPagina) {
      blocos.push(linhas.slice(i, i + linhasPorPagina));
    }
  }

  const logoGeom = caixa
    ? {
        x: caixa.x,
        y: pagina.altura - margem - caixa.h,
        w: caixa.w,
        h: caixa.h,
      }
    : null;

  const streams = blocos.map((bloco, indice) =>
    streamPagina({
      linhas: bloco,
      largura: pagina.largura,
      altura: pagina.altura,
      fonte,
      margem,
      leading,
      logo: indice === 0 ? logoGeom : null,
    })
  );

  const n = streams.length;
  const kids = streams.map((_, i) => `${3 + i} 0 R`).join(" ");
  const fonteId = 3 + 2 * n;
  const imagemId = imagem ? fonteId + 1 : 0;
  const objetos: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from(
      `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
      "latin1"
    ),
  ];

  for (let i = 0; i < n; i += 1) {
    const conteudoId = 3 + n + i;
    const xobject =
      imagem && i === 0 ? ` /XObject << /Im1 ${imagemId} 0 R >>` : "";
    objetos.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagina.largura} ${pagina.altura}] /Contents ${conteudoId} 0 R /Resources << /Font << /F1 ${fonteId} 0 R >>${xobject} >> >>`,
        "latin1"
      )
    );
  }

  for (const stream of streams) {
    objetos.push(
      Buffer.from(
        `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
        "latin1"
      )
    );
  }

  objetos.push(
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1")
  );
  if (imagem) {
    objetos.push(imagem.objeto);
  }

  return montarPdf(objetos);
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
