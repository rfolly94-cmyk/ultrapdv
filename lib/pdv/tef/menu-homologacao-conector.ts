import { origemDoConnectorUnico } from "@/lib/impressao/conector-homologacao";
import { FRASE_TESTE_FINANCEIRO_HOMOLOGACAO } from "@/lib/pdv/tef/menu-homologacao-contrato";

export function urlMenuConectorHomologacao(origem: string) {
  return `${origem}/tef/homologacao/menu`;
}

const MENSAGENS_PREPARACAO: Record<string, string> = {
  ausente: "A autorização da operação não foi apresentada. Nenhum comando foi enviado.",
  assinatura: "A assinatura da autorização não confere. Nenhum comando foi enviado.",
  sessao: "A sessão nativa residente não está disponível. Nenhum comando foi enviado.",
  transporte: "A sessão nativa residente não está disponível. Nenhum comando foi enviado.",
  biblioteca: "A biblioteca residente do Connector não está ligada. Nenhum comando foi enviado.",
};

function mensagemPreparacao(corpo: Record<string, unknown>) {
  if (typeof corpo.mensagem === "string" && corpo.mensagem.trim()) return corpo.mensagem;
  if (typeof corpo.motivo === "string" && corpo.motivo.trim()) return corpo.motivo;
  return MENSAGENS_PREPARACAO[String(corpo.codigo ?? "")] ?? "A preparação foi interrompida. Nenhum comando foi enviado.";
}

function respostaSegura(corpo: Record<string, unknown>) {
  return {
    ...corpo,
    ...(corpo.ok === true ? {} : { mensagem: mensagemPreparacao(corpo) }),
    pagamentoRecebido: corpo.fase === "resultado" && corpo.pagamentoRecebido === true && corpo.confirmacaoChamada === true,
    podeFinalizar: corpo.fase === "resultado" && corpo.podeFinalizar === true && corpo.pagamentoRecebido === true,
    nfcEEmitida: false as const,
    execucaoFisica: corpo.execucaoFisica === true,
    comandoDll: corpo.comandoDll === true,
  } as Record<string, unknown> & {
    pagamentoRecebido: boolean;
    podeFinalizar: boolean;
    nfcEEmitida: false;
    execucaoFisica: boolean;
    comandoDll: boolean;
    ok?: boolean;
    codigo?: string;
  };
}

export async function encaminharMenuConectorHomologacao(
  input: {
    acao: "iniciar" | "executar" | "responder" | "cancelar" | "estado" | "confirmar" | "desfazer" | "acompanhar";
    empresaId: string;
    terminalCodigo: string;
    frase: string;
    capturaId?: number;
    valor?: string;
    dispositivoId?: string;
    posid?: string;
    valorCentavos?: number;
    idempotencyKey?: string;
    expiraEm?: number;
    assinatura?: string;
  },
  deps: {
    origem?: string | null;
    buscar?: typeof fetch;
  } = {}
) {
  const origem = origemDoConnectorUnico(String(deps.origem ?? ""));
  if (!origem) {
    return respostaSegura({
      ok: false,
      codigo: "conector",
      fase: "recusa",
      mensagem: "O UltraPDV Connector não está disponível. Nenhum comando foi enviado.",
      menu: null,
      pinpad: null,
    });
  }
  const buscar = deps.buscar ?? fetch;
  const corpo: Record<string, unknown> = {
    acao: input.acao,
    empresaId: input.empresaId,
    terminalCodigo: input.terminalCodigo,
    frase: input.frase,
  };
  if (input.acao === "responder") {
    corpo.capturaId = input.capturaId;
    corpo.valor = input.valor;
  }
  if ((input.acao === "iniciar" || input.acao === "executar") && input.assinatura) {
    corpo.dispositivoId = input.dispositivoId;
    corpo.posid = input.posid;
    corpo.valorCentavos = input.valorCentavos;
    corpo.idempotencyKey = input.idempotencyKey;
    corpo.expiraEm = input.expiraEm;
    corpo.assinatura = input.assinatura;
  }
  try {
    const http = await buscar(urlMenuConectorHomologacao(origem), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      cache: "no-store",
    });
    const json = (await http.json()) as Record<string, unknown>;
    if (json.frase === FRASE_TESTE_FINANCEIRO_HOMOLOGACAO) {
      delete json.frase;
    }
    return respostaSegura(json);
  } catch {
    return respostaSegura({
      ok: false,
      codigo: "comunicacao",
      fase: "recusa",
      mensagem: "O PDV não alcançou o Connector de homologação. Nenhum comando foi enviado.",
      menu: null,
      pinpad: null,
    });
  }
}
