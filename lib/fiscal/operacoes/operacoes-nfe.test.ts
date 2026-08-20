import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

import {
  MENSAGEM_CFOP_NAO_CONFIGURADO,
  MENSAGEM_CFOP_NATUREZA_GRUPO_NAO_CONFIGURADO,
  MENSAGEM_IDENTIDADE_FISCAL_AUSENTE,
  MENSAGEM_NATUREZA_VENDA_AUSENTE,
  MENSAGEM_NATUREZA_VENDA_INVALIDA,
  MENSAGEM_OPERACAO_EM_DESENVOLVIMENTO,
  naturezaVendaFromTextoLegado,
} from "./catalogo";
import {
  normalizarRegrasCfopDaEmpresaAtiva,
  resolverCfopEfetivo,
} from "./resolver-cfop";
import {
  assertIdentidadeFiscalNfe,
  escolherNaturezaPadrao,
  escolherNaturezaParaVenda,
  naturezaEstaCompleta,
} from "./resolver-natureza";
import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  classificarOperacaoNfe,
  operacaoPodeChegarEmitir,
} from "./validar-operacao-nfe";

const naturezaVenda = {
  id: "nat-venda",
  empresa_id: "emp-1",
  tipo_operacao_interno: "venda",
  descricao: "Venda de mercadoria",
  tp_nf: "1",
  fin_nfe: "1",
  padrao: true,
  ativo: true,
};

function fonte(relativo: string) {
  return readFileSync(
    path.join(process.cwd(), relativo),
    "utf8"
  );
}

test("empresa migrada ganha natureza padrão de venda equivalente", () => {
  assert.deepEqual(
    naturezaVendaFromTextoLegado("Venda de mercadoria"),
    {
      tipo_operacao_interno: "venda",
      descricao: "Venda de mercadoria",
      tp_nf: "1",
      fin_nfe: "1",
      padrao: true,
      ativo: true,
    }
  );

  const migracao = fonte(
    "supabase/migrations/20260817200000_fiscal_naturezas_operacao.sql"
  );
  assert.match(migracao, /tipo_operacao_interno,\s*descricao,\s*tp_nf,\s*fin_nfe/);
  assert.match(migracao, /'venda'/);
  assert.match(migracao, /natureza_operacao_padrao/);
  assert.doesNotMatch(migracao, /drop column.*natureza_operacao_padrao/i);

  const builder = fonte(
    "lib/fiscal/geranet/montar-payload-nfe.ts"
  );
  assert.doesNotMatch(builder, /config\.tipo \?\?/);
  assert.doesNotMatch(builder, /config\.finalidade \?\?/);
  assert.match(builder, /exigirIdentidadeFiscalNfe/);
});

test("venda padrão sem regra nova continua no CFOP do grupo fiscal", () => {
  const interno = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-venda",
    grupoFiscalId: "grp-1",
    naturezaPadrao: true,
    empresaIdAtiva: "emp-1",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [],
  });
  const interestadual = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interestadual",
    naturezaId: "nat-venda",
    grupoFiscalId: "grp-1",
    naturezaPadrao: true,
    empresaIdAtiva: "emp-1",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [],
  });

  assert.equal(interno.ok, true);
  assert.equal(interestadual.ok, true);
  if (interno.ok) {
    assert.equal(interno.cfop, "5102");
    assert.equal(interno.origem, "grupo_fiscal_venda");
  }
  if (interestadual.ok) {
    assert.equal(interestadual.cfop, "6102");
  }
});

test("devolução sem regra de CFOP bloqueia e não inventa 1202", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_venda",
    tipoDestino: "interna",
    naturezaId: "nat-dev",
    grupoFiscal: {
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [],
  });

  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /Não existe regra de CFOP configurada/);
    assert.doesNotMatch(resultado.mensagem, /1202|5102/);
  }
  assert.doesNotMatch(JSON.stringify(resultado), /1202|5152/);
});

test("natureza ausente impede emissão de venda", () => {
  assert.equal(naturezaEstaCompleta(null), false);
  assert.equal(escolherNaturezaPadrao([], "venda", "emp-1"), null);
  const status = classificarOperacaoNfe({
    codigo: "venda",
    natureza: null,
    empresaIdAtiva: "emp-1",
  });
  assert.equal(status.podeChegarEmitir, false);
  assert.match(status.motivo, /natureza padrão de venda/i);
  assert.equal(
    MENSAGEM_NATUREZA_VENDA_AUSENTE.includes("Naturezas de operação"),
    true
  );
});

test("venda com natureza padrão fica disponível com tpNF 1 e finNFe 1", () => {
  const status = classificarOperacaoNfe({
    codigo: "venda",
    natureza: naturezaVenda,
    empresaIdAtiva: "emp-1",
  });
  assert.equal(status.disponivelParaEmissao, true);
  assert.equal(status.podeChegarEmitir, true);
  assert.match(status.motivo, /tpNF 1/);
  assert.match(status.motivo, /finNFe 1/);
});

test("natureza de outra empresa não é usada", () => {
  const outraEmpresa = {
    ...naturezaVenda,
    empresa_id: "emp-2",
  };
  assert.equal(
    registroPertenceAEmpresaAtiva(outraEmpresa, "emp-1"),
    false
  );
  assert.equal(
    escolherNaturezaPadrao([outraEmpresa], "venda", "emp-1"),
    null
  );
  assert.equal(naturezaEstaCompleta(outraEmpresa, "emp-1"), false);
  const status = classificarOperacaoNfe({
    codigo: "venda",
    natureza: outraEmpresa,
    empresaIdAtiva: "emp-1",
  });
  assert.equal(status.podeChegarEmitir, false);

  const isolamento = fonte(
    "supabase/migrations/20260817210000_fiscal_naturezas_mesma_empresa.sql"
  );
  assert.match(isolamento, /fiscal_assert_emissao_natureza_mesma_empresa/);
  assert.match(isolamento, /A natureza de operação não pertence à empresa da emissão/);
});

test("venda usa natureza escolhida na preparação, não outra empresa nem outro tipo", () => {
  const outra = {
    ...naturezaVenda,
    id: "nat-2",
    descricao: "Venda para entrega futura",
    padrao: false,
  };
  const escolhida = escolherNaturezaParaVenda({
    empresaIdAtiva: "emp-1",
    naturezaIdVenda: "nat-2",
    naturezas: [naturezaVenda, outra],
  });
  assert.equal(escolhida.ok, true);
  if (escolhida.ok) {
    assert.equal(escolhida.natureza.id, "nat-2");
    assert.equal(escolhida.origem, "venda");
  }

  const semEscolha = escolherNaturezaParaVenda({
    empresaIdAtiva: "emp-1",
    naturezaIdVenda: null,
    naturezas: [naturezaVenda, outra],
  });
  assert.equal(semEscolha.ok, true);
  if (semEscolha.ok) {
    assert.equal(semEscolha.natureza.id, "nat-venda");
    assert.equal(semEscolha.origem, "padrao");
  }

  const deOutraEmpresa = escolherNaturezaParaVenda({
    empresaIdAtiva: "emp-1",
    naturezaIdVenda: "nat-x",
    naturezas: [{ ...outra, id: "nat-x", empresa_id: "emp-2" }],
  });
  assert.equal(deOutraEmpresa.ok, false);
  if (!deOutraEmpresa.ok) {
    assert.equal(deOutraEmpresa.mensagem, MENSAGEM_NATUREZA_VENDA_INVALIDA);
  }

  const outroTipo = escolherNaturezaParaVenda({
    empresaIdAtiva: "emp-1",
    naturezaIdVenda: "nat-dev",
    naturezas: [
      {
        ...naturezaVenda,
        id: "nat-dev",
        tipo_operacao_interno: "devolucao_venda",
      },
    ],
  });
  assert.equal(outroTipo.ok, false);

  const inativa = escolherNaturezaParaVenda({
    empresaIdAtiva: "emp-1",
    naturezaIdVenda: "nat-inativa",
    naturezas: [
      {
        ...naturezaVenda,
        id: "nat-inativa",
        ativo: false,
        padrao: false,
      },
    ],
  });
  assert.equal(inativa.ok, false);
});

test("segunda natureza de venda usa CFOP da matriz e não o da venda padrão", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-ativo",
    grupoFiscalId: "grp-1",
    naturezaPadrao: false,
    naturezaDescricao: "Venda de ativo imobilizado",
    empresaIdAtiva: "emp-1",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-ativo",
        grupoFiscalId: "grp-1",
        tipoDestino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
  });

  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.equal(resultado.cfop, "5551");
    assert.equal(resultado.origem, "regra_natureza");
  }
});

test("segunda natureza de venda sem regra bloqueia e não herda CFOP da venda padrão", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-ativo",
    grupoFiscalId: "grp-1",
    naturezaPadrao: false,
    naturezaDescricao: "Venda de ativo imobilizado",
    empresaIdAtiva: "emp-1",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [],
  });

  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, new RegExp(MENSAGEM_CFOP_NATUREZA_GRUPO_NAO_CONFIGURADO));
    assert.match(resultado.mensagem, /Venda de ativo imobilizado/);
    assert.match(resultado.mensagem, /Produtos/);
    assert.match(resultado.mensagem, /Interna/);
    assert.match(resultado.mensagem, /não configurado/i);
  }
  assert.doesNotMatch(JSON.stringify(resultado), /5102|6102/);
});

test("regra de CFOP de outra empresa não vaza na resolução", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-ativo",
    grupoFiscalId: "grp-1",
    naturezaPadrao: false,
    empresaIdAtiva: "emp-1",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [
      {
        empresaId: "emp-2",
        naturezaId: "nat-ativo",
        grupoFiscalId: "grp-1",
        tipoDestino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
  });

  assert.equal(resultado.ok, false);
  const filtradas = normalizarRegrasCfopDaEmpresaAtiva(
    [
      {
        empresa_id: "emp-2",
        natureza_id: "nat-ativo",
        grupo_fiscal_id: "grp-1",
        tipo_destino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
    "emp-1"
  );
  assert.equal(filtradas.length, 0);
});

test("seletor Preparar NF-e lista só venda ativa da empresa e backend rejeita o restante", () => {
  const pagina = fonte("app/vendas/[id]/nfe/page.tsx");
  assert.match(pagina, /tipo_operacao_interno["',\s]*venda/);
  assert.match(pagina, /\.eq\(\s*"ativo",\s*true\s*\)/);
  assert.match(pagina, /natureza\.tipo_operacao_interno === "venda"/);
  assert.match(pagina, /natureza\.ativo/);
  assert.doesNotMatch(
    pagina.slice(
      pagina.indexOf("fiscal_naturezas_operacao"),
      pagina.indexOf("transportadoras")
    ),
    /devolucao|transferencia|remessa/
  );

  const api = fonte("app/api/vendas/[id]/natureza/route.ts");
  assert.match(api, /\.eq\(\s*"empresa_id",\s*empresaId\s*\)/);
  assert.match(api, /\.eq\(\s*"tipo_operacao_interno",\s*"venda"\s*\)/);
  assert.match(api, /\.eq\(\s*"ativo",\s*true\s*\)/);
  assert.match(api, /tipo_operacao_interno !== "venda"/);
  assert.match(api, /ativo !== true/);
  assert.match(api, /registroPertenceAEmpresaAtiva/);
});

test("matriz de CFOP é por empresa, natureza, grupo e destino, com RLS de acesso", () => {
  const migracao = fonte(
    "supabase/migrations/20260817230000_fiscal_natureza_cfop_regras_matriz.sql"
  );
  assert.match(migracao, /grupo_fiscal_id set not null/);
  assert.match(
    migracao,
    /unique \(empresa_id, natureza_id, grupo_fiscal_id, tipo_destino\)/
  );
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /fiscal_natureza_cfop_regras_insert_empresa/);
  assert.match(migracao, /fiscal_natureza_cfop_regras_update_empresa/);
  assert.match(migracao, /fiscal_natureza_cfop_regras_delete_empresa/);
  assert.match(migracao, /A natureza de operação precisa estar ativa/);
  assert.doesNotMatch(migracao, /5102|5551|1202|5152/);

  const isolamento = fonte(
    "supabase/migrations/20260817210000_fiscal_naturezas_mesma_empresa.sql"
  );
  assert.match(isolamento, /fiscal_assert_cfop_regra_mesma_empresa/);
  assert.match(isolamento, /A regra de CFOP deve usar natureza da mesma empresa/);
  assert.match(isolamento, /A regra de CFOP deve usar grupo fiscal da mesma empresa/);
});

test("nota de crédito e débito não chegam em /nfe/emitir", () => {
  for (const codigo of ["nota_credito", "nota_debito"] as const) {
    const status = classificarOperacaoNfe({ codigo });
    assert.equal(status.status, "em_desenvolvimento");
    assert.equal(status.podeChegarEmitir, false);
    assert.equal(operacaoPodeChegarEmitir(codigo), false);
    assert.equal(status.motivo, MENSAGEM_OPERACAO_EM_DESENVOLVIMENTO);
  }

  const wizard = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  assert.doesNotMatch(wizard, /\/api\/v1\/nfe\/emitir/);
  assert.match(wizard, /nfe-emitir-operacao/);
  assert.match(wizard, /Validar NF-e/);
  assert.match(wizard, /Emitir NF-e/);
  assert.doesNotMatch(wizard, /nfce-emitir-venda/);
  assert.doesNotMatch(wizard, /criarOperacaoFiscal\(\{ tipo: "remessa"/);

  const finalidade = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(finalidade, /export type FinalidadeNfe =\s*\n?\s*\| "1"\s*\n?\s*\| "2"\s*\n?\s*\| "3"\s*\n?\s*\| "4"/);
  assert.doesNotMatch(
    finalidade.slice(
      finalidade.indexOf("export type FinalidadeNfe"),
      finalidade.indexOf("export type ModalidadeFreteNfe")
    ),
    /"5"|"6"/
  );
});

test("identidade fiscal ausente bloqueia em vez de assumir 1", () => {
  assert.throws(
    () =>
      assertIdentidadeFiscalNfe({
        naturezaId: "",
        descricao: "Venda",
        tpNf: "1",
        finNfe: "1",
      }),
    (error: Error) => error.message === MENSAGEM_IDENTIDADE_FISCAL_AUSENTE
  );
  assert.throws(
    () =>
      assertIdentidadeFiscalNfe({
        naturezaId: "nat-1",
        descricao: "Venda",
        tpNf: null,
        finNfe: "1",
      }),
    (error: Error) => error.message === MENSAGEM_IDENTIDADE_FISCAL_AUSENTE
  );
});

test("fluxo de venda resolve natureza, tpNF, finNFe e não hardcodifica 1 no payload", () => {
  const emitirVenda = fonte(
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts"
  );
  assert.match(emitirVenda, /MENSAGEM_NATUREZA_VENDA_AUSENTE/);
  assert.match(emitirVenda, /identidadeEmissao\.tpNf/);
  assert.match(emitirVenda, /identidadeEmissao\.finNfe/);
  assert.match(emitirVenda, /identidadeEmissao\.descricao/);
  assert.match(emitirVenda, /tipo_operacao_interno:\s*"venda"/);
  assert.match(emitirVenda, /resolverCfopEfetivo/);
  assert.match(emitirVenda, /venda\.natureza_id/);
  assert.match(emitirVenda, /MENSAGEM_NATUREZA_VENDA_INVALIDA/);
  assert.match(emitirVenda, /naturezaPadrao/);
  assert.match(emitirVenda, /fiscal_natureza_cfop_regras/);
  assert.match(
    fonte("app/vendas/[id]/nfe/page.tsx"),
    /NaturezaOperacaoVendaForm/
  );
  assert.match(
    fonte("app/vendas/[id]/nfe/page.tsx"),
    /fiscal_natureza_cfop_regras/
  );
  assert.match(
    fonte("app/configuracoes/fiscal/naturezas/natureza-operacao-form.tsx"),
    /Regras de CFOP/
  );
});

test("reconciliação e anti-retransmissão não foram alteradas nesta etapa", () => {
  const emitirVenda = fonte(
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts"
  );
  assert.match(emitirVenda, /claimTentativaEmissaoFiscal/);
  assert.match(emitirVenda, /persistenciaFalhaComunicacaoEmitir/);
  assert.match(emitirVenda, /mensagemBloqueioEmissao/);
  assert.match(emitirVenda, /chamarGeranet/);
  assert.match(emitirVenda, /\/api\/v1\/nfe\/emitir/);

  const classificar = fonte(
    "lib/fiscal/geranet/classificar-emissao.ts"
  );
  assert.match(classificar, /MENSAGEM_BLOQUEIO_RETRANSMISSAO/);
  assert.match(classificar, /emissaoBloqueiaRetransmissao/);

  const cliente = fonte(
    "lib/fiscal/geranet/cliente-geranet.ts"
  );
  assert.match(cliente, /transmissaoPodeTerSaido/);
  assert.match(cliente, /aguardando_reconciliacao/);
});
