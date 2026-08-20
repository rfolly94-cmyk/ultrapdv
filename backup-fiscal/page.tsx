import { redirect } from "next/navigation";

import {
  inicializarFiscal,
  salvarFiscal,
} from "./actions";

import { createClient } from "@/lib/supabase/server";

type FiscalPageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function FiscalPage({
  searchParams,
}: FiscalPageProps) {
  const params = await searchParams;

  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select(`
      empresa_id,
      perfil,
      empresas (
        razao_social,
        nome_fantasia,
        cnpj
      )
    `)
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  const { data: fiscal } = await supabase
    .from("empresas_fiscal")
    .select("*")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  const { data: numeracoes } = await supabase
    .from("fiscal_numeracoes")
    .select("modelo, serie, proximo_numero")
    .eq("empresa_id", vinculo.empresa_id)
    .order("modelo");

  if (!fiscal) {
    return (
      <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm font-semibold text-zinc-500">
            UltraPDV
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            Configuração Fiscal
          </h1>

          <div className="mt-8 rounded-2xl border bg-white p-8">
            <h2 className="text-xl font-semibold">
              Preparar módulo fiscal
            </h2>

            <p className="mt-2 text-zinc-500">
              A configuração fiscal desta empresa ainda não
              foi inicializada.
            </p>

            {params.erro && (
              <div className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {params.erro}
              </div>
            )}

            <form action={inicializarFiscal} className="mt-6">
              <button
                className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
                type="submit"
              >
                Inicializar configuração fiscal
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div>
          <p className="text-sm font-semibold text-zinc-500">
            UltraPDV • Configurações
          </p>

          <h1 className="mt-1 text-3xl font-bold text-zinc-900">
            Fiscal
          </h1>

          <p className="mt-2 text-zinc-500">
            Dados utilizados na emissão de NF-e e NFC-e.
          </p>
        </div>

        {params.erro && (
          <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {params.erro}
          </div>
        )}

        {params.sucesso && (
          <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-700">
            {params.sucesso}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Emitente
          </p>

          <h2 className="mt-2 text-xl font-semibold">
            {empresa?.nome_fantasia}
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            {empresa?.razao_social}
          </p>

          <p className="mt-1 text-sm text-zinc-500">
            CNPJ: {empresa?.cnpj}
          </p>
        </div>

        <form action={salvarFiscal}>
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Dados tributários
            </h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Campo
                label="Inscrição Estadual"
                name="inscricao_estadual"
                defaultValue={fiscal.inscricao_estadual}
              />

              <Campo
                label="Inscrição Municipal"
                name="inscricao_municipal"
                defaultValue={fiscal.inscricao_municipal}
              />

              <div>
                <Label>Regime tributário</Label>

                <select
                  name="codigo_regime_tributario"
                  defaultValue={
                    fiscal.codigo_regime_tributario ?? ""
                  }
                  className={inputClass}
                >
                  <option value="">
                    Selecione
                  </option>

                  <option value="1">
                    1 - Simples Nacional
                  </option>

                  <option value="2">
                    2 - Simples Nacional - excesso de sublimite
                  </option>

                  <option value="3">
                    3 - Regime Normal
                  </option>
                </select>
              </div>

              <Campo
                label="Tipo de atividade"
                name="tipo_atividade"
                defaultValue={fiscal.tipo_atividade}
              />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Endereço fiscal
            </h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Campo
                label="Logradouro"
                name="logradouro"
                defaultValue={fiscal.logradouro}
              />

              <Campo
                label="Número"
                name="numero"
                defaultValue={fiscal.numero}
              />

              <Campo
                label="Complemento"
                name="complemento"
                defaultValue={fiscal.complemento}
              />

              <Campo
                label="Bairro"
                name="bairro"
                defaultValue={fiscal.bairro}
              />

              <Campo
                label="CEP"
                name="cep"
                defaultValue={fiscal.cep}
              />

              <Campo
                label="Município"
                name="municipio"
                defaultValue={fiscal.municipio}
              />

              <Campo
                label="Código IBGE do município"
                name="codigo_municipio_ibge"
                defaultValue={fiscal.codigo_municipio_ibge}
              />

              <div>
                <Label>UF</Label>

                <select
                  name="uf"
                  defaultValue={fiscal.uf ?? ""}
                  className={inputClass}
                >
                  <option value="">Selecione</option>

                  {[
                    "AC","AL","AP","AM","BA","CE","DF","ES",
                    "GO","MA","MT","MS","MG","PA","PB","PR",
                    "PE","PI","RJ","RN","RS","RO","RR","SC",
                    "SP","SE","TO",
                  ].map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Contato
            </h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Campo
                label="Telefone"
                name="telefone"
                defaultValue={fiscal.telefone}
              />

              <Campo
                label="E-mail"
                name="email"
                type="email"
                defaultValue={fiscal.email}
              />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Emissão
            </h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <Label>Ambiente</Label>

                <select
                  name="ambiente"
                  defaultValue={String(fiscal.ambiente)}
                  className={inputClass}
                >
                  <option value="2">
                    Homologação
                  </option>

                  <option value="1">
                    Produção
                  </option>
                </select>
              </div>

              <Campo
                label="Natureza da operação padrão"
                name="natureza_operacao_padrao"
                defaultValue={
                  fiscal.natureza_operacao_padrao
                }
              />

              <div>
                <Label>Indicador de presença</Label>

                <select
                  name="indicador_presenca_padrao"
                  defaultValue={String(
                    fiscal.indicador_presenca_padrao
                  )}
                  className={inputClass}
                >
                  <option value="0">0 - Não se aplica</option>
                  <option value="1">1 - Presencial</option>
                  <option value="2">2 - Internet</option>
                  <option value="3">3 - Teleatendimento</option>
                  <option value="4">4 - Entrega</option>
                  <option value="5">5 - Fora do estabelecimento</option>
                  <option value="9">9 - Outros</option>
                </select>
              </div>

              <div>
                <Label>Intermediador</Label>

                <select
                  name="indicativo_intermediador_padrao"
                  defaultValue={String(
                    fiscal.indicativo_intermediador_padrao
                  )}
                  className={inputClass}
                >
                  <option value="0">
                    0 - Sem intermediador
                  </option>

                  <option value="1">
                    1 - Com intermediador
                  </option>
                </select>
              </div>
            </div>

            <div className="mt-5">
              <Label>Informação complementar padrão</Label>

              <textarea
                name="informacao_complementar_padrao"
                defaultValue={
                  fiscal.informacao_complementar_padrao ?? ""
                }
                rows={4}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Numeração fiscal
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {numeracoes?.map((item) => (
                <div
                  key={`${item.modelo}-${item.serie}`}
                  className="rounded-xl border border-zinc-200 p-4"
                >
                  <p className="text-sm text-zinc-500">
                    {item.modelo === "55"
                      ? "NF-e modelo 55"
                      : "NFC-e modelo 65"}
                  </p>

                  <p className="mt-2 font-semibold">
                    Série {item.serie}
                  </p>

                  <p className="text-sm text-zinc-500">
                    Próximo número:{" "}
                    {item.proximo_numero}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-800"
            >
              Salvar configuração fiscal
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

const inputClass =
  "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900";

function Label({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-zinc-700">
      {children}
    </label>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>

      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className={inputClass}
      />
    </div>
  );
}