"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Veiculo = {
  id: string;
  empresa_id: string;
  transportadora_id: string;
  placa: string;
  uf: string | null;
  rntrc: string | null;
  descricao: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type Transportadora = {
  id: string;
  empresa_id: string;
  nome_razao_social: string;
  nome_fantasia: string | null;
  cpf_cnpj: string;
  inscricao_estadual: string | null;
  rntrc: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigo_municipio_ibge: string | null;
  uf: string | null;
  cep: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type Props = {
  transportadoras: Transportadora[];
  veiculos: Veiculo[];
  abrirNovo: boolean;
  perfil: string;
};

type VeiculoForm = {
  id?: string;
  placa: string;
  uf: string;
  rntrc: string;
  descricao: string;
  ativo: boolean;
};

type Form = {
  id?: string;
  nome_razao_social: string;
  nome_fantasia: string;
  cpf_cnpj: string;
  inscricao_estadual: string;
  rntrc: string;
  telefone: string;
  email: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  codigo_municipio_ibge: string;
  uf: string;
  cep: string;
  ativo: boolean;
  veiculos: VeiculoForm[];
};

function novoForm(): Form {
  return {
    nome_razao_social: "",
    nome_fantasia: "",
    cpf_cnpj: "",
    inscricao_estadual: "",
    rntrc: "",
    telefone: "",
    email: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    municipio: "",
    codigo_municipio_ibge: "",
    uf: "",
    cep: "",
    ativo: true,
    veiculos: [],
  };
}

function formatarDocumento(
  valor: string
) {
  const d =
    valor.replace(
      /\D/g,
      ""
    );

  if (
    d.length === 14
  ) {
    return d.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5"
    );
  }

  if (
    d.length === 11
  ) {
    return d.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      "$1.$2.$3-$4"
    );
  }

  return valor;
}

export function TransportadorasWorkspace({
  transportadoras,
  veiculos,
  abrirNovo,
  perfil,
}: Props) {
  const router =
    useRouter();

  const podeGerenciar =
    [
      "administrador",
      "admin",
      "gerente",
    ].includes(
      perfil
        .trim()
        .toLowerCase()
    );

  const [
    busca,
    setBusca,
  ] =
    useState("");

  const [
    modalAberto,
    setModalAberto,
  ] =
    useState(
      abrirNovo &&
      podeGerenciar
    );

  const [
    form,
    setForm,
  ] =
    useState<Form>(
      novoForm()
    );

  const [
    salvando,
    setSalvando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const [
    sucesso,
    setSucesso,
  ] =
    useState(false);

  const filtradas =
    useMemo(() => {
      const termo =
        busca
          .trim()
          .toLowerCase();

      if (!termo) {
        return transportadoras;
      }

      const digitos =
        termo.replace(
          /\D/g,
          ""
        );

      return transportadoras.filter(
        (item) =>
          item
            .nome_razao_social
            .toLowerCase()
            .includes(
              termo
            ) ||
          (
            item.nome_fantasia ??
            ""
          )
            .toLowerCase()
            .includes(
              termo
            ) ||
          (
            digitos &&
            item.cpf_cnpj.includes(
              digitos
            )
          )
      );
    }, [
      busca,
      transportadoras,
    ]);

  function abrirNovoCadastro() {
    setForm(
      novoForm()
    );
    setMensagem(null);
    setSucesso(false);
    setModalAberto(true);
  }

  function editar(
    item: Transportadora
  ) {
    const veiculosItem =
      veiculos
        .filter(
          (veiculo) =>
            veiculo
              .transportadora_id ===
            item.id
        )
        .map(
          (veiculo) => ({
            id:
              veiculo.id,
            placa:
              veiculo.placa,
            uf:
              veiculo.uf ??
              "",
            rntrc:
              veiculo.rntrc ??
              "",
            descricao:
              veiculo.descricao ??
              "",
            ativo:
              veiculo.ativo,
          })
        );

    setForm({
      id:
        item.id,
      nome_razao_social:
        item.nome_razao_social,
      nome_fantasia:
        item.nome_fantasia ??
        "",
      cpf_cnpj:
        item.cpf_cnpj,
      inscricao_estadual:
        item.inscricao_estadual ??
        "",
      rntrc:
        item.rntrc ??
        "",
      telefone:
        item.telefone ??
        "",
      email:
        item.email ??
        "",
      logradouro:
        item.logradouro ??
        "",
      numero:
        item.numero ??
        "",
      complemento:
        item.complemento ??
        "",
      bairro:
        item.bairro ??
        "",
      municipio:
        item.municipio ??
        "",
      codigo_municipio_ibge:
        item.codigo_municipio_ibge ??
        "",
      uf:
        item.uf ??
        "",
      cep:
        item.cep ??
        "",
      ativo:
        item.ativo,
      veiculos:
        veiculosItem,
    });

    setMensagem(null);
    setSucesso(false);
    setModalAberto(true);
  }

  function patch(
    chave:
      keyof Form,
    valor: unknown
  ) {
    setForm(
      (atual) => ({
        ...atual,
        [chave]:
          valor,
      })
    );
  }

  function adicionarVeiculo() {
    setForm(
      (atual) => ({
        ...atual,
        veiculos: [
          ...atual.veiculos,
          {
            placa: "",
            uf:
              atual.uf,
            rntrc:
              atual.rntrc,
            descricao:
              "",
            ativo:
              true,
          },
        ],
      })
    );
  }

  function patchVeiculo(
    indice: number,
    patch:
      Partial<
        VeiculoForm
      >
  ) {
    setForm(
      (atual) => ({
        ...atual,
        veiculos:
          atual.veiculos.map(
            (
              veiculo,
              index
            ) =>
              index ===
              indice
                ? {
                    ...veiculo,
                    ...patch,
                  }
                : veiculo
          ),
      })
    );
  }

  function removerVeiculo(
    indice: number
  ) {
    setForm(
      (atual) => ({
        ...atual,
        veiculos:
          atual.veiculos.filter(
            (
              _,
              index
            ) =>
              index !==
              indice
          ),
      })
    );
  }

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const url =
        form.id
          ? `/api/transportadoras/${form.id}`
          : "/api/transportadoras";

      const response =
        await fetch(
          url,
          {
            method:
              form.id
                ? "PATCH"
                : "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                form
              ),
          }
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          erro?: string;
          mensagem?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        setMensagem(
          payload.erro ??
            "Não foi possível salvar a transportadora."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        payload.mensagem ??
          "Cadastro realizado com sucesso."
      );

      setModalAberto(false);
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function desativar(
    item: Transportadora
  ) {
    if (
      !window.confirm(
        `Desativar a transportadora "${item.nome_razao_social}"? O histórico das vendas não será alterado.`
      )
    ) {
      return;
    }

    const response =
      await fetch(
        `/api/transportadoras/${item.id}`,
        {
          method:
            "DELETE",
        }
      );

    const payload =
      (await response.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
      };

    if (
      !response.ok ||
      !payload.ok
    ) {
      setSucesso(false);
      setMensagem(
        payload.erro ??
          "Não foi possível desativar a transportadora."
      );
      return;
    }

    setSucesso(true);
    setMensagem(
      payload.mensagem ??
        "Transportadora desativada."
    );
    router.refresh();
  }

  return (
    <main className="min-h-full p-4 md:p-6">
      <section className="mx-auto max-w-[1400px] space-y-4">
        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500">
              Cadastros
            </p>

            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
              Transportadoras
            </h1>

            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
              Cadastre transportadoras e veículos uma única vez para reutilizar nas próximas emissões de NF-e.
            </p>
          </div>

          {podeGerenciar && (
            <button
              type="button"
              onClick={
                abrirNovoCadastro
              }
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              + Nova transportadora
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <input
            value={busca}
            onChange={(event) =>
              setBusca(
                event.target
                  .value
              )
            }
            placeholder="Buscar por nome, fantasia ou CNPJ/CPF"
            className="h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500"
          />
        </div>

        {mensagem && (
          <div
            className={[
              "rounded-xl border p-4 text-sm",
              sucesso
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            ].join(" ")}
          >
            {mensagem}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <Th>Transportadora</Th>
                  <Th>CNPJ / CPF</Th>
                  <Th>Município / UF</Th>
                  <Th>Veículos</Th>
                  <Th>Status</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100">
                {filtradas.map(
                  (item) => {
                    const qtdVeiculos =
                      veiculos.filter(
                        (veiculo) =>
                          veiculo
                            .transportadora_id ===
                            item.id &&
                          veiculo.ativo
                      ).length;

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-zinc-50/70"
                      >
                        <Td>
                          <div className="font-semibold text-zinc-900">
                            {item.nome_razao_social}
                          </div>
                          {item.nome_fantasia && (
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {item.nome_fantasia}
                            </div>
                          )}
                        </Td>

                        <Td>
                          {formatarDocumento(
                            item.cpf_cnpj
                          )}
                        </Td>

                        <Td>
                          {item.municipio ||
                            "—"}
                          {item.uf
                            ? ` / ${item.uf}`
                            : ""}
                        </Td>

                        <Td>
                          {qtdVeiculos}
                        </Td>

                        <Td>
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-semibold",
                              item.ativo
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-zinc-100 text-zinc-500",
                            ].join(" ")}
                          >
                            {item.ativo
                              ? "Ativa"
                              : "Inativa"}
                          </span>
                        </Td>

                        <Td>
                          {podeGerenciar ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  editar(
                                    item
                                  )
                                }
                                className="text-sm font-semibold text-blue-700 hover:underline"
                              >
                                Editar
                              </button>

                              {item.ativo && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    desativar(
                                      item
                                    )
                                  }
                                  className="text-sm font-semibold text-red-700 hover:underline"
                                >
                                  Desativar
                                </button>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </tr>
                    );
                  }
                )}

                {filtradas.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center text-sm text-zinc-500"
                    >
                      Nenhuma transportadora encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-8">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  {form.id
                    ? "Editar transportadora"
                    : "Nova transportadora"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Dados reutilizáveis em novas vendas e NF-e.
                </p>
              </div>

              <button
                type="button"
                disabled={salvando}
                onClick={() =>
                  setModalAberto(
                    false
                  )
                }
                className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-6 p-5">
              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <legend className="px-2 text-sm font-semibold text-zinc-900">
                  Identificação
                </legend>

                <div className="grid gap-4 md:grid-cols-2">
                  <Campo
                    label="Nome / Razão Social *"
                    value={form.nome_razao_social}
                    onChange={(value) =>
                      patch(
                        "nome_razao_social",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Nome Fantasia"
                    value={form.nome_fantasia}
                    onChange={(value) =>
                      patch(
                        "nome_fantasia",
                        value
                      )
                    }
                  />

                  <Campo
                    label="CNPJ / CPF *"
                    value={form.cpf_cnpj}
                    onChange={(value) =>
                      patch(
                        "cpf_cnpj",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Inscrição Estadual"
                    value={form.inscricao_estadual}
                    onChange={(value) =>
                      patch(
                        "inscricao_estadual",
                        value
                      )
                    }
                  />

                  <Campo
                    label="RNTRC / ANTT"
                    value={form.rntrc}
                    onChange={(value) =>
                      patch(
                        "rntrc",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Telefone"
                    value={form.telefone}
                    onChange={(value) =>
                      patch(
                        "telefone",
                        value
                      )
                    }
                  />

                  <Campo
                    label="E-mail"
                    value={form.email}
                    onChange={(value) =>
                      patch(
                        "email",
                        value
                      )
                    }
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <legend className="px-2 text-sm font-semibold text-zinc-900">
                  Endereço
                </legend>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Campo
                      label="Logradouro"
                      value={form.logradouro}
                      onChange={(value) =>
                        patch(
                          "logradouro",
                          value
                        )
                      }
                    />
                  </div>

                  <Campo
                    label="Número"
                    value={form.numero}
                    onChange={(value) =>
                      patch(
                        "numero",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Complemento"
                    value={form.complemento}
                    onChange={(value) =>
                      patch(
                        "complemento",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Bairro"
                    value={form.bairro}
                    onChange={(value) =>
                      patch(
                        "bairro",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Município"
                    value={form.municipio}
                    onChange={(value) =>
                      patch(
                        "municipio",
                        value
                      )
                    }
                  />

                  <Campo
                    label="Código IBGE"
                    value={form.codigo_municipio_ibge}
                    onChange={(value) =>
                      patch(
                        "codigo_municipio_ibge",
                        value
                      )
                    }
                  />

                  <Campo
                    label="UF"
                    value={form.uf}
                    onChange={(value) =>
                      patch(
                        "uf",
                        value
                          .toUpperCase()
                          .slice(
                            0,
                            2
                          )
                      )
                    }
                    maxLength={2}
                  />

                  <Campo
                    label="CEP"
                    value={form.cep}
                    onChange={(value) =>
                      patch(
                        "cep",
                        value
                      )
                    }
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <legend className="px-2 text-sm font-semibold text-zinc-900">
                    Veículos
                  </legend>

                  <button
                    type="button"
                    onClick={adicionarVeiculo}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    + Adicionar veículo
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {form.veiculos.map(
                    (
                      veiculo,
                      indice
                    ) => (
                      <div
                        key={
                          veiculo.id ??
                          indice
                        }
                        className="grid gap-3 rounded-xl bg-zinc-50 p-4 md:grid-cols-5"
                      >
                        <Campo
                          label="Placa *"
                          value={veiculo.placa}
                          onChange={(value) =>
                            patchVeiculo(
                              indice,
                              {
                                placa:
                                  value
                                    .toUpperCase(),
                              }
                            )
                          }
                        />

                        <Campo
                          label="UF"
                          value={veiculo.uf}
                          onChange={(value) =>
                            patchVeiculo(
                              indice,
                              {
                                uf:
                                  value
                                    .toUpperCase()
                                    .slice(
                                      0,
                                      2
                                    ),
                              }
                            )
                          }
                          maxLength={2}
                        />

                        <Campo
                          label="RNTRC"
                          value={veiculo.rntrc}
                          onChange={(value) =>
                            patchVeiculo(
                              indice,
                              {
                                rntrc:
                                  value,
                              }
                            )
                          }
                        />

                        <Campo
                          label="Descrição"
                          value={veiculo.descricao}
                          onChange={(value) =>
                            patchVeiculo(
                              indice,
                              {
                                descricao:
                                  value,
                              }
                            )
                          }
                        />

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() =>
                              removerVeiculo(
                                indice
                              )
                            }
                            className="h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    )
                  )}

                  {form.veiculos.length ===
                    0 && (
                    <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">
                      Nenhum veículo cadastrado. Você pode cadastrar a transportadora sem veículo e adicionar depois.
                    </div>
                  )}
                </div>
              </fieldset>

              <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                <input
                  type="checkbox"
                  checked={form.ativo}
                  onChange={(event) =>
                    patch(
                      "ativo",
                      event.target
                        .checked
                    )
                  }
                />
                Transportadora ativa
              </label>

              {mensagem && modalAberto && (
                <div
                  className={[
                    "rounded-xl border p-3 text-sm",
                    sucesso
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800",
                  ].join(" ")}
                >
                  {mensagem}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                disabled={salvando}
                onClick={() =>
                  setModalAberto(
                    false
                  )
                }
                className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={salvando}
                onClick={salvar}
                className="h-10 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {salvando
                  ? "Salvando..."
                  : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Th({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </th>
  );
}

function Td({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <td className="px-5 py-4 text-sm text-zinc-700">
      {children}
    </td>
  );
}

function Campo({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange:
    (
      value: string
    ) => void;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>

      <input
        value={value}
        maxLength={
          maxLength
        }
        onChange={(event) =>
          onChange(
            event.target
              .value
          )
        }
        className="mt-1.5 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500"
      />
    </label>
  );
}
