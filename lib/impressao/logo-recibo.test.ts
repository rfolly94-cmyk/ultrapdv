import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { gerarPdfSimples } from "./pdf-simples";
import { decodificarPngParaRgb, prepararImagemPdf } from "./pdf-imagem";
import { urlLogoReciboEmpresa } from "./logo-recibo";
import { resolverLogoReciboEmpresa } from "./resolver-logo-recibo";
import {
  layoutReciboPadrao,
  montarReciboVenda,
  reciboVendaExemplo,
} from "./recibo-layout";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
}

function pngRgb(width: number, height: number, rgb: Buffer) {
  const assinatura = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  function chunk(tipo: string, data: Buffer) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([
      len,
      Buffer.from(tipo, "ascii"),
      data,
      Buffer.alloc(4),
    ]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const linhas: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    linhas.push(Buffer.from([0]));
    linhas.push(rgb.subarray(y * width * 3, (y + 1) * width * 3));
  }
  return Buffer.concat([
    assinatura,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(linhas))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSof(width: number, height: number) {
  const sof = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 255,
    height & 255,
    (width >> 8) & 255,
    width & 255,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
  return sof;
}

function clienteLogoFake(opts: {
  empresaId: string;
  logoPath: string | null;
  bytes?: Buffer | null;
}) {
  return {
    from(tabela: string) {
      return {
        select() {
          return {
            eq(_coluna: string, id: string) {
              return {
                async maybeSingle() {
                  if (tabela !== "empresas" || id !== opts.empresaId) {
                    return { data: null };
                  }
                  return {
                    data: { id: opts.empresaId, logo_path: opts.logoPath },
                  };
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            if (
              bucket !== "logos-empresas" ||
              !opts.bytes ||
              path !== opts.logoPath
            ) {
              return { data: null, error: { message: "ausente" } };
            }
            const copia = Buffer.from(opts.bytes);
            return {
              data: {
                arrayBuffer: async () =>
                  copia.buffer.slice(
                    copia.byteOffset,
                    copia.byteOffset + copia.byteLength
                  ),
              },
              error: null,
            };
          },
        };
      },
    },
  };
}

test("campo oficial da logo é empresas.logo_path da empresa ativa", () => {
  const pathA = `${empresaA}/logo-111.png`;
  const pathB = `${empresaB}/logo-222.png`;
  const urlA = urlLogoReciboEmpresa(empresaA, pathA);
  const urlB = urlLogoReciboEmpresa(empresaB, pathB);
  assert.ok(urlA?.includes(pathA));
  assert.ok(urlB?.includes(pathB));
  assert.notEqual(urlA, urlB);
  assert.equal(urlLogoReciboEmpresa(empresaA, pathB), null);
  assert.equal(urlLogoReciboEmpresa(empresaA, null), null);
  assert.equal(urlLogoReciboEmpresa(empresaA, "https://cdn.exemplo/x.png"), null);
  assert.equal(urlLogoReciboEmpresa("", pathA), null);
  assert.match(urlA ?? "", /\/storage\/v1\/object\/public\/logos-empresas\//);

  assert.match(
    fonte("lib/impressao/logo-recibo.ts"),
    /pathLogoDaEmpresa/
  );
  assert.match(
    fonte("lib/impressao/logo-recibo.ts"),
    /urlPublicaLogoEmpresa/
  );
  assert.match(
    fonte("lib/empresa/identidade-sessao.ts"),
    /pathLogoDaEmpresa/
  );
  assert.doesNotMatch(
    fonte("lib/impressao/resolver-logo-recibo.ts"),
    /createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/
  );
  assert.doesNotMatch(
    fonte("components/impressao/recibo-termico.tsx"),
    /createAdminClient|SERVICE_ROLE|obterLogomarcaFiscalHex|toString\("hex"\)/
  );
});

test("empresa sem logo ou arquivo removido não quebra o recibo", async () => {
  const semLogo = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: null,
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.equal(semLogo.url, null);
  assert.equal(semLogo.bytes, null);

  const removido = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaA}/logo-sumiu.png`,
      bytes: null,
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.ok(removido.url?.includes(`${empresaA}/logo-sumiu.png`));
  assert.equal(removido.bytes, null);

  const pdf = gerarPdfSimples({
    papel: "80mm",
    linhas: ["TOTAL 10,00"],
    logo: { bytes: Buffer.from("nao-e-imagem"), mime: "image/png" },
  });
  const texto = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.match(texto, /TOTAL 10,00/);
  assert.doesNotMatch(texto, /\/Im1 Do/);
});

test("preview só mostra logo HTTP da empresa ativa e esconde imagem quebrada", () => {
  const dados = reciboVendaExemplo();
  dados.empresa.logoUrl = `https://proj.supabase.co/storage/v1/object/public/logos-empresas/${empresaA}/logo-1.png`;
  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  layout.cabecalho.alinhamento = "esquerda";
  const montado = montarReciboVenda(dados, layout);
  const logo = montado.blocos.find((bloco) => bloco.tipo === "logo");
  assert.equal(logo?.tipo, "logo");
  if (logo?.tipo === "logo") {
    assert.equal(logo.alinhamento, "esquerda");
  }
  assert.equal(
    montado.linhasPdf.some((linha) => linha.includes("logos-empresas")),
    false
  );

  dados.empresa.logoUrl = `${empresaA}/logo-1.png`;
  assert.equal(
    montarReciboVenda(dados, layout).blocos.some((bloco) => bloco.tipo === "logo"),
    false
  );

  layout.cabecalho.logo = false;
  dados.empresa.logoUrl = `https://proj.supabase.co/storage/v1/object/public/logos-empresas/${empresaA}/logo-1.png`;
  assert.equal(
    montarReciboVenda(dados, layout).blocos.some((bloco) => bloco.tipo === "logo"),
    false
  );

  const preview = fonte("components/impressao/recibo-termico.tsx");
  assert.match(preview, /logoUrlUtilizavel/);
  assert.match(preview, /onError/);
  assert.match(preview, /object-contain/);
  assert.match(preview, /justify-start/);
  assert.match(fonte("app/pdv/imprimir/recibo/[id]/page.tsx"), /logoUrl=\{recibo\.empresa\.logoUrl\}/);
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /logoUrl=\{empresa\.logoUrl\}/
  );
});

test("PDF incorpora a logo no servidor e ignora URL remota crua", () => {
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const png = pngRgb(2, 2, rgb);
  const decodificado = decodificarPngParaRgb(png);
  assert.equal(decodificado?.width, 2);
  assert.equal(decodificado?.height, 2);
  assert.deepEqual([...decodificado!.rgb.subarray(0, 3)], [255, 0, 0]);

  const pdf = gerarPdfSimples({
    papel: "80mm",
    linhas: ["UltraPDV"],
    logo: { bytes: png, mime: "image/png", alinhamento: "centro" },
  });
  const texto = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.match(texto, /\/Subtype \/Image/);
  assert.match(texto, /\/Im1 Do/);
  assert.match(texto, /UltraPDV/);
  assert.doesNotMatch(texto, /https:\/\/proj\.supabase\.co/);

  const jpeg = jpegSof(3, 2);
  assert.ok(prepararImagemPdf(jpeg, "image/jpeg"));
  const pdfJpeg = gerarPdfSimples({
    papel: "58mm",
    linhas: ["OK"],
    logo: { bytes: jpeg, mime: "image/jpeg", alinhamento: "esquerda" },
  });
  assert.match(Buffer.from(pdfJpeg).toString("latin1"), /\/Filter \/DCTDecode/);
  assert.match(Buffer.from(pdfJpeg).toString("latin1"), /\/Im1 Do/);
});

test("resolver baixa só o arquivo da empresa pedida", async () => {
  const png = pngRgb(1, 1, Buffer.from([0, 0, 255]));
  const logoA = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaA}/logo-a.png`,
      bytes: png,
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.equal(logoA.path, `${empresaA}/logo-a.png`);
  assert.ok(logoA.bytes?.equals(png));
  assert.equal(logoA.mime, "image/png");

  const cruzado = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaB}/logo-b.png`,
      bytes: png,
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.equal(cruzado.path, null);
  assert.equal(cruzado.bytes, null);

  const soUrl = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaA}/logo-a.png`,
      bytes: png,
    }) as never,
    empresaId: empresaA,
    logoPath: `${empresaA}/logo-a.png`,
    incorporar: false,
  });
  assert.equal(soUrl.bytes, null);
  assert.ok(soUrl.url?.includes(`${empresaA}/logo-a.png`));
});

test("troca de logo não depende de rebuild e PDF de teste usa o resolver", () => {
  assert.match(
    fonte("app/configuracoes/empresa/actions.ts"),
    /revalidatePath\("\/configuracoes\/impressao\/recibo"\)/
  );
  assert.match(fonte("lib/impressao/gerar-pdf-recibo.ts"), /incorporar: true/);
  assert.match(
    fonte("lib/impressao/gerar-pdf-recibo.ts"),
    /resolverLogoReciboEmpresa/
  );
  assert.doesNotMatch(
    fonte("lib/impressao/recibo-layout.ts"),
    /logoUrl:\s*"https:\/\//
  );
});
