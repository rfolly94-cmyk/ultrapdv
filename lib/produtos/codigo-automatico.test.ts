import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MENSAGEM_CODIGO_AUTOMATICO_FALHOU,
  MENSAGEM_CODIGO_OBRIGATORIO,
  ehCodigoNumericoSequencia,
  mensagemCodigoDuplicado,
  proximoCodigoNumerico,
} from "./codigo-automatico";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const form = fonte("app/produtos/produto-cadastro-form.tsx");
const actions = fonte("app/produtos/actions.ts");
const migracao = fonte(
  "supabase/migrations/20260816280000_codigo_automatico_produto.sql"
);

test("1. novo produto abre com Código automático marcado", () => {
  assert.match(form, /Código automático/);
  assert.match(form, /useState\(true\)/);
  assert.match(form, /name="codigo_automatico"/);
  assert.match(form, /checked=\{codigoAutomatico\}/);
});

test("2. com automático marcado, campo código fica bloqueado", () => {
  assert.match(form, /disabled=\{codigoAutomatico\}/);
  assert.match(form, /readOnly=\{codigoAutomatico\}/);
  assert.match(form, /Gerado automaticamente ao salvar/);
});

test("3. cadastro automático não exige código manual", () => {
  assert.match(actions, /formMarcouCodigoAutomatico/);
  assert.match(actions, /codigoAutomatico/);
  assert.match(form, /required=\{\!codigoAutomatico\}/);
  assert.match(actions, /permitirAutomatico: true/);
});

test("4. primeiro produto recebe código válido", () => {
  assert.equal(proximoCodigoNumerico([]), "1");
  assert.equal(proximoCodigoNumerico(["ABC10"]), "1");
});

test("5. próximo produto recebe próximo código", () => {
  assert.equal(
    proximoCodigoNumerico(["0005", "002", "01", "15", "5051", "5207"]),
    "5208"
  );
});

test("6. empresa A não usa sequência da Empresa B", () => {
  const empresaA = proximoCodigoNumerico(["5207"]);
  const empresaB = proximoCodigoNumerico(["1"]);
  assert.equal(empresaA, "5208");
  assert.equal(empresaB, "2");
  assert.match(migracao, /p\.empresa_id = p_empresa_id/);
  assert.match(migracao, /pg_advisory_xact_lock/);
});

test("7. dois cadastros simultâneos não recebem mesmo código", () => {
  assert.match(migracao, /pg_advisory_xact_lock/);
  assert.match(migracao, /hashtext\('produtos_codigo'\)/);
  assert.match(migracao, /unique_violation/);
  assert.match(
    fonte("app/produtos/actions.ts"),
    /rpc_cadastrar_produto/
  );
});

test("8. código manual continua funcionando", () => {
  assert.match(form, /setCodigoAutomatico/);
  assert.match(actions, /MENSAGEM_CODIGO_OBRIGATORIO/);
  assert.equal(MENSAGEM_CODIGO_OBRIGATORIO, "Informe o código do produto.");
});

test("9. código manual duplicado na mesma empresa é bloqueado", () => {
  assert.equal(
    mensagemCodigoDuplicado("5208"),
    "Já existe um produto com o código 5208 nesta empresa."
  );
  assert.match(actions, /mensagemCodigoDuplicado/);
});

test("10. editar produto não gera código novo", () => {
  const editar = actions.slice(actions.indexOf("export async function editarProduto"));
  assert.doesNotMatch(
    editar.slice(0, editar.indexOf("export async function listarLotesProduto")),
    /gerar_proximo_codigo_produto|codigoAutomatico/
  );
  assert.match(form, /produto\?\.id/);
});

test("11. código existente não é alterado na edição", () => {
  assert.match(form, /defaultValue=\{produto\.codigo\}/);
  assert.match(actions, /codigo: dados\.codigo/);
  assert.doesNotMatch(
    actions.slice(actions.indexOf("export async function editarProduto")),
    /gerar_proximo_codigo_produto/
  );
});

test("12. códigos alfanuméricos existentes não quebram geração automática", () => {
  assert.equal(ehCodigoNumericoSequencia("ABC10"), false);
  assert.equal(ehCodigoNumericoSequencia("CAPA01"), false);
  assert.equal(ehCodigoNumericoSequencia("5207"), true);
  assert.equal(ehCodigoNumericoSequencia("0005"), true);
  assert.equal(
    proximoCodigoNumerico(["ABC10", "CAPA01", "5207"]),
    "5208"
  );
  assert.match(migracao, /\^\[0-9\]\+/);
});

test("13. categoria opcional continua opcional", () => {
  assert.match(form, /placeholder=\{`Digite para buscar \$\{tipo\} \(opcional\)`\}/);
  assert.match(actions, /dados\.categoriaId\s*\?/);
});

test("14. marca opcional continua opcional", () => {
  assert.match(form, /tipo="marca"/);
  assert.match(actions, /dados\.marcaId\s*\?/);
});

test("15. grupo fiscal opcional continua opcional", () => {
  assert.match(form, /— Sem grupo fiscal —/);
  assert.match(form, /Define as regras tributárias usadas na emissão/);
  assert.match(actions, /dados\.grupoFiscalId\s*\?/);
});

test("falha da geração não cadastra produto sem código", () => {
  assert.equal(
    MENSAGEM_CODIGO_AUTOMATICO_FALHOU,
    "Não foi possível gerar o código automático do produto."
  );
  assert.match(migracao, /Não foi possível gerar o código automático do produto/);
});
