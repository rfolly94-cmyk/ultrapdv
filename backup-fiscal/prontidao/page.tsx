import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ItemValidacao = {
  nome: string;
  ok: boolean;
  detalhe: string;
  aviso?: boolean;
};

export default async function ProntidaoFiscalPage() {
  const supabase = await createClient();

  // =======================================================
  // AUTENTICAÇÃO
  // =======================================================

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  // =======================================================
  // EMPRESA ATIVA
  // =======================================================

  const { data: vinculo, error: vinculoError } =
    await supabase
      .from("usuarios_empresas")
      .select(`
        empresa_id,
        perfil,
        empresas (
          id,
          razao_social,
          nome_fantasia,
          cnpj
        )
      `)
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (vinculoError || !vinculo) {
    redirect("/onboarding");
  }

  if (vinculo.perfil !== "administrador") {
    redirect("/painel");
  }

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  const empresaId = vinculo.empresa_id;

  // =======================================================
  // CONFIGURAÇÃO FISCAL
  // =======================================================

  const { data: fiscal } = await supabase
    .from("empresas_fiscal")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  // =======================================================
  // NUMERAÇÃO NFC-E
  // =======================================================

  const { data: numeracaoNfce } = await supabase
    .from("fiscal_numeracoes")
    .select(`
      modelo,
      serie,
      proximo_numero,
      ativo
    `)
    .eq("empresa_id", empresaId)
    .eq("modelo", "65")
    .eq("ativo", true)
    .maybeSingle();

  // =======================================================
  // CONFIGURAÇÃO NFC-E
  // =======================================================

  const { data: nfce } = await supabase
    .from("fiscal_nfce_config")
    .select(`
      id_csc,
      csc_configurado,
      ativo
    `)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  // =======================================================
  // STATUS DAS CREDENCIAIS
  // =======================================================

  const { data: credenciais } = await supabase
    .from("fiscal_credenciais_status")
    .select(`
      api_key_configurada,
      certificado_configurado,
      certificado_nome
    `)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  // =======================================================
  // VERIFICAÇÃO REAL DO VAULT
  //
  // Nunca exibimos os valores.
  // Apenas verificamos se existem.
  // =======================================================

  const admin = createAdminClient();

  const { data: segredosData, error: segredosError } =
    await admin.rpc("obter_segredos_fiscais", {
      p_empresa_id: empresaId,
    });

  const segredos =
    !segredosError && segredosData
      ? (segredosData as {
          geranet_api_key?: string | null;
          certificado_a1?: string | null;
          senha_certificado?: string | null;
          csc?: string | null;
        })
      : null;

  // =======================================================
  // AUXILIARES
  // =======================================================

  const possuiTexto = (
    valor: string | null | undefined
  ) => Boolean(valor && valor.trim().length > 0);

  const somenteNumeros = (
    valor: string | null | undefined
  ) => String(valor ?? "").replace(/\D/g, "");

  // =======================================================
  // EMPRESA
  // =======================================================

  const empresaChecks: ItemValidacao[] = [
    {
      nome: "CNPJ",
      ok: somenteNumeros(empresa?.cnpj).length === 14,
      detalhe:
        somenteNumeros(empresa?.cnpj).length === 14
          ? empresa?.cnpj ?? ""
          : "CNPJ deve possuir 14 dígitos.",
    },
    {
      nome: "Razão social",
      ok: possuiTexto(empresa?.razao_social),
      detalhe:
        empresa?.razao_social ||
        "Razão social não informada.",
    },
    {
      nome: "Nome fantasia",
      ok: possuiTexto(empresa?.nome_fantasia),
      detalhe:
        empresa?.nome_fantasia ||
        "Nome fantasia não informado.",
    },
  ];

  // =======================================================
  // EMITENTE
  // =======================================================

  const fiscalChecks: ItemValidacao[] = [
    {
      nome: "Inscrição Estadual",
      ok: possuiTexto(fiscal?.inscricao_estadual),
      detalhe:
        fiscal?.inscricao_estadual ||
        "Inscrição Estadual não informada.",
    },
    {
      nome: "Regime tributário",
      ok: [1, 2, 3].includes(
        Number(fiscal?.codigo_regime_tributario)
      ),
      detalhe: fiscal?.codigo_regime_tributario
        ? `CRT ${fiscal.codigo_regime_tributario}`
        : "Regime tributário não definido.",
    },
    {
      nome: "Logradouro",
      ok: possuiTexto(fiscal?.logradouro),
      detalhe:
        fiscal?.logradouro ||
        "Logradouro não informado.",
    },
    {
      nome: "Número",
      ok: possuiTexto(fiscal?.numero),
      detalhe:
        fiscal?.numero ||
        "Número do endereço não informado.",
    },
    {
      nome: "Bairro",
      ok: possuiTexto(fiscal?.bairro),
      detalhe:
        fiscal?.bairro ||
        "Bairro não informado.",
    },
    {
      nome: "CEP",
      ok:
        somenteNumeros(fiscal?.cep).length === 8,
      detalhe:
        somenteNumeros(fiscal?.cep).length === 8
          ? fiscal?.cep ?? ""
          : "CEP deve possuir 8 dígitos.",
    },
    {
      nome: "Município",
      ok: possuiTexto(fiscal?.municipio),
      detalhe:
        fiscal?.municipio ||
        "Município não informado.",
    },
    {
      nome: "Código IBGE",
      ok:
        somenteNumeros(
          fiscal?.codigo_municipio_ibge
        ).length === 7,
      detalhe:
        somenteNumeros(
          fiscal?.codigo_municipio_ibge
        ).length === 7
          ? fiscal?.codigo_municipio_ibge ?? ""
          : "Código IBGE deve possuir 7 dígitos.",
    },
    {
      nome: "UF",
      ok: String(fiscal?.uf ?? "").length === 2,
      detalhe:
        fiscal?.uf || "UF não informada.",
    },
    {
      nome: "Natureza da operação",
      ok: possuiTexto(
        fiscal?.natureza_operacao_padrao
      ),
      detalhe:
        fiscal?.natureza_operacao_padrao ||
        "Natureza da operação não informada.",
    },
    {
      nome: "Ambiente",
      ok: fiscal?.ambiente === 2,
      detalhe:
        fiscal?.ambiente === 2
          ? "Homologação"
          : fiscal?.ambiente === 1
            ? "Produção — volte para homologação durante o desenvolvimento."
            : "Ambiente fiscal não definido.",
    },

    // Não vamos bloquear o projeto por tipoAtividade até
    // confirmarmos o código correto para a empresa.
    {
      nome: "Tipo de atividade",
      ok: possuiTexto(fiscal?.tipo_atividade),
      detalhe:
        fiscal?.tipo_atividade ||
        "Ainda precisa ser confirmado antes da emissão.",
      aviso: true,
    },
  ];

  // =======================================================
  // GERANET / VAULT
  // =======================================================

  const integracaoChecks: ItemValidacao[] = [
    {
      nome: "API Key Geranet",
      ok:
        Boolean(credenciais?.api_key_configurada) &&
        possuiTexto(segredos?.geranet_api_key),
      detalhe:
        Boolean(credenciais?.api_key_configurada) &&
        possuiTexto(segredos?.geranet_api_key)
          ? "Armazenada no Vault."
          : "API Key não encontrada no cofre.",
    },
    {
      nome: "Certificado A1",
      ok:
        Boolean(
          credenciais?.certificado_configurado
        ) &&
        possuiTexto(segredos?.certificado_a1),
      detalhe:
        Boolean(
          credenciais?.certificado_configurado
        ) &&
        possuiTexto(segredos?.certificado_a1)
          ? credenciais?.certificado_nome ||
            "Certificado armazenado."
          : "Certificado não encontrado no cofre.",
    },
    {
      nome: "Senha do certificado",
      ok: possuiTexto(
        segredos?.senha_certificado
      ),
      detalhe: possuiTexto(
        segredos?.senha_certificado
      )
        ? "Configurada no Vault."
        : "Senha do certificado ausente.",
    },
    {
      nome: "ID CSC",
      ok: possuiTexto(nfce?.id_csc),
      detalhe:
        nfce?.id_csc ||
        "ID CSC não configurado.",
    },
    {
      nome: "CSC",
      ok:
        Boolean(nfce?.csc_configurado) &&
        possuiTexto(segredos?.csc),
      detalhe:
        Boolean(nfce?.csc_configurado) &&
        possuiTexto(segredos?.csc)
          ? "Configurado no Vault."
          : "CSC não encontrado no cofre.",
    },
  ];

  // =======================================================
  // NUMERAÇÃO
  // =======================================================

  const numeracaoChecks: ItemValidacao[] = [
    {
      nome: "Modelo",
      ok: numeracaoNfce?.modelo === "65",
      detalhe:
        numeracaoNfce?.modelo === "65"
          ? "NFC-e modelo 65"
          : "Numeração NFC-e não encontrada.",
    },
    {
      nome: "Série",
      ok: Number(numeracaoNfce?.serie) > 0,
      detalhe:
        Number(numeracaoNfce?.serie) > 0
          ? `Série ${numeracaoNfce?.serie}`
          : "Série inválida.",
    },
    {
      nome: "Próximo número",
      ok:
        Number(
          numeracaoNfce?.proximo_numero
        ) > 0,
      detalhe:
        Number(
          numeracaoNfce?.proximo_numero
        ) > 0
          ? String(
              numeracaoNfce?.proximo_numero
            )
          : "Próximo número inválido.",
    },
    {
      nome: "NFC-e ativa",
      ok: nfce?.ativo === true,
      detalhe:
        nfce?.ativo === true
          ? "Configuração ativa."
          : "Configuração NFC-e inativa.",
    },
  ];

  const todos = [
    ...empresaChecks,
    ...fiscalChecks,
    ...integracaoChecks,
    ...numeracaoChecks,
  ];

  const bloqueadores = todos.filter(
    (item) => !item.ok && !item.aviso
  );

  const avisos = todos.filter(
    (item) => !item.ok && item.aviso
  );

  const pronto =
    bloqueadores.length === 0;

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
            Prontidão Fiscal
          </h1>

          <p className="mt-2 text-zinc-500">
            {empresa?.nome_fantasia}
          </p>
        </div>

        <div
          className={`mt-8 rounded-2xl border p-6 ${
            pronto
              ? "border-green-200 bg-green-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="text-sm font-medium">
            Status da NFC-e
          </p>

          <h2 className="mt-2 text-2xl font-bold">
            {pronto
              ? "Base pronta para montar o payload de homologação"
              : "Existem pendências antes do primeiro teste fiscal"}
          </h2>

          <p className="mt-2 text-sm">
            {bloqueadores.length} bloqueador(es) •{" "}
            {avisos.length} aviso(s)
          </p>
        </div>

        <Secao
          titulo="Empresa"
          itens={empresaChecks}
        />

        <Secao
          titulo="Dados fiscais do emitente"
          itens={fiscalChecks}
        />

        <Secao
          titulo="Integração Geranet"
          itens={integracaoChecks}
        />

        <Secao
          titulo="NFC-e e numeração"
          itens={numeracaoChecks}
        />

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/configuracoes/fiscal"
            className="rounded-lg border border-zinc-300 bg-white px-5 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Corrigir dados fiscais
          </Link>

          <Link
            href="/configuracoes/fiscal/integracao"
            className="rounded-lg border border-zinc-300 bg-white px-5 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Configurar Geranet
          </Link>
        </div>
      </div>
    </main>
  );
}

function Secao({
  titulo,
  itens,
}: {
  titulo: string;
  itens: ItemValidacao[];
}) {
  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        {titulo}
      </h2>

      <div className="mt-5 divide-y divide-zinc-100">
        {itens.map((item) => (
          <div
            key={item.nome}
            className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div>
              <p className="font-medium text-zinc-900">
                {item.nome}
              </p>

              <p className="mt-1 text-sm text-zinc-500">
                {item.detalhe}
              </p>
            </div>

            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                item.ok
                  ? "bg-green-100 text-green-700"
                  : item.aviso
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {item.ok
                ? "OK"
                : item.aviso
                  ? "ATENÇÃO"
                  : "PENDENTE"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}