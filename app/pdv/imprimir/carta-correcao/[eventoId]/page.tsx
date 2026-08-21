import {
  notFound,
  redirect,
} from "next/navigation";

import { ControlesImpressao } from "@/components/impressao/controles-impressao";
import { hrefOrigemEmissaoFiscal } from "@/lib/fiscal/acoes-emissao";
import { createClient } from "@/lib/supabase/server";

export const dynamic =
  "force-dynamic";

function dataHora(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle: "short",
      timeStyle: "short",
      timeZone:
        "America/Cuiaba",
    }
  ).format(data);
}

function formatarCnpj(
  valor:
    | string
    | null
) {
  const d =
    String(
      valor ?? ""
    ).replace(/\D/g, "");

  if (d.length !== 14) {
    return d || "—";
  }

  return d.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5"
  );
}

function chaveFormatada(
  valor:
    | string
    | null
) {
  const d =
    String(
      valor ?? ""
    ).replace(/\D/g, "");

  if (d.length !== 44) {
    return valor ?? "—";
  }

  return d.match(/.{1,4}/g)?.join(
    " "
  ) ?? d;
}

type PageProps = {
  params: Promise<{
    eventoId: string;
  }>;
  searchParams: Promise<{
    auto?: string;
  }>;
};

export default async function ImprimirCartaCorrecaoPage({
  params,
  searchParams,
}: PageProps) {
  const {
    eventoId,
  } = await params;

  const {
    auto,
  } = await searchParams;

  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select("empresa_id")
      .eq(
        "usuario_id",
        String(claimsData.claims.sub)
      )
      .eq(
        "principal",
        true
      )
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const {
    data: evento,
    error: eventoError,
  } = await supabase
    .from(
      "fiscal_emissao_eventos"
    )
    .select(`
      id,
      emissao_id,
      tipo,
      status,
      sequencia,
      texto_correcao,
      cstat,
      protocolo,
      motivo,
      concluido_at,
      created_at
    `)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .eq("id", eventoId)
    .maybeSingle();

  if (eventoError) {
    throw new Error(
      eventoError.message
    );
  }

  if (
    !evento ||
    evento.tipo !==
      "carta_correcao" ||
    evento.status !==
      "sucesso"
  ) {
    notFound();
  }

  const [
    emissaoResult,
    empresaResult,
  ] = await Promise.all([
    supabase
      .from(
        "fiscal_emissoes"
      )
      .select(`
        id,
        origem_id,
        origem_tipo,
        modelo,
        serie,
        numero,
        chave_acesso,
        protocolo,
        autorizada_at,
        status
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "id",
        evento.emissao_id
      )
      .maybeSingle(),

    supabase
      .from("empresas")
      .select(`
        razao_social,
        nome_fantasia,
        cnpj
      `)
      .eq(
        "id",
        vinculo.empresa_id
      )
      .maybeSingle(),
  ]);

  if (
    emissaoResult.error ||
    empresaResult.error
  ) {
    throw new Error(
      emissaoResult.error?.message ??
        empresaResult.error?.message ??
        "Erro ao carregar Carta de Correção."
    );
  }

  const emissao =
    emissaoResult.data;

  if (
    !emissao ||
    emissao.modelo !== "55"
  ) {
    notFound();
  }

  const empresa =
    empresaResult.data;

  return (
    <main className="min-h-screen bg-zinc-100 p-5 text-zinc-950 print:bg-white print:p-0">
      <style>{`
        @page {
          size: A4;
          margin: 14mm;
        }

        @media print {
          html, body {
            background: white !important;
          }
        }
      `}</style>

      <div className="mx-auto max-w-3xl">
        <ControlesImpressao
          autoPrint={
            auto === "1"
          }
          voltarHref={
            hrefOrigemEmissaoFiscal(
              emissao.origem_tipo,
              emissao.origem_id
            ) ?? undefined
          }
          pdfUrl={`/api/impressao/carta-correcao/${evento.id}`}
          tipoDocumento="danfe_nfe"
          papel="a4"
        />

        <article className="rounded-2xl bg-white p-8 shadow-sm print:rounded-none print:p-0 print:shadow-none">
          <header className="border-b border-zinc-300 pb-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Representação para impressão
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Carta de Correção Eletrônica — CC-e
            </h1>

            <p className="mt-1 text-sm text-zinc-500">
              Evento vinculado à NF-e modelo 55
            </p>
          </header>

          <section className="grid gap-3 border-b border-zinc-200 py-5 text-sm sm:grid-cols-2">
            <Info
              titulo="Emitente"
              valor={
                empresa?.razao_social ??
                empresa?.nome_fantasia ??
                "—"
              }
            />

            <Info
              titulo="CNPJ"
              valor={formatarCnpj(
                empresa?.cnpj ??
                  null
              )}
            />

            <Info
              titulo="NF-e"
              valor={`Série ${emissao.serie} · nº ${emissao.numero}`}
            />

            <Info
              titulo="Sequência da CC-e"
              valor={`CC-e nº ${evento.sequencia ?? "—"}`}
            />

            <Info
              titulo="Data do evento"
              valor={dataHora(
                evento.concluido_at ??
                  evento.created_at
              )}
            />

            <Info
              titulo="Status"
              valor="AUTORIZADA"
            />

            <Info
              titulo="cStat"
              valor={
                evento.cstat ??
                "—"
              }
            />

            <Info
              titulo="Protocolo do evento"
              valor={
                evento.protocolo ??
                "—"
              }
            />
          </section>

          <section className="border-b border-zinc-200 py-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Chave de acesso da NF-e
            </p>

            <p className="mt-2 break-words font-mono text-sm leading-6">
              {chaveFormatada(
                emissao.chave_acesso
              )}
            </p>
          </section>

          <section className="py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Texto consolidado da correção
            </p>

            <div className="mt-3 rounded-xl border border-zinc-300 bg-zinc-50 p-5 text-sm leading-7 print:bg-white">
              <p className="whitespace-pre-wrap">
                {
                  evento.texto_correcao
                }
              </p>
            </div>

            {evento.motivo && (
              <div className="mt-4 text-sm text-zinc-600">
                <strong>
                  Retorno:
                </strong>{" "}
                {
                  evento.motivo
                }
              </div>
            )}
          </section>

          <footer className="border-t border-zinc-300 pt-5 text-xs leading-5 text-zinc-500">
            <p>
              Este impresso é uma representação da Carta de Correção Eletrônica para consulta e arquivo.
            </p>

            <p className="mt-2">
              O evento eletrônico autorizado, seu XML e protocolo constituem o registro fiscal da CC-e. Esta impressão não altera a NF-e original.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Info({
  titulo,
  valor,
}: {
  titulo: string;
  valor: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {titulo}
      </p>

      <p className="mt-1 font-medium text-zinc-900">
        {valor}
      </p>
    </div>
  );
}
