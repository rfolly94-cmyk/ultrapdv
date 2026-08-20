import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

import { createAdminClient } from "@/lib/supabase/admin";
import { reconciliarEmissaoFiscal } from "@/lib/fiscal/reconciliar-emissao";

const LIMITE_POR_CICLO = 5;
const INTERVALO_MINIMO_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_CRON = 8;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

async function executar(request: NextRequest) {
  const segredo = process.env.CRON_SECRET?.trim();

  if (!segredo) {
    return json(
      { ok: false, erro: "CRON_SECRET não está configurado no servidor." },
      503
    );
  }

  const authorization = request.headers.get("authorization")?.trim();

  if (authorization !== `Bearer ${segredo}`) {
    return json({ ok: false, erro: "Não autorizado." }, 401);
  }

  const admin = createAdminClient();
  const agora = Date.now();

  const { data: pendentes, error } = await admin
    .from("fiscal_emissoes")
    .select("id, empresa_id, modelo, resposta_resumo")
    .in("modelo", ["55", "65"])
    .eq("status", "aguardando_reconciliacao")
    .order("created_at", { ascending: true })
    .limit(40);

  if (error) {
    return json({ ok: false, erro: error.message }, 500);
  }

  const resultados = [];

  for (const item of pendentes ?? []) {
    if (resultados.length >= LIMITE_POR_CICLO) {
      break;
    }

    const { data: consultas } = await admin
      .from("fiscal_emissao_eventos")
      .select("created_at, payload_resumo")
      .eq("empresa_id", item.empresa_id)
      .eq("emissao_id", item.id)
      .eq("tipo", "consulta_status")
      .order("created_at", { ascending: false })
      .limit(MAX_TENTATIVAS_CRON);

    const cronAnteriores = (consultas ?? []).filter((evento) => {
      const payload = evento.payload_resumo as { origem?: string } | null;
      return payload?.origem === "cron";
    });

    if (cronAnteriores.length >= MAX_TENTATIVAS_CRON) {
      continue;
    }

    const consultaLocal = (
      item.resposta_resumo as { consulta?: { em?: string } } | null
    )?.consulta?.em;
    const ultima = consultas?.[0]?.created_at ?? consultaLocal;
    if (ultima && agora - new Date(ultima).getTime() < INTERVALO_MINIMO_MS) {
      continue;
    }

    try {
      const resultado = await reconciliarEmissaoFiscal({
        admin,
        empresaId: item.empresa_id,
        emissaoId: item.id,
        origem: "cron",
      });

      resultados.push(resultado);
    } catch (erro) {
      resultados.push({
        ok: false,
        emissao_id: item.id,
        status: "aguardando_reconciliacao",
        situacao: "falha_consulta",
        mensagem:
          erro instanceof Error
            ? erro.message
            : "Falha ao reconciliar automaticamente.",
        reenviou: false,
      });
    }
  }

  return json({
    ok: true,
    processadas: resultados.length,
    autorizadas: resultados.filter((item) => item.status === "autorizada")
      .length,
    rejeitadas: resultados.filter((item) => item.status === "rejeitada")
      .length,
    pendentes: resultados.filter(
      (item) => item.status === "aguardando_reconciliacao"
    ).length,
    resultados,
  });
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
