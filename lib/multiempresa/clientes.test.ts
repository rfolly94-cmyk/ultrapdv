import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  assertRegistroDaEmpresaAtiva,
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";

import {
  clienteA,
  clienteB,
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
  vinculosPadrao,
} from "./cenario";
import { buscarPorIdComRls, escreverComRls } from "./rls-memoria";

const clientes = [
  { id: clienteA, empresa_id: empresaA, nome: "Cliente A" },
  { id: clienteB, empresa_id: empresaB, nome: "Cliente B" },
];

test("clientes: A lê A", () => {
  const encontrado = buscarPorIdComRls(clientes, usuarioA, vinculosPadrao, clienteA);
  assert.equal(encontrado?.nome, "Cliente A");
  assert.equal(registroPertenceAEmpresaAtiva(encontrado, empresaA), true);
});

test("clientes: A não lê B mesmo conhecendo o UUID", () => {
  assert.equal(
    buscarPorIdComRls(clientes, usuarioA, vinculosPadrao, clienteB),
    null
  );
});

test("clientes: B não lê A", () => {
  assert.equal(
    buscarPorIdComRls(clientes, usuarioB, vinculosPadrao, clienteA),
    null
  );
});

test("clientes: A não atualiza B", () => {
  const resultado = escreverComRls(
    clientes,
    usuarioA,
    vinculosPadrao,
    clienteB,
    (cliente) => ({ ...cliente, nome: "Invadido" })
  );
  assert.equal(resultado.ok, false);
});

test("clientes: A não exclui B", () => {
  const resultado = escreverComRls(
    clientes,
    usuarioA,
    vinculosPadrao,
    clienteB,
    () => {
      throw new Error("não deveria mutar");
    }
  );
  assert.equal(resultado.ok, false);
});

test("clientes: backend recusa registro de outra empresa", () => {
  assert.throws(
    () => assertRegistroDaEmpresaAtiva({ empresa_id: empresaB }, empresaA),
    /não pertence à empresa ativa/
  );
});

test("cadastro de cliente consulta CEP no ViaCEP sem criar campos novos", () => {
  const pagina = readFileSync(path.join(process.cwd(), "app/clientes/page.tsx"), "utf8");
  const actions = readFileSync(path.join(process.cwd(), "app/clientes/actions.ts"), "utf8");
  const campos = readFileSync(
    path.join(process.cwd(), "components/cadastro/endereco-via-cep-campos.tsx"),
    "utf8"
  );
  assert.match(pagina, /EnderecoViaCepCampos/);
  assert.match(pagina, /const mostrarLista = !clienteEdicao && !params\.novo/);
  assert.match(pagina, /ClienteNavegacao/);
  assert.match(campos, /name="cep"/);
  assert.match(campos, /name="logradouro"/);
  assert.match(campos, /name="codigo_municipio_ibge"/);
  assert.match(campos, /Consultando CEP/);
  assert.match(actions, /eq\("empresa_id"/);
  assert.match(actions, /codigo_municipio_ibge/);
  assert.doesNotMatch(campos, /name="filial/);
});
