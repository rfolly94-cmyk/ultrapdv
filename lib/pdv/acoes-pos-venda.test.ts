import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  resolverAcoesPosVendaPdv,
  type EntradaAcoesPosVenda,
  type FiscalPosVenda,
} from "./acoes-pos-venda";

const vendaId = "venda-1";

function entrada(
  extra: Partial<EntradaAcoesPosVenda> & {
    fiscal?: FiscalPosVenda | null;
  }
): EntradaAcoesPosVenda {
  return {
    emitirNfceAutomatico: true,
    vendaId,
    imprimirApos: true,
    fiscal: extra.fiscal ?? null,
    ...extra,
  };
}

function fiscal(
  extra: Partial<FiscalPosVenda>
): FiscalPosVenda {
  return {
    emitindo: false,
    kind: null,
    status: null,
    mensagem: "",
    emissaoId: null,
    danfeDisponivel: false,
    ...extra,
  };
}

test("1. configuração ativa + NFC-e autorizada = mostra Imprimir NFC-e", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "autorizada",
        status: "autorizada",
        mensagem: "Autorizada",
        emissaoId: "em-1",
        danfeDisponivel: true,
      }),
    })
  );

  assert.equal(acoes.rotuloFiscal, "NFC-e autorizada");
  assert.equal(acoes.mostrarImprimirNfce, true);
  assert.equal(acoes.mostrarImprimirReciboNormal, false);
  assert.equal(acoes.hrefDanfe, "/api/fiscal/emissoes/em-1/arquivo?tipo=pdf");
  assert.equal(acoes.autoAbrir, "danfe");
  assert.equal(acoes.podeReenviarNfce, false);
});

test("2. configuração ativa + NFC-e rejeitada = mostra Imprimir recibo normal", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "rejeitada",
        status: "rejeitada",
        mensagem: "Rejeitada pela SEFAZ",
        emissaoId: "em-2",
      }),
    })
  );

  assert.equal(acoes.rotuloFiscal, "NFC-e rejeitada");
  assert.equal(acoes.mostrarImprimirNfce, false);
  assert.equal(acoes.mostrarImprimirReciboNormal, true);
  assert.equal(acoes.rotuloBotaoRecibo, "Imprimir recibo normal");
  assert.equal(acoes.mostrarVerSituacaoFiscal, true);
  assert.equal(acoes.autoAbrir, null);
  assert.equal(acoes.podeReenviarNfce, false);
});

test("3. configuração ativa + aguardando reconciliação = recibo normal e NÃO reenvia", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "aguardando_reconciliacao",
        status: "aguardando_reconciliacao",
        mensagem: "Aguardando reconciliação",
        emissaoId: "em-3",
      }),
    })
  );

  assert.equal(acoes.rotuloFiscal, "NFC-e aguardando reconciliação");
  assert.equal(acoes.mostrarImprimirReciboNormal, true);
  assert.equal(acoes.mostrarImprimirNfce, false);
  assert.equal(acoes.mostrarVerSituacaoFiscal, true);
  assert.equal(acoes.podeReenviarNfce, false);
  assert.equal(acoes.hrefSituacaoFiscal, `/vendas/${vendaId}`);

  const shell = fonte("components/pdv/pdv-shell.tsx");
  const posFinalizar = shell.indexOf("await finalizarVendaPdv");
  const posEmitir = shell.indexOf("await chamarEmissaoNfceVenda");
  assert.ok(posEmitir > posFinalizar);
  assert.equal(
    shell.split("await chamarEmissaoNfceVenda").length - 1,
    1,
    "pós-venda não pode reenviar NFC-e"
  );
});

test("4. configuração ativa + DANFE indisponível = permite recibo normal", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "autorizada",
        status: "autorizada",
        mensagem: "Autorizada",
        emissaoId: "em-4",
        danfeDisponivel: false,
      }),
    })
  );

  assert.match(acoes.rotuloFiscal ?? "", /DANFE indisponível/);
  assert.equal(acoes.mostrarImprimirNfce, false);
  assert.equal(acoes.mostrarImprimirReciboNormal, true);
  assert.equal(acoes.autoAbrir, null);
});

test("5. autorização posterior libera Imprimir NFC-e", () => {
  const pendente = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "aguardando_reconciliacao",
        status: "aguardando_reconciliacao",
        emissaoId: "em-5",
        mensagem: "Consultar SEFAZ",
      }),
    })
  );
  assert.equal(pendente.mostrarImprimirNfce, false);
  assert.equal(pendente.mostrarImprimirReciboNormal, true);

  const autorizada = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "autorizada",
        status: "autorizada",
        emissaoId: "em-5",
        danfeDisponivel: true,
        mensagem: "Autorizada",
      }),
    })
  );
  assert.equal(autorizada.mostrarImprimirNfce, true);
  assert.equal(autorizada.mostrarImprimirReciboNormal, false);
  assert.equal(autorizada.hrefDanfe, "/api/fiscal/emissoes/em-5/arquivo?tipo=pdf");
});

test("6. imprimir recibo normal não altera status fiscal", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      fiscal: fiscal({
        kind: "rejeitada",
        status: "rejeitada",
        mensagem: "Rejeitada",
      }),
    })
  );
  assert.match(acoes.hrefRecibo, /\/pdv\/imprimir\/recibo\//);
  assert.doesNotMatch(acoes.hrefRecibo, /emitir|retransmit|cancelar/);

  const recibo = fonte("app/pdv/imprimir/recibo/[id]/page.tsx");
  assert.doesNotMatch(recibo, /fiscal_emissoes/);
  assert.doesNotMatch(recibo, /\.update\(/);
  assert.doesNotMatch(recibo, /nfce-emitir/);
  assert.match(recibo, /usuarios_empresas/);
  assert.match(recibo, /principal/);
  assert.match(recibo, /ativo/);
});

test("7. configuração desligada mantém fluxo comercial normal", () => {
  const acoes = resolverAcoesPosVendaPdv(
    entrada({
      emitirNfceAutomatico: false,
      fiscal: null,
    })
  );

  assert.equal(acoes.mostrarStatusFiscal, false);
  assert.equal(acoes.mostrarImprimirNfce, false);
  assert.equal(acoes.mostrarVerSituacaoFiscal, false);
  assert.equal(acoes.mostrarImprimirReciboNormal, true);
  assert.equal(acoes.rotuloBotaoRecibo, "Imprimir recibo");
  assert.equal(acoes.autoAbrir, "recibo");

  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /resolverAcoesPosVendaPdv/);
  assert.match(shell, /if \(!emitirNfceAutomaticoPdv\)/);
  assert.match(shell, /imprimirApos/);
  assert.match(shell, /rotuloBotaoRecibo/);
  assert.match(shell, /não substitui NF-e, NFC-e ou DANFE/);
  assert.doesNotMatch(shell, /window\.open/);
  assert.match(fonte("lib/pdv/acoes-pos-venda.ts"), /Imprimir recibo normal/);
  assert.doesNotMatch(shell, /setUltimaVenda\(null\).*chamarEmissaoNfceVenda/);
});
