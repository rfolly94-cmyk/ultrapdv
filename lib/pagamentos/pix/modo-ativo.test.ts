import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CAMPOS_PROIBIDOS_EMITIR_PDV } from "./geranet-regras";
import { validarGeracaoPixLocal } from "./local-regras";
import {
  CODIGO_PIX_GERANET_NAO_ATIVO,
  CODIGO_PIX_LOCAL_NAO_ATIVO,
  CODIGO_PIX_NAO_CONFIGURADO,
  MENSAGEM_PIX_GERANET_NAO_ATIVO,
  MENSAGEM_PIX_LOCAL_NAO_ATIVO,
  MENSAGEM_PIX_NAO_CONFIGURADO,
  MENSAGEM_TROCA_MODO_PIX_PENDENTE,
  MENSAGEM_VENDA_GERANET_NAO_ACEITA_LOCAL,
  MENSAGEM_VENDA_LOCAL_NAO_ACEITA_GERANET,
  classificarIntegracaoPix,
  deveBloquearTrocaModoPix,
  pixConfigPublicoPdv,
  rejeitarModoAdulteradoNoCliente,
  validarCobrancaCompativelComModoAtivo,
} from "./modo-ativo";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

function apareceAntes(texto: string, primeiro: string, segundo: string) {
  const a = texto.indexOf(primeiro);
  const b = texto.indexOf(segundo);
  assert.ok(a >= 0, `não encontrou ${primeiro}`);
  assert.ok(b >= 0, `não encontrou ${segundo}`);
  assert.ok(a < b, `${primeiro} deveria aparecer antes de ${segundo}`);
}

const local = {
  id: "int-local",
  ativo: true,
  modo: "local_manual" as const,
  provedor: null,
};
const geranet = {
  id: "int-geranet",
  ativo: true,
  modo: "geranet" as const,
  provedor: "sicredi",
};

test("1. modo local permite gerar QR Local", () => {
  validarGeracaoPixLocal({
    valor: 100,
    modo: "local_manual",
    ativo: true,
    chavePix: "chave",
    recebedorNome: "Loja",
    recebedorCidade: "Cuiaba",
  });
  assert.equal(classificarIntegracaoPix(local).ativo, true);
  assert.match(fonte("lib/pagamentos/pix/local-pdv.ts"), /exigirPixLocalAtivo/);
  assert.match(fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"), /exigirPixLocalAtivo/);
});

test("2. modo local bloqueia emitir Geranet", () => {
  const resolucao = classificarIntegracaoPix(local);
  assert.equal(resolucao.ativo, true);
  if (resolucao.ativo) {
    assert.equal(resolucao.modo, "local_manual");
  }
  const geranetFonte = [
    fonte("lib/pagamentos/pix/geranet-pdv.ts"),
    fonte("lib/pagamentos/pix/geranet.ts"),
  ].join("\n");
  assert.match(geranetFonte, /exigirPixGeranetAtivo/);
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo.ts"),
    new RegExp(CODIGO_PIX_GERANET_NAO_ATIVO)
  );
});

test("3. modo local não busca secrets Geranet", () => {
  const pdv = fonte("lib/pagamentos/pix/geranet-pdv.ts");
  apareceAntes(
    pdv.slice(pdv.indexOf("async function validarPreRequisitosGeranetPdv")),
    "exigirPixGeranetAtivo",
    "carregarApiKeyGeranet"
  );
  const geranet = fonte("lib/pagamentos/pix/geranet.ts");
  apareceAntes(
    geranet.slice(geranet.indexOf("export async function emitirCobrancaPixTeste")),
    "exigirPixGeranetAtivo",
    "carregarApiKeyGeranet"
  );
  const testar = fonte("app/api/pagamentos/pix/geranet/testar/route.ts");
  apareceAntes(
    testar.slice(testar.indexOf("export async function POST")),
    "exigirPixGeranetAtivo",
    "carregarApiKeyGeranet"
  );
});

test("4. modo local não chama API Geranet", () => {
  const locais = [
    fonte("lib/pagamentos/pix/local-pdv.ts"),
    fonte("lib/pagamentos/pix/local-regras.ts"),
    fonte("app/api/pagamentos/pix/local/gerar/route.ts"),
    fonte("app/api/pagamentos/pix/local/confirmar/route.ts"),
  ].join("\n");
  assert.equal(locais.includes("chamarGeranetBanking"), false);
  assert.equal(locais.includes("/api/v1/pix/emitir"), false);
});

test("5. modo geranet permite emitir cobrança", () => {
  const resolucao = classificarIntegracaoPix(geranet);
  assert.equal(resolucao.ativo, true);
  if (resolucao.ativo) {
    assert.equal(resolucao.modo, "geranet");
  }
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /exigirPixGeranetAtivo/);
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /chamarGeranetBanking/);
});

test("6. modo geranet bloqueia gerar QR Local", () => {
  assert.throws(
    () =>
      validarGeracaoPixLocal({
        valor: 100,
        modo: "geranet",
        ativo: true,
        chavePix: "chave",
        recebedorNome: "Loja",
        recebedorCidade: "Cuiaba",
      }),
    /Configure o PIX Local/
  );
  assert.match(fonte("lib/pagamentos/pix/local-pdv.ts"), /exigirPixLocalAtivo/);
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo.ts"),
    new RegExp(CODIGO_PIX_LOCAL_NAO_ATIVO)
  );
});

test("7. modo geranet bloqueia confirmação manual Local", () => {
  assert.match(
    fonte("lib/pagamentos/pix/local-pdv.ts"),
    /await exigirPixLocalAtivo\(empresaId\);[\s\S]*confirmarRecebimentoPixLocal|confirmarRecebimentoPixLocal[\s\S]*exigirPixLocalAtivo/
  );
  const confirmar = fonte("lib/pagamentos/pix/local-pdv.ts");
  const idxFn = confirmar.indexOf("export async function confirmarRecebimentoPixLocal");
  const trecho = confirmar.slice(idxFn, idxFn + 800);
  assert.match(trecho, /exigirPixLocalAtivo/);
});

test("8. frontend recebe somente o modo ativo", () => {
  const localCfg = pixConfigPublicoPdv(classificarIntegracaoPix(local));
  const geranetCfg = pixConfigPublicoPdv(classificarIntegracaoPix(geranet));
  assert.deepEqual(localCfg, { modo: "local_manual" });
  assert.deepEqual(geranetCfg, { modo: "geranet", provedor: "sicredi" });
  assert.equal(localCfg && "provedor" in localCfg, false);
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /pixLocalAtivo/);
  assert.match(shell, /pixGeranetAtivo/);
  assert.match(fonte("app/pdv/page.tsx"), /pixConfigPublicoPdv/);
});

test("9. browser não consegue forçar modo diferente", () => {
  assert.throws(
    () => rejeitarModoAdulteradoNoCliente({ modo: "geranet", valor: 100 }),
    /não pode escolher o modo PIX/
  );
  assert.ok(CAMPOS_PROIBIDOS_EMITIR_PDV.includes("modo"));
  assert.ok(CAMPOS_PROIBIDOS_EMITIR_PDV.includes("modo_pix"));
  assert.match(
    fonte("app/api/pagamentos/pix/local/gerar/route.ts"),
    /rejeitarModoAdulteradoNoCliente/
  );
});

test("10. servidor ignora modo adulterado no request", () => {
  assert.throws(
    () =>
      rejeitarModoAdulteradoNoCliente({
        modo_pix: "local_manual",
        valor: 40,
      }),
    /não pode escolher o modo PIX/
  );
  assert.match(fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"), /carregarIntegracaoPix/);
  assert.match(
    fonte("lib/pagamentos/pix/geranet-pdv.ts"),
    /exigirPixGeranetAtivo\(empresaId\)/
  );
});

test("11. empresa A não usa configuração da empresa B", () => {
  assert.match(
    fonte("lib/pagamentos/pix/contexto.ts"),
    /\.eq\("empresa_id", empresaId\)/
  );
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"),
    /resolverModoPixAtivo/
  );
  assert.match(
    fonte("lib/pagamentos/pix/local-pdv.ts"),
    /exigirPixLocalAtivo\(empresaId\)/
  );
  assert.equal(
    fonte("lib/pagamentos/pix/modo-ativo-servidor.ts").includes("body.empresa_id"),
    false
  );
});

test("12. sem configuração PIX bloqueia pagamento PIX", () => {
  const resolucao = classificarIntegracaoPix(null);
  assert.equal(resolucao.ativo, false);
  assert.equal(pixConfigPublicoPdv(resolucao), null);
  assert.equal(MENSAGEM_PIX_NAO_CONFIGURADO, "PIX não está configurado para esta empresa.");
  assert.match(
    fonte("components/pdv/pdv-shell.tsx"),
    /MENSAGEM_CONFIGURE_PIX/
  );
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"),
    /MENSAGEM_PIX_NAO_CONFIGURADO/
  );
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo.ts"),
    new RegExp(CODIGO_PIX_NAO_CONFIGURADO)
  );
});

test("13. integração inativa bloqueia PIX", () => {
  const resolucao = classificarIntegracaoPix({
    id: "x",
    ativo: false,
    modo: "geranet",
    provedor: "sicredi",
  });
  assert.equal(resolucao.ativo, false);
  if (!resolucao.ativo) {
    assert.equal(resolucao.motivo, "inativa");
  }
  assert.equal(pixConfigPublicoPdv(resolucao), null);
});

test("14. venda Local não aceita cobrança Geranet", () => {
  assert.throws(
    () =>
      validarCobrancaCompativelComModoAtivo({
        modoAtivo: "local_manual",
        cobrancaModoPix: "geranet",
      }),
    new Error(MENSAGEM_VENDA_LOCAL_NAO_ACEITA_GERANET)
  );
});

test("15. venda Geranet não aceita recebimento Local", () => {
  assert.throws(
    () =>
      validarCobrancaCompativelComModoAtivo({
        modoAtivo: "geranet",
        cobrancaModoPix: "local_manual",
      }),
    new Error(MENSAGEM_VENDA_GERANET_NAO_ACEITA_LOCAL)
  );
});

test("16. mudança de configuração não altera vendas antigas", () => {
  const salvar = fonte("app/configuracoes/financeiro/pix/actions.ts");
  assert.equal(salvar.includes('from("cobrancas_pix")'), false);
  assert.equal(salvar.includes("modo_pix:"), false);
  assert.match(salvar, /garantirTrocaModoPixPermitida/);
});

test("17. troca de modo é bloqueada com PIX pendente", () => {
  assert.equal(
    deveBloquearTrocaModoPix({
      modoAtual: "local_manual",
      modoNovo: "geranet",
      pendenciasNaoVinculadas: 1,
    }),
    true
  );
  assert.equal(
    deveBloquearTrocaModoPix({
      modoAtual: "geranet",
      modoNovo: "local_manual",
      pendenciasNaoVinculadas: 1,
    }),
    true
  );
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo.ts"),
    /aguardando_confirmacao/
  );
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo.ts"),
    new RegExp(MENSAGEM_TROCA_MODO_PIX_PENDENTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("18. troca é bloqueada com PIX pago/confirmado ainda não vinculado", () => {
  assert.equal(
    deveBloquearTrocaModoPix({
      modoAtual: "geranet",
      modoNovo: "local_manual",
      pendenciasNaoVinculadas: 1,
    }),
    true
  );
  const modo = fonte("lib/pagamentos/pix/modo-ativo.ts");
  const servidor = fonte("lib/pagamentos/pix/modo-ativo-servidor.ts");
  assert.match(modo, /confirmado_manual/);
  assert.match(modo, /"paga"/);
  assert.match(servidor, /\.is\("venda_id", null\)/);
});

test("19. operação histórica vinculada continua válida", () => {
  assert.equal(
    deveBloquearTrocaModoPix({
      modoAtual: "local_manual",
      modoNovo: "geranet",
      pendenciasNaoVinculadas: 0,
    }),
    false
  );
  validarCobrancaCompativelComModoAtivo({
    modoAtivo: "local_manual",
    cobrancaModoPix: "local_manual",
  });
  validarCobrancaCompativelComModoAtivo({
    modoAtivo: "geranet",
    cobrancaModoPix: "geranet",
  });
  assert.match(
    fonte("app/vendas/[id]/page.tsx"),
    /modo_pix/
  );
});

test("20. configuração atual é consultada novamente na finalização", () => {
  const acao = fonte("app/pdv/actions.ts");
  assert.match(acao, /validarPixNaFinalizacaoComercial/);
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"),
    /resolverModoPixAtivo/
  );
  assert.equal(
    classificarIntegracaoPix({
      id: "x",
      ativo: true,
      modo: "invalido",
      provedor: null,
    }).ativo,
    false
  );
});

test("mensagens HTTP 409 identificam o modo ativo", () => {
  assert.equal(
    MENSAGEM_PIX_LOCAL_NAO_ATIVO.includes("PIX Integrado"),
    true
  );
  assert.equal(
    MENSAGEM_PIX_GERANET_NAO_ATIVO.includes("PIX Local"),
    true
  );
  assert.equal(CODIGO_PIX_LOCAL_NAO_ATIVO, "PIX_LOCAL_NAO_ATIVO");
  assert.equal(CODIGO_PIX_GERANET_NAO_ATIVO, "PIX_GERANET_NAO_ATIVO");
});
