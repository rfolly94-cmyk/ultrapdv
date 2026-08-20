import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buscarVinculoEmpresaAtiva,
  selecionarVinculoEmpresaAtiva,
} from "@/lib/empresa/empresa-ativa";

import {
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
  usuarioSemVinculo,
  usuarioX,
  vinculosPadrao,
} from "./cenario";

test("A. usuário A resolve somente Empresa A", () => {
  const vinculo = selecionarVinculoEmpresaAtiva(vinculosPadrao, usuarioA);
  assert.equal(vinculo?.empresa_id, empresaA);
});

test("A. usuário B resolve somente Empresa B", () => {
  const vinculo = selecionarVinculoEmpresaAtiva(vinculosPadrao, usuarioB);
  assert.equal(vinculo?.empresa_id, empresaB);
});

test("A. usuário X com A principal não devolve B como ativa", () => {
  const vinculo = selecionarVinculoEmpresaAtiva(vinculosPadrao, usuarioX);
  assert.equal(vinculo?.empresa_id, empresaA);
  assert.notEqual(vinculo?.empresa_id, empresaB);
});

test("A. sem vínculo não resolve empresa", () => {
  assert.equal(selecionarVinculoEmpresaAtiva(vinculosPadrao, usuarioSemVinculo), null);
});

test("A. vínculo inativo não resolve", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [
        {
          usuario_id: usuarioA,
          empresa_id: empresaA,
          principal: true,
          ativo: false,
        },
      ],
      usuarioA
    ),
    null
  );
});

test("A. sem principal não escolhe empresa arbitrariamente", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [
        {
          usuario_id: usuarioA,
          empresa_id: empresaA,
          principal: false,
          ativo: true,
        },
        {
          usuario_id: usuarioA,
          empresa_id: empresaB,
          principal: false,
          ativo: true,
        },
      ],
      usuarioA
    ),
    null
  );
});

test("A. dois principais ativos são ambíguos", () => {
  assert.equal(
    selecionarVinculoEmpresaAtiva(
      [
        {
          usuario_id: usuarioA,
          empresa_id: empresaA,
          principal: true,
          ativo: true,
        },
        {
          usuario_id: usuarioA,
          empresa_id: empresaB,
          principal: true,
          ativo: true,
        },
      ],
      usuarioA
    ),
    null
  );
});

test("A. helper de consulta nunca devolve a empresa do outro usuário", async () => {
  const db = {
    from() {
      const filtros: Record<string, unknown> = {};
      const cadeia = {
        select() {
          return cadeia;
        },
        eq(coluna: string, valor: string | boolean) {
          filtros[coluna] = valor;
          return cadeia;
        },
        async maybeSingle() {
          const data = selecionarVinculoEmpresaAtiva(vinculosPadrao, filtros.usuario_id);
          return { data, error: null };
        },
      };
      return cadeia;
    },
  };

  const a = await buscarVinculoEmpresaAtiva(db, usuarioA);
  const b = await buscarVinculoEmpresaAtiva(db, usuarioB);
  assert.equal(a.data?.empresa_id, empresaA);
  assert.equal(b.data?.empresa_id, empresaB);
});
