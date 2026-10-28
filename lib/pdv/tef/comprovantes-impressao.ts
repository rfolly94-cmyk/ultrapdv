import {
  conduzirImpressaoPdv,
  enfileirarImpressaoAutomatica,
  type FilaImpressaoPdv,
} from "@/lib/pdv/impressao-fila";
import { prepararComprovantesTef } from "@/lib/pdv/tef/disponibilidade-pdv";

export type ViaImpressaoTef = {
  destino: "estabelecimento" | "cliente";
  documento: "tef_estabelecimento" | "tef_cliente";
  texto: string;
  linhas: string[];
};

export function linhasComprovanteTef(texto: string) {
  return texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function selecionarViaMarcada(
  input: {
    status: string;
    pagamentoRecebido: boolean;
    transacaoConfirmada: boolean;
    viaEstabelecimento: string;
    viaCliente: string;
    vendaId: string;
    rede: string;
    quando: string;
  },
  querCliente: boolean,
  querEstabelecimento: boolean
) {
  if (input.status !== "confirmada" || input.pagamentoRecebido !== true || input.transacaoConfirmada !== true) {
    return {
      imprimir: false as const,
      motivo: "Sem autorização confirmada. Nenhum comprovante foi impresso.",
    };
  }
  if (!querCliente && !querEstabelecimento) {
    return {
      imprimir: false as const,
      motivo: "Nenhuma via automática está marcada. Os comprovantes permanecem guardados.",
    };
  }
  const destino = querEstabelecimento ? "estabelecimento" as const : "cliente" as const;
  const texto = (querEstabelecimento ? input.viaEstabelecimento : input.viaCliente).trim();
  if (!texto || !input.vendaId.trim() || !input.rede.trim() || !input.quando.trim()) {
    return {
      imprimir: false as const,
      motivo: "A via selecionada não está disponível para impressão. O comprovante permanece guardado.",
    };
  }
  return {
    imprimir: true as const,
    motivo: "",
    vias: [{ destino, texto }],
  };
}

export async function executarImpressaoComprovantesTef(input: {
  empresaId: string;
  vendaId: string;
  status: string;
  pagamentoRecebido: boolean;
  transacaoConfirmada: boolean;
  viaEstabelecimento: string;
  viaCliente: string;
  rede: string;
  quando: string;
  imprimirViaCliente?: boolean;
  imprimirViaEstabelecimento?: boolean;
  ler: () => FilaImpressaoPdv;
  gravar: (fila: FilaImpressaoPdv) => void;
  emCurso: Set<string>;
  agora: () => string;
  imprimirVia: (via: ViaImpressaoTef) => Promise<{ ok: boolean; erro?: string | null }>;
}) {
  const querCliente = input.imprimirViaCliente !== false;
  const querEstabelecimento = input.imprimirViaEstabelecimento !== false;
  const plano = querCliente && querEstabelecimento
    ? prepararComprovantesTef({
        status: input.status,
        pagamentoRecebido: input.pagamentoRecebido,
        transacaoConfirmada: input.transacaoConfirmada,
        viaEstabelecimento: input.viaEstabelecimento,
        viaCliente: input.viaCliente,
        vendaId: input.vendaId,
        rede: input.rede,
        quando: input.quando,
      })
    : selecionarViaMarcada(input, querCliente, querEstabelecimento);
  if (!plano.imprimir) {
    return { impresso: false as const, motivo: plano.motivo, trabalhos: 0 };
  }

  let trabalhos = 0;
  for (const via of plano.vias) {
    const documento = via.destino === "estabelecimento" ? "tef_estabelecimento" : "tef_cliente";
    const texto = via.texto;
    const enfileirado = enfileirarImpressaoAutomatica(input.ler(), {
      vendaId: input.vendaId,
      empresaId: input.empresaId,
      emissaoId: null,
      documento,
      agora: input.agora(),
    });
    input.gravar(enfileirado.fila);
    if (!enfileirado.iniciar || !enfileirado.trabalho) {
      continue;
    }
    const conduzido = await conduzirImpressaoPdv({
      ler: input.ler,
      gravar: input.gravar,
      trabalho: enfileirado.trabalho,
      emCurso: input.emCurso,
      agora: input.agora,
      imprimir: () =>
        input.imprimirVia({
          destino: via.destino,
          documento,
          texto,
          linhas: linhasComprovanteTef(texto),
        }),
    });
    if (conduzido.aplicado && conduzido.trabalho.estado === "concluido") {
      trabalhos += 1;
    }
  }

  return {
    impresso: trabalhos === plano.vias.length,
    motivo: "",
    trabalhos,
  };
}
