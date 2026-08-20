import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  salvarApiGeranet,
  salvarCertificadoA1,
  salvarConfiguracaoNfce,
  testarConexaoGeranet,
} from "./actions";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function IntegracaoFiscalPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const supabase =
    await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from("usuarios_empresas")
      .select(`
        empresa_id,
        perfil,
        empresas (
          razao_social,
          nome_fantasia
        )
      `)
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  if (
    vinculo.perfil !==
    "administrador"
  ) {
    redirect("/painel");
  }

  const empresa =
    Array.isArray(vinculo.empresas)
      ? vinculo.empresas[0]
      : vinculo.empresas;

  const { data: credenciais } =
    await supabase
      .from(
        "fiscal_credenciais_status"
      )
      .select(`
        api_key_configurada,
        certificado_configurado,
        certificado_nome,
        certificado_validade
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

  const { data: nfce } =
    await supabase
      .from("fiscal_nfce_config")
      .select(`
        id_csc,
        csc_configurado
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 md:p-10">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/configuracoes/fiscal"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          ← Voltar para Fiscal
        </Link>

        <div className="mt-5">
          <p className="text-sm font-semibold text-zinc-500">
            UltraPDV • Fiscal
          </p>

          <h1 className="mt-1 text-3xl font-bold text-zinc-900">
            Integração Geranet
          </h1>

          <p className="mt-2 text-zinc-500">
            {empresa?.nome_fantasia}
          </p>
        </div>

        {params.erro && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {params.erro}
          </div>
        )}

        {params.sucesso && (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {params.sucesso}
          </div>
        )}

        {/* STATUS */}

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Status
            titulo="API Geranet"
            configurado={
              credenciais?.api_key_configurada ??
              false
            }
          />

          <Status
            titulo="Certificado A1"
            configurado={
              credenciais?.certificado_configurado ??
              false
            }
            detalhe={
              credenciais?.certificado_nome ??
              undefined
            }
          />

          <Status
            titulo="CSC NFC-e"
            configurado={
              nfce?.csc_configurado ??
              false
            }
            detalhe={
              nfce?.id_csc
                ? `ID: ${nfce.id_csc}`
                : undefined
            }
          />
        </div>

        {/* API KEY */}

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            API Geranet
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            A chave será validada na Geranet
            antes de ser armazenada.
          </p>

          <form
            action={salvarApiGeranet}
            className="mt-5"
          >
            <label className="block text-sm font-medium text-zinc-700">
              API Key
            </label>

            <input
              name="api_key"
              type="password"
              required
              autoComplete="off"
              placeholder="gn_..."
              className={inputClass}
            />

            <button
              type="submit"
              className={buttonClass}
            >
              Validar e salvar API Key
            </button>
          </form>

          {credenciais?.api_key_configurada && (
            <form
              action={testarConexaoGeranet}
              className="mt-4"
            >
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Testar conexão com Geranet
              </button>
            </form>
          )}
        </section>

        {/* CERTIFICADO */}

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            Certificado digital A1
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Envie o arquivo .pfx ou .p12.
            O UltraPDV converterá o certificado
            para hexadecimal no servidor.
          </p>

          <form
            action={salvarCertificadoA1}
            className="mt-5 space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Certificado
              </label>

              <input
                name="certificado"
                type="file"
                required
                accept=".pfx,.p12,application/x-pkcs12"
                className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Senha do certificado
              </label>

              <input
                name="senha_certificado"
                type="password"
                required
                autoComplete="off"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              className={buttonClass}
            >
              Armazenar certificado
            </button>
          </form>
        </section>

        {/* NFC-E */}

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            NFC-e
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            CSC utilizado para geração do QR Code
            da NFC-e modelo 65.
          </p>

          <form
            action={salvarConfiguracaoNfce}
            className="mt-5 space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                ID CSC
              </label>

              <input
                name="id_csc"
                required
                defaultValue={
                  nfce?.id_csc ?? ""
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700">
                CSC
              </label>

              <input
                name="csc"
                type="password"
                required
                autoComplete="off"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              className={buttonClass}
            >
              Salvar CSC
            </button>
          </form>
        </section>

        <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          Continuaremos trabalhando em ambiente
          de homologação. Nenhuma emissão em
          produção será feita nesta etapa.
        </div>
      </div>
    </main>
  );
}

function Status({
  titulo,
  configurado,
  detalhe,
}: {
  titulo: string;
  configurado: boolean;
  detalhe?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm font-medium text-zinc-500">
        {titulo}
      </p>

      <p className="mt-2 text-lg font-semibold text-zinc-900">
        {configurado
          ? "Configurado"
          : "Não configurado"}
      </p>

      {detalhe && (
        <p className="mt-1 truncate text-xs text-zinc-500">
          {detalhe}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900";

const buttonClass =
  "mt-5 rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white transition hover:bg-zinc-800";