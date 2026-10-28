import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  PGWEB_SHA256,
  PGWEB_VERSAO,
  arquiteturaPe,
  verificarDllPgWeb,
} from "./tef-dll.mjs";
import { resolverRaizAgente } from "./raiz.mjs";

function pe(machine) {
  const buffer = Buffer.alloc(0x80);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.writeUInt16LE(machine, 0x44);
  return buffer;
}

test("a DLL ausente, x86, versão errada, hash divergente e assinatura inválida bloqueiam o uso", async () => {
  const ausente = await verificarDllPgWeb("C:\\agente", {
    ler: async () => {
      const erro = new Error("ausente");
      erro.code = "ENOENT";
      throw erro;
    },
  });
  assert.equal(ausente.ok, false);
  assert.equal(ausente.encontrada, false);

  const x86 = await verificarDllPgWeb("C:\\agente", {
    ler: async () => pe(0x14c),
  });
  assert.equal(x86.arquitetura, "x86");
  assert.equal(x86.ok, false);

  const versao = pe(0x8664);
  const errada = await verificarDllPgWeb("C:\\agente", { ler: async () => versao });
  assert.match(errada.mensagem, /4\.1\.50\.924/);

  const corpo = Buffer.concat([
    pe(0x8664),
    Buffer.from(PGWEB_VERSAO, "utf16le"),
  ]);
  const hash = await verificarDllPgWeb("C:\\agente", { ler: async () => corpo });
  assert.equal(hash.integridade, false);

  const oficial = await fs.readFile(path.join(resolverRaizAgente(), "bin/tef/PGWebLib.dll"));
  assert.equal(createHash("sha256").update(oficial).digest("hex"), PGWEB_SHA256);
  const assinaturaInvalida = await verificarDllPgWeb("C:\\agente", {
    ler: async () => oficial,
    assinar: async () => ({ ok: false, assinatura: "invalida" }),
  });
  assert.equal(assinaturaInvalida.integridade, true);
  assert.equal(assinaturaInvalida.assinatura, "invalida");
  assert.equal(assinaturaInvalida.ok, false);
  assert.equal(arquiteturaPe(pe(0x8664)), "x64");
});

