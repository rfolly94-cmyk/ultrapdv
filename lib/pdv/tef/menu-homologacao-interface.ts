export const CLASSE_BACKDROP =
  "fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4";
export const CLASSE_JANELA =
  "flex max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl";
export const CLASSE_ROLAGEM = "overflow-y-auto px-5 py-4";
export const CLASSE_OPCAO_SELECIONADA =
  "w-full rounded-lg border-2 border-sky-700 bg-sky-100 px-4 py-3 text-left font-semibold text-zinc-950 ring-2 ring-sky-500";

export const MENSAGEM_FECHAMENTO_IMPEDIDO =
  "A sessão financeira continua no Connector. Não há encerramento seguro da DLL para esta captura. O fechamento foi impedido. Nenhum journal foi apagado e nenhum pagamento foi marcado como recebido.";

export function exibirTesteFinanceiroHomologacao(input: {
  habilitado: boolean;
  ambiente: string;
  cobrancaBloqueada: boolean;
}) {
  return input.habilitado === true && input.ambiente === "homologacao" && input.cobrancaBloqueada === true;
}

export function sessaoTesteAtiva(fase: string | undefined) {
  return fase === "menu" || fase === "pinpad";
}

export function decidirFechamentoTeste(fase: string | undefined) {
  if (sessaoTesteAtiva(fase)) {
    return { permitir: false as const, mensagem: MENSAGEM_FECHAMENTO_IMPEDIDO };
  }
  return { permitir: true as const, mensagem: "" };
}

export function tratarTeclaModal(input: { tecla: string; indice: number; total: number; sessaoAtiva: boolean }) {
  const total = Math.max(0, input.total);
  const indice = total === 0 ? 0 : ((input.indice % total) + total) % total;
  if (input.tecla === "Escape") {
    return { acao: input.sessaoAtiva ? ("impedir" as const) : ("fechar" as const), indice };
  }
  if (input.tecla === "ArrowDown" && total > 0) {
    return { acao: "mover" as const, indice: (indice + 1) % total };
  }
  if (input.tecla === "ArrowUp" && total > 0) {
    return { acao: "mover" as const, indice: (indice - 1 + total) % total };
  }
  if (input.tecla === "Enter" && total > 0) {
    return { acao: "confirmar" as const, indice };
  }
  return { acao: "ignorar" as const, indice };
}

export function proximoFocoCircular(atual: number, total: number, retroceder: boolean) {
  if (total <= 0) return 0;
  const base = ((atual % total) + total) % total;
  return retroceder ? (base - 1 + total) % total : (base + 1) % total;
}

const CODIGO_ERRO_SEGURO = /^[a-z][a-z0-9_-]{0,31}$/i;

export function textoErroMenuHomologacao(resposta: {
  mensagem?: unknown;
  motivo?: unknown;
  erro?: unknown;
  codigo?: unknown;
}) {
  const texto = [resposta.mensagem, resposta.motivo, resposta.erro].find(
    (item) => typeof item === "string" && item.trim()
  );
  const base = typeof texto === "string" ? texto.trim() : "O teste financeiro não continuou.";
  const codigo = typeof resposta.codigo === "string" ? resposta.codigo.trim() : "";
  if (!CODIGO_ERRO_SEGURO.test(codigo)) return base;
  return `${base} Código: ${codigo}.`;
}

export function criarTravaEnvio() {
  let aberto = false;
  return {
    tentar() {
      if (aberto) return false;
      aberto = true;
      return true;
    },
    liberar() {
      aberto = false;
    },
  };
}
