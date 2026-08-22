import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  avaliarCamadasAcesso,
  decidirRecursoDoPlano,
} from "@/lib/plataforma/entitlements/camadas";
import {
  modoEntitlementDoRecurso,
  RECURSOS_COM_ENFORCEMENT,
} from "@/lib/plataforma/entitlements/rollout";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import {
  completarConfiguracoesImpressao,
  decidirDestinoImpressaoAutomatica,
} from "@/lib/impressao/regras";
import { MENSAGEM_CONECTOR_NAO_CONTRATADO } from "@/lib/impressao/mensagens";

function plano(empresaId: string, impressao: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      impressao === "ausente"
        ? []
        : [
            {
              chave: "impressao_automatica",
              habilitado: impressao,
              ativo: true,
            },
          ],
  };
}

const configAuto = completarConfiguracoesImpressao([
  {
    id: "1",
    tipoDocumento: "recibo",
    impressoraNome: "ELGIN i9",
    papel: "80mm",
    copias: 1,
    impressaoAutomatica: true,
    ativo: true,
  },
]);

test("rollout inclui importador, impressao_automatica, relatorios e contabilidade", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    ["importador", "impressao_automatica", "relatorios", "contabilidade", "pix_integrado", "carteira", "produtos", "clientes", "estoque", "nfce", "nfe", "cce", "inutilizacao_fiscal", "vendas", "pdv", "catalogo"]
  );
  assert.equal(modoEntitlementDoRecurso("impressao_automatica"), "enforce");
  assert.equal(modoEntitlementDoRecurso("relatorios"), "enforce");
  assert.equal(modoEntitlementDoRecurso("contabilidade"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 1: impressao_automatica true + permissão → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "impressao_automatica",
    modulo: "configuracoes",
    acao: "acessar",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.modoEntitlement, "enforce");
});

test("CASO 2: recurso false + usuário permitido → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "impressao_automatica",
    modulo: "configuracoes",
    acao: "acessar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 3: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "impressao_automatica",
    modulo: "configuracoes",
    acao: "acessar",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 4: mesmo usuário, empresas diferentes", () => {
  const naA = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "impressao_automatica",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "impressao_automatica",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 5: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "impressao_automatica",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "impressao_automatica",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 6: venda finalizada + recurso false não envia ao agente", () => {
  const destino = decidirDestinoImpressaoAutomatica({
    configs: configAuto,
    vendaId: "v1",
    fiscal: null,
    conectorPermitido: false,
  });
  assert.deepEqual(destino, { tipo: "nenhum" });
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const posFinalizar = shell.indexOf("await finalizarVendaPdv");
  const posImpressao = shell.indexOf("await tentarImpressaoPosVenda");
  assert.ok(posImpressao > posFinalizar);
  assert.match(shell, /conectorLiberado/);
  assert.doesNotMatch(shell, /rollback/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /impressao_automatica/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /exigirRecursoEmpresa/);
});

test("CASO 7: NFC-e autorizada continua disponível sem enviar ao agente", () => {
  const destino = decidirDestinoImpressaoAutomatica({
    configs: completarConfiguracoesImpressao([
      {
        id: "2",
        tipoDocumento: "danfe_nfce",
        impressoraNome: "ELGIN i9",
        papel: "80mm",
        copias: 1,
        impressaoAutomatica: true,
        ativo: true,
      },
    ]),
    vendaId: "v1",
    fiscal: {
      kind: "autorizada",
      status: "autorizada",
      emissaoId: "e1",
      danfeDisponivel: true,
    },
    conectorPermitido: false,
  });
  assert.deepEqual(destino, { tipo: "nenhum" });
  assert.doesNotMatch(
    fonte("app/api/impressao/danfe/[id]/route.ts"),
    /exigirRecursoEmpresa|impressao_automatica/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    /exigirRecursoEmpresa/
  );
});

test("CASO 8 e 9: visualizar e baixar PDF continuam permitidos", () => {
  for (const arquivo of [
    "app/api/impressao/recibo/[id]/route.ts",
    "app/api/impressao/danfe/[id]/route.ts",
    "app/api/impressao/carta-correcao/[id]/route.ts",
    "app/api/impressao/carteira-abertos/[id]/route.ts",
    "app/api/impressao/relatorio/route.ts",
  ]) {
    const src = fonte(arquivo);
    assert.doesNotMatch(src, /exigirRecursoEmpresa/);
    assert.doesNotMatch(src, /impressao_automatica/);
  }
  assert.match(
    fonte("components/impressao/controles-impressao.tsx"),
    /Baixar PDF/
  );
  assert.match(fonte("app/vendas/[id]/page.tsx"), /Visualizar recibo/);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /Visualizar DANFE/);
});

test("CASO 10: Imprimir via Conector é negado no plano", () => {
  const botao = fonte("components/impressao/botao-imprimir-conector.tsx");
  assert.match(botao, /useRecursoLiberado\("impressao_automatica"\)/);
  assert.match(botao, /MENSAGEM_CONECTOR_NAO_CONTRATADO/);
  assert.match(MENSAGEM_CONECTOR_NAO_CONTRATADO, /visualizar ou baixar/);
  assert.doesNotMatch(MENSAGEM_CONECTOR_NAO_CONTRATADO, /venda falhou|rollback/i);
});

test("CASO 11: entrypoint servidor autoriza antes de enviar ao agente", () => {
  const imprimir = fonte("lib/impressao/imprimir-pdf.ts");
  const authIdx = imprimir.indexOf("autorizarUsoConectorImpressaoAction");
  const envioIdx = imprimir.indexOf("enviarImpressaoAgente");
  assert.ok(authIdx >= 0);
  assert.ok(envioIdx > authIdx);
  const actions = fonte("app/configuracoes/impressao/actions.ts");
  assert.match(actions, /recurso: "impressao_automatica"/);
  assert.match(actions, /salvarConfiguracaoImpressaoAction/);
  assert.match(actions, /exigirAcessoOperacao/);
  assert.match(actions, /RECURSO_NAO_CONTRATADO/);
});

test("CASO 12: perder o recurso não apaga configuração", () => {
  const servidor = fonte("lib/impressao/configuracoes-servidor.ts");
  assert.match(servidor, /impressoes_configuracoes/);
  assert.match(servidor, /\.upsert\(/);
  assert.doesNotMatch(servidor, /\.delete\(/);
  assert.doesNotMatch(servidor, /exigirRecursoEmpresa/);
  const actions = fonte("app/configuracoes/impressao/actions.ts");
  const buscar = actions.slice(
    actions.indexOf("buscarConfiguracoesImpressaoAction"),
    actions.indexOf("salvarConfiguracaoImpressaoAction")
  );
  assert.doesNotMatch(buscar, /exigirRecursoEmpresa/);
  assert.match(buscar, /conectorLiberado/);
});

test("print-agent e PDFs fiscais não recebem entitlement SaaS", () => {
  assert.doesNotMatch(
    fonte("print-agent/src/server.mjs"),
    /exigirRecursoEmpresa|impressao_automatica|SUPABASE_SERVICE/
  );
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /exigirRecursoEmpresa/);
});
