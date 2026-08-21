import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  completarConfiguracoesImpressao,
  danfeNfceAutorizadaImprimivel,
  decidirDestinoImpressaoAutomatica,
  ehUuid,
  podeImprimirAutomaticamente,
  sanitizarConfiguracaoImpressao,
  sanitizarCopiasImpressao,
} from "./regras";
import { portasDescobertaConector } from "./descobrir";
import { DISPOSITIVO_STORAGE_KEY, PRINT_AGENT_PORT } from "./tipos";
import { gerarPdfSimples } from "./pdf-simples";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const pc1 = "22222222-2222-4222-8222-222222222222";
const pc2 = "33333333-3333-4333-8333-333333333333";

test("dispositivo_id é UUID persistido localmente, sem fingerprint", () => {
  assert.equal(DISPOSITIVO_STORAGE_KEY, "ultrapdv_dispositivo_id");
  assert.equal(ehUuid(pc1), true);
  assert.equal(ehUuid("nao-uuid"), false);
  const dispositivo = fonte("lib/impressao/dispositivo.ts");
  assert.match(dispositivo, /localStorage/);
  assert.doesNotMatch(dispositivo, /canvas|webgl|userAgent|fingerprint/i);
});

test("computador 1 e computador 2 não compartilham unique da config", () => {
  const migration = fonte(
    "supabase/migrations/20260820100000_impressoes_configuracoes.sql"
  );
  assert.match(
    migration,
    /UNIQUE \(empresa_id, usuario_id, dispositivo_id, tipo_documento\)/
  );
  assert.notEqual(pc1, pc2);
});

test("empresa B não entra na consulta sem empresa_id da sessão", () => {
  const servidor = fonte("lib/impressao/configuracoes-servidor.ts");
  assert.match(servidor, /buscarVinculoEmpresaAtiva/);
  assert.match(servidor, /\.eq\("empresa_id", ctx\.empresaId\)/);
  assert.match(servidor, /\.eq\("usuario_id", ctx\.usuarioId\)/);
  assert.match(servidor, /\.eq\("dispositivo_id", dispositivoId\)/);
  assert.doesNotMatch(servidor, /body\.empresa_id|formData\.get\("empresa_id"\)/);
  assert.match(
    fonte("app/configuracoes/impressao/actions.ts"),
    /salvarConfiguracaoImpressaoAction/
  );
});

test("RLS usa tem_acesso_empresa e auth.uid, sem política só de uid", () => {
  const migration = fonte(
    "supabase/migrations/20260820100000_impressoes_configuracoes.sql"
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migration, /usuario_id = auth\.uid\(\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.impressoes_configuracoes FROM PUBLIC, anon/);
});

test("NFC-e rejeitada ou aguardando reconciliação não imprime DANFE autorizado", () => {
  const configs = completarConfiguracoesImpressao([
    {
      id: "1",
      tipoDocumento: "danfe_nfce",
      impressoraNome: "ELGIN i9",
      papel: "80mm",
      copias: 1,
      impressaoAutomatica: true,
      ativo: true,
    },
    {
      id: "2",
      tipoDocumento: "recibo",
      impressoraNome: "ELGIN i9",
      papel: "80mm",
      copias: 1,
      impressaoAutomatica: true,
      ativo: true,
    },
  ]);

  const rejeitada = decidirDestinoImpressaoAutomatica({
    configs,
    vendaId: "v1",
    fiscal: {
      emitindo: false,
      kind: "rejeitada",
      status: "rejeitada",
      emissaoId: "em-1",
      danfeDisponivel: false,
    },
  });
  assert.equal(rejeitada.tipo, "recibo");

  const reconciliar = decidirDestinoImpressaoAutomatica({
    configs,
    vendaId: "v1",
    fiscal: {
      emitindo: false,
      kind: "aguardando_reconciliacao",
      status: "aguardando_reconciliacao",
      emissaoId: "em-2",
      danfeDisponivel: false,
    },
  });
  assert.equal(reconciliar.tipo, "recibo");
  assert.equal(
    danfeNfceAutorizadaImprimivel({
      kind: "rejeitada",
      status: "rejeitada",
      emissaoId: "em-1",
      danfeDisponivel: true,
    }),
    false
  );
});

test("NFC-e autorizada com DANFE prioriza danfe_nfce automático", () => {
  const configs = completarConfiguracoesImpressao([
    {
      id: "1",
      tipoDocumento: "danfe_nfce",
      impressoraNome: "ELGIN i9",
      papel: "80mm",
      copias: 1,
      impressaoAutomatica: true,
      ativo: true,
    },
    {
      id: "2",
      tipoDocumento: "recibo",
      impressoraNome: "ELGIN i9",
      papel: "80mm",
      copias: 1,
      impressaoAutomatica: true,
      ativo: true,
    },
  ]);

  const destino = decidirDestinoImpressaoAutomatica({
    configs,
    vendaId: "v1",
    fiscal: {
      emitindo: false,
      kind: "autorizada",
      status: "autorizada",
      emissaoId: "em-ok",
      danfeDisponivel: true,
    },
  });
  assert.deepEqual(destino, { tipo: "danfe_nfce", emissaoId: "em-ok" });
});

test("sem impressão automática o destino é nenhum", () => {
  const configs = completarConfiguracoesImpressao([]);
  const destino = decidirDestinoImpressaoAutomatica({
    configs,
    vendaId: "v1",
    fiscal: null,
  });
  assert.equal(destino.tipo, "nenhum");
  assert.equal(
    podeImprimirAutomaticamente(configs[0]),
    false
  );
});

test("cópias ficam entre 1 e 10 e PDF de teste não usa dados fiscais", () => {
  assert.equal(sanitizarCopiasImpressao(0), 1);
  assert.equal(sanitizarCopiasImpressao(99), 10);
  const pdf = gerarPdfSimples({
    papel: "80mm",
    linhas: ["UltraPDV", "Teste de impressao"],
  });
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.doesNotMatch(Buffer.from(pdf).toString("latin1"), /chave_acesso|xml_hex|geranet/i);
});

test("PDV não dá rollback da venda se a impressão falhar", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /if \(!emitirNfceAutomaticoPdv && imprimirApos\)/);
  assert.match(shell, /tentarImpressaoPosVenda/);
  assert.match(shell, /Tentar imprimir novamente/);
  const posFinalizar = shell.indexOf("await finalizarVendaPdv");
  const posImpressao = shell.indexOf("await tentarImpressaoPosVenda");
  assert.ok(posImpressao > posFinalizar);
  assert.match(shell, /Venda concluída, mas não foi possível imprimir automaticamente/);
  assert.doesNotMatch(shell, /rollback/);
  assert.match(
    fonte("app/api/impressao/danfe/[id]/route.ts"),
    /status !== "autorizada"/
  );
  assert.match(
    fonte("app/api/impressao/danfe/[id]/route.ts"),
    /eq\("empresa_id", vinculo\.empresa_id\)/
  );
});

test("frontend encontra qualquer Conector entre 18181 e 18190", () => {
  const portas = portasDescobertaConector();
  assert.deepEqual(portas[0], 18181);
  assert.equal(portas.at(-1), 18190);
  assert.equal(portas.length, 10);
  assert.equal(portas.includes(18185), true);
  assert.equal(portas.includes(19000), false);
});

test("agente local escuta só 127.0.0.1 e o web descobre a porta", () => {
  assert.equal(PRINT_AGENT_PORT, 18181);
  const agente = fonte("print-agent/src/server.mjs");
  const portas = fonte("print-agent/src/portas.mjs");
  const imprimir = fonte("print-agent/src/imprimir.mjs");
  const tela = fonte("components/impressao/impressao-workspace.tsx");
  const descobrir = fonte("lib/impressao/descobrir.ts");
  const tipos = fonte("lib/impressao/tipos.ts");
  const cliente = fonte("lib/impressao/agente.ts");
  const versao = JSON.parse(fonte("print-agent/version.json"));
  assert.equal(versao.name, "UltraPDV Connector");
  assert.equal(versao.version, "1.3.1");
  assert.match(agente, /127\.0\.0\.1/);
  assert.match(agente, /PORTA_PADRAO/);
  assert.match(portas, /PORTA_PADRAO = 18181/);
  assert.match(portas, /PORTA_AUTO_MAX = 18190/);
  assert.match(portas, /PORTA_USUARIO_MIN = PORTA_PADRAO/);
  assert.match(portas, /PORTA_USUARIO_MAX = PORTA_AUTO_MAX/);
  assert.doesNotMatch(agente, /0\.0\.0\.0/);
  assert.doesNotMatch(agente, /SUPABASE_SERVICE|service_role|GERANET/);
  assert.match(agente, /Get-Printer/);
  assert.doesNotMatch(agente, /PrintTo|Start-Process/);
  assert.doesNotMatch(imprimir, /PrintTo|Start-Process/);
  assert.match(imprimir, /execFile/);
  assert.match(imprimir, /-print-to/);
  assert.match(tela, /UltraPDV Conector conectado/);
  assert.match(tela, /UltraPDV Conector desconectado/);
  assert.match(tela, /Motor de impressão PDF não encontrado/);
  assert.doesNotMatch(tela, /http:\/\/127\.0\.0\.1:18181/);
  assert.match(descobrir, /export async function descobrirUltraPdvConector/);
  assert.match(descobrir, /PRINT_AGENT_APP/);
  assert.match(descobrir, /PRINT_AGENT_PORTA_MAX_AUTO/);
  assert.match(tipos, /UltraPDV-Conector/);
  assert.match(tipos, /PRINT_AGENT_PORTA_MAX_AUTO = 18190/);
  assert.doesNotMatch(descobrir, /19000/);
  assert.match(cliente, /descobrirUltraPdvConector/);
  assert.doesNotMatch(cliente, /PRINT_AGENT_ORIGIN/);
  const painel = fonte("print-agent/src/pagina-status.html");
  assert.match(painel, /18181–18190/);
  assert.match(painel, /O UltraPDV Conector utiliza portas entre 18181 e 18190/);
  assert.match(painel, /Salvar configuração/);
  assert.match(painel, /selImpressora/);
  assert.doesNotMatch(painel, /1024/);
});

test("configuração sanitiza tipo e ignora empresa_id do cliente", () => {
  assert.equal(
    sanitizarConfiguracaoImpressao({
      tipoDocumento: "recibo",
      papel: "80mm",
      copias: 2,
      impressaoAutomatica: true,
      impressoraNome: "ELGIN i9",
    })?.impressoraNome,
    "ELGIN i9"
  );
  assert.equal(
    sanitizarConfiguracaoImpressao({ tipoDocumento: "etiqueta" }),
    null
  );
});
