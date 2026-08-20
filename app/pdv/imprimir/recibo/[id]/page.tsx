import {
  notFound,
  redirect,
} from "next/navigation";

import { ControlesImpressao } from "@/components/impressao/controles-impressao";
import { createClient } from "@/lib/supabase/server";

export const dynamic =
  "force-dynamic";

const moeda =
  new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  );

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

function somenteDigitos(
  valor:
    | string
    | null
) {
  return String(
    valor ?? ""
  ).replace(/\D/g, "");
}

function formatarDocumento(
  valor:
    | string
    | null
) {
  const d =
    somenteDigitos(valor);

  if (d.length === 11) {
    return d.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      "$1.$2.$3-$4"
    );
  }

  if (d.length === 14) {
    return d.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }

  return d || "—";
}

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    auto?: string;
  }>;
};

export default async function ReciboVendaPage({
  params,
  searchParams,
}: PageProps) {
  const { id } =
    await params;

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

  const [
    vendaResult,
    empresaResult,
    fiscalResult,
    itensResult,
    pagamentosResult,
  ] = await Promise.all([
    supabase
      .from("vendas")
      .select(`
        id,
        numero,
        cliente_id,
        usuario_id,
        status,
        valor_produtos,
        desconto,
        acrescimo,
        frete,
        valor_total,
        troco,
        observacao,
        finalizada_at,
        created_at
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq("id", id)
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

    supabase
      .from(
        "empresas_fiscal"
      )
      .select(`
        inscricao_estadual,
        telefone,
        logradouro,
        numero,
        complemento,
        bairro,
        municipio,
        uf,
        cep
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle(),

    supabase
      .from(
        "vendas_itens"
      )
      .select(`
        id,
        produto_codigo,
        produto_nome,
        unidade_medida,
        quantidade,
        valor_unitario,
        desconto,
        acrescimo,
        valor_total
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "venda_id",
        id
      )
      .order(
        "created_at",
        {
          ascending: true,
        }
      ),

    supabase
      .from(
        "vendas_pagamentos"
      )
      .select(`
        id,
        forma_pagamento_nome,
        forma_pagamento_codigo,
        valor,
        troco,
        status
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "venda_id",
        id
      )
      .eq(
        "status",
        "confirmado"
      )
      .order(
        "created_at",
        {
          ascending: true,
        }
      ),
  ]);

  const erro =
    vendaResult.error ??
    empresaResult.error ??
    fiscalResult.error ??
    itensResult.error ??
    pagamentosResult.error;

  if (erro) {
    throw new Error(
      erro.message
    );
  }

  const venda =
    vendaResult.data;

  if (!venda) {
    notFound();
  }

  let cliente:
    | {
        nome:
          | string
          | null;
        cpf_cnpj:
          | string
          | null;
        telefone:
          | string
          | null;
      }
    | null = null;

  if (venda.cliente_id) {
    const {
      data,
      error,
    } = await supabase
      .from("clientes")
      .select(`
        nome,
        cpf_cnpj,
        telefone
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "id",
        venda.cliente_id
      )
      .maybeSingle();

    if (error) {
      throw new Error(
        error.message
      );
    }

    cliente = data;
  }

  let operadorNome =
    "—";

  if (venda.usuario_id) {
    const {
      data: operador,
    } = await supabase
      .from("usuarios")
      .select("nome")
      .eq(
        "id",
        venda.usuario_id
      )
      .maybeSingle();

    if (operador?.nome) {
      operadorNome =
        operador.nome;
    }
  }

  const empresa =
    empresaResult.data;

  const fiscal =
    fiscalResult.data;

  const endereco = [
    fiscal?.logradouro,
    fiscal?.numero,
    fiscal?.bairro,
    fiscal?.municipio,
    fiscal?.uf,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-5 text-zinc-950 print:bg-white print:p-0">
      <style>{`
        @page {
          size: 80mm auto;
          margin: 4mm;
        }

        @media print {
          html, body {
            background: white !important;
          }

          body {
            width: 72mm;
            margin: 0 auto;
          }
        }
      `}</style>

      <div className="mx-auto w-full max-w-[80mm]">
        <ControlesImpressao
          autoPrint={
            auto === "1"
          }
          voltarHref={
            `/vendas/${venda.id}`
          }
        />

        <article className="bg-white px-3 py-4 font-mono text-[11px] leading-4 shadow-sm print:p-0 print:shadow-none">
          <header className="text-center">
            <h1 className="text-sm font-bold">
              {empresa?.nome_fantasia ??
                empresa?.razao_social ??
                "Empresa"}
            </h1>

            {empresa?.razao_social &&
              empresa?.razao_social !==
                empresa?.nome_fantasia && (
                <p className="mt-1">
                  {
                    empresa.razao_social
                  }
                </p>
              )}

            <p>
              CNPJ:{" "}
              {formatarDocumento(
                empresa?.cnpj ??
                  null
              )}
            </p>

            {fiscal?.inscricao_estadual && (
              <p>
                IE:{" "}
                {
                  fiscal.inscricao_estadual
                }
              </p>
            )}

            {endereco && (
              <p>
                {endereco}
              </p>
            )}

            {fiscal?.telefone && (
              <p>
                Tel.:{" "}
                {
                  fiscal.telefone
                }
              </p>
            )}
          </header>

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <div className="text-center">
            <p className="text-sm font-bold">
              RECIBO DE VENDA
            </p>

            <p>
              Venda nº{" "}
              {venda.numero ?? "—"}
            </p>

            <p>
              {
                dataHora(
                  venda.finalizada_at ??
                    venda.created_at
                )
              }
            </p>

            <p>
              Status:{" "}
              {
                String(
                  venda.status
                ).toUpperCase()
              }
            </p>
          </div>

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <div>
            <p>
              Cliente:{" "}
              <strong>
                {cliente?.nome ??
                  "Consumidor não identificado"}
              </strong>
            </p>

            {cliente?.cpf_cnpj && (
              <p>
                CPF/CNPJ:{" "}
                {formatarDocumento(
                  cliente.cpf_cnpj
                )}
              </p>
            )}

            {cliente?.telefone && (
              <p>
                Telefone:{" "}
                {
                  cliente.telefone
                }
              </p>
            )}

            <p>
              Operador:{" "}
              {operadorNome}
            </p>
          </div>

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <div className="space-y-3">
            {(itensResult.data ?? []).map(
              (item) => (
                <div
                  key={
                    item.id
                  }
                >
                  <p className="font-bold">
                    {
                      item.produto_nome
                    }
                  </p>

                  <div className="flex justify-between gap-2">
                    <span>
                      {Number(
                        item.quantidade
                      )}{" "}
                      {item.unidade_medida ??
                        "UN"}{" "}
                      x{" "}
                      {moeda.format(
                        Number(
                          item.valor_unitario ??
                            0
                        )
                      )}
                    </span>

                    <strong>
                      {moeda.format(
                        Number(
                          item.valor_total ??
                            0
                        )
                      )}
                    </strong>
                  </div>

                  {Number(
                    item.desconto ??
                      0
                  ) > 0 && (
                    <p>
                      Desconto item:{" "}
                      {moeda.format(
                        Number(
                          item.desconto
                        )
                      )}
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <div className="space-y-1">
            <Linha
              nome="Produtos"
              valor={moeda.format(
                Number(
                  venda.valor_produtos ??
                    0
                )
              )}
            />

            {Number(
              venda.desconto ?? 0
            ) > 0 && (
              <Linha
                nome="Desconto"
                valor={`- ${moeda.format(
                  Number(
                    venda.desconto
                  )
                )}`}
              />
            )}

            {Number(
              venda.acrescimo ?? 0
            ) > 0 && (
              <Linha
                nome="Acréscimo"
                valor={moeda.format(
                  Number(
                    venda.acrescimo
                  )
                )}
              />
            )}

            {Number(
              venda.frete ?? 0
            ) > 0 && (
              <Linha
                nome="Frete"
                valor={moeda.format(
                  Number(
                    venda.frete
                  )
                )}
              />
            )}

            <div className="mt-2 flex justify-between gap-2 text-sm font-bold">
              <span>
                TOTAL
              </span>
              <span>
                {moeda.format(
                  Number(
                    venda.valor_total ??
                      0
                  )
                )}
              </span>
            </div>
          </div>

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <div>
            <p className="mb-1 font-bold">
              PAGAMENTO
            </p>

            {(pagamentosResult.data ?? []).map(
              (pagamento) => (
                <Linha
                  key={
                    pagamento.id
                  }
                  nome={
                    pagamento.forma_pagamento_nome ??
                    pagamento.forma_pagamento_codigo ??
                    "Pagamento"
                  }
                  valor={moeda.format(
                    Number(
                      pagamento.valor ??
                        0
                    )
                  )}
                />
              )
            )}

            {Number(
              venda.troco ?? 0
            ) > 0 && (
              <Linha
                nome="Troco"
                valor={moeda.format(
                  Number(
                    venda.troco
                  )
                )}
              />
            )}
          </div>

          {venda.observacao && (
            <>
              <div className="my-3 border-t border-dashed border-zinc-500" />

              <p className="whitespace-pre-wrap">
                Obs.:{" "}
                {
                  venda.observacao
                }
              </p>
            </>
          )}

          <div className="my-3 border-t border-dashed border-zinc-500" />

          <footer className="text-center text-[10px] leading-4">
            <p className="font-bold">
              Obrigado pela preferência!
            </p>

            <p className="mt-2">
              RECIBO COMERCIAL
            </p>

            <p>
              Não substitui documento fiscal.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Linha({
  nome,
  valor,
}: {
  nome: string;
  valor: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span>
        {nome}
      </span>
      <span className="text-right">
        {valor}
      </span>
    </div>
  );
}
