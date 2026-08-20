import assert from "node:assert/strict";
import { test } from "node:test";

import { aplicarAcaoAssinatura } from "./aplicar-acao";
import {
  empresaPodeOperar,
  liberacaoTemporariaValida,
  assinaturaBloqueiaOperacao,
} from "./empresa-pode-operar";
import {
  rotaLivreNoModoRestrito,
  rotaOperacionalBloqueadaQuandoSuspensa,
} from "./rotas-restritas";
import { TRIAL_DIAS } from "./tipos";
import { decidirAcessoMaster } from "../master/autorizacao";
import { empresaA, empresaB, usuarioA, usuarioB } from "../multiempresa/cenario";
import { fonte } from "../multiempresa/fonte";

test("1. usuário comum não acessa /master", () => {
  const acesso = decidirAcessoMaster({
    usuarioId: usuarioA,
    autenticado: true,
    admin: null,
  });
  assert.deepEqual(acesso, { ok: false, status: 404 });
  assert.match(fonte("app/master/layout.tsx"), /exigirMaster/);
  assert.match(fonte("app/master/layout.tsx"), /notFound\(\)/);
});

test("2. Master ativo acessa /master", () => {
  const acesso = decidirAcessoMaster({
    usuarioId: usuarioA,
    autenticado: true,
    admin: { usuario_id: usuarioA, ativo: true },
  });
  assert.deepEqual(acesso, { ok: true });
  assert.match(fonte("lib/master/exigir-master.ts"), /administradores_plataforma|obterContextoAdminPlataforma/);
});

test("3. Master inativo não acessa", () => {
  const acesso = decidirAcessoMaster({
    usuarioId: usuarioA,
    autenticado: true,
    admin: { usuario_id: usuarioA, ativo: false },
  });
  assert.deepEqual(acesso, { ok: false, status: 404 });
});

test("4. empresa ativa opera normalmente", () => {
  assert.equal(
    empresaPodeOperar({ status: "ativa", empresa_id: empresaA }),
    true
  );
});

test("5. trial opera normalmente", () => {
  assert.equal(
    empresaPodeOperar({ status: "trial", empresa_id: empresaA }),
    true
  );
  assert.equal(TRIAL_DIAS, 7);
});

test("6. carência válida opera normalmente", () => {
  const agora = new Date("2026-08-20T12:00:00-03:00");
  assert.equal(
    empresaPodeOperar(
      {
        status: "carencia",
        empresa_id: empresaA,
        carencia_ate: "2026-08-25",
      },
      agora
    ),
    true
  );
});

test("7. empresa suspensa não acessa PDV", () => {
  assert.equal(
    empresaPodeOperar({ status: "suspensa", empresa_id: empresaA }),
    false
  );
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/pdv"), true);
  assert.match(fonte("app/pdv/page.tsx"), /PdvIndisponivelAssinatura/);
  assert.match(fonte("lib/supabase/proxy.ts"), /rotaOperacionalBloqueadaQuandoSuspensa/);
});

test("8. empresa suspensa não consegue finalizar venda via Server Action", () => {
  assert.match(fonte("app/pdv/actions.ts"), /exigirEmpresaOperacional/);
  assert.match(fonte("app/pdv/editar-actions.ts"), /exigirEmpresaOperacional/);
});

test("9. liberação temporária válida permite operar", () => {
  const agora = new Date("2026-08-20T12:00:00-03:00");
  assert.equal(
    empresaPodeOperar(
      {
        status: "suspensa",
        empresa_id: empresaA,
        liberado_ate: "2026-08-27T23:59:59-03:00",
      },
      agora
    ),
    true
  );
  assert.equal(
    liberacaoTemporariaValida("2026-08-27T23:59:59-03:00", agora),
    true
  );
});

test("10. liberação expirada volta a restringir", () => {
  const agora = new Date("2026-08-28T12:00:00-03:00");
  assert.equal(
    empresaPodeOperar(
      {
        status: "suspensa",
        empresa_id: empresaA,
        liberado_ate: "2026-08-27T23:59:59-03:00",
      },
      agora
    ),
    false
  );
});

test("11. reativar empresa restaura operação", () => {
  const suspensa = {
    empresa_id: empresaA,
    status: "suspensa",
    suspenso_em: "2026-08-18T09:32:00-03:00",
  };
  const { proxima, evento } = aplicarAcaoAssinatura(suspensa, "ativar");
  assert.equal(proxima.status, "ativa");
  assert.equal(proxima.suspenso_em, null);
  assert.equal(evento, "empresa_ativada");
  assert.equal(empresaPodeOperar(proxima), true);
});

test("12. empresa suspensa mantém todos os dados", () => {
  const { proxima } = aplicarAcaoAssinatura(
    {
      empresa_id: empresaA,
      status: "ativa",
      liberado_ate: "2099-01-01T00:00:00-03:00",
    },
    "suspender",
    { motivo: "pagamento pendente" }
  );
  assert.equal(proxima.status, "suspensa");
  assert.equal(proxima.empresa_id, empresaA);
  assert.equal(proxima.liberado_ate, null);
  assert.equal(empresaPodeOperar(proxima), false);
  assert.match(fonte("lib/master/acoes.ts"), /Não apagar|dados serão preservados|empresa_id/);
  assert.doesNotMatch(fonte("lib/master/acoes.ts"), /from\("empresas"\)[\s\S]*\.delete\(/);
  assert.doesNotMatch(fonte("lib/master/acoes.ts"), /from\("vendas"\)[\s\S]*\.delete\(/);
});

test("13. suspensão da empresa A não afeta empresa B", () => {
  const a = aplicarAcaoAssinatura(
    { empresa_id: empresaA, status: "ativa" },
    "suspender",
    { motivo: "teste" }
  ).proxima;
  const b = { empresa_id: empresaB, status: "ativa" };
  assert.equal(empresaPodeOperar(a), false);
  assert.equal(empresaPodeOperar(b), true);
  assert.notEqual(a.empresa_id, b.empresa_id);
});

test("14. Master consegue visualizar empresas diferentes", () => {
  assert.match(fonte("lib/master/empresas.ts"), /exigirMaster/);
  assert.match(fonte("lib/master/empresas.ts"), /from\("empresas"\)/);
  assert.doesNotMatch(
    fonte("lib/master/empresas.ts"),
    /eq\("empresa_id", vinculo/
  );
});

test("15. usuário normal não consegue usar endpoint/action Master manualmente", () => {
  assert.match(fonte("lib/master/acoes.ts"), /exigirMaster/);
  assert.match(fonte("lib/master/empresas.ts"), /exigirMaster/);
  assert.equal(
    decidirAcessoMaster({
      usuarioId: usuarioB,
      autenticado: true,
      admin: null,
    }).ok,
    false
  );
});

test("16. empresas existentes recebem estado seguro após migration", () => {
  const sql = fonte(
    "supabase/migrations/20260820040000_master_saas_fundacao.sql"
  );
  assert.match(sql, /'ativa'/);
  assert.match(sql, /INSERT INTO public\.assinaturas_empresas/);
  assert.match(sql, /FROM public\.empresas e/);
  assert.match(sql, /'trial'/);
  assert.match(sql, /current_date \+ 7/);
  assert.doesNotMatch(sql, /usuarios_empresas\.perfil/);
  assert.doesNotMatch(sql, /CREATE TABLE.*platform_admins/);
});

test("cancelada não opera mesmo com liberação", () => {
  assert.equal(
    empresaPodeOperar({
      status: "cancelada",
      empresa_id: empresaA,
      liberado_ate: "2099-01-01T00:00:00-03:00",
    }),
    false
  );
});

test("modo restrito libera assinatura, painel e empresa", () => {
  assert.equal(rotaLivreNoModoRestrito("/assinatura"), true);
  assert.equal(rotaLivreNoModoRestrito("/painel"), true);
  assert.equal(rotaLivreNoModoRestrito("/configuracoes/empresa"), true);
  assert.equal(rotaLivreNoModoRestrito("/logout"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/produtos"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/clientes"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/estoque"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/vendas"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/fiscal/nfe/nova"), true);
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/fiscal"), false);
});

test("nova emissão fiscal é bloqueada; Master não usa email hardcoded", () => {
  assert.match(fonte("app/api/fiscal/geranet/nfe-emitir/route.ts"), /exigirEmpresaOperacional/);
  assert.match(fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"), /exigirEmpresaOperacional/);
  assert.match(fonte("app/api/fiscal/geranet/nfce-emitir/route.ts"), /exigirEmpresaOperacional/);
  assert.doesNotMatch(fonte("lib/master/exigir-master.ts"), /email ===/);
  assert.doesNotMatch(fonte("app/master/layout.tsx"), /email ===/);
});

test("assinatura ausente não é bypass permanente", () => {
  assert.equal(empresaPodeOperar(null), false);
  assert.equal(assinaturaBloqueiaOperacao(null, null), true);
  assert.equal(
    assinaturaBloqueiaOperacao(null, {
      message: "Could not find the table 'public.assinaturas_empresas' in the schema cache",
    }),
    false
  );
  assert.equal(
    assinaturaBloqueiaOperacao(null, { message: "permission denied for table assinaturas_empresas" }),
    true
  );
});

test("Suspender limpa liberado_ate e bloqueia na hora", () => {
  const agora = new Date("2026-08-20T12:00:00-03:00");
  const { proxima } = aplicarAcaoAssinatura(
    {
      empresa_id: empresaA,
      status: "suspensa",
      liberado_ate: "2026-08-27T23:59:59-03:00",
    },
    "suspender",
    { motivo: "bloquear agora" },
    agora
  );
  assert.equal(proxima.status, "suspensa");
  assert.equal(proxima.liberado_ate, null);
  assert.equal(empresaPodeOperar(proxima, agora), false);
});

test("Master não ignora suspensão nas rotas operacionais", () => {
  assert.doesNotMatch(fonte("lib/assinatura/empresa-pode-operar.ts"), /isMaster|administrador_plataforma/);
  assert.doesNotMatch(fonte("lib/assinatura/exigir-empresa-operacional.ts"), /isMaster|exigirMaster/);
  assert.doesNotMatch(fonte("lib/assinatura/resolver-assinatura-empresa.ts"), /isMaster|exigirMaster/);
  assert.doesNotMatch(fonte("lib/supabase/proxy.ts"), /if \(isMaster\)/);
  assert.match(fonte("lib/supabase/proxy.ts"), /assinaturaBloqueiaOperacao/);
  assert.match(fonte("app/pdv/actions.ts"), /exigirEmpresaOperacional/);
});

test("Master revalida shell operacional após suspender/reativar", () => {
  const acoes = fonte("lib/master/acoes.ts");
  assert.match(acoes, /revalidatePath\("\/pdv"\)/);
  assert.match(acoes, /revalidatePath\("\/assinatura"\)/);
  assert.match(acoes, /revalidatePath\("\/", "layout"\)/);
  assert.match(acoes, /error: updateError/);
  assert.match(acoes, /A assinatura não foi atualizada/);
  assert.match(fonte("app/vendas/pedidos/actions.ts"), /exigirEmpresaOperacionalOuRedirecionar/);
  assert.match(fonte("app/configuracoes/catalogo/actions.ts"), /exigirEmpresaOperacionalOuRedirecionar/);
});
