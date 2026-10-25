import assert from "node:assert/strict";
import test from "node:test";
import { fonte } from "../../multiempresa/fonte";
import {
  avaliarAutorizacaoProducao,
  decidirAmbienteCobranca,
  pinpadAprovadoNaCobranca,
} from "./habilitacao-producao";
import { modalidadeNativaPinpad } from "./modalidade-pinpad";
import { classificarServidorComercial, declaracaoRepeteServidorConfirmado, leituraConfirmaServidor } from "./servidor-comercial";

const empresa = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const terminal = "11111111-1111-4111-8111-111111111111";
const dispositivo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const completo = {
  administrador: true,
  credenciamentoComprovado: true,
  servidorValidado: true,
  pontoInstalado: true,
  pinpadAprovado: true,
  pendenciaFinanceira: false,
  empresaSessao: empresa,
  terminalId: terminal,
  dispositivoId: dispositivo,
};

test("repetir o mesmo servidor confirmado não apaga a confirmação", () => {
  assert.equal(declaracaoRepeteServidorConfirmado("loja.exemplo:31735", "LOJA.exemplo:31735", true), true);
  assert.equal(declaracaoRepeteServidorConfirmado("loja.exemplo:31735", "outra.exemplo:31735", true), false);
  assert.equal(declaracaoRepeteServidorConfirmado("loja.exemplo:31735", "loja.exemplo:31735", false), false);
});

test("endereço sintaticamente válido não comprova produção", () => {
  assert.equal(classificarServidorComercial("sandbox.exemplo:31735").ok, false);
  assert.equal(classificarServidorComercial("loja.exemplo").ok, false);
  assert.equal(classificarServidorComercial("https://loja.exemplo:31735").ok, false);
  const comercial = classificarServidorComercial("loja.exemplo:31735");
  assert.equal(comercial.ok, true);
  assert.equal(leituraConfirmaServidor("loja.exemplo:31735", "loja.exemplo:31735"), true);
  assert.equal(leituraConfirmaServidor("sandbox.exemplo:31735", "sandbox.exemplo:31735"), false);
  assert.equal(leituraConfirmaServidor("loja.exemplo:31735", "outro.exemplo:31735"), false);
});

test("pinpad aprovado só com retorno 0 no mesmo ponto, terminal e dispositivo", () => {
  const registro = {
    empresaId: empresa,
    terminalId: terminal,
    dispositivoId: dispositivo,
    journalInstalacao: "abc123",
    codigoNativo: 0,
    aprovado: true,
  };
  const base = { empresaId: empresa, terminalId: terminal, dispositivoId: dispositivo, journalInstalacao: "abc123", registro };
  assert.equal(pinpadAprovadoNaCobranca(base), true);
  assert.equal(pinpadAprovadoNaCobranca({ ...base, registro: { ...registro, codigoNativo: 1, aprovado: false } }), false);
  assert.equal(pinpadAprovadoNaCobranca({ ...base, dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }), false);
  assert.equal(pinpadAprovadoNaCobranca({ ...base, terminalId: "22222222-2222-4222-8222-222222222222" }), false);
  assert.equal(pinpadAprovadoNaCobranca({ ...base, journalInstalacao: "outro" }), false);
});

test("autorização exige as sete provas e escolher produção não autoriza", () => {
  assert.equal(avaliarAutorizacaoProducao(completo).pode, true);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, administrador: false }).pode, false);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, servidorValidado: false }).pode, false);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, pontoInstalado: false }).pode, false);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, pinpadAprovado: false }).pode, false);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, pendenciaFinanceira: true }).pode, false);
  assert.equal(avaliarAutorizacaoProducao({ ...completo, credenciamentoComprovado: false }).pode, false);
  const destino = decidirAmbienteCobranca({ ambienteEmpresa: "producao", liberada: false, comando: "vender" });
  assert.equal(destino.ok, false);
  const liberado = decidirAmbienteCobranca({ ambienteEmpresa: "producao", liberada: true, comando: "vender" });
  assert.equal(liberado.ok, true);
  if (liberado.ok) assert.equal(liberado.finalidade, "venda_producao");
  assert.equal(decidirAmbienteCobranca({ ambienteEmpresa: "producao", liberada: true, comando: "cancelar" }).ok, false);
  const debito = modalidadeNativaPinpad("debito");
  const credito = modalidadeNativaPinpad("credito");
  assert.equal(debito.ok && debito.modalidade === "2", true);
  assert.equal(credito.ok && credito.modalidade === "1", true);
  const pix = modalidadeNativaPinpad("pix");
  assert.equal(pix.ok && pix.modalidade === "", true);
  assert.equal(modalidadeNativaPinpad("voucher").ok, false);

  const servidor = fonte("lib/pdv/tef/politica-empresa-servidor.ts");
  const autorizacao = fonte("lib/pdv/tef/autorizacao-producao-servidor.ts");
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.doesNotMatch(servidor, /producao_autorizada:\s*true/);
  assert.match(autorizacao, /producao_autorizada:\s*true/);
  assert.match(autorizacao, /sessao\.empresaId/);
  assert.match(shell, /cobrancaProducao/);
  assert.match(shell, /classificarAmbienteDaConclusao/);
  assert.match(shell, /decidirEmissaoAposConfirmacao/);
  assert.match(fonte("app/pdv/actions.ts"), /ambienteMotor/);
  assert.doesNotMatch(shell, /let cobrancaProducao = false/);
  assert.match(shell, /if \(!cobrancaProducao\) suprimirNfceTef = true/);
});
