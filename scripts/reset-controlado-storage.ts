import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

function carregarEnvLocal() {
  const caminho = join(process.cwd(), ".env.local");
  const texto = readFileSync(caminho, "utf8");

  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) {
      continue;
    }
    const igual = limpa.indexOf("=");
    if (igual <= 0) {
      continue;
    }
    const chave = limpa.slice(0, igual).trim();
    let valor = limpa.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}

carregarEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  throw new Error("Credenciais administrativas do Supabase ausentes.");
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKETS = ["catalogo", "logos-empresas"] as const;

type Item = {
  name: string;
  id: string | null;
  metadata: Record<string, unknown> | null;
};

async function listarRecursivo(
  bucket: string,
  prefix: string
): Promise<string[]> {
  const caminhos: string[] = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, {
    limit: 1000,
    offset: 0,
  });

  if (error) {
    throw new Error(`${bucket}/${prefix}: ${error.message}`);
  }

  for (const item of (data ?? []) as Item[]) {
    const caminho = prefix ? `${prefix}/${item.name}` : item.name;
    const pasta = !item.id || item.metadata == null;
    if (pasta) {
      caminhos.push(...(await listarRecursivo(bucket, caminho)));
    } else {
      caminhos.push(caminho);
    }
  }

  return caminhos;
}

async function main() {
  const { data: empresas, error } = await admin
    .from("empresas")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  const ids = new Set((empresas ?? []).map((linha) => String(linha.id)));
  const removidos: Array<{ bucket: string; path: string }> = [];
  const preservados: Array<{ bucket: string; path: string }> = [];

  for (const bucket of BUCKETS) {
    const todos = await listarRecursivo(bucket, "");
    const apagar: string[] = [];

    for (const path of todos) {
      const raiz = path.split("/")[0] ?? "";
      if (ids.has(raiz)) {
        apagar.push(path);
      } else {
        preservados.push({ bucket, path });
      }
    }

    if (apagar.length > 0) {
      const { error: erroRemove } = await admin.storage
        .from(bucket)
        .remove(apagar);
      if (erroRemove) {
        throw new Error(`${bucket}: ${erroRemove.message}`);
      }
      for (const path of apagar) {
        removidos.push({ bucket, path });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        empresas: [...ids],
        removidos: removidos.length,
        caminhosRemovidos: removidos,
        preservados,
      },
      null,
      2
    )
  );
}

void main();
