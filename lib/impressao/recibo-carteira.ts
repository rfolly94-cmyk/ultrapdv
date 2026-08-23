export type ItemReciboRecebimentoCarteira = {
  numeroVenda: string | number | null;
  produtoNome: string;
  valorAplicado: number;
};

export type ReciboRecebimentoCarteira = {
  empresaNome: string;
  empresaDocumento: string;
  empresaTelefone: string;
  empresaEndereco: string;
  clienteNome: string;
  clienteDocumento: string;
  recebimentoId: string;
  dataIso: string | null;
  dataHora: string;
  formaPagamento: string;
  valor: number;
  itens: ItemReciboRecebimentoCarteira[];
  operadorNome: string;
  rodapeDataHora: string;
};

function dinheiro(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function dataHoraRecibo(valor: string | null | undefined) {
  if (!valor) {
    return "-";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(valor));
}

export function dataArquivoRecibo(valor: string | null | undefined) {
  if (!valor) {
    return "sem-data";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(valor));
}

export function slugArquivoRecibo(texto: string) {
  const slug = String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "cliente";
}

export function nomeArquivoReciboRecebimento(input: {
  clienteNome: string;
  dataIso: string | null | undefined;
  recebimentoId: string;
}) {
  const cliente = slugArquivoRecibo(input.clienteNome);
  const data = dataArquivoRecibo(input.dataIso);
  const id = String(input.recebimentoId ?? "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 8);
  return `Recibo-${cliente}-${data}-${id || "recibo"}.pdf`;
}

export function montarItensReciboRecebimento(input: {
  alocacoes: Array<{ item_id: string; valor: number | string }>;
  itens: Array<{
    id: string;
    titulo_id: string;
    produto_nome: string;
    valor_aberto?: number | string;
  }>;
  titulos: Array<{ id: string; numero_venda: number | string | null }>;
}): ItemReciboRecebimentoCarteira[] {
  const itemPorId = new Map(input.itens.map((item) => [item.id, item]));
  const tituloPorId = new Map(
    input.titulos.map((titulo) => [titulo.id, titulo])
  );

  return input.alocacoes.map((alocacao) => {
    const item = itemPorId.get(alocacao.item_id);
    const titulo = item ? tituloPorId.get(item.titulo_id) : undefined;
    return {
      numeroVenda: titulo?.numero_venda ?? null,
      produtoNome: item?.produto_nome || "Item",
      valorAplicado: numero(alocacao.valor),
    };
  });
}

export function urlPdfReciboRecebimento(input: {
  recebimentoId: string;
  clienteId: string;
  papel?: string;
}) {
  const papel = encodeURIComponent(input.papel || "80mm");
  const cliente = encodeURIComponent(input.clienteId);
  return `/api/impressao/carteira-recebimento/${input.recebimentoId}?cliente=${cliente}&papel=${papel}`;
}

export function linhasReciboRecebimentoCarteira(
  recibo: ReciboRecebimentoCarteira
) {
  const linhas = [
    recibo.empresaNome,
    recibo.empresaDocumento ? `CNPJ/CPF ${recibo.empresaDocumento}` : "",
    recibo.empresaTelefone ? `Tel ${recibo.empresaTelefone}` : "",
    recibo.empresaEndereco,
    "--------------------------------",
    "RECIBO DE RECEBIMENTO",
    "--------------------------------",
    `Cliente: ${recibo.clienteNome}`,
    recibo.clienteDocumento ? `CPF/CNPJ ${recibo.clienteDocumento}` : "",
    "--------------------------------",
    `Data/hora: ${recibo.dataHora}`,
    `Forma: ${recibo.formaPagamento}`,
    `Valor recebido: ${dinheiro(recibo.valor)}`,
    `Recebimento: ${recibo.recebimentoId}`,
    "--------------------------------",
  ].filter((linha) => linha.length > 0);

  let ultimaVenda: string | null = null;
  for (const item of recibo.itens) {
    const venda = `Venda #${item.numeroVenda ?? "-"}`;
    if (venda !== ultimaVenda) {
      linhas.push(venda);
      ultimaVenda = venda;
    }
    linhas.push(item.produtoNome);
    linhas.push(`Valor aplicado: ${dinheiro(item.valorAplicado)}`);
  }

  if (!recibo.itens.length) {
    linhas.push("Nenhum item vinculado a este recebimento.");
  }

  linhas.push(
    "--------------------------------",
    `Total recebido: ${dinheiro(recibo.valor)}`,
    "--------------------------------",
    "Recebimento registrado no UltraPDV",
    recibo.operadorNome ? `Operador: ${recibo.operadorNome}` : "",
    recibo.rodapeDataHora
  );

  return linhas.filter((linha) => linha.length > 0);
}
