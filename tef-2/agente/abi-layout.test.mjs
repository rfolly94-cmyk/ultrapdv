import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../..");
const kit = resolve(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924");
const header = readFileSync(resolve(kit, "PGWebLib.h"), "utf8");
const pascal = readFileSync(resolve(aqui, "PgWebLib.pas"), "utf8");
const fonteC = readFileSync(resolve(aqui, "layout/pgweb-layout.c"), "utf8");
const fpc = "C:\\lazarus\\fpc\\3.2.2\\bin\\x86_64-win64\\fpc.exe";

function blocoStruct(nome) {
  const inicio = header.indexOf(`} ${nome};`);
  assert.ok(inicio > 0, nome);
  const corte = header.lastIndexOf("typedef struct", inicio);
  return header.slice(corte, inicio);
}

function camposC(nome) {
  const corpo = blocoStruct(nome);
  const campos = [];
  for (const linha of corpo.split(/\r?\n/)) {
    const casado = linha.match(/^\s*(Word|Byte|char|Uint32|Uint16|Int16|Bool)\s+(\w+)((?:\[[^\]]+\])*)/);
    if (!casado) continue;
    const dimensoes = [...casado[3].matchAll(/\[([^\]]+)\]/g)].map((item) => item[1]);
    campos.push({ tipo: casado[1], nome: casado[2], dimensoes });
  }
  return campos;
}

function camposPascal() {
  const inicio = pascal.indexOf("TPWGetData = record");
  const fim = pascal.indexOf("end;", inicio);
  const campos = [];
  for (const linha of pascal.slice(inicio, fim).split(/\r?\n/)) {
    const matriz = linha.match(/^\s*(\w+):\s*array\[(\d+)\.\.(\d+),\s*(\d+)\.\.(\d+)\]/);
    if (matriz) {
      campos.push({
        nome: matriz[1],
        dimensoes: [String(Number(matriz[3]) - Number(matriz[2]) + 1), String(Number(matriz[5]) - Number(matriz[4]) + 1)],
      });
      continue;
    }
    const vetor = linha.match(/^\s*(\w+):\s*array\[(\d+)\.\.(\d+)\]/);
    if (vetor) {
      campos.push({ nome: vetor[1], dimensoes: [String(Number(vetor[3]) - Number(vetor[2]) + 1)] });
      continue;
    }
    const escalar = linha.match(/^\s*(\w+):\s*(?:Word|Byte|Cardinal|AnsiChar)\s*;/);
    if (escalar && escalar[1] !== "TPWGetData") campos.push({ nome: escalar[1], dimensoes: [] });
  }
  return campos;
}

function ler(saida, prefixo) {
  const linha = saida.split(/\r?\n/).find((item) => item.startsWith(`${prefixo} `));
  assert.ok(linha, prefixo);
  return linha.slice(prefixo.length + 1);
}

test("o header oficial não traz os tipos e o ABI permanece sem comprovação", () => {
  const arquivos = readdirSync(kit);
  assert.equal(arquivos.includes("PWL_Type.h"), false);
  assert.match(header, /#include "PWL_Type.h"/);
  assert.equal(header.includes("#pragma pack"), false);
  assert.match(header, /#define PW_EXPORT\s*$/m);
  assert.match(header, /#define PWMENU_MAXINTENS\s+40/);
  assert.match(pascal, /LAYOUT_HOMOLOGADO = False/);
  assert.match(pascal, /ABI_COMPROVADO = False/);
  assert.equal(pascal.includes("LAYOUT_HOMOLOGADO = True"), false);
  assert.equal(fonteC.includes("LoadLibrary"), false);
  assert.equal(/pragma\s+comment\s*\(\s*lib/i.test(fonteC), false);
  assert.equal(/typedef\s+(unsigned\s+)?(char|short|int|long|Byte|Word)/.test(fonteC), false);
  assert.equal(fonteC.includes("#define Byte"), false);
  assert.equal(fonteC.includes("#define Word"), false);
  assert.equal(fonteC.includes("#define Int16"), false);
  assert.equal(fonteC.includes("#define Uint32"), false);
  assert.equal(fonteC.includes("#define Bool"), false);
});

test("nomes, ordem e quantidades de elementos batem com o header", () => {
  const oficiais = camposC("PW_GetData").map((campo) => ({
    nome: campo.nome,
    dimensoes: campo.dimensoes.map((item) => (item === "PWMENU_MAXINTENS" ? "40" : item)),
  }));
  const locais = camposPascal();
  assert.deepEqual(
    locais.map((campo) => campo.nome),
    oficiais.map((campo) => campo.nome)
  );
  for (const oficial of oficiais) {
    const local = locais.find((campo) => campo.nome === oficial.nome);
    assert.deepEqual(local.dimensoes, oficial.dimensoes, oficial.nome);
  }
  assert.deepEqual(camposC("PW_Operations").map((campo) => campo.nome), ["bOperType", "szText", "szValue"]);
  assert.deepEqual(camposC("PW_OperationsEx").map((campo) => campo.nome), [
    "bOperType",
    "szOperName",
    "szAuthSyst",
    "szValue",
    "fAuthPreferential",
    "bPaymentMode",
  ]);
  assert.equal(pascal.includes("PW_Operations"), false);
});

test("as assinaturas usam os nomes do header e não uma largura inventada", () => {
  const esperadas = {
    PW_iExecTransac: ["PW_GetData vstParam[]", "Int16 *piNumParam"],
    PW_iGetResult: ["Int16 iInfo", "char *pszData", "Uint32 ulDataSize"],
    PW_iPPEventLoop: ["char *pszDisplay", "Uint32 ulDisplaySize"],
    PW_iConfirmation: ["Uint32 ulResult", "const char* pszReqNum", "const char* pszLocRef", "const char* pszExtRef", "const char* pszVirtMerch", "const char* pszAuthSyst"],
  };
  for (const [nome, partes] of Object.entries(esperadas)) {
    const encontrado = header.match(new RegExp(`extern Int16 PW_EXPORT ${nome}[\\s\\S]*?;`));
    assert.ok(encontrado, nome);
    const texto = encontrado[0].replace(/\s+/g, " ");
    for (const parte of partes) {
      assert.match(texto, new RegExp(parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
  assert.match(pascal, /TPwExecTransac = function\(vstParam: Pointer; piNumParam: PSmallInt\)/);
  assert.match(pascal, /TPwGetResult = function\(iInfo: SmallInt; pszData: PAnsiChar; ulDataSize: Cardinal\)/);
  assert.match(pascal, /TPwPPEventLoop = function\(pszDisplay: PAnsiChar; ulDisplaySize: Cardinal\)/);
  assert.match(pascal, /TPwConfirmation = function\(ulResult: Cardinal; pszReqNum, pszLocRef, pszExtRef, pszVirtMerch, pszAuthSyst: PAnsiChar\)/);
  assert.match(header, /100 bytes/);
  assert.match(pascal, /array\[0\.\.127\]/);
  assert.match(pascal, /array\[0\.\.4095\]/);
  assert.equal(pascal.includes("Copy(TextoC(Buffer), 1, DISPLAY_MINIMO)"), false);
  const programa = readFileSync(resolve(aqui, "UltraPDVPgWeb.lpr"), "utf8");
  assert.match(programa, /Porta := \$FF/);
  assert.equal(programa.includes("PortaInt"), false);
});

test("o medidor Pascal roda sem a DLL e o C x64 não fecha o layout", () => {
  const compilado = spawnSync(fpc, ["-Mdelphi", "-O2", "-FEbin", "-FUlib", "PgWebLayout.lpr"], {
    cwd: aqui,
    encoding: "utf8",
  });
  assert.equal(compilado.status, 0, compilado.stdout + compilado.stderr);
  const medido = spawnSync(resolve(aqui, "bin/PgWebLayout.exe"), [], { encoding: "utf8" });
  assert.equal(medido.status, 0, medido.stderr);
  const mapa = {
    fonte: ler(medido.stdout, "fonte"),
    abi: ler(medido.stdout, "abiComprovado"),
    layout: ler(medido.stdout, "layoutHomologado"),
    char: ler(medido.stdout, "sizeof AnsiChar"),
    prompt: ler(medido.stdout, "elementos szPrompt"),
    texto: ler(medido.stdout, "elementos vszTextoMenu"),
    valor: ler(medido.stdout, "elementos vszValorMenu"),
    mascara: ler(medido.stdout, "elementos szMascaraDeCaptura"),
    previa: ler(medido.stdout, "elementos szMsgPrevia"),
    tamanho: ler(medido.stdout, "sizeof PW_GetData"),
  };
  assert.equal(mapa.fonte, "pascal");
  assert.equal(mapa.abi, "0");
  assert.equal(mapa.layout, "0");
  assert.equal(mapa.char, "1");
  assert.equal(mapa.prompt, "84");
  assert.equal(mapa.texto, "40 41");
  assert.equal(mapa.valor, "40 256");
  assert.equal(mapa.mascara, "41");
  assert.equal(mapa.previa, "84");
  assert.equal(Number(mapa.tamanho) > 11000, true);

  const gccVelho = "C:\\lazarus\\fpc\\3.2.2\\bin\\x86_64-win64\\gcc.exe";
  const maquina = spawnSync(gccVelho, ["-dumpmachine"], { encoding: "utf8" });
  assert.match(maquina.stdout, /i386/);
  const inclusao = spawnSync(gccVelho, ["-c", "-I", kit, resolve(aqui, "layout/pgweb-layout.c"), "-o", resolve(aqui, "lib/pgweb-layout-i386.o")], {
    encoding: "utf8",
  });
  assert.notEqual(inclusao.status, 0);
  assert.match(`${inclusao.stdout}\n${inclusao.stderr}`, /cannot exec `cpp'|PWL_Type\.h/);

  function compiladorX64() {
    const direto = [
      "clang",
      "cl",
      "x86_64-w64-mingw32-gcc",
      "zig",
    ];
    for (const nome of direto) {
      const visto = spawnSync("where.exe", [nome], { encoding: "utf8" });
      if (visto.status === 0 && visto.stdout.trim()) return { comando: visto.stdout.trim().split(/\r?\n/)[0], prefixo: nome === "zig" ? ["cc", "-target", "x86_64-windows-gnu", "-std=c11"] : nome === "cl" ? ["/nologo", "/std:c11"] : ["-std=c11"] };
    }
    const pacote = resolve(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages");
    if (pacote) {
      const encontrados = [];
      const visitar = (diretorio, profundidade) => {
        if (profundidade > 3) return;
        let entradas = [];
        try { entradas = readdirSync(diretorio, { withFileTypes: true }); } catch { return; }
        for (const entrada of entradas) {
          const caminho = resolve(diretorio, entrada.name);
          if (entrada.isDirectory()) visitar(caminho, profundidade + 1);
          else if (entrada.name.toLowerCase() === "zig.exe") encontrados.push(caminho);
        }
      };
      visitar(pacote, 0);
      if (encontrados[0]) return { comando: encontrados[0], prefixo: ["cc", "-target", "x86_64-windows-gnu", "-std=c11"] };
    }
    return null;
  }

  const compilador = compiladorX64();
  assert.ok(compilador, "nenhum compilador C x64 foi encontrado");
  const resultado = spawnSync(compilador.comando, [...compilador.prefixo, "-c", "-I", kit, resolve(aqui, "layout/pgweb-layout.c"), "-o", resolve(aqui, "lib/pgweb-layout.obj")], {
    encoding: "utf8",
  });
  assert.notEqual(resultado.status, 0);
  assert.match(`${resultado.stdout}\n${resultado.stderr}`, /PWL_Type\.h/);
  assert.equal(pascal.includes("ABI_COMPROVADO = True"), false);
});
