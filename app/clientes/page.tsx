import { redirect } from "next/navigation";

import { cadastrarCliente, editarCliente } from "./actions";

import { ClienteNavegacao } from "@/components/clientes/cliente-navegacao";
import { ClientesListagemWorkspace } from "@/components/clientes/clientes-listagem-workspace";
import { EnderecoViaCepCampos } from "@/components/cadastro/endereco-via-cep-campos";
import { createClient } from "@/lib/supabase/server";
import { PageAlert } from "@/components/ui/page-alert";
import { PageHeader } from "@/components/ui/page-header";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { carregarListagemClientes } from "@/lib/clientes/carregar-listagem";
import { parseFiltroListagemClientes } from "@/lib/clientes/listagem";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
    editar?: string;
    novo?: string;
    q?: string;
    filtro?: string;
  }>;
};

export default async function ClientesPage({
  searchParams,
}: PageProps) {
  const params =
    await searchParams;

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
      .from("usuarios_empresas")
      .select(
        "empresa_id, perfil"
      )
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "clientes"
  );
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(
      String(vinculo.empresa_id)
    );
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Clientes"
            descricao="Este recurso não está disponível no plano atual da sua empresa. O cadastro de clientes está disponível em planos que incluem este recurso. PDV, vendas, fiscal e carteira continuam usando clientes já cadastrados."
            planoNome={entitlements.planoNome}
            voltarHref="/painel"
            voltarLabel="Voltar ao início"
          />
        </div>
      </main>
    );
  }

  const importadorNoPlano = (
    await planoPermiteRecursoEmpresa(String(vinculo.empresa_id), "importador")
  ).permitido;
  const [carteiraNoPlano, pdvNoPlano, vendasNoPlano, sessaoPermissoes] =
    await Promise.all([
      planoPermiteRecursoEmpresa(String(vinculo.empresa_id), "carteira").then(
        (plano) => plano.permitido
      ),
      planoPermiteRecursoEmpresa(String(vinculo.empresa_id), "pdv").then(
        (plano) => plano.permitido
      ),
      planoPermiteRecursoEmpresa(String(vinculo.empresa_id), "vendas").then(
        (plano) => plano.permitido
      ),
      obterPermissoesSessao(),
    ]);
  const podeAcessarCarteira =
    carteiraNoPlano &&
    temPermissao(sessaoPermissoes?.permissoes, "clientes", "acessar_carteira");
  const podeReceberCarteira =
    podeAcessarCarteira &&
    temPermissao(sessaoPermissoes?.permissoes, "clientes", "receber_carteira");
  const podeNovaVenda =
    pdvNoPlano && temPermissao(sessaoPermissoes?.permissoes, "pdv", "acessar");
  const podeVerVendas =
    (vendasNoPlano &&
      temPermissao(sessaoPermissoes?.permissoes, "vendas", "acessar")) ||
    podeAcessarCarteira;

  const busca = String(params.q ?? "").trim();
  const filtro = parseFiltroListagemClientes(params.filtro);

  const [listagem, clienteEdicaoResult] = await Promise.all([
    params.novo
      ? Promise.resolve({
          clientes: [],
          total: 0,
          contadores: { debito: 0, credito: 0, vencidos: 0 },
        })
      : carregarListagemClientes({
          supabase,
          empresaId: String(vinculo.empresa_id),
          busca,
          filtro,
        }),
    params.editar
      ? supabase
          .from("clientes")
          .select(`
            id,
            nome,
            nome_fantasia,
            tipo_pessoa,
            cpf_cnpj,
            inscricao_estadual,
            contribuinte_icms,
            indicador_ie_destinatario,
            consumidor_final,
            telefone,
            email,
            cep,
            logradouro,
            numero,
            complemento,
            bairro,
            municipio,
            codigo_municipio_ibge,
            uf,
            limite_credito,
            saldo_devedor,
            bloqueado,
            dia_vencimento,
            observacao,
            ativo
          `)
          .eq("empresa_id", vinculo.empresa_id)
          .eq("id", params.editar)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (clienteEdicaoResult.error) {
    throw new Error(clienteEdicaoResult.error.message);
  }

  const clientes = listagem.clientes;
  const clienteEdicao = clienteEdicaoResult.data;
  const mostrarFormulario = Boolean(clienteEdicao || params.novo);
  const mostrarLista = !clienteEdicao && !params.novo;

  return (
    <main className="updv-page">
      {clienteEdicao ? (
        <ClienteNavegacao
          clienteId={clienteEdicao.id}
          clienteNome={clienteEdicao.nome}
        />
      ) : (
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes da empresa."
        count={clientes?.length ?? 0}
        actions={
          <div className="flex flex-wrap gap-2">
            {importadorNoPlano ? (
              <a
                href="/configuracoes/importar-dados?tipo=clientes"
                className="updv-btn updv-btn-ghost"
              >
                Importar clientes
              </a>
            ) : null}
            <a href="/clientes?novo=1" className="updv-btn updv-btn-primary">
              Novo cliente
            </a>
          </div>
        }
      />
      )}

      {mostrarLista ? (
        <ClientesListagemWorkspace
          clientesIniciais={clientes}
          totalInicial={listagem.total}
          contadoresIniciais={listagem.contadores}
          filtro={filtro}
          busca={busca}
          podeAcessarCarteira={podeAcessarCarteira}
          podeReceberCarteira={podeReceberCarteira}
          podeNovaVenda={podeNovaVenda}
          podeVerVendas={podeVerVendas}
        />
      ) : null}

      <div>
        {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}

        {params.sucesso && (
          <PageAlert type="sucesso">{params.sucesso}</PageAlert>
        )}

        {mostrarFormulario && (
        <section className="mx-4 mb-4 rounded-md border border-zinc-200 bg-white p-5">
          <div>
            <h2 className="text-xl font-semibold">
              {clienteEdicao
                ? "Editar cliente"
                : "Novo cliente"}
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Os dados de endereço e documento
              serão utilizados futuramente na NF-e.
            </p>
          </div>

          <form
            action={
              clienteEdicao
                ? editarCliente
                : cadastrarCliente
            }
            className="mt-6"
          >
            {clienteEdicao && (
              <input
                type="hidden"
                name="id"
                value={clienteEdicao.id}
              />
            )}

            <h3 className="font-semibold text-zinc-900">
              Identificação
            </h3>

            <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label>
                  Tipo de pessoa
                </Label>

                <select
                  name="tipo_pessoa"
                  defaultValue={
                    clienteEdicao
                      ?.tipo_pessoa ??
                    "F"
                  }
                  className={inputClass}
                >
                  <option value="F">
                    Pessoa Física
                  </option>
                  <option value="J">
                    Pessoa Jurídica
                  </option>
                </select>
              </div>

              <Campo
                label="Nome / Razão social"
                name="nome"
                defaultValue={
                  clienteEdicao?.nome
                }
                required
              />

              <Campo
                label="Nome fantasia"
                name="nome_fantasia"
                defaultValue={
                  clienteEdicao
                    ?.nome_fantasia
                }
              />

              <Campo
                label="CPF / CNPJ"
                name="cpf_cnpj"
                defaultValue={
                  clienteEdicao
                    ?.cpf_cnpj
                }
                inputMode="numeric"
              />

              <Campo
                label="Inscrição Estadual"
                name="inscricao_estadual"
                defaultValue={
                  clienteEdicao
                    ?.inscricao_estadual
                }
              />

              <Campo
                label="Telefone"
                name="telefone"
                defaultValue={
                  clienteEdicao
                    ?.telefone
                }
                inputMode="tel"
              />

              <Campo
                label="E-mail"
                name="email"
                type="email"
                defaultValue={
                  clienteEdicao?.email
                }
              />

              <div className="flex flex-col gap-3 pt-1">
                <div>
                  <Label>Indicador IE</Label>
                  <select
                    name="indicador_ie_destinatario"
                    defaultValue={
                      clienteEdicao?.indicador_ie_destinatario === "1" ||
                      clienteEdicao?.indicador_ie_destinatario === "2" ||
                      clienteEdicao?.indicador_ie_destinatario === "9"
                        ? clienteEdicao.indicador_ie_destinatario
                        : clienteEdicao?.contribuinte_icms
                          ? "1"
                          : "9"
                    }
                    className={inputClass}
                  >
                    <option value="1">Contribuinte</option>
                    <option value="2">Isento</option>
                    <option value="9">Não contribuinte</option>
                  </select>
                  <p className="mt-1 text-xs text-zinc-500">
                    Situação do destinatário perante o ICMS. Não define se a
                    NF-e é de consumidor final.
                  </p>
                </div>

                <Check
                  name="consumidor_final"
                  label="Sugestão de consumidor final"
                  defaultChecked={
                    clienteEdicao
                      ?.consumidor_final ??
                    true
                  }
                />
                <p className="-mt-1 text-xs text-zinc-500">
                  Preferência do cadastro. A NF-e grava o valor na operação
                  fiscal e não volta a este campo depois de criada.
                </p>
              </div>
            </div>

            <div className="my-7 border-t border-zinc-200" />

            <h3 className="font-semibold text-zinc-900">
              Endereço
            </h3>

            <EnderecoViaCepCampos
              inicial={{
                cep: clienteEdicao?.cep,
                logradouro: clienteEdicao?.logradouro,
                numero: clienteEdicao?.numero,
                complemento: clienteEdicao?.complemento,
                bairro: clienteEdicao?.bairro,
                municipio: clienteEdicao?.municipio,
                codigoMunicipioIbge: clienteEdicao?.codigo_municipio_ibge,
                uf: clienteEdicao?.uf,
              }}
            />

            <div className="my-7 border-t border-zinc-200" />

            <h3 className="font-semibold text-zinc-900">
              Crédito / Fiado
            </h3>

            <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <Campo
                label="Limite de crédito"
                name="limite_credito"
                defaultValue={
                  clienteEdicao
                    ? Number(
                        clienteEdicao
                          .limite_credito
                      ).toLocaleString(
                        "pt-BR",
                        {
                          minimumFractionDigits:
                            2,
                          maximumFractionDigits:
                            2,
                        }
                      )
                    : "0,00"
                }
                inputMode="decimal"
              />

              <Campo
                label="Dia de vencimento"
                name="dia_vencimento"
                type="number"
                min={1}
                max={31}
                defaultValue={
                  clienteEdicao
                    ?.dia_vencimento
                }
              />

              <div className="flex flex-col gap-3 pt-1">
                <Check
                  name="bloqueado"
                  label="Bloquear venda fiado"
                  defaultChecked={
                    clienteEdicao
                      ?.bloqueado ??
                    false
                  }
                />

                {clienteEdicao && (
                  <Check
                    name="ativo"
                    label="Cliente ativo"
                    defaultChecked={
                      clienteEdicao
                        .ativo
                    }
                  />
                )}
              </div>
            </div>

            <div className="mt-5">
              <Label>
                Observações
              </Label>

              <textarea
                name="observacao"
                defaultValue={
                  clienteEdicao
                    ?.observacao ??
                  ""
                }
                rows={3}
                className={inputClass}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button type="submit" className="updv-btn updv-btn-primary">
                {clienteEdicao
                  ? "Salvar alterações"
                  : "Cadastrar cliente"}
              </button>

              <a href="/clientes" className="updv-btn updv-btn-ghost">
                Cancelar
              </a>
            </div>
          </form>
        </section>
        )}
      </div>
    </main>
  );
}

const inputClass = "updv-input mt-1 w-full";

type CampoProps = {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?:
    | string
    | number
    | null;
  inputMode?:
    | "text"
    | "numeric"
    | "decimal"
    | "tel"
    | "email"
    | "url"
    | "search";
  min?: number;
  max?: number;
  maxLength?: number;
};

function Campo({
  label,
  name,
  type = "text",
  required,
  defaultValue,
  inputMode,
  min,
  max,
  maxLength,
}: CampoProps) {
  return (
    <div>
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>

      <input
        name={name}
        type={type}
        required={required}
        defaultValue={
          defaultValue ?? ""
        }
        inputMode={inputMode}
        min={min}
        max={max}
        maxLength={maxLength}
        className={inputClass}
      />
    </div>
  );
}

function Label({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-medium text-zinc-700">
      {children}
    </label>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={
          defaultChecked
        }
        className="size-4 rounded border-zinc-300"
      />

      <span>{label}</span>
    </label>
  );
}
