import { deflateRawSync } from "node:zlib";

const CRC_TABELA = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABELA[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = {
  nome: string;
  conteudo: Buffer;
};

function dosDateTime(data = new Date()) {
  const ano = Math.max(1980, data.getFullYear());
  const dosTime =
    (data.getHours() << 11) |
    (data.getMinutes() << 5) |
    Math.floor(data.getSeconds() / 2);
  const dosDate =
    ((ano - 1980) << 9) |
    ((data.getMonth() + 1) << 5) |
    data.getDate();
  return { dosTime, dosDate };
}

export function criarZip(arquivos: ZipEntry[]) {
  const agora = dosDateTime();
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome.replace(/\\/g, "/"), "utf8");
    const compactado = deflateRawSync(arquivo.conteudo);
    const crc = crc32(arquivo.conteudo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(agora.dosTime, 10);
    local.writeUInt16LE(agora.dosDate, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compactado.length, 18);
    local.writeUInt32LE(arquivo.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    partes.push(local, nome, compactado);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(agora.dosTime, 12);
    central.writeUInt16LE(agora.dosDate, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compactado.length, 20);
    central.writeUInt32LE(arquivo.conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nome);

    offset += local.length + nome.length + compactado.length;
  }

  const centralSize = centrais.reduce((soma, parte) => soma + parte.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(centralSize, 12);
  fim.writeUInt32LE(offset, 16);
  fim.writeUInt16LE(0, 20);

  return Buffer.concat([...partes, ...centrais, fim]);
}
