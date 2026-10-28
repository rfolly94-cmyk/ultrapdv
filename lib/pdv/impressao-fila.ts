export const CHAVE_FILA_IMPRESSAO_PDV = "ultrapdv.pdv.impressao.v1";

export const MENSAGEM_IMPRESSAO_INTERROMPIDA =
  "A tela fechou durante a impressão. Reimprima se o DANFE não saiu. Nenhuma nova cobrança foi feita.";

export type EstadoTrabalhoImpressao = "pendente" | "executando" | "concluido" | "falhou";

export type DocumentoImpressaoPdv = "danfe_nfce" | "recibo" | "tef_estabelecimento" | "tef_cliente";

export type TrabalhoImpressaoPdv = {
  id: string;
  vendaId: string;
  empresaId?: string;
  emissaoId: string | null;
  documento: DocumentoImpressaoPdv;
  origem: "automatica" | "reimpressao";
  estado: EstadoTrabalhoImpressao;
  execucao: number;
  erro: string | null;
  atualizadoEm: string;
};

export type FilaImpressaoPdv = {
  trabalhos: TrabalhoImpressaoPdv[];
};

export type ArmazenamentoImpressao = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
};

export function filaImpressaoVazia(): FilaImpressaoPdv {
  return { trabalhos: [] };
}

export function confirmacaoFinanceiraPendente(input: {
  houveTef: boolean;
  confirmacaoLiberada: boolean;
  confirmacaoOk: boolean;
}) {
  if (!input.houveTef) {
    return false;
  }
  return !input.confirmacaoLiberada || !input.confirmacaoOk;
}

export function planejarPosVenda(input: {
  houveTef: boolean;
  confirmacaoLiberada: boolean;
  confirmacaoOk: boolean;
  emitirNfce: boolean;
  nfceAutorizada: boolean;
  documentoDisponivel: boolean;
}) {
  const financeiraPendente = confirmacaoFinanceiraPendente(input);
  const danfePronto =
    input.emitirNfce && input.nfceAutorizada && input.documentoDisponivel;
  return {
    liberarCaixa: !financeiraPendente,
    imprimirEmSegundoPlano: input.emitirNfce ? danfePronto : !financeiraPendente,
  };
}

export function iniciarImpressaoSemBloquear<T>(input: {
  liberarCaixa: boolean;
  imprimir: (() => Promise<T>) | null;
  aoLiberar: () => void;
}) {
  if (input.liberarCaixa) {
    input.aoLiberar();
  }
  const impressao = input.imprimir ? input.imprimir() : Promise.resolve(null);
  return { impressao };
}

function chaveDocumento(trabalho: Pick<TrabalhoImpressaoPdv, "vendaId" | "documento" | "emissaoId" | "empresaId">) {
  const nucleo = `${trabalho.vendaId}:${trabalho.documento}:${trabalho.emissaoId ?? ""}`;
  if (trabalho.documento === "tef_estabelecimento" || trabalho.documento === "tef_cliente") {
    return `${trabalho.empresaId ?? ""}:${nucleo}`;
  }
  return nucleo;
}

function mesmoDocumento(
  trabalho: TrabalhoImpressaoPdv,
  pedido: { vendaId: string; documento: DocumentoImpressaoPdv; emissaoId: string | null; empresaId?: string }
) {
  return chaveDocumento(trabalho) === chaveDocumento(pedido);
}

function ocupado(
  fila: FilaImpressaoPdv,
  pedido: { vendaId: string; documento: DocumentoImpressaoPdv; emissaoId: string | null; empresaId?: string }
) {
  return fila.trabalhos.some(
    (trabalho) =>
      mesmoDocumento(trabalho, pedido) &&
      (trabalho.estado === "pendente" || trabalho.estado === "executando")
  );
}

function limitar(trabalhos: TrabalhoImpressaoPdv[]) {
  const ativos = trabalhos.filter(
    (trabalho) => trabalho.estado === "pendente" || trabalho.estado === "executando"
  );
  const terminais = trabalhos.filter(
    (trabalho) => trabalho.estado !== "pendente" && trabalho.estado !== "executando"
  );
  return [...ativos, ...terminais.slice(-20)];
}

export function enfileirarImpressaoAutomatica(
  fila: FilaImpressaoPdv,
  pedido: {
    vendaId: string;
    emissaoId: string | null;
    documento: DocumentoImpressaoPdv;
    empresaId?: string;
    agora: string;
  }
) {
  const existente = fila.trabalhos.find(
    (trabalho) => trabalho.origem === "automatica" && mesmoDocumento(trabalho, pedido)
  );
  if (existente) {
    return { fila, trabalho: existente, iniciar: false as const };
  }
  const trabalho: TrabalhoImpressaoPdv = {
    id: `automatica:${chaveDocumento(pedido)}`,
    vendaId: pedido.vendaId,
    empresaId: pedido.empresaId,
    emissaoId: pedido.emissaoId,
    documento: pedido.documento,
    origem: "automatica",
    estado: "pendente",
    execucao: 0,
    erro: null,
    atualizadoEm: pedido.agora,
  };
  return {
    fila: { trabalhos: limitar([...fila.trabalhos, trabalho]) },
    trabalho,
    iniciar: true as const,
  };
}

export function solicitarReimpressao(
  fila: FilaImpressaoPdv,
  pedido: {
    vendaId: string;
    emissaoId: string | null;
    documento: DocumentoImpressaoPdv;
    empresaId?: string;
    agora: string;
  }
) {
  if (ocupado(fila, pedido)) {
    return { fila, trabalho: null, iniciar: false as const };
  }
  const sequencia =
    fila.trabalhos.filter((trabalho) => mesmoDocumento(trabalho, pedido)).length + 1;
  const trabalho: TrabalhoImpressaoPdv = {
    id: `reimpressao:${chaveDocumento(pedido)}:${sequencia}`,
    vendaId: pedido.vendaId,
    empresaId: pedido.empresaId,
    emissaoId: pedido.emissaoId,
    documento: pedido.documento,
    origem: "reimpressao",
    estado: "pendente",
    execucao: 0,
    erro: null,
    atualizadoEm: pedido.agora,
  };
  return {
    fila: { trabalhos: limitar([...fila.trabalhos, trabalho]) },
    trabalho,
    iniciar: true as const,
  };
}

export function assumirExecucao(
  fila: FilaImpressaoPdv,
  id: string,
  emCurso: Set<string>,
  agora: string
) {
  const trabalho = fila.trabalhos.find((item) => item.id === id);
  if (!trabalho || trabalho.estado !== "pendente" || emCurso.has(id)) {
    return null;
  }
  emCurso.add(id);
  const execucao = trabalho.execucao + 1;
  const atualizado: TrabalhoImpressaoPdv = {
    ...trabalho,
    estado: "executando",
    execucao,
    erro: null,
    atualizadoEm: agora,
  };
  return {
    fila: {
      trabalhos: fila.trabalhos.map((item) => (item.id === id ? atualizado : item)),
    },
    trabalho: atualizado,
    execucao,
  };
}

export function registrarResultadoImpressao(
  fila: FilaImpressaoPdv,
  input: {
    id: string;
    execucao: number;
    ok: boolean;
    erro?: string | null;
    agora: string;
  },
  emCurso?: Set<string>
) {
  const trabalho = fila.trabalhos.find((item) => item.id === input.id);
  if (!trabalho || trabalho.execucao !== input.execucao) {
    return { fila, trabalho, aplicado: false as const };
  }
  if (trabalho.estado === "concluido" || (trabalho.estado === "falhou" && !input.ok)) {
    return { fila, trabalho, aplicado: false as const };
  }
  if (trabalho.estado !== "executando" && trabalho.estado !== "falhou") {
    return { fila, trabalho, aplicado: false as const };
  }
  emCurso?.delete(input.id);
  const atualizado: TrabalhoImpressaoPdv = {
    ...trabalho,
    estado: input.ok ? "concluido" : "falhou",
    erro: input.ok ? null : input.erro || "Não foi possível imprimir.",
    atualizadoEm: input.agora,
  };
  return {
    fila: {
      trabalhos: fila.trabalhos.map((item) => (item.id === input.id ? atualizado : item)),
    },
    trabalho: atualizado,
    aplicado: true as const,
  };
}

export function recuperarFilaImpressaoPdv(
  fila: FilaImpressaoPdv,
  agora: string,
  emCurso?: Set<string>
) {
  const interrompidos: TrabalhoImpressaoPdv[] = [];
  const retomar: TrabalhoImpressaoPdv[] = [];
  const trabalhos = fila.trabalhos.map((trabalho) => {
    if (trabalho.estado === "executando" && emCurso?.has(trabalho.id)) {
      return trabalho;
    }
    if (trabalho.estado === "executando") {
      const interrompido: TrabalhoImpressaoPdv = {
        ...trabalho,
        estado: "falhou",
        erro: MENSAGEM_IMPRESSAO_INTERROMPIDA,
        atualizadoEm: agora,
      };
      interrompidos.push(interrompido);
      return interrompido;
    }
    if (trabalho.estado === "pendente") {
      retomar.push(trabalho);
    }
    return trabalho;
  });
  return { fila: { trabalhos }, retomar, interrompidos };
}

export async function conduzirImpressaoPdv(input: {
  ler: () => FilaImpressaoPdv;
  trabalho: TrabalhoImpressaoPdv;
  emCurso: Set<string>;
  agora: () => string;
  imprimir: () => Promise<{ ok: boolean; erro?: string | null }>;
  gravar: (fila: FilaImpressaoPdv) => void;
}) {
  const assumido = assumirExecucao(input.ler(), input.trabalho.id, input.emCurso, input.agora());
  if (!assumido) {
    return { fila: input.ler(), aplicado: false as const, trabalho: input.trabalho };
  }
  input.gravar(assumido.fila);
  let resultado: { ok: boolean; erro?: string | null };
  try {
    resultado = await input.imprimir();
  } catch (error) {
    resultado = {
      ok: false,
      erro: error instanceof Error ? error.message : "Não foi possível imprimir.",
    };
  }
  const registrado = registrarResultadoImpressao(
    input.ler(),
    {
      id: assumido.trabalho.id,
      execucao: assumido.execucao,
      ok: resultado.ok,
      erro: resultado.erro,
      agora: input.agora(),
    },
    input.emCurso
  );
  if (registrado.aplicado) {
    input.gravar(registrado.fila);
  }
  return registrado;
}

export function lerFilaImpressaoPdv(storage: ArmazenamentoImpressao | null): FilaImpressaoPdv {
  if (!storage) {
    return filaImpressaoVazia();
  }
  try {
    const bruto = storage.getItem(CHAVE_FILA_IMPRESSAO_PDV);
    if (!bruto) {
      return filaImpressaoVazia();
    }
    const json = JSON.parse(bruto) as { trabalhos?: unknown };
    if (!json || !Array.isArray(json.trabalhos)) {
      return filaImpressaoVazia();
    }
    const trabalhos = json.trabalhos.filter((item): item is TrabalhoImpressaoPdv => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const trabalho = item as TrabalhoImpressaoPdv;
      return (
        typeof trabalho.id === "string" &&
        typeof trabalho.vendaId === "string" &&
        (trabalho.documento === "danfe_nfce" ||
          trabalho.documento === "recibo" ||
          ((trabalho.documento === "tef_estabelecimento" || trabalho.documento === "tef_cliente") &&
            typeof trabalho.empresaId === "string" &&
            trabalho.empresaId.length > 0)) &&
        (trabalho.estado === "pendente" ||
          trabalho.estado === "executando" ||
          trabalho.estado === "concluido" ||
          trabalho.estado === "falhou")
      );
    });
    return { trabalhos };
  } catch {
    return filaImpressaoVazia();
  }
}

export function gravarFilaImpressaoPdv(
  fila: FilaImpressaoPdv,
  storage: ArmazenamentoImpressao | null
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CHAVE_FILA_IMPRESSAO_PDV, JSON.stringify({ trabalhos: limitar(fila.trabalhos) }));
  } catch {
    // A memória da fila segue na sessão. A falha de disco não inicia outra cobrança.
  }
}
