import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  anexarLogomarcaFiscal,
  bufferParaHexLogomarca,
  caminhoLogoEmpresa,
  detectarTipoLogo,
  logoPertenceAEmpresa,
  logoUrlUtilizavel,
  montarPayloadGerarPdf,
  urlPublicaLogoEmpresa,
  validarUploadLogoEmpresa,
} from "./logo";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const empresaA = "11111111-1111-4111-8111-111111111111";
const empresaB = "22222222-2222-4222-8222-222222222222";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);
const jpegMinimo = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);

test("1. empresa A lê sua própria logo", () => {
  const path = caminhoLogoEmpresa(empresaA, "image/png");
  assert.equal(logoPertenceAEmpresa(empresaA, path), true);
  assert.equal(path.startsWith(`${empresaA}/`), true);
});

test("2. empresa A não lê logo da empresa B", () => {
  const pathB = caminhoLogoEmpresa(empresaB, "image/png");
  assert.equal(logoPertenceAEmpresa(empresaA, pathB), false);
  assert.match(fonte("lib/empresa/obter-logomarca-fiscal-hex.ts"), /logoPertenceAEmpresa/);
  assert.match(fonte("app/configuracoes/empresa/actions.ts"), /empresaId: String\(vinculo.empresa_id\)/);
});

test("3. PNG aceito", () => {
  assert.equal(detectarTipoLogo(png1x1), "image/png");
  const validado = validarUploadLogoEmpresa({
    empresaId: empresaA,
    mimeInformado: "image/png",
    tamanho: png1x1.length,
    bytes: png1x1,
  });
  assert.equal(validado.tipo, "image/png");
});

test("4. JPEG aceito", () => {
  assert.equal(detectarTipoLogo(jpegMinimo), "image/jpeg");
  const validado = validarUploadLogoEmpresa({
    empresaId: empresaA,
    mimeInformado: "image/jpeg",
    tamanho: jpegMinimo.length,
    bytes: jpegMinimo,
  });
  assert.equal(validado.tipo, "image/jpeg");
});

test("5. arquivo inválido recusado no upload", () => {
  assert.throws(
    () =>
      validarUploadLogoEmpresa({
        empresaId: empresaA,
        mimeInformado: "image/png",
        tamanho: 8,
        bytes: Buffer.from("notimage"),
      }),
    /PNG ou JPEG/
  );
});

test("6. logo é convertida para hexadecimal corretamente", () => {
  const hex = bufferParaHexLogomarca(png1x1);
  assert.equal(hex, png1x1.toString("hex"));
  assert.equal(hex.includes(" "), false);
  assert.equal(hex.startsWith("89504e47"), true);
  assert.equal(hex.includes("data:image"), false);
});

test("7. NF-e 55 recebe nfe.empresa.logomarca", () => {
  const nfe = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(nfe, /logomarca\?: string \| null/);
  assert.match(nfe, /logomarca: texto\(emitente.logomarca\)/);
  assert.match(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /obterLogomarcaFiscalHex/
  );
});

test("8. NFC-e 65 recebe nfe.empresa.logomarca", () => {
  const nfce = fonte("lib/fiscal/geranet/montar-payload-nfce.ts");
  assert.match(nfce, /logomarca\?: string \| null/);
  assert.match(nfce, /logomarca: texto\(emitente.logomarca\)/);
  assert.match(
    fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    /obterLogomarcaFiscalHex/
  );
});

test("9. sem logo o campo é omitido", () => {
  const payload = anexarLogomarcaFiscal(
    { nfe: { empresa: { cnpj: "123" } } },
    undefined
  );
  assert.equal("logomarca" in (payload.nfe?.empresa ?? {}), false);

  const pdf = montarPayloadGerarPdf({ xml: "<xml/>", modelo: "55" });
  assert.equal("nfe" in pdf, false);
});

test("10. falha ao carregar logo não bloqueia emissão fiscal", () => {
  const fonteHex = fonte("lib/empresa/obter-logomarca-fiscal-hex.ts");
  assert.match(fonteHex, /return undefined/);
  assert.match(fonteHex, /catch/);
  assert.equal(fonteHex.includes("throw "), false);
});

test("11. HEX não é enviado ao Client Component", () => {
  const ui = [
    fonte("components/empresa/logo-empresa.tsx"),
    fonte("app/configuracoes/empresa/identidade-visual-form.tsx"),
    fonte("components/layout/app-sidebar.tsx"),
  ].join("\n");
  assert.equal(ui.includes("toString(\"hex\")"), false);
  assert.equal(ui.includes("bufferParaHexLogomarca"), false);
  assert.equal(ui.includes("obterLogomarcaFiscalHex"), false);
  assert.match(ui, /logoUrl|src/);
});

test("12. logo aparece na interface", () => {
  assert.match(fonte("components/layout/app-sidebar.tsx"), /LogoEmpresa/);
  assert.match(fonte("components/app-shell.tsx"), /LogoEmpresa/);
  assert.match(
    fonte("app/configuracoes/fiscal/empresa/page.tsx"),
    /IdentidadeVisualForm/
  );
});

test("13. empresa sem logo usa fallback", () => {
  const componente = fonte("components/empresa/logo-empresa.tsx");
  assert.match(componente, /UltraPDV/);
  assert.match(componente, /onError/);
  assert.match(componente, /object-contain/);
  assert.match(componente, /logoUrlUtilizavel/);
  assert.equal(componente.includes("{!compacto &&"), false);
  assert.equal(urlPublicaLogoEmpresa(null), null);
  assert.equal(urlPublicaLogoEmpresa("   "), null);
  assert.equal(urlPublicaLogoEmpresa("https://cdn.exemplo/logo.png"), null);
  assert.equal(logoUrlUtilizavel(null), null);
  assert.equal(logoUrlUtilizavel("   "), null);
  assert.equal(logoUrlUtilizavel("logos-empresas/a/logo.png"), null);
  assert.equal(
    logoUrlUtilizavel("https://example.supabase.co/storage/v1/object/public/logos-empresas/a/logo.png"),
    "https://example.supabase.co/storage/v1/object/public/logos-empresas/a/logo.png"
  );
  assert.match(fonte("lib/empresa/identidade-sessao.ts"), /pathLogoDaEmpresa/);
  assert.match(fonte("lib/empresa/identidade-sessao.ts"), /buscarVinculoEmpresaAtiva/);
});

test("14. reimpressão/gerar-pdf envia logo quando aplicável", () => {
  const pdf = montarPayloadGerarPdf({
    xml: "<nfe/>",
    modelo: "65",
    logomarca: "89504e47",
  });
  assert.equal(pdf.nfe?.empresa.logomarca, "89504e47");
  assert.match(fonte("lib/fiscal/obter-documento-fiscal.ts"), /montarPayloadGerarPdf/);
  assert.match(fonte("lib/fiscal/obter-documento-fiscal.ts"), /obterLogomarcaFiscalHex/);
});

test("15. nenhuma regra tributária é alterada", () => {
  const nfe = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  const nfce = fonte("lib/fiscal/geranet/montar-payload-nfce.ts");
  assert.match(nfe, /codigoRegimeTributario/);
  assert.match(nfce, /codigoSegurancaContribuinte/);
  assert.equal(nfe.includes("ICMS"), nfe.includes("ICMS"));
  assert.match(
    fonte("supabase/migrations/20260816260000_empresa_identidade_visual.sql"),
    /logo_path/
  );
  assert.equal(
    fonte("supabase/migrations/20260816260000_empresa_identidade_visual.sql").includes("ICMS"),
    false
  );
});

test("anexar logomarca não envia string vazia", () => {
  const payload = anexarLogomarcaFiscal(
    { nfe: { empresa: { cnpj: "1" } } },
    "   "
  );
  assert.equal("logomarca" in (payload.nfe?.empresa ?? {}), false);
});
