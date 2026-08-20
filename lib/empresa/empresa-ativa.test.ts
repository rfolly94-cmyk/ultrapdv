import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buscarVinculoEmpresaAtiva,
  selecionarVinculoEmpresaAtiva,
  type VinculoEmpresaAtiva,
} from "./empresa-ativa";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const usuarioA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const usuarioB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const empresaA = "11111111-1111-4111-8111-111111111111";
const empresaB = "22222222-2222-4222-8222-222222222222";

function vinculo(parcial: Partial<VinculoEmpresaAtiva>): VinculoEmpresaAtiva {
  return {
    usuario_id: usuarioA,
    empresa_id: empresaA,
    principal: true,
    ativo: true,
    ...parcial,
  };
}

const cenario = [
  vinculo({ usuario_id: usuarioA, empresa_id: empresaA, principal: true, ativo: true }),
  vinculo({ usuario_id: usuarioA, empresa_id: empresaB, principal: false, ativo: true }),
  vinculo({ usuario_id: usuarioB, empresa_id: empresaB, principal: true, ativo: true }),
  vinculo({ usuario_id: usuarioB, empresa_id: empresaA, principal: false, ativo: true }),
];

test("usuário A resolve somente a empresa principal ativa A", () => {
  const encontrado = selecionarVinculoEmpresaAtiva(cenario, usuarioA);
  assert.equal(encontrado?.empresa_id, empresaA);
  assert.equal(encontrado?.usuario_id, usuarioA);
});

test("usuário B resolve somente a empresa principal ativa B", () => {
  const encontrado = selecionarVinculoEmpresaAtiva(cenario, usuarioB);
  assert.equal(encontrado?.empresa_id, empresaB);
  assert.equal(encontrado?.usuario_id, usuarioB);
});

test("nunca devolve a empresa principal de outro usuário", () => {
  assert.notEqual(
    selecionarVinculoEmpresaAtiva(cenario, usuarioA)?.empresa_id,
    empresaB
  );
  assert.notEqual(
    selecionarVinculoEmpresaAtiva(cenario, usuarioB)?.empresa_id,
    empresaA
  );
});

test("sem vínculo retorna null", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(cenario, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    null
  );
});

test("vínculo inativo não resolve empresa ativa", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [vinculo({ ativo: false }), vinculo({ usuario_id: usuarioB, empresa_id: empresaB })],
      usuarioA
    ),
    null
  );
});

test("vínculo sem principal não resolve empresa ativa", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [vinculo({ principal: false }), vinculo({ usuario_id: usuarioB, empresa_id: empresaB })],
      usuarioA
    ),
    null
  );
});

test("dois principais ativos do mesmo usuário não resolvem (ambíguo)", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [
        vinculo({ empresa_id: empresaA }),
        vinculo({ empresa_id: empresaB, principal: true, ativo: true }),
      ],
      usuarioA
    ),
    null
  );
});

test("buscarVinculoEmpresaAtiva aplica usuario_id + principal + ativo", async () => {
  const visto: Array<Array<[string, unknown]>> = [];

  function db() {
    const filtros: Array<[string, unknown]> = [];
    return {
      from(tabela: string) {
        assert.equal(tabela, "usuarios_empresas");
        return {
          select(colunas: string) {
            assert.equal(colunas, "empresa_id");
            const cadeia = {
              eq(coluna: string, valor: string | boolean) {
                filtros.push([coluna, valor]);
                return cadeia;
              },
              async maybeSingle() {
                visto.push([...filtros]);
                const usuarioFiltro = [...filtros]
                  .reverse()
                  .find(([coluna]) => coluna === "usuario_id")?.[1];
                const data = selecionarVinculoEmpresaAtiva(cenario, usuarioFiltro);
                return {
                  data: data ? { empresa_id: data.empresa_id } : null,
                  error: null,
                };
              },
            };
            return cadeia;
          },
        };
      },
    };
  }

  const a = await buscarVinculoEmpresaAtiva(db(), usuarioA);
  const b = await buscarVinculoEmpresaAtiva(db(), usuarioB);
  const vazio = await buscarVinculoEmpresaAtiva(db(), "");

  assert.deepEqual(visto[0], [
    ["usuario_id", usuarioA],
    ["principal", true],
    ["ativo", true],
  ]);
  assert.equal(a.data?.empresa_id, empresaA);
  assert.equal(b.data?.empresa_id, empresaB);
  assert.equal(vazio.data, null);
});

test("createAdminClient não entra em componente client", () => {
  const proibidos: string[] = [];

  function caminhar(diretorio: string) {
    for (const nome of readdirSync(diretorio)) {
      if (
        nome === "node_modules" ||
        nome === ".next" ||
        nome === "backup-fiscal"
      ) {
        continue;
      }

      const caminho = join(diretorio, nome);
      const info = statSync(caminho);

      if (info.isDirectory()) {
        caminhar(caminho);
        continue;
      }

      if (!/\.(tsx|ts|jsx|js)$/.test(nome)) {
        continue;
      }

      const fonte = readFileSync(caminho, "utf8");
      if (
        /^\s*["']use client["']/.test(fonte) &&
        fonte.includes("createAdminClient")
      ) {
        proibidos.push(caminho.slice(raiz.length + 1));
      }
    }
  }

  caminhar(join(raiz, "app"));
  caminhar(join(raiz, "components"));
  caminhar(join(raiz, "lib"));

  assert.deepEqual(proibidos, []);
});

test("secret do admin fica só no servidor e sem NEXT_PUBLIC", () => {
  const admin = readFileSync(join(raiz, "lib/supabase/admin.ts"), "utf8");
  const browser = readFileSync(join(raiz, "lib/supabase/client.ts"), "utf8");

  assert.match(admin, /import "server-only"/);
  assert.match(admin, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SECRET/);
  assert.doesNotMatch(browser, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(browser, /service_role/);
});

test("helpers de sessão reutilizam buscarVinculoEmpresaAtiva", () => {
  const identidade = readFileSync(join(raiz, "lib/empresa/identidade-sessao.ts"), "utf8");
  const pix = readFileSync(join(raiz, "lib/pagamentos/pix/contexto.ts"), "utf8");
  assert.match(identidade, /buscarVinculoEmpresaAtiva/);
  assert.match(pix, /buscarVinculoEmpresaAtiva/);
});
