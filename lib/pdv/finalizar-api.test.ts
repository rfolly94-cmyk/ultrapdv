import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { mensagemErroFinalizacaoPublica } from "./mensagem-erro-publica";

test("API de finalização reusa a action e não confia em empresa_id do body", () => {
  const rota = fonte("app/api/pdv/finalizar/route.ts");
  const action = fonte("app/pdv/actions.ts");

  assert.match(rota, /executarFinalizacaoVendaPdv/);
  assert.match(rota, /extrairBearerAuthorization/);
  assert.match(rota, /Authorization/);
  assert.doesNotMatch(rota, /empresa_id|empresaId/);
  assert.doesNotMatch(rota, /createAdminClient|SUPABASE_SECRET_KEY/);
  assert.match(fonte("lib/permissoes/rotas.ts"), /\/api\/pdv\/finalizar/);
  assert.match(action, /rpc_finalizar_venda/);
  assert.match(action, /p_empresa_id:\s*vinculo\.empresa_id/);
  assert.ok(
    action.indexOf("exigirOperacaoPdv") < action.indexOf("rpc_finalizar_venda")
  );
  assert.ok(
    action.indexOf("exigirEmpresaOperacional") <
      action.indexOf("rpc_finalizar_venda")
  );
});

test("API exige as mesmas autorizações do PDV web", () => {
  const action = fonte("app/pdv/actions.ts");
  assert.match(action, /acao: "finalizar_venda"/);
  assert.match(action, /acao: "usar_fiado"/);
  assert.match(action, /acao: "aplicar_desconto"/);
  assert.match(action, /validarPixNaFinalizacaoComercial/);
  assert.match(action, /avaliarTetoPagamentosNoServidor/);
  assert.match(action, /p_idempotency_key/);
});

test("erros internos da RPC não vazam para o cliente", () => {
  assert.equal(
    mensagemErroFinalizacaoPublica("function public.rpc_finalizar_venda failed"),
    "Não foi possível finalizar a venda."
  );
  assert.equal(
    mensagemErroFinalizacaoPublica("Pagamento fiado exige cliente."),
    "Pagamento fiado exige cliente."
  );
  assert.equal(
    mensagemErroFinalizacaoPublica(
      "function public.rpc_finalizar_venda_com_caixa() O caixa foi fechado. Abra um caixa para continuar."
    ),
    "O caixa foi fechado. Abra um caixa para continuar."
  );
});

test("API mobile não exige caixa aberto nesta fase; PDV web exige", () => {
  const rota = fonte("app/api/pdv/finalizar/route.ts");
  const action = fonte("app/pdv/actions.ts");

  assert.match(rota, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(rota, /executarFinalizacaoVendaPdv\(corpo,/);
  assert.match(rota, /Futura integração Caixa mobile/);
  assert.match(action, /exigirCaixaAberto:\s*true/);
  assert.match(action, /buscarCaixaAbertoEmpresa/);
});
