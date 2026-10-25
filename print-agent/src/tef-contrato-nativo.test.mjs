import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepararTipoGetDataInstalacao } from "./tef-instalacao-homologacao.mjs";
import { ABI_COMPROVADO, AMBIENTE_PGWEB, ASSINATURAS_NATIVAS, LAYOUT_HOMOLOGADO } from "./tef-pgweb.mjs";
import { matrizSetis } from "./tef-roteiro-setis.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kit = path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924");
const header = path.join(kit, "PGWebLib.h");

test("o contrato nativo usa um único mapa e existe no header 4.1.50.924", async () => {
  const texto = await readFile(header, "latin1");
  assert.match(texto, /#include "PWL_Type.h"/);
  await assert.rejects(access(path.join(kit, "PWL_Type.h")));
  await access(path.join(kit, "x64", "PGWebLib.dll"));
  await access(path.join(kit, "x86", "PGWebLib.dll"));
  for (const nome of Object.keys(ASSINATURAS_NATIVAS)) {
    assert.match(texto, new RegExp(`\\b${nome}\\b`));
  }
  assert.match(texto, /extern Int16 PW_EXPORT PW_iInit \(const char\* pszWorkingDir\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iNewTransac \(Byte bOper\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iAddParam \(Word wParam, const char \*pszValue\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iExecTransac \(PW_GetData vstParam\[\], Int16 \*piNumParam\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iGetResult \(Int16 iInfo, char \*pszData, Uint32 ulDataSize\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iConfirmation \(Uint32 ulResult,/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iIdleProc\(void\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iGetOperations\(Byte bOperType,/);
  assert.match(texto, /extern void PW_EXPORT PW_End \(void\);/);
  assert.match(texto, /extern Int16 PW_EXPORT PW_iSetEnvironment \(Int16 iEnv\);/);
  const producao = texto.indexOf("ENVRMNT_PROD");
  const testeAmbiente = texto.indexOf("ENVRMNT_TEST");
  assert.equal(producao > 0 && testeAmbiente > producao, true);
  assert.equal(AMBIENTE_PGWEB.producao, 0);
  assert.equal(AMBIENTE_PGWEB.homologacao, 1);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
});

test("a matriz SETIS tem 58 passos e nenhum está aprovado na DLL", async () => {
  const matriz = matrizSetis();
  assert.equal(matriz.length, 58);
  assert.deepEqual(matriz.map((passo) => passo.passo), Array.from({ length: 58 }, (_, indice) => indice + 1));
  assert.equal(matriz.some((passo) => passo.resultado === "aprovado_dll"), false);
  assert.equal(matriz.every((passo) => passo.procedimento && passo.resultadoEsperado && passo.evidenciaFisica), true);
  assert.equal(matriz[2].procedimento.includes("0x2F"), false);
  assert.equal(matriz[27].procedimento.includes("tag 0x2F"), true);
  assert.equal(matriz[27].procedimento.includes("PWOPER_SALEPRE"), false);
  assert.equal(matriz.filter((passo) => passo.aplicavelWindows === false).map((passo) => passo.passo).join(","), "49,50,51,52,53,58");
  const xlsx = (await import("xlsx")).default;
  const planilha = path.join(kit, "Roteiro de testes", "Planilha de testes v20260819.xlsx");
  const pasta = xlsx.readFile(planilha);
  const linhas = xlsx.utils.sheet_to_json(pasta.Sheets[pasta.SheetNames[0]], { header: 1, raw: false, defval: "" });
  const passos = linhas.filter((linha) => String(linha[0] ?? "").trim().startsWith("Passo "));
  assert.equal(passos.length, 58);
});

test("o layout Windows x64 compilado confere com o Koffi e o mesmo header em LP64 diverge", async () => {
  const zig = execFileSync("where.exe", ["zig"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  const kit = path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924");
  const headers = path.join(raiz, "tef-2", "headers-referencia");
  const dir = await mkdtemp(path.join(tmpdir(), "ultrapdv-abi-"));
  try {
    const exe = path.join(dir, "medir-abi-win.exe");
    execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-I", kit, "-I", headers, "-o", exe, path.join(headers, "medir-abi.c")], {
      stdio: "pipe",
    });
    const medido = JSON.parse(execFileSync(exe, { encoding: "utf8" }));
    const koffi = (await import("koffi")).default;
    const tipo = prepararTipoGetDataInstalacao(koffi);
    assert.equal(medido.alvo, "x86_64-windows");
    assert.equal(medido.sizeof, 12500);
    assert.equal(medido.alignof, 4);
    assert.equal(medido.tipos.Uint32, 4);
    assert.equal(medido.tipos.long, 4);
    assert.equal(koffi.sizeof(tipo), medido.sizeof);
    for (const [nome, campo] of Object.entries(medido.campos)) {
      if (nome === "fim") continue;
      assert.equal(koffi.offsetof(tipo, nome), campo.offset);
    }
    const objeto = path.join(dir, "medir-abi-linux.o");
    execFileSync(
      zig,
      ["cc", "-target", "x86_64-linux-gnu", "-ffreestanding", "-fno-builtin", "-nostdinc", "-I", kit, "-I", headers, "-c", "-o", objeto, path.join(headers, "medir-abi-lp64.c")],
      { stdio: "pipe" }
    );
    const simbolos = tamanhosElf(await readFile(objeto));
    assert.equal(simbolos.ultrapdv_sizeof_pw_getdata, 12520);
    assert.equal(simbolos.ultrapdv_sizeof_uint32, 8);
    assert.equal(simbolos.ultrapdv_sizeof_long, 8);
    assert.equal(simbolos.ultrapdv_offset_ul_valor_minimo, 12016);
    assert.notEqual(simbolos.ultrapdv_sizeof_pw_getdata, medido.sizeof);
    assert.equal(ABI_COMPROVADO, false);
    assert.equal(LAYOUT_HOMOLOGADO, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function tamanhosElf(buffer) {
  const u16 = (offset) => buffer.readUInt16LE(offset);
  const u32 = (offset) => buffer.readUInt32LE(offset);
  const u64 = (offset) => Number(buffer.readBigUInt64LE(offset));
  const shoff = u64(40);
  const shentsize = u16(58);
  const shnum = u16(60);
  const shstrndx = u16(62);
  const nomes = u64(shoff + shstrndx * shentsize + 24);
  const secoes = [];
  for (let indice = 0; indice < shnum; indice += 1) {
    const offset = shoff + indice * shentsize;
    secoes.push({ tipo: u32(offset + 4), off: u64(offset + 24), size: u64(offset + 32), link: u32(offset + 40), nomeOff: nomes });
  }
  const sym = secoes.find((secao) => secao.tipo === 2);
  const str = secoes[sym.link];
  const tamanhos = {};
  for (let indice = 0; indice < sym.size / 24; indice += 1) {
    const offset = sym.off + indice * 24;
    let nome = "";
    for (let cursor = str.off + u32(offset); buffer[cursor]; cursor += 1) nome += String.fromCharCode(buffer[cursor]);
    if (nome.startsWith("ultrapdv_")) tamanhos[nome] = u64(offset + 16);
  }
  return tamanhos;
}
