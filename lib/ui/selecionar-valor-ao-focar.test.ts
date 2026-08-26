import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  consumirSelecaoValorPendente,
  marcarSelecaoValorSeCliqueInicial,
  selecionarValorAoFocar,
} from "./selecionar-valor-ao-focar";

test("selecionarValorAoFocar seleciona o conteúdo quando o campo está focado", () => {
  const chamadas: string[] = [];
  const campo = {
    disabled: false,
    select() {
      chamadas.push("select");
    },
  };
  const original = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: campo },
  });

  selecionarValorAoFocar({
    currentTarget: campo,
  } as never);

  assert.equal(chamadas.includes("select"), true);

  if (original === undefined) {
    // @ts-expect-error ambiente de teste
    delete globalThis.document;
  } else {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: original,
    });
  }
});

test("primeiro clique impede o mouseup de desfazer a seleção", () => {
  const chamadas: string[] = [];
  const campo = {
    select() {
      chamadas.push("select");
    },
  };
  const original = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: null },
  });

  marcarSelecaoValorSeCliqueInicial({
    currentTarget: campo,
  } as never);

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: campo },
  });

  let preventido = false;
  consumirSelecaoValorPendente({
    currentTarget: campo,
    preventDefault() {
      preventido = true;
    },
  } as never);

  assert.equal(preventido, true);
  assert.equal(chamadas.includes("select"), true);

  preventido = false;
  consumirSelecaoValorPendente({
    currentTarget: campo,
    preventDefault() {
      preventido = true;
    },
  } as never);
  assert.equal(preventido, false);

  if (original === undefined) {
    // @ts-expect-error ambiente de teste
    delete globalThis.document;
  } else {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: original,
    });
  }
});

test("campos de valor reutilizam o helper central e não alteram busca ou CPF", () => {
  const helper = fonte("lib/ui/selecionar-valor-ao-focar.ts");
  const campo = fonte("components/ui/campo-valor.tsx");
  assert.match(helper, /campo\.select\(\)/);
  assert.match(campo, /selecionarValorAoFocar/);

  for (const arquivo of [
    "components/pdv/pdv-shell.tsx",
    "components/pdv/pdv-edicao-shell.tsx",
    "components/pdv/pdv-caixa-fechado.tsx",
    "components/caixa/caixa-modais.tsx",
    "components/caixa/caixa-conferencia-meios.tsx",
    "app/produtos/produto-cadastro-form.tsx",
    "components/clientes/modal-debito-cliente.tsx",
    "components/estoque/estoque-workspace.tsx",
    "components/fiscal/nfe55/nfe-pagamento-venda.tsx",
  ]) {
    assert.match(fonte(arquivo), /CampoValor/, arquivo);
  }

  assert.doesNotMatch(fonte("components/ui/list-toolbar.tsx"), /CampoValor/);
  assert.doesNotMatch(fonte("components/pdv/pdv-consumidor-nota.tsx"), /CampoValor/);
});
