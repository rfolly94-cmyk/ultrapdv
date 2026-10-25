import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO } from "./tef-pgweb.mjs";
import {
  assinarAutorizacaoOperacao,
  concederAutorizacaoOperacao,
  consultarAutorizacaoOperacao,
  consumirAutorizacaoOperacao,
  esquecerMenuConector,
  DETALHES_SESSAO,
  prepararTransporteHomologacao,
  registrarBloqueioResultadoDesconhecido,
  reservarOperacaoCom7,
} from "./tef-menu-conector.mjs";

const par = generateKeyPairSync("ed25519");
const publica = par.publicKey.export({ type: "spki", format: "pem" });
const privada = par.privateKey.export({ type: "pkcs8", format: "pem" });
const agora = 1_800_000_000_000;
const dispositivo = "33333333-3333-4333-8333-333333333333";
const outroDispositivo = "44444444-4444-4444-8444-444444444444";

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    empresaId: "empresa-a",
    dispositivoId: dispositivo,
    terminalCodigo: "caixa-lab",
    posid: "ponto-lab",
    valorCentavos: 100,
    idempotencyKey: "op-prep-1",
    expiraEm: agora + 60_000,
    ...extra,
  };
}

function bibliotecaEspia() {
  const estado = { chamadas: 0 };
  return {
    estado,
    biblioteca: {
      residente: true,
      homologacao: true,
      origem: "conector",
      newTransac() {
        estado.chamadas += 1;
        throw new Error("PW_iNewTransac");
      },
    },
  };
}

function preparar(base, assinatura = assinarAutorizacaoOperacao(privada, base), biblioteca = bibliotecaEspia()) {
  const resultado = prepararTransporteHomologacao({
    pedido: base,
    assinatura,
    chavePublicaPem: publica,
    agora,
    entrada: {
      journal: { seguir: true },
      pontoInstalado: true,
      dllOk: true,
      biblioteca: biblioteca.biblioteca,
    },
  });
  return { resultado, biblioteca };
}

test("autorização válida seleciona o transporte nativo sem iniciar transação", () => {
  esquecerMenuConector();
  const base = pedido();
  const { resultado, biblioteca } = preparar(base);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.codigo, "preparada");
  assert.equal(resultado.nativo, true);
  assert.equal(resultado.simulacao, false);
  assert.equal(resultado.transacaoIniciada, false);
  assert.equal(resultado.execucaoFisica, false);
  assert.equal(resultado.comandoDll, false);
  assert.equal(resultado.reservaTomada, false);
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(biblioteca.estado.chamadas, 0);
  assert.equal(consultarAutorizacaoOperacao(base, agora).ok, true);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
  const repetida = preparar(base);
  assert.equal(repetida.resultado.codigo, "preparada");
  assert.equal(repetida.biblioteca.estado.chamadas, 0);
  esquecerMenuConector();
});

test("autorização ausente, expirada, reutilizada ou alterada é recusada sem PW_iNewTransac", () => {
  esquecerMenuConector();
  const base = pedido({ idempotencyKey: "op-prep-recusa" });
  const ausente = preparar(base, "");
  assert.equal(ausente.resultado.codigo, "ausente");
  assert.equal(ausente.resultado.nativo, false);
  assert.equal(ausente.biblioteca.estado.chamadas, 0);

  const expirada = preparar(pedido({ idempotencyKey: "op-prep-expira", expiraEm: agora - 1 }));
  assert.equal(expirada.resultado.codigo, "expirada");
  assert.equal(expirada.biblioteca.estado.chamadas, 0);

  const primeira = preparar(base);
  assert.equal(primeira.resultado.codigo, "preparada");
  consumirAutorizacaoOperacao(base);
  const reutilizada = preparar(base);
  assert.equal(reutilizada.resultado.codigo, "consumida");
  assert.equal(reutilizada.biblioteca.estado.chamadas, 0);

  const empresa = preparar(pedido({ idempotencyKey: "op-prep-empresa" }));
  assert.equal(empresa.resultado.codigo, "preparada");
  const outraEmpresa = preparar(pedido({ idempotencyKey: "op-prep-empresa", empresaId: "empresa-b" }));
  assert.equal(outraEmpresa.resultado.codigo, "empresa");
  assert.equal(outraEmpresa.biblioteca.estado.chamadas, 0);

  const dispositivoBase = preparar(pedido({ idempotencyKey: "op-prep-dispositivo" }));
  assert.equal(dispositivoBase.resultado.codigo, "preparada");
  const dispositivoTrocado = preparar(pedido({ idempotencyKey: "op-prep-dispositivo", dispositivoId: outroDispositivo }));
  assert.equal(dispositivoTrocado.resultado.codigo, "dispositivo");

  const posidBase = preparar(pedido({ idempotencyKey: "op-prep-posid" }));
  assert.equal(posidBase.resultado.codigo, "preparada");
  const posidTrocado = preparar(pedido({ idempotencyKey: "op-prep-posid", posid: "ponto-errado" }));
  assert.equal(posidTrocado.resultado.codigo, "posid");

  const valorBase = preparar(pedido({ idempotencyKey: "op-prep-valor" }));
  assert.equal(valorBase.resultado.codigo, "preparada");
  const valorTrocado = preparar(pedido({ idempotencyKey: "op-prep-valor", valorCentavos: 250 }));
  assert.equal(valorTrocado.resultado.codigo, "valor");

  const assinatura = assinarAutorizacaoOperacao(privada, base);
  const chaveTrocada = preparar({ ...base, idempotencyKey: "op-prep-outra" }, assinatura);
  assert.equal(chaveTrocada.resultado.codigo, "assinatura");
  assert.equal(chaveTrocada.resultado.nativo, false);
  assert.equal(chaveTrocada.biblioteca.estado.chamadas, 0);

  const producao = preparar(pedido({ idempotencyKey: "op-prep-prod", ambiente: "producao" }));
  assert.equal(producao.resultado.codigo, "ambiente");
  assert.equal(producao.biblioteca.estado.chamadas, 0);
  esquecerMenuConector();
});

test("COM7 ocupada e resultado desconhecido impedem nova preparação", () => {
  esquecerMenuConector();
  const ocupante = pedido({ idempotencyKey: "op-prep-ocupada" });
  assert.equal(concederAutorizacaoOperacao(ocupante, { servidor: true }).codigo, "concedida");
  assert.equal(reservarOperacaoCom7(ocupante).ok, true);
  const bloqueada = preparar(pedido({ idempotencyKey: "op-prep-livre" }));
  assert.equal(bloqueada.resultado.codigo, "ocupada");
  assert.equal(bloqueada.resultado.nativo, false);
  assert.equal(bloqueada.resultado.novaCobranca, false);
  assert.equal(bloqueada.biblioteca.estado.chamadas, 0);
  esquecerMenuConector();

  registrarBloqueioResultadoDesconhecido("empresa-a", "caixa-lab");
  const desconhecida = preparar(pedido({ idempotencyKey: "op-prep-desconhecida" }));
  assert.equal(desconhecida.resultado.codigo, "desconhecido");
  assert.equal(desconhecida.resultado.novaCobranca, false);
  assert.equal(desconhecida.resultado.journalApagado, false);
  assert.equal(desconhecida.resultado.pagamentoRecebido, false);
  assert.equal(desconhecida.biblioteca.estado.chamadas, 0);
  esquecerMenuConector();
});

test("autorização válida sem sessão residente para em sessao e informa a mensagem", () => {
  esquecerMenuConector();
  const base = pedido({ idempotencyKey: "op-prep-sessao" });
  const resultado = prepararTransporteHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    entrada: { journal: { seguir: true }, pontoInstalado: true, dllOk: true, biblioteca: null },
  });
  assert.equal(resultado.codigo, "sessao");
  assert.equal(resultado.causa, "ausente");
  assert.equal(resultado.mensagem, `A sessão nativa residente não está disponível. ${DETALHES_SESSAO.ausente}`);
  assert.equal(resultado.nativo, false);
  assert.equal(resultado.execucaoFisica, false);
  assert.equal(resultado.comandoDll, false);
  assert.equal(resultado.transacaoIniciada, false);
  esquecerMenuConector();
});

test("a rota de menu devolve a preparação antes de atender a transação", () => {
  const server = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  const inicioRota = server.indexOf('url.pathname === "/tef/homologacao/menu"');
  const fimRota = server.indexOf('url.pathname === "/tef/homologacao/pinpad"', inicioRota);
  const menu = server.slice(inicioRota, fimRota);
  const inicio = menu.indexOf('if (payloadMenu.acao === "iniciar")');
  const retorno = menu.indexOf("return;", inicio);
  const atender = menu.indexOf("atenderMenuConector(", inicio);
  assert.ok(inicio > 0);
  assert.ok(retorno > inicio);
  assert.ok(atender > retorno);
  assert.equal(menu.includes("PW_iNewTransac"), false);
  assert.match(menu, /prepararTransporteHomologacao/);
});
