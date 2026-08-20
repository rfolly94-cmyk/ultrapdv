import { redirect } from "next/navigation";

import {
  inicializarFiscal,
  salvarFiscal,
} from "./actions";

import { PageAlert } from "@/components/ui/page-alert";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { opcoesFusoHorarioFiscal } from "@/lib/fiscal/fuso-horario-empresa";
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
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  const { data: fiscalBruto } = await supabase
    .from("empresas_fiscal")
    .select("*")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  const fiscal = registroPertenceAEmpresaAtiva(
    fiscalBruto,
    vinculo.empresa_id
  )
    ? fiscalBruto
    : null;

  const { data: numeracoes } = await supabase
    .from("fiscal_numeracoes")
    .select("modelo, ambiente, serie, proximo_numero")
    .eq("empresa_id", vinculo.empresa_id)
    .order("modelo");

  const { data: nfceConfigBruto } = await supabase
    .from("fiscal_nfce_config")
    .select("empresa_id, emitir_nfce_automatico_pdv")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  const nfceConfig = registroPertenceAEmpresaAtiva(
    nfceConfigBruto,
    vinculo.empresa_id
  )
    ? nfceConfigBruto
    : null;

  const nfceAutomaticaPdv =
    nfceConfig?.emitir_nfce_automatico_pdv === true;

  if (!fiscal) {
    return (
      <div className="updv-config">
        <div className="rounded-md border border-zinc-200 bg-white p-5">
          <h2 className="text-[15px] font-semibold text-zinc-950">
            Preparar módulo fiscal
          </h2>

          <p className="mt-1 text-[13px] text-zinc-500">
            A configuração fiscal desta empresa ainda não
            foi inicializada.
          </p>

          {params.erro ? (
            <PageAlert type="erro" className="mt-4">
              {params.erro}
            </PageAlert>
          ) : null}

          <form action={inicializarFiscal} className="mt-6">
            <button type="submit" className="updv-btn updv-btn-primary">
              Inicializar configuração fiscal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="updv-config">
        {params.erro ? (
          <PageAlert type="erro" className="mb-4">
            {params.erro}
          </PageAlert>
        ) : null}

        {params.sucesso ? (
          <PageAlert type="sucesso" className="mb-4">
            {params.sucesso}
          </PageAlert>
        ) : null}

        <div className="rounded-md border border-zinc-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Emitente
          </p>

          <h2 className="mt-1 text-[15px] font-semibold text-zinc-950">
            {empresa?.nome_fantasia}
          </h2>

          <p className="mt-0.5 text-[13px] text-zinc-500">
            {empresa?.razao_social}
          </p>

          <p className="text-[13px] text-zinc-500">
            CNPJ: {empresa?.cnpj}
          </p>
        </div>

        <form action={salvarFiscal}>
          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
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

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold">
              Perfil perante o IPI
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Esta configuração não é determinada somente
              pelo CRT. Confirme a condição fiscal do
              estabelecimento.
            </p>

            {!fiscal.perfil_ipi && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Configuração pendente para NF-e modelo 55.
                Enquanto o perfil IPI não for informado, a
                preparação de NF-e fica bloqueada. NFC-e
                modelo 65 não usa IPI.
              </div>
            )}

            <div className="mt-5 max-w-xl">
              <Label>Perfil perante o IPI</Label>
              <select
                name="perfil_ipi"
                defaultValue={fiscal.perfil_ipi ?? ""}
                className={inputClass}
              >
                <option value="">
                  Selecione — pendente
                </option>
                <option value="NAO_CONTRIBUINTE">
                  Não contribuinte de IPI
                </option>
                <option value="INDUSTRIAL">
                  Industrial
                </option>
                <option value="EQUIPARADO_INDUSTRIAL">
                  Equiparado a industrial
                </option>
              </select>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
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

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
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

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
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

              <label className="flex items-start gap-3 md:col-span-2">
                <input
                  type="checkbox"
                  name="emitir_nfce_automatico_pdv"
                  value="1"
                  defaultChecked={nfceAutomaticaPdv}
                  className="mt-1 h-4 w-4 rounded border-zinc-300"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-700">
                    Emitir NFC-e automaticamente ao finalizar venda no PDV
                  </span>
                  <span className="mt-1 block text-sm text-zinc-500">
                    A venda comercial é concluída mesmo se a NFC-e for
                    rejeitada, der erro ou ficar pendente de reconciliação.
                  </span>
                </span>
              </label>

              <div>
                <Label>Fuso horário fiscal</Label>
                <select
                  name="fuso_horario"
                  defaultValue={fiscal.fuso_horario ?? ""}
                  className={inputClass}
                >
                  <option value="">
                    Selecione — pendente
                  </option>
                  {opcoesFusoHorarioFiscal(fiscal.fuso_horario).map(
                    (opcao) => (
                      <option key={opcao.valor} value={opcao.valor}>
                        {opcao.rotulo}
                      </option>
                    )
                  )}
                </select>
                <p className="mt-2 text-xs text-zinc-500">
                  Pertence a esta empresa. Usado na data/hora da NF-e e da
                  NFC-e. Não é o fuso do servidor, do usuário nem da Natureza.
                </p>
              </div>

              <div>
                <Campo
                  label="Natureza da operação padrão (legado)"
                  name="natureza_operacao_padrao"
                  defaultValue={
                    fiscal.natureza_operacao_padrao
                  }
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Mantido por compatibilidade. A NF-e 55 usa a natureza
                  cadastrada em{" "}
                  <a
                    href="/configuracoes/fiscal/naturezas"
                    className="font-medium text-zinc-800 underline"
                  >
                    Naturezas de operação
                  </a>
                  .
                </p>
              </div>

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

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold">
              Responsável técnico
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Dados enviados em nfe.responsavelTecnico na NF-e 55, somente
              quando a configuração desta empresa estiver completa. O CSRT
              fica no cofre fiscal e não é exibido depois de salvo.
            </p>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Campo
                label="CNPJ"
                name="responsavel_tecnico_cnpj"
                defaultValue={fiscal.responsavel_tecnico_cnpj}
              />
              <Campo
                label="Contato"
                name="responsavel_tecnico_contato"
                defaultValue={fiscal.responsavel_tecnico_contato}
              />
              <Campo
                label="E-mail"
                name="responsavel_tecnico_email"
                defaultValue={fiscal.responsavel_tecnico_email}
              />
              <Campo
                label="Telefone"
                name="responsavel_tecnico_fone"
                defaultValue={fiscal.responsavel_tecnico_fone}
              />
              <Campo
                label="idCSRT"
                name="responsavel_tecnico_id_csrt"
                defaultValue={fiscal.responsavel_tecnico_id_csrt}
              />
              <div>
                <Label>CSRT</Label>
                <input
                  name="responsavel_tecnico_csrt"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    fiscal.responsavel_tecnico_csrt_configurado
                      ? "Configurado no cofre — informe só para substituir"
                      : ""
                  }
                  className={inputClass}
                />
                {fiscal.responsavel_tecnico_csrt_configurado ? (
                  <p className="mt-1 text-[12px] text-zinc-500">
                    CSRT presente no cofre fiscal desta empresa.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold">
              Numeração fiscal
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {numeracoes?.map((item) => (
                <div
                 key={`${item.modelo}-${item.ambiente}-${item.serie}`}
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
            <button type="submit" className="updv-btn updv-btn-primary">
              Salvar configuração fiscal
            </button>
          </div>
        </form>
    </div>
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