import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { resolverEstadoOperacionalFiscal } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  acoesEmissaoFiscal,
  classificarRespostaEmitir,
  mensagemReconciliacaoInconclusiva,
} from "@/lib/fiscal/geranet/classificar-emissao";
import {
  classificarLogEmitir,
  decidirStatusLocal,
  EmissaoParaConsulta,
  LogGeranetResumo,
  montarAtualizacaoEmissao,
  reconciliacaoMaterialmenteIgual,
} from "@/lib/fiscal/geranet/classificar-consulta";
import { motivoBloqueioInutilizacao } from "@/lib/fiscal/geranet/classificar-inutilizacao";

const CHAVE = "51260812345678000155550010000000111234567890";

function emissao(
  parcial: Partial<EmissaoParaConsulta> = {}
): EmissaoParaConsulta {
  return {
    id: "e-pendente",
    modelo: "55",
    serie: 1,
    numero: 10,
    ambiente: 1,
    status: "aguardando_reconciliacao",
    codigo_numerico: "12345678",
    chave_acesso: CHAVE,
    ...parcial,
  };
}

function log(parcial: Partial<LogGeranetResumo> = {}): LogGeranetResumo {
  return {
    id: 90,
    endpoint: "nfe/emitir",
    criado_em: "2026-09-28T15:04:00.000Z",
    http_status: 200,
    sucesso: true,
    chave: CHAVE,
    protocolo: "151260000000010",
    cstat: "100",
    numero: "10",
    situacao: "sucesso",
    mensagem: "Autorizado o uso da NF-e",
    xml: "3c6e666550726f63",
    pdf: "25504446",
    modelo: "55",
    serie: "1",
    ambiente: "1",
    codigo_numerico: "12345678",
    numero_venda: null,
    contingencia: "nao",
    ...parcial,
  };
}

const HOST_NOT_FOUND = [
  "HTTP 500",
  "URL: https://nfe.sefaz.mt.gov.br/nfews/v4/services/NfeAutorizacao4",
  "Host not found",
].join("\n");

test("a) pendente consulta autorizada grava protocolo sem nova numeração", () => {
  const atual = emissao();
  const encontrado = log();
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
  });

  assert.equal(situacao, "autorizada");
  assert.equal(resultado.status_local, "autorizada");
  assert.equal(resultado.patch.chave_acesso, CHAVE);
  assert.equal(resultado.patch.protocolo, "151260000000010");
  assert.equal(resultado.patch.cstat, "100");
  assert.equal(resultado.patch.xml_hex, "3c6e666550726f63");
  assert.equal(resultado.patch.serie, undefined);
  assert.equal(resultado.patch.numero, undefined);
  assert.equal(resultado.patch.autorizada_at, "2026-09-28T15:04:00.000Z");
  assert.equal(
    JSON.stringify(resultado.patch).includes("/nfe/emitir"),
    false
  );
});

test("b) cStat 217 com NF-e posterior habilita inutilização e não retransmite", () => {
  const atual = emissao();
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    http_status: 422,
    protocolo: null,
    cstat: "217",
    mensagem: "Rejeição 217: NF-e não consta na base de dados da SEFAZ",
    xml: null,
    pdf: null,
  });
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
    posteriorAutorizada: true,
  });
  const resumo = resultado.patch.resposta_resumo as {
    inexistencia_confirmada?: boolean;
    quebra_sequencia?: boolean;
  };

  assert.equal(situacao, "nao_existe");
  assert.equal(resultado.status_local, "aguardando_inutilizacao");
  assert.equal(resultado.patch.cstat, "217");
  assert.equal(resumo.inexistencia_confirmada, true);
  assert.equal(resumo.quebra_sequencia, true);
  assert.equal(resultado.patch.serie, undefined);
  assert.equal(resultado.patch.numero, undefined);
  assert.equal(resultado.patch.chave_acesso, undefined);
  assert.equal(
    motivoBloqueioInutilizacao({
      id: atual.id,
      modelo: "55",
      serie: 1,
      numero: 10,
      ambiente: 1,
      status: resultado.status_local,
    }),
    null
  );
});

test("c) HTTP 500 NfeAutorizacao4 Host not found permanece inconclusivo", () => {
  const atual = emissao({
    motivo: HOST_NOT_FOUND,
    erro_comunicacao: HOST_NOT_FOUND,
    geranet_http_status: 500,
  });
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    http_status: 500,
    protocolo: null,
    cstat: null,
    mensagem: HOST_NOT_FOUND,
    xml: "3c7265717569736963616f",
    pdf: null,
  });
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
    posteriorAutorizada: true,
  });

  assert.equal(situacao, "inconclusiva");
  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(
    resultado.mensagem,
    mensagemReconciliacaoInconclusiva("55")
  );
  assert.equal(resultado.patch.xml_hex, undefined);
  assert.equal(resultado.patch.serie, undefined);
  assert.equal(resultado.patch.numero, undefined);
  assert.equal(
    (resultado.patch.resposta_resumo as { quebra_sequencia?: boolean })
      .quebra_sequencia,
    true
  );
  assert.equal(
    (resultado.patch.resposta_resumo as { inexistencia_confirmada?: boolean })
      .inexistencia_confirmada,
    false
  );

  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: resultado.status_local,
    resposta_resumo: resultado.patch.resposta_resumo,
    cstat: null,
    motivo: String(resultado.patch.motivo),
    chave_acesso: CHAVE,
    erro_comunicacao: HOST_NOT_FOUND,
    geranet_http_status: 500,
  });
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.acaoPrincipal, "reconciliar");
  assert.equal(
    classificarRespostaEmitir({
      httpStatus: 500,
      mensagem: HOST_NOT_FOUND,
      chave: CHAVE,
    }),
    "aguardando_reconciliacao"
  );
});

test("d) segunda reconciliação idêntica não altera chave, número nem protocolo", () => {
  const atual = emissao({
    status: "autorizada",
    protocolo: "151260000000010",
    autorizada_at: "2026-09-28T15:04:00.000Z",
    xml_hex: "xml-ja-salvo",
  });
  const encontrado = log({ xml: "outro-xml", protocolo: "999" });
  const primeira = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: classificarLogEmitir(encontrado, atual),
    log: encontrado,
    origem: "manual",
  });
  const segunda = montarAtualizacaoEmissao({
    emissao: {
      ...atual,
      status: primeira.status_local,
      protocolo: String(primeira.patch.protocolo ?? atual.protocolo),
    },
    situacao: "autorizada",
    log: encontrado,
    origem: "manual",
  });

  assert.equal(primeira.status_local, "autorizada");
  assert.equal(primeira.patch.protocolo, undefined);
  assert.equal(primeira.patch.chave_acesso, CHAVE);
  assert.equal(primeira.patch.xml_hex, undefined);
  assert.equal(segunda.status_local, "autorizada");
  assert.equal(segunda.patch.numero, undefined);
  assert.equal(segunda.patch.serie, undefined);
  assert.equal(
    reconciliacaoMaterialmenteIgual(
      {
        status: "autorizada",
        cstat: "100",
        protocolo: "151260000000010",
        situacao: "autorizada",
      },
      {
        status: segunda.status_local,
        cstat: segunda.cstat,
        protocolo: "151260000000010",
        situacao: "autorizada",
      }
    ),
    true
  );
  assert.equal(
    decidirStatusLocal("inutilizada", "inconclusiva"),
    "inutilizada"
  );
  assert.equal(
    decidirStatusLocal("inutilizada", "nao_existe", {
      posteriorAutorizada: true,
    }),
    "inutilizada"
  );
});

test("e) NF-e posterior autorizada bloqueia retransmissão da anterior pendente", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    resposta_resumo: { quebra_sequencia: true },
    motivo: "falha antes do POST",
  });
  const acoes = acoesEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    resposta_resumo: { quebra_sequencia: true },
    motivo: "falha antes do POST",
  });

  assert.equal(estado.podeRetry, false);
  assert.equal(estado.acaoPrincipal, "reconciliar");
  assert.equal(estado.bloqueiaRetransmissao, true);
  assert.equal(acoes.podeRetransmitir, false);
});

test("f) inutilização só depois da inexistência confirmada", () => {
  const pendente = {
    id: "e-pendente",
    modelo: "55",
    serie: 1,
    numero: 10,
    ambiente: 1,
    status: "aguardando_reconciliacao",
  };
  assert.match(
    motivoBloqueioInutilizacao(pendente) ?? "",
    /consulte a situação fiscal/i
  );

  const confirmada = montarAtualizacaoEmissao({
    emissao: emissao(),
    situacao: "nao_existe",
    log: log({
      sucesso: false,
      situacao: "erro",
      http_status: 200,
      protocolo: null,
      cstat: "217",
      mensagem: "Rejeição 217: NF-e não consta na base de dados da SEFAZ",
      xml: null,
      pdf: null,
    }),
    origem: "manual",
    posteriorAutorizada: false,
  });
  assert.equal(confirmada.status_local, "rejeitada");
  assert.notEqual(confirmada.status_local, "aguardando_inutilizacao");
  assert.match(
    motivoBloqueioInutilizacao({
      ...pendente,
      status: confirmada.status_local,
    }) ?? "",
    /aguardando inutilização/i
  );

  const fonte = readFileSync(
    join(process.cwd(), "lib/fiscal/reconciliar-emissao.ts"),
    "utf8"
  );
  assert.match(fonte, /acao: "reconciliar_nfe"/);
  assert.doesNotMatch(fonte, /\/api\/v1\/nfe\/emitir/);
  assert.match(fonte, /texto\(emissao\.status\) === "inutilizada"/);
  assert.match(fonte, /Nenhuma nova inutilização foi enviada/);
});
