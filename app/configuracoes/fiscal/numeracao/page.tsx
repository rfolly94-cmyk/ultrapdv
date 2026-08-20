import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  NumeracaoFiscalForm,
} from "@/components/fiscal/numeracao-fiscal-form";

function ambienteNormalizado(
  valor: unknown
): "1" | "2" {
  const texto =
    String(
      valor ??
      ""
    )
      .trim()
      .toLowerCase();

  return (
    texto === "1" ||
    texto ===
      "producao" ||
    texto ===
      "produção"
  )
    ? "1"
    : "2";
}

export default async function NumeracaoFiscalPage() {
  const supabase =
    await createClient();

  const {
    data: claims,
    error: authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claims?.claims?.sub
  ) {
    redirect("/login");
  }

  const {
    data: vinculo,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id"
      )
      .eq(
        "usuario_id",
        String(claims.claims.sub)
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  if (!vinculo) {
    redirect(
      "/onboarding"
    );
  }

  const empresaId =
    vinculo.empresa_id;

  const [
    empresaResult,
    fiscalResult,
    numeracoesResult,
    emissoesResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "empresas"
        )
        .select(
          "id, razao_social, nome_fantasia"
        )
        .eq(
          "id",
          empresaId
        )
        .maybeSingle(),

      supabase
        .from(
          "empresas_fiscal"
        )
        .select(
          "empresa_id, ambiente, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      supabase
        .from(
          "fiscal_numeracoes"
        )
        .select(`
          id,
          modelo,
          ambiente,
          serie,
          proximo_numero,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .in(
          "modelo",
          [
            "55",
            "65",
          ]
        )
        .order(
          "ambiente",
          {
            ascending:
              true,
          }
        )
        .order(
          "modelo",
          {
            ascending:
              true,
          }
        )
        .order(
          "serie",
          {
            ascending:
              true,
          }
        ),

      supabase
        .from(
          "fiscal_emissoes"
        )
        .select(`
          modelo,
          ambiente,
          serie,
          numero
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .in(
          "modelo",
          [
            "55",
            "65",
          ]
        )
        .order(
          "numero",
          {
            ascending:
              false,
          }
        )
        .limit(
          1000
        ),
    ]);

  const primeiroErro =
    empresaResult.error ??
    fiscalResult.error ??
    numeracoesResult.error ??
    emissoesResult.error;

  if (
    primeiroErro
  ) {
    throw new Error(
      primeiroErro.message
    );
  }

  const ambienteAtual =
    ambienteNormalizado(
      fiscalResult.data
        ?.ambiente
    );

  const maiores =
    new Map<
      string,
      {
        modelo:
          | "55"
          | "65";
        ambiente:
          number;
        serie:
          number;
        maior_numero:
          number;
      }
    >();

  for (
    const emissao of
    emissoesResult.data ??
    []
  ) {
    const modelo =
      String(
        emissao.modelo
      );

    if (
      modelo !== "55" &&
      modelo !== "65"
    ) {
      continue;
    }

    const ambiente =
      Number(
        emissao.ambiente
      );

    const serie =
      Number(
        emissao.serie
      );

    const numero =
      Number(
        emissao.numero
      );

    if (
      ![
        1,
        2,
      ].includes(
        ambiente
      ) ||
      !Number.isInteger(
        serie
      ) ||
      !Number.isFinite(
        numero
      )
    ) {
      continue;
    }

    const chave =
      `${modelo}:${ambiente}:${serie}`;

    const atual =
      maiores.get(
        chave
      );

    if (
      !atual ||
      numero >
        atual.maior_numero
    ) {
      maiores.set(
        chave,
        {
          modelo,
          ambiente,
          serie,
          maior_numero:
            numero,
        }
      );
    }
  }

  return (
    <div className="updv-config space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Ambiente atual
          </p>
          <p className="mt-1 font-semibold text-zinc-900">
            {ambienteAtual === "1" ? "Produção" : "Homologação"}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            {empresaResult.data?.nome_fantasia ||
              empresaResult.data?.razao_social ||
              "Empresa ativa"}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] leading-6 text-blue-950">
        Você pode pré-configurar a numeração de produção sem trocar o ambiente atual. A emissão continuará obedecendo o ambiente configurado em Configurações Fiscais.
      </div>

      <NumeracaoFiscalForm
        ambienteAtual={
          ambienteAtual
        }
        numeracoes={
          (
            numeracoesResult.data ??
            []
          ).map(
            (item) => ({
              id:
                item.id,
              modelo:
                String(
                  item.modelo
                ) as
                  | "55"
                  | "65",
              ambiente:
                Number(
                  item.ambiente
                ),
              serie:
                Number(
                  item.serie
                ),
              proximo_numero:
                item
                  .proximo_numero,
              ativo:
                Boolean(
                  item.ativo
                ),
            })
          )
        }
        ultimasEmissoes={[
          ...maiores.values(),
        ]}
      />
    </div>
  );
}
