import {
  FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
  ROTULO_PAGAMENTO_NAO_RECEBIDO,
  ROTULO_TESTE_FINANCEIRO,
} from "@/lib/pdv/tef/menu-homologacao-contrato";
import { cobrancaRealBloqueada } from "@/lib/pdv/tef/motor";
import {
  abrirCapturaResidente,
  criarSessaoContinua,
  pedidoParaOperador,
  responderContinuidadeNativa,
  transacaoResidenteAtiva,
} from "../../../print-agent/src/tef-teste-nativo-homologacao.mjs";

export {
  FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
  ROTULO_PAGAMENTO_NAO_RECEBIDO,
  ROTULO_TESTE_FINANCEIRO,
} from "@/lib/pdv/tef/menu-homologacao-contrato";

type TransporteMenu = {
  novas: number;
  params: Array<[number, string]>;
  newTransac: () => Promise<number>;
  addParam: (info: number, valor: string) => Promise<number>;
  execTransac: () => Promise<{ codigo: number; captura: Array<Record<string, unknown>> }>;
};

type SessaoCaixa = {
  empresaId: string;
  terminalCodigo: string;
  sessao: ReturnType<typeof criarSessaoContinua>;
  transporte: TransporteMenu;
};

const sessoes = new Map<string, SessaoCaixa>();

function chave(empresaId: string, terminalCodigo: string) {
  return `${empresaId}|${terminalCodigo}`;
}

function transporteMenuHomologacao(): TransporteMenu {
  const params: Array<[number, string]> = [];
  let etapa = 0;
  const transporte: TransporteMenu = {
    novas: 0,
    params,
    async newTransac() {
      transporte.novas += 1;
      return transporte.novas === 1 ? 0 : -2494;
    },
    async addParam(info, valor) {
      params.push([info, valor]);
      return 0;
    },
    async execTransac() {
      if (etapa === 0) {
        etapa = 1;
        return {
          codigo: -2497,
          captura: [
            {
              wIdentificador: 0x36,
              bTipoDeDado: 1,
              bNumOpcoesMenu: 3,
              szPrompt: "SELECIONE O PROVEDOR",
              vszTextoMenu: ["C6 PAY", "REDE", "PIX C6 BANK"],
              vszValorMenu: ["9691", "9692", "9693"],
            },
          ],
        };
      }
      if (etapa === 1) {
        etapa = 2;
        return {
          codigo: -2497,
          captura: [
            {
              wIdentificador: 0x29,
              bTipoDeDado: 1,
              bNumOpcoesMenu: 2,
              szPrompt: "ESCOLHA A FORMA DE PAGAMENTO",
              vszTextoMenu: ["Débito", "Crédito"],
              vszValorMenu: ["02", "01"],
            },
          ],
        };
      }
      etapa = 3;
      return {
        codigo: -2497,
        captura: [
          {
            wIdentificador: 0x2f,
            bTipoDeDado: 3,
            szPrompt: "Insira ou passe o cartão",
            vszTextoMenu: [],
            vszValorMenu: [],
          },
        ],
      };
    },
  };
  return transporte;
}

function recusa(codigo: string, mensagem: string) {
  return {
    ok: false as const,
    testeFinanceiro: true,
    pagamentoRecebido: false as const,
    podeFinalizar: false as const,
    nfcEEmitida: false as const,
    rotulo: ROTULO_TESTE_FINANCEIRO,
    aviso: ROTULO_PAGAMENTO_NAO_RECEBIDO,
    codigo,
    mensagem,
    novas: 0,
    fase: "recusa" as const,
    menu: null,
    pinpad: null,
    valorEnviado: null as string | null,
  };
}

function menuDe(pedido: {
  capturaId: number;
  identificador: number;
  prompt: string;
  opcoes: string[];
  valores: string[];
  tipo: number;
}) {
  return {
    capturaId: pedido.capturaId,
    wIdentificador: pedido.identificador,
    tipo: pedido.tipo,
    prompt: pedido.prompt,
    opcoes: pedido.opcoes.map((texto, indice) => ({
      texto,
      valor: pedido.valores[indice] ?? "",
    })),
  };
}

function apresentar(caixa: SessaoCaixa, valorEnviado: string | null) {
  const pedido = pedidoParaOperador(caixa.sessao);
  const base = {
    ok: true as const,
    testeFinanceiro: true,
    pagamentoRecebido: false as const,
    podeFinalizar: false as const,
    nfcEEmitida: false as const,
    rotulo: ROTULO_TESTE_FINANCEIRO,
    aviso: ROTULO_PAGAMENTO_NAO_RECEBIDO,
    codigo: "captura",
    mensagem: ROTULO_TESTE_FINANCEIRO,
    novas: caixa.sessao.novas,
    valorEnviado,
  };
  if (!pedido) {
    return { ...base, fase: "encerrado" as const, menu: null, pinpad: null };
  }
  if (pedido.pinpad) {
    return {
      ...base,
      fase: "pinpad" as const,
      menu: null,
      pinpad: { prompt: pedido.prompt || "Aguardando o PinPad", wIdentificador: pedido.identificador },
    };
  }
  return { ...base, fase: "menu" as const, menu: menuDe(pedido), pinpad: null };
}

export function esquecerMenusHomologacao() {
  sessoes.clear();
}

export async function iniciarTesteFinanceiroHomologacao(input: {
  ambiente: string;
  empresaId: string;
  terminalCodigo: string;
  frase: string;
}) {
  if (!cobrancaRealBloqueada()) {
    return recusa("comercial", "O caminho comercial permanece bloqueado. Nenhum comando foi enviado.");
  }
  if (input.ambiente !== "homologacao" || !input.empresaId || !input.terminalCodigo) {
    return recusa("perfil", "O teste financeiro só existe na homologação desta empresa.");
  }
  if (input.frase !== FRASE_TESTE_FINANCEIRO_HOMOLOGACAO) {
    return recusa("autorizacao", "O teste financeiro de homologação não foi autorizado. Nenhum comando foi enviado.");
  }
  const id = chave(input.empresaId, input.terminalCodigo);
  for (const [outra, caixa] of sessoes) {
    if (outra !== id && outra.startsWith(`${input.empresaId}|`) && transacaoResidenteAtiva(caixa.sessao)) {
      return recusa("ocupada", "Há outra transação neste terminal. Nenhuma nova venda foi iniciada.");
    }
  }
  const existente = sessoes.get(id);
  if (existente && transacaoResidenteAtiva(existente.sessao)) {
    return apresentar(existente, null);
  }
  const transporte = transporteMenuHomologacao();
  const sessao = criarSessaoContinua();
  const mutavel = sessao as { transporte: TransporteMenu | null; inicializada: boolean; novas: number };
  mutavel.transporte = transporte;
  mutavel.inicializada = true;
  const codigo = await transporte.newTransac();
  mutavel.novas = transporte.novas;
  if (codigo !== 0 || sessao.novas !== 1) {
    return recusa("recusa", "A transação não iniciou. Nenhum pagamento foi recebido.");
  }
  const caixa = { empresaId: input.empresaId, terminalCodigo: input.terminalCodigo, sessao, transporte };
  sessoes.set(id, caixa);
  const abertura = await abrirCapturaResidente(sessao);
  if (abertura?.codigo !== "captura") {
    sessoes.delete(id);
    return recusa("captura", "A biblioteca não apresentou um menu. Nenhum pagamento foi recebido.");
  }
  return apresentar(caixa, null);
}

export async function responderTesteFinanceiroHomologacao(input: {
  empresaId: string;
  terminalCodigo: string;
  capturaId: number;
  valor: string;
}) {
  const caixa = sessoes.get(chave(input.empresaId, input.terminalCodigo));
  if (!caixa || !transacaoResidenteAtiva(caixa.sessao)) {
    return recusa("SESSAO_PERDIDA", "A sessão de homologação não está mais ativa. Nenhum pagamento foi recebido.");
  }
  const pedido = pedidoParaOperador(caixa.sessao);
  if (!pedido) {
    return recusa("SESSAO_PERDIDA", "A sessão de homologação não está mais ativa. Nenhum pagamento foi recebido.");
  }
  if (pedido.pinpad) {
    return apresentar(caixa, caixa.transporte.params.at(-1)?.[1] ?? null);
  }
  if (pedido.capturaId !== input.capturaId) {
    return recusa("DIVERGENTE", "A resposta não pertence ao menu atual. Nenhum valor foi enviado.");
  }
  const valor = String(input.valor ?? "");
  const indices = (pedido.valores ?? []).flatMap((item: string, posicao: number) => (item === valor ? [posicao] : []));
  if (indices.length !== 1) {
    return recusa("OPCAO", "A resposta precisa ser um vszValorMenu devolvido pela biblioteca. Nenhum índice foi enviado.");
  }
  const novasAntes = caixa.transporte.novas;
  const resultado = await responderContinuidadeNativa(caixa.sessao, { indice: indices[0] });
  if (caixa.transporte.novas !== novasAntes) {
    return recusa("NOVA_TRANSACAO", "Outra transação foi recusada. O valor permaneceu na sessão atual.");
  }
  const valorEnviado = caixa.transporte.params.at(-1)?.[1] ?? null;
  if (resultado?.codigo === "DUPLICADA" || resultado?.codigo === "OCUPADA") {
    return {
      ...recusa(resultado.codigo, "Esta escolha já foi enviada. A sessão não foi repetida."),
      novas: caixa.sessao.novas,
      valorEnviado,
    };
  }
  if (resultado?.codigo !== "captura") {
    return {
      ...recusa(String(resultado?.codigo ?? "recusa"), "O teste financeiro não recebeu o pagamento."),
      novas: caixa.sessao.novas,
      valorEnviado,
    };
  }
  return apresentar(caixa, valorEnviado);
}
