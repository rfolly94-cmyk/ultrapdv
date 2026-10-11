import { sanitizarParaLog } from "./regras";

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type ParcelaTefCliente = {
  formaPagamentoId: string;
  modalidade: "debito" | "credito";
  valorCentavos: number;
};

export type CobrancaTefPronta = {
  formaPagamentoId: string;
  operacaoId: string;
  valorCentavos: number;
  identificador: string;
  empresaId: string;
  terminalCodigo: string;
  desafio: string;
  vinculoSegredo: string;
  autorizacao: string;
  estabelecimento?: string;
};

function cabecalhosTef(operacao: {
  empresaId?: string;
  terminalCodigo?: string;
  desafio?: string;
  identificador?: string;
  valorCentavos?: number;
  autorizacao?: string;
  estabelecimento?: string;
}) {
  return {
    "Content-Type": "application/json",
    "x-ultrapdv-empresa": operacao.empresaId ?? "",
    "x-ultrapdv-terminal": operacao.terminalCodigo ?? "",
    "x-ultrapdv-desafio": operacao.desafio ?? "",
    "x-ultrapdv-identificador": operacao.identificador ?? "",
    "x-ultrapdv-valor-centavos":
      operacao.valorCentavos === undefined ? "" : String(operacao.valorCentavos),
    "x-ultrapdv-autorizacao": operacao.autorizacao ?? "",
    "x-ultrapdv-estabelecimento": operacao.estabelecimento ?? "",
  };
}

type InicioTef = {
  ok?: boolean;
  erro?: string;
  operacaoId?: string;
  identificador?: string;
  valor?: number;
  terminalCodigo?: string;
  empresaId?: string;
  dispositivoId?: string;
  parear?: boolean;
  jaAutorizada?: boolean;
  emAndamento?: boolean;
  repetida?: boolean;
  desafio?: string;
  vinculoSegredo?: string;
};

type ResultadoApi = {
  ok?: boolean;
  erro?: string;
  status?: string;
  confirmar?: boolean;
  executar?: "desfazer" | "confirmar" | "nenhum";
  rede?: string;
  nsu?: string;
  finalizacao?: string;
  autorizacao?: string;
  identificador?: string;
  valorCentavos?: number;
  desafio?: string;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

async function lerJson(resposta: { json: () => Promise<unknown> }) {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function executarCobrancasTef(
  input: {
    parcelas: ParcelaTefCliente[];
    origem: string;
    dispositivoId: string;
    idempotencyKey: (indice: number) => string;
    grupoVenda?: string;
    estabelecimento?: string;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const prontas: CobrancaTefPronta[] = [];

  const status = await lerJson(
    await fetchImpl(`${input.origem}/tef/status`, { cache: "no-store" })
  );
  const tef = (status.tef ?? {}) as { inicializado?: boolean };
  if (tef.inicializado !== true) {
    const inicio = await lerJson(
      await fetchImpl(`${input.origem}/tef/inicializar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "inicializar" }),
      })
    );
    if (inicio.ok !== true) {
      return {
        ok: false as const,
        erro: texto(inicio.erro) || "O Connector TEF não está pronto.",
        operacoes: prontas,
      };
    }
  }

  const identidade = await lerJson(
    await fetchImpl(`${input.origem}/tef/identidade`, { cache: "no-store" })
  );
  if (identidade.ok !== true || !texto(identidade.chavePublica) || !texto(identidade.assinatura)) {
    return {
      ok: false as const,
      erro: "O Connector não apresentou a identidade do terminal TEF.",
      operacoes: prontas,
    };
  }
  const dispositivoId = texto(identidade.dispositivoId) || input.dispositivoId;

  for (const [indice, parcela] of input.parcelas.entries()) {
    const criado = (await lerJson(
      await fetchImpl("/api/pdv/tef/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formaPagamentoId: parcela.formaPagamentoId,
          modalidade: parcela.modalidade,
          valorCentavos: parcela.valorCentavos,
          dispositivoId,
          idempotencyKey: input.idempotencyKey(indice),
          grupoVenda: input.grupoVenda,
          chavePublica: identidade.chavePublica,
          assinaturaIdentidade: identidade.assinatura,
        }),
      })
    )) as InicioTef;

    if (!criado.ok || !criado.operacaoId || !criado.identificador) {
      await desfazerCobrancasTef(
        { operacoes: prontas, origem: input.origem, idempotencyKeyVenda: null },
        { fetchImpl }
      );
      return {
        ok: false as const,
        erro: criado.erro || "Não foi possível iniciar o TEF.",
        operacoes: prontas,
      };
    }
    if (criado.emAndamento) {
      return {
        ok: false as const,
        erro: "Já existe uma cobrança TEF em andamento nesta venda.",
        operacoes: prontas,
      };
    }

    const headers = cabecalhosTef({
      empresaId: texto(criado.empresaId),
      terminalCodigo: texto(criado.terminalCodigo),
      desafio: texto(criado.desafio),
      identificador: texto(criado.identificador),
      valorCentavos: parcela.valorCentavos,
      estabelecimento: input.estabelecimento,
    });

    if (!criado.jaAutorizada) {
      const pagamento = await lerJson(
        await fetchImpl(`${input.origem}/tef/pagamento`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            acao: "pagamento",
            identificador: criado.identificador,
            valor: criado.valor,
          }),
        })
      );
      const resultado = (pagamento.resultado ?? {}) as Record<string, unknown>;
      const registro = (await lerJson(
        await fetchImpl("/api/pdv/tef/resultado", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            sanitizarParaLog({
              operacaoId: criado.operacaoId,
              sucessoTransacao: resultado.sucessoTransacao,
              nsu: resultado.nsu,
              autorizacao: resultado.codigoAutorizacao ?? resultado.autorizacao,
              rede: resultado.rede,
              finalizacao: resultado.codigoFinalizacao ?? resultado.finalizacao,
              valor: resultado.valor,
              confirmar: resultado.confirmar,
              precisaConfirmacao: resultado.precisaConfirmacao,
              transacaoPendenteConfirmacao: resultado.transacaoPendenteConfirmacao,
              cancelada: resultado.cancelada,
              canceladoOperador: resultado.canceladoOperador,
              codigo: pagamento.codigo,
              teste: resultado.teste,
              nomeBandeiraPadrao: resultado.nomeBandeiraPadrao,
              nomeCartao: resultado.nomeCartao,
              bandeira: resultado.bandeira,
              cnpjCredenciadora: resultado.cnpjCredenciadora,
              cnpjRecebedor: resultado.cnpjRecebedor,
              instituicao: resultado.instituicao,
              prova: pagamento.prova,
            })
          ),
        })
      )) as ResultadoApi;
      if (!registro.ok || registro.status !== "autorizada") {
        await desfazerCobrancasTef(
          {
            operacoes: prontas,
            origem: input.origem,
            idempotencyKeyVenda: null,
          },
          { fetchImpl }
        );
        const desconhecido =
          registro.status === "desconhecida" || registro.status === "timeout";
        let desfezAtual = 0;
        if (registro.status === "desconhecida") {
          const pedido = await desfazerCobrancasTef(
            {
              operacoes: [
                {
                  formaPagamentoId: parcela.formaPagamentoId,
                  operacaoId: criado.operacaoId,
                  valorCentavos: parcela.valorCentavos,
                  identificador: texto(criado.identificador),
                  empresaId: texto(criado.empresaId),
                  terminalCodigo: texto(criado.terminalCodigo),
                  desafio: texto(criado.desafio),
                  vinculoSegredo: texto(criado.vinculoSegredo),
                  autorizacao: "",
                  estabelecimento: input.estabelecimento,
                },
              ],
              origem: input.origem,
              idempotencyKeyVenda: null,
              proibirConfirmacao: true,
            },
            { fetchImpl }
          );
          desfezAtual = pedido.desfez;
        }
        return {
          ok: false as const,
          erro: desconhecido
            ? desfezAtual > 0
              ? "A cobrança TEF foi desfeita porque a venda não foi registrada. Não cobre novamente."
              : "O resultado do TEF ficou desconhecido. Não cobre novamente até a reconciliação."
            : registro.erro ||
              texto(pagamento.erro) ||
              "O TEF não autorizou este pagamento.",
          operacoes: prontas,
        };
      }
    }

    if (!texto(criado.vinculoSegredo)) {
      return {
        ok: false as const,
        erro: "A autorização TEF não pode ser reaproveitada. Recupere a pendência neste terminal.",
        operacoes: prontas,
      };
    }

    prontas.push({
      formaPagamentoId: parcela.formaPagamentoId,
      operacaoId: criado.operacaoId,
      valorCentavos: parcela.valorCentavos,
      identificador: criado.identificador,
      empresaId: texto(criado.empresaId),
      terminalCodigo: texto(criado.terminalCodigo),
      desafio: texto(criado.desafio),
      vinculoSegredo: texto(criado.vinculoSegredo),
      autorizacao: "",
      estabelecimento: input.estabelecimento,
    });
  }

  return { ok: true as const, operacoes: prontas, origem: input.origem };
}

export async function confirmarTefAposVenda(
  input: { vendaId: string; operacoes: CobrancaTefPronta[]; origem: string },
  deps: { fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  for (const operacao of input.operacoes) {
    const liberada = (await lerJson(
      await fetchImpl("/api/pdv/tef/liberar-confirmacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operacaoId: operacao.operacaoId,
          vendaId: input.vendaId,
        }),
      })
    )) as ResultadoApi;
    if (!liberada.ok || liberada.confirmar !== true) {
      return {
        ok: false as const,
        erro:
          liberada.erro ||
          "A venda foi registrada, mas a confirmação TEF não foi liberada. Não cobre novamente.",
      };
    }
    const confirmado = await lerJson(
      await fetchImpl(`${input.origem}/tef/confirmar`, {
        method: "POST",
        headers: cabecalhosTef({
          ...operacao,
          desafio: texto(liberada.desafio) || operacao.desafio,
          identificador: texto(liberada.identificador) || operacao.identificador,
          valorCentavos: liberada.valorCentavos ?? operacao.valorCentavos,
          autorizacao: texto(liberada.autorizacao) || operacao.autorizacao,
        }),
        body: JSON.stringify({
          acao: "confirmar",
          rede: liberada.rede,
          nsu: liberada.nsu,
          finalizacao: liberada.finalizacao,
        }),
      })
    );
    const registrada = (await lerJson(
      await fetchImpl("/api/pdv/tef/registrar-confirmacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operacaoId: operacao.operacaoId,
          prova: confirmado.prova,
        }),
      })
    )) as ResultadoApi;
    if (confirmado.ok !== true || registrada.ok !== true || registrada.status !== "confirmada") {
      return {
        ok: false as const,
        erro:
          "A venda foi registrada, mas a confirmação TEF falhou. Não cobre novamente.",
      };
    }
  }
  return { ok: true as const };
}

export async function desfazerCobrancasTef(
  input: {
    operacoes: CobrancaTefPronta[];
    origem: string;
    idempotencyKeyVenda: string | null;
    proibirConfirmacao?: boolean;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let desfez = 0;
  for (const operacao of input.operacoes) {
    const pedido = (await lerJson(
      await fetchImpl("/api/pdv/tef/desfazer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operacaoId: operacao.operacaoId,
          idempotencyKeyVenda: input.idempotencyKeyVenda,
        }),
      })
    )) as ResultadoApi;
    if (pedido.executar === "confirmar") {
      if (input.proibirConfirmacao) {
        continue;
      }
      const confirmado = await lerJson(
        await fetchImpl(`${input.origem}/tef/confirmar`, {
          method: "POST",
          headers: cabecalhosTef({
            ...operacao,
            desafio: texto(pedido.desafio),
            identificador: texto(pedido.identificador),
            valorCentavos: pedido.valorCentavos,
            autorizacao: texto(pedido.autorizacao),
          }),
          body: JSON.stringify({
            acao: "confirmar",
            rede: pedido.rede,
            nsu: pedido.nsu,
            finalizacao: pedido.finalizacao,
          }),
        })
      );
      await fetchImpl("/api/pdv/tef/registrar-confirmacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operacaoId: operacao.operacaoId,
          prova: confirmado.prova,
        }),
      });
      continue;
    }
    if (pedido.executar !== "desfazer") {
      continue;
    }
    const desfeito = await lerJson(
      await fetchImpl(`${input.origem}/tef/desfazer`, {
        method: "POST",
        headers: cabecalhosTef({
          ...operacao,
          desafio: texto(pedido.desafio),
          identificador: texto(pedido.identificador),
          valorCentavos: pedido.valorCentavos,
          autorizacao: texto(pedido.autorizacao),
        }),
        body: JSON.stringify({
          acao: "desfazer",
          rede: pedido.rede,
          nsu: pedido.nsu,
          finalizacao: pedido.finalizacao,
        }),
      })
    );
    await fetchImpl("/api/pdv/tef/registrar-desfazimento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operacaoId: operacao.operacaoId,
        prova: desfeito.prova,
      }),
    });
    if (desfeito.ok === true) {
      desfez += 1;
    }
  }
  return { desfez };
}

export async function reenviarProvaLocal(
  input: {
    origem: string;
    empresaId: string;
    terminalCodigo: string;
    estabelecimento?: string;
    pendencias: Array<{ id: string; identificador?: string; status?: string }>;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const candidatas = input.pendencias.filter(
    (item) => item.status === "iniciada" || item.status === "desconhecida"
  );
  if (candidatas.length === 0) {
    return { ok: true as const, reenviadas: 0 };
  }
  const resposta = await lerJson(
    await fetchImpl(`${input.origem}/tef/recuperacao`, {
      cache: "no-store",
      headers: cabecalhosTef({
        empresaId: input.empresaId,
        terminalCodigo: input.terminalCodigo,
        estabelecimento: input.estabelecimento,
      }),
    })
  );
  const recuperacao = (resposta.recuperacao ?? null) as Record<string, unknown> | null;
  if (!recuperacao || resposta.ok !== true) {
    return { ok: true as const, reenviadas: 0 };
  }
  const pendencia = candidatas.find(
    (item) => item.identificador && item.identificador === texto(recuperacao.identificador)
  );
  if (!pendencia) {
    return { ok: true as const, reenviadas: 0 };
  }
  const registro = (await lerJson(
    await fetchImpl("/api/pdv/tef/resultado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operacaoId: pendencia.id,
        prova: recuperacao.prova,
        sucessoTransacao: recuperacao.sucessoTransacao,
        nsu: recuperacao.nsu,
        autorizacao: recuperacao.autorizacao,
        rede: recuperacao.rede,
        finalizacao: recuperacao.finalizacao,
        valor: recuperacao.valor,
        confirmar: recuperacao.confirmar,
        precisaConfirmacao: recuperacao.precisaConfirmacao,
        transacaoPendenteConfirmacao: recuperacao.transacaoPendenteConfirmacao,
        cancelada: recuperacao.cancelada,
        codigo: recuperacao.codigo,
        nomeBandeiraPadrao: recuperacao.nomeBandeiraPadrao || recuperacao.bandeira,
        cnpjCredenciadora: recuperacao.cnpjCredenciadora,
        cnpjRecebedor: recuperacao.cnpjRecebedor,
        instituicao: recuperacao.instituicao,
      }),
    })
  )) as ResultadoApi;
  return { ok: registro.ok === true, reenviadas: registro.ok === true ? 1 : 0, status: registro.status };
}
