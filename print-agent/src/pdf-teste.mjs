function escapar(texto) {
  return String(texto ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function papelRotulo(papel) {
  if (papel === "a4") {
    return "A4";
  }
  if (papel === "58mm") {
    return "58 mm";
  }
  return "80 mm";
}

export function gerarPdfTesteConector({
  porta,
  versao,
  impressora,
  papel,
  agora = new Date(),
} = {}) {
  const pagina = { largura: 226, altura: 420 };
  const fonte = 9;
  const margem = 14;
  const leading = 13;
  let y = pagina.altura - margem - fonte;
  const data = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(agora);

  const linhas = [
    "ULTRAPDV",
    "TESTE DE IMPRESSAO",
    "",
    "Conector funcionando corretamente.",
    "",
    `Versao: ${versao || "-"}`,
    `Porta: ${porta ?? "-"}`,
    `Impressora: ${impressora || "-"}`,
    `Papel: ${papelRotulo(papel)}`,
    `Data/hora: ${data}`,
    "",
    "--------------------------------",
    "UltraPDV Conector",
  ];

  const ops = ["BT", `/F1 ${fonte} Tf`];
  for (const linha of linhas) {
    ops.push(
      `1 0 0 1 ${margem} ${y.toFixed(1)} Tm (${escapar(linha).slice(0, 86)}) Tj`
    );
    y -= leading;
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const objetos = [
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
  return Buffer.from(corpo, "latin1");
}
