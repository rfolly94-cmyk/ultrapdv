import { NextResponse } from "next/server";

import {
  executarFinalizacaoVendaPdv,
  type FinalizarVendaPdvInput,
} from "@/app/pdv/actions";
import { extrairBearerAuthorization } from "@/lib/supabase/bearer";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function comCors(resposta: NextResponse) {
  resposta.headers.set("Access-Control-Allow-Origin", "*");
  resposta.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  resposta.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return resposta;
}

function json(body: unknown, status = 200) {
  return comCors(NextResponse.json(body, { status }));
}

export async function OPTIONS() {
  return comCors(new NextResponse(null, { status: 204 }));
}

function inteiroNaoNegativo(valor: unknown) {
  return Number.isInteger(valor) && Number(valor) >= 0;
}

function lerCorpo(body: unknown): FinalizarVendaPdvInput | { erro: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { erro: "Payload inválido." };
  }

  const dados = body as Record<string, unknown>;
  const idempotencyKey = String(dados.idempotencyKey ?? "").trim();
  const clienteIdBruto = dados.clienteId;
  const clienteId =
    clienteIdBruto == null || clienteIdBruto === ""
      ? null
      : String(clienteIdBruto).trim();

  if (!UUID.test(idempotencyKey)) {
    return { erro: "Chave de idempotência inválida." };
  }

  if (clienteId && !UUID.test(clienteId)) {
    return { erro: "Cliente inválido." };
  }

  if (!inteiroNaoNegativo(dados.descontoCentavos)) {
    return { erro: "Desconto inválido." };
  }

  if (!Array.isArray(dados.itens) || dados.itens.length === 0) {
    return { erro: "Adicione ao menos um produto." };
  }

  if (!Array.isArray(dados.pagamentos) || dados.pagamentos.length === 0) {
    return { erro: "Informe o pagamento." };
  }

  const itens: FinalizarVendaPdvInput["itens"] = [];
  for (const item of dados.itens) {
    if (!item || typeof item !== "object") {
      return { erro: "Item da venda inválido." };
    }
    const linha = item as Record<string, unknown>;
    const produtoId = String(linha.produtoId ?? "").trim();
    const quantidade = linha.quantidade;
    if (!UUID.test(produtoId) || !Number.isInteger(quantidade) || Number(quantidade) <= 0) {
      return { erro: "Item da venda inválido." };
    }
    itens.push({
      produtoId,
      quantidade: Number(quantidade),
    });
  }

  const pagamentos: FinalizarVendaPdvInput["pagamentos"] = [];
  for (const pagamento of dados.pagamentos) {
    if (!pagamento || typeof pagamento !== "object") {
      return { erro: "Pagamento inválido." };
    }
    const linha = pagamento as Record<string, unknown>;
    const formaPagamentoId = String(linha.formaPagamentoId ?? "").trim();
    const valorCentavos = linha.valorCentavos;
    if (
      !UUID.test(formaPagamentoId) ||
      !Number.isInteger(valorCentavos) ||
      Number(valorCentavos) <= 0
    ) {
      return { erro: "Pagamento inválido." };
    }
    pagamentos.push({
      formaPagamentoId,
      valorCentavos: Number(valorCentavos),
    });
  }

  return {
    idempotencyKey,
    clienteId,
    descontoCentavos: Number(dados.descontoCentavos),
    trocoCentavos: 0,
    observacao:
      typeof dados.observacao === "string" ? dados.observacao : null,
    itens,
    pagamentos,
  };
}

export async function POST(request: Request) {
  if (!extrairBearerAuthorization(request.headers.get("authorization"))) {
    return json({ ok: false, erro: "Não autenticado." }, 401);
  }

  let bruto: unknown;
  try {
    bruto = await request.json();
  } catch {
    return json({ ok: false, erro: "Payload inválido." }, 400);
  }

  const corpo = lerCorpo(bruto);
  if ("erro" in corpo) {
    return json({ ok: false, erro: corpo.erro }, 400);
  }

  const resultado = await executarFinalizacaoVendaPdv(corpo);

  if (!resultado.ok) {
    const status =
      resultado.codigo === "NAO_AUTENTICADO"
        ? 401
        : resultado.codigo === "SEM_EMPRESA"
          ? 403
          : resultado.codigo === "RECURSO_NAO_CONTRATADO"
            ? 403
            : 400;
    return json(
      {
        ok: false,
        erro: resultado.erro,
        codigo: resultado.codigo,
      },
      status
    );
  }

  return json({
    ok: true,
    vendaId: resultado.vendaId,
    numero: resultado.numero,
    valorTotalCentavos: resultado.valorTotalCentavos,
  });
}
