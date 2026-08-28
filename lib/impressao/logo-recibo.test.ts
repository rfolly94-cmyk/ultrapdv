import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deflateSync } from "node:zlib";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { bytesDeArquivoStorage } from "./bytes-logo-recibo";
import { gerarPdfReciboEmpresa } from "./gerar-pdf-recibo";
import {
  formatoLogoNoPdf,
  normalizarLogoParaPdf,
  pdfContemLogoIncorporada,
} from "./incorporar-logo-pdf";
import { urlLogoReciboEmpresa } from "./logo-recibo";
import {
  pathLogoReciboPersonalizada,
  urlLogoReciboPersonalizada,
} from "./logo-recibo-personalizada";
import { decodificarPngParaRgb, prepararImagemPdf } from "./pdf-imagem";
import { gerarPdfSimples } from "./pdf-simples";
import {
  layoutReciboPadrao,
  montarReciboVenda,
  reciboVendaExemplo,
  sanitizarLayoutRecibo,
} from "./recibo-layout";
import {
  resolverLogoRecibo,
  resolverLogoReciboEmpresa,
} from "./resolver-logo-recibo";

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

const fetchOriginal = globalThis.fetch;
const fetchFixtures = new Map<string, Buffer>();

before(() => {
  globalThis.fetch = async (input) => {
    const url = String(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url
    );
    const bytes = fetchFixtures.get(url);
    if (bytes) {
      const corpo = Uint8Array.from(bytes);
      return new Response(corpo, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response("ausente", { status: 404 });
  };
});

after(() => {
  globalThis.fetch = fetchOriginal;
});

function clienteLogoFake(opts: {
  empresaId: string;
  logoPath: string | null;
  bytes?: Buffer | null;
  bucket?: string;
  downloadComo?: "blob" | "buffer";
  falharDownload?: boolean;
}) {
  const bucketEsperado = opts.bucket ?? "logos-empresas";
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
              opts.falharDownload ||
              bucket !== bucketEsperado ||
              !opts.bytes ||
              path !== opts.logoPath
            ) {
              return { data: null, error: { message: "ausente" } };
            }
            if (opts.downloadComo === "buffer") {
              return { data: Buffer.from(opts.bytes), error: null };
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
  layout.cabecalho.logoFonte = "empresa";
  layout.cabecalho.logoAlinhamento = "esquerda";
  dados.empresa.logoEmpresaUrl = dados.empresa.logoUrl;
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
  dados.empresa.logoEmpresaUrl = `${empresaA}/logo-1.png`;
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
  assert.match(preview, /justify-end/);
  assert.match(fonte("app/pdv/imprimir/recibo/[id]/page.tsx"), /urlLogoReciboEfetiva/);
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /urlLogoReciboEfetiva/
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
  assert.ok(pdfContemLogoIncorporada(pdf));
  assert.equal(formatoLogoNoPdf(pdf), "png-rgb-flate");
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
  assert.match(fonte("lib/impressao/gerar-pdf-recibo.ts"), /resolverLogoRecibo/);
  assert.match(fonte("lib/impressao/gerar-pdf-recibo.ts"), /logoResolvidaParaPdf/);
  assert.doesNotMatch(
    fonte("lib/impressao/recibo-layout.ts"),
    /logoUrl:\s*"https:\/\//
  );
});

test("logo personalizada pertence à empresa e não substitui a oficial", () => {
  const pathA = `${empresaA}/logo-recibo1.png`;
  const pathB = `${empresaB}/logo-recibo2.webp`;
  assert.equal(
    pathLogoReciboPersonalizada(empresaA, pathA),
    pathA
  );
  assert.equal(pathLogoReciboPersonalizada(empresaA, pathB), null);
  assert.equal(
    pathLogoReciboPersonalizada(empresaA, "https://cdn.exemplo/x.png"),
    null
  );
  const urlA = urlLogoReciboPersonalizada(empresaA, pathA);
  const urlB = urlLogoReciboPersonalizada(empresaB, pathB);
  assert.ok(urlA?.includes("recibos-logos"));
  assert.ok(urlA?.includes(pathA));
  assert.notEqual(urlA, urlB);

  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  layout.cabecalho.logoFonte = "personalizada";
  layout.cabecalho.logoPersonalizadaPath = pathA;
  layout.cabecalho.logoTamanho = "grande";
  layout.cabecalho.logoAlinhamento = "direita";
  const dados = reciboVendaExemplo();
  dados.empresa.logoEmpresaUrl =
    `https://proj.supabase.co/storage/v1/object/public/logos-empresas/${empresaA}/oficial.png`;
  dados.empresa.logoPersonalizadaUrl = urlA;
  const montado = montarReciboVenda(dados, layout);
  const bloco = montado.blocos.find((item) => item.tipo === "logo");
  assert.equal(bloco?.tipo, "logo");
  if (bloco?.tipo === "logo") {
    assert.equal(bloco.alinhamento, "direita");
    assert.equal(bloco.tamanho, "grande");
  }

  layout.cabecalho.logoFonte = "empresa";
  const oficial = montarReciboVenda(dados, layout);
  assert.equal(oficial.blocos.some((item) => item.tipo === "logo"), true);

  layout.cabecalho.logoFonte = "personalizada";
  dados.empresa.logoPersonalizadaUrl = null;
  assert.equal(
    montarReciboVenda(dados, layout).blocos.some((item) => item.tipo === "logo"),
    false
  );

  layout.cabecalho.logo = false;
  dados.empresa.logoPersonalizadaUrl = urlA;
  assert.equal(
    montarReciboVenda(dados, layout).blocos.some((item) => item.tipo === "logo"),
    false
  );

  const sanitizado = sanitizarLayoutRecibo({
    versao: 1,
    cabecalho: {
      logoFonte: "personalizada",
      logoTamanho: "pequena",
      logoAlinhamento: "direita",
      logoPersonalizadaPath: pathB,
    },
  });
  assert.equal(sanitizado.ok, true);
  if (sanitizado.ok) {
    assert.equal(sanitizado.valor.cabecalho.logoPersonalizadaPath, pathB);
    assert.equal(sanitizado.valor.cabecalho.logoFonte, "personalizada");
  }

  const pdf = gerarPdfSimples({
    papel: "80mm",
    linhas: ["OK"],
    logo: {
      bytes: pngRgb(2, 2, Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255])),
      mime: "image/png",
      alinhamento: "direita",
      tamanho: "pequena",
    },
  });
  assert.ok(pdfContemLogoIncorporada(pdf));
});

test("upload da logo do recibo não usa service role no frontend", () => {
  assert.match(
    fonte("supabase/migrations/20260826160000_recibos_logos_storage.sql"),
    /recibos-logos/
  );
  assert.match(
    fonte("supabase/migrations/20260826160000_recibos_logos_storage.sql"),
    /tem_acesso_empresa/
  );
  assert.doesNotMatch(
    fonte("lib/impressao/recibo-logo-servidor.ts"),
    /createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/
  );
  assert.doesNotMatch(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /createAdminClient|SERVICE_ROLE/
  );
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /Mostrar logo/
  );
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /Usar logo da empresa/
  );
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /Usar logo personalizada no recibo/
  );
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /Escolher imagem/
  );
  assert.match(
    fonte("components/impressao/recibo-layout-workspace.tsx"),
    /Remover logo personalizada/
  );
  assert.match(
    fonte("app/configuracoes/impressao/recibo-actions.ts"),
    /salvarLogoPersonalizadaReciboAction/
  );
});

test("Storage Buffer sem arrayBuffer ainda vira bytes da logo", async () => {
  const png = pngRgb(1, 1, Buffer.from([10, 20, 30]));
  const direto = await bytesDeArquivoStorage(png);
  assert.ok(direto?.equals(png));

  const viaBlob = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaA}/logo-buf.png`,
      bytes: png,
      downloadComo: "buffer",
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.ok(viaBlob.bytes?.equals(png));
});

test("PDF usa a mesma URL pública do preview quando o download autenticado falha", async () => {
  const png = pngRgb(2, 2, Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]));
  const path = `${empresaA}/logo-publica.png`;
  const url = urlLogoReciboEmpresa(empresaA, path);
  assert.ok(url);
  fetchFixtures.set(url, png);

  const resolvida = await resolverLogoReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: path,
      bytes: png,
      falharDownload: true,
    }) as never,
    empresaId: empresaA,
    incorporar: true,
  });
  assert.ok(resolvida.bytes?.equals(png));
  fetchFixtures.delete(url);

  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  layout.cabecalho.logoFonte = "empresa";
  const pdf = await gerarPdfReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: path,
      bytes: png,
    }) as never,
    empresaId: empresaA,
    linhas: ["TOTAL 10,00"],
    papel: "80mm",
    layout,
  });
  assert.ok(pdfContemLogoIncorporada(pdf));
  assert.match(Buffer.from(pdf).toString("latin1"), /TOTAL 10,00/);
  assert.doesNotMatch(Buffer.from(pdf).toString("latin1"), /storage\/v1\/object/);
});

test("impressão de teste, venda e reimpressão passam pelo mesmo PDF com logo incorporada", async () => {
  const png = pngRgb(2, 2, Buffer.from([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]));
  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  layout.cabecalho.logoFonte = "empresa";
  const pdf = await gerarPdfReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaA}/logo-unica.png`,
      bytes: png,
    }) as never,
    empresaId: empresaA,
    linhas: ["RECIBO VENDA"],
    papel: "80mm",
    layout,
  });
  assert.ok(pdfContemLogoIncorporada(pdf));
  assert.equal(formatoLogoNoPdf(pdf), "png-rgb-flate");
  assert.match(
    fonte("app/api/impressao/recibo/[id]/route.ts"),
    /gerarPdfReciboEmpresa/
  );
  assert.match(
    fonte("app/configuracoes/impressao/recibo-actions.ts"),
    /gerarPdfReciboEmpresa/
  );
  assert.match(fonte("lib/impressao/gerar-pdf-recibo.ts"), /logoResolvidaParaPdf/);
  assert.match(
    fonte("components/pdv/pdv-shell.tsx"),
    /\/api\/impressao\/recibo\//
  );
  assert.match(
    fonte("app/vendas/[id]/page.tsx"),
    /\/api\/impressao\/recibo\//
  );
});

test("logo personalizada, JPEG e empresa B ficam isoladas no PDF gerado", async () => {
  const jpeg = jpegSof(4, 3);
  const pathA = `${empresaA}/logo-recibo1.jpg`;
  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  layout.cabecalho.logoFonte = "personalizada";
  layout.cabecalho.logoPersonalizadaPath = pathA;

  const pdf = await gerarPdfReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: pathA,
      bytes: jpeg,
      bucket: "recibos-logos",
    }) as never,
    empresaId: empresaA,
    linhas: ["PERSONALIZADA"],
    papel: "58mm",
    layout,
  });
  assert.ok(pdfContemLogoIncorporada(pdf));
  assert.equal(formatoLogoNoPdf(pdf), "jpeg-dct");

  const cruzado = await resolverLogoRecibo({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: `${empresaB}/logo-recibo2.png`,
      bytes: jpeg,
      bucket: "recibos-logos",
    }) as never,
    empresaId: empresaA,
    layout: {
      ...layout,
      cabecalho: {
        ...layout.cabecalho,
        logoPersonalizadaPath: `${empresaB}/logo-recibo2.png`,
      },
    },
    incorporar: true,
  });
  assert.equal(cruzado.bytes, null);
  assert.equal(cruzado.path, null);
});

test("PNG 1-bit, WEBP e transparência viram XObject no PDF real", async () => {
  const sharp = (await import("sharp")).default;
  const umBit = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png({ palette: true, colours: 2, dither: 0 })
    .toBuffer();
  assert.equal(decodificarPngParaRgb(umBit), null);
  assert.equal(prepararImagemPdf(umBit, "image/png"), null);

  const normalizada = await normalizarLogoParaPdf(umBit);
  assert.ok(normalizada);
  const pdfBit = gerarPdfSimples({
    papel: "80mm",
    linhas: ["UMBIT"],
    logo: { ...normalizada, alinhamento: "centro", tamanho: "media" },
  });
  assert.ok(pdfContemLogoIncorporada(pdfBit));
  assert.equal(formatoLogoNoPdf(pdfBit), "png-rgb-flate");

  const comAlpha = await sharp({
    create: {
      width: 6,
      height: 6,
      channels: 4,
      background: { r: 0, g: 128, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const rgbAlpha = decodificarPngParaRgb(comAlpha);
  assert.equal(rgbAlpha?.width, 6);
  assert.deepEqual([...rgbAlpha!.rgb.subarray(0, 3)], [127, 191, 255]);
  const pdfAlpha = gerarPdfSimples({
    papel: "80mm",
    linhas: ["ALPHA"],
    logo: { bytes: comAlpha, mime: "image/png" },
  });
  assert.ok(pdfContemLogoIncorporada(pdfAlpha));

  const webp = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 20, g: 180, b: 40 },
    },
  })
    .webp()
    .toBuffer();
  assert.equal(prepararImagemPdf(webp), null);
  const webpNorm = await normalizarLogoParaPdf(webp);
  assert.ok(webpNorm);
  const webpPdf = gerarPdfSimples({
    papel: "80mm",
    linhas: ["WEBP"],
    logo: webpNorm,
  });
  assert.ok(pdfContemLogoIncorporada(webpPdf));

  const jpeg = jpegSof(5, 5);
  assert.ok(prepararImagemPdf(jpeg, "image/png"));

  const pngCrc = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const pdfReal = gerarPdfSimples({
    papel: "80mm",
    linhas: ["PNG"],
    logo: { bytes: pngCrc, mime: "image/png" },
  });
  assert.ok(pdfContemLogoIncorporada(pdfReal));
});

test("empresa sem logo e PDF já gerado não dependem de URL remota", async () => {
  const layout = layoutReciboPadrao();
  layout.cabecalho.logo = true;
  const pdf = await gerarPdfReciboEmpresa({
    supabase: clienteLogoFake({
      empresaId: empresaA,
      logoPath: null,
    }) as never,
    empresaId: empresaA,
    linhas: ["SEM LOGO"],
    papel: "80mm",
    layout,
  });
  const texto = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.match(texto, /SEM LOGO/);
  assert.equal(pdfContemLogoIncorporada(pdf), false);
  assert.doesNotMatch(texto, /storage\/v1\/object/);
  assert.doesNotMatch(texto, /\/Im1 Do/);
});

