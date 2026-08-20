import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import { sanitizarPayloadTentativaFiscal } from "@/lib/fiscal/emissao-tentativas";
import {
  mapearResponsavelTecnicoGeranet,
  MENSAGEM_RESPONSAVEL_TECNICO_CNPJ_INVALIDO,
  responsavelTecnicoDoCadastroFiscal,
  validarResponsavelTecnicoCadastro,
} from "./responsavel-tecnico";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const rtOk = {
  cnpj: "42.741.754/0001-42",
  contato: "Suporte UltraPDV",
  email: "suporte@exemplo.com",
  fone: "6533334444",
  idCSRT: "01",
  CSRT: "CSRT-SECRETO-ABC",
};

function payloadBase(
  responsavelTecnico?: {
    cnpj: string;
    contato: string;
    email: string;
    fone: string;
    idCSRT?: string;
    CSRT?: string;
  } | null
) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT",
    senhaCertificadoDigital: "SENHA",
    emitente: {
      cnpj: "42741754000142",
      inscricaoEstadual: "138856729",
      razaoSocial: "EMPRESA TESTE",
      logradouro: "Rua A",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
      codigoRegimeTributario: 1,
    },
    destinatario: {
      cpf: "52998224725",
      consumidorFinal: "1",
      indicadorIEdestinatario: "9",
      logradouro: "Rua B",
      numero: "2",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
    },
    config: {
      serie: 1,
      numeroNota: 1,
      codigoNumerico: "12345678",
      dataSaida: "2026-08-19 12:00:00",
      dataEmissao: "2026-08-19 12:00:00",
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: {
      troco: 0,
      detalhamento: [{ tipo: "01", valor: 10, indicadorPagamento: "0" }],
    },
    responsavelTecnico,
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  });
}

test("sem configuração válida o bloco nfe.responsavelTecnico é omitido", () => {
  const nfe = (payloadBase() as { nfe: Record<string, unknown> }).nfe;
  assert.equal("responsavelTecnico" in nfe, false);
  assert.equal(mapearResponsavelTecnicoGeranet({}), null);
  assert.equal(
    responsavelTecnicoDoCadastroFiscal({
      fiscal: {},
      csrt: "CSRT-SECRETO-ABC",
    }),
    null
  );
});

test("payload Geranet usa só cnpj, contato, email, fone, idCSRT e CSRT", () => {
  const nfe = (
    payloadBase(rtOk) as {
      nfe: { responsavelTecnico: Record<string, string> };
    }
  ).nfe;
  assert.deepEqual(Object.keys(nfe.responsavelTecnico).sort(), [
    "CSRT",
    "cnpj",
    "contato",
    "email",
    "fone",
    "idCSRT",
  ]);
  assert.equal(nfe.responsavelTecnico.cnpj, "42741754000142");
  assert.equal(nfe.responsavelTecnico.contato, "Suporte UltraPDV");
  assert.equal(nfe.responsavelTecnico.email, "suporte@exemplo.com");
  assert.equal(nfe.responsavelTecnico.fone, "6533334444");
  assert.equal(nfe.responsavelTecnico.idCSRT, "01");
  assert.equal(nfe.responsavelTecnico.CSRT, "CSRT-SECRETO-ABC");
});

test("idCSRT e CSRT só entram juntos; cadastro incompleto não vai para a Geranet", () => {
  const semCsrt = mapearResponsavelTecnicoGeranet({
    ...rtOk,
    CSRT: "",
  });
  assert.equal(semCsrt?.cnpj, "42741754000142");
  assert.equal("CSRT" in (semCsrt ?? {}), false);
  assert.equal("idCSRT" in (semCsrt ?? {}), false);
  assert.equal(
    validarResponsavelTecnicoCadastro({ cnpj: "123" }),
    MENSAGEM_RESPONSAVEL_TECNICO_CNPJ_INVALIDO
  );
});

test("CSRT não permanece no payload sanitizado", () => {
  const limpo = sanitizarPayloadTentativaFiscal(payloadBase(rtOk));
  const json = JSON.stringify(limpo);
  assert.doesNotMatch(json, /CSRT-SECRETO-ABC/);
  assert.doesNotMatch(json, /"CSRT"/);
});

test("configuração é por empresa, CSRT vai ao cofre e emissão lê empresas_fiscal + vault", () => {
  const migracao = fonte(
    "supabase/migrations/20260819130000_nfe_responsavel_tecnico.sql"
  );
  const action = fonte("app/configuracoes/fiscal/actions.ts");
  const pagina = fonte("app/configuracoes/fiscal/page.tsx");
  const emitirOp = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirDevolucao = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  const payload = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(migracao, /responsavel_tecnico_cnpj/);
  assert.match(migracao, /csrt_secret_id/);
  assert.match(migracao, /salvar_csrt_fiscal/);
  assert.match(migracao, /obter_csrt_fiscal/);
  assert.match(migracao, /ultrapdv:' \|\| p_empresa_id::text \|\| ':csrt'/);
  assert.match(migracao, /eh_admin_empresa\(p_empresa_id\)/);
  assert.match(migracao, /REVOKE ALL ON FUNCTION public\.obter_csrt_fiscal/);
  assert.match(action, /salvar_csrt_fiscal/);
  assert.match(action, /p_empresa_id: empresaId/);
  assert.doesNotMatch(action, /p_empresa_id: formData/);
  assert.doesNotMatch(action, /console\.(log|info|debug).*rtCsrt/);
  assert.match(pagina, /Responsável técnico/);
  assert.match(pagina, /name="responsavel_tecnico_csrt"/);
  assert.match(pagina, /type="password"/);
  assert.match(emitirOp, /obter_csrt_fiscal/);
  assert.match(emitirOp, /responsavelTecnicoDoCadastroFiscal/);
  assert.match(emitirVenda, /obter_csrt_fiscal/);
  assert.match(emitirVenda, /responsavelTecnicoDoCadastroFiscal/);
  assert.match(emitirDevolucao, /obter_csrt_fiscal/);
  assert.match(emitirDevolucao, /responsavelTecnicoDoCadastroFiscal/);
  assert.match(payload, /responsavelTecnico:\s*\n\s*responsavelTecnicoGeranet/);
  assert.doesNotMatch(pagina, /42741754000142/);
  assert.doesNotMatch(action, /42741754000142/);
});
