"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";
import {
  Lock,
  Truck,
} from "lucide-react";
import { CampoValor } from "@/components/ui/campo-valor";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";

export type VolumeTransporte = {
  quantidade:
    | number
    | null;
  especie: string;
  marca: string;
  numeracao: string;
  peso_bruto_kg:
    | number
    | null;
  peso_liquido_kg:
    | number
    | null;
};

export type VeiculoTransportadoraCadastro = {
  id: string;
  placa: string;
  uf: string;
  rntrc: string;
  descricao: string;
};

export type TransportadoraCadastro = {
  id: string;
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
  veiculos:
    VeiculoTransportadoraCadastro[];
};

export type DadosTransporteVenda = {
  versao?: number;
  mod_frete?: string;
  transportadora_id?: string | null;
  veiculo_id?: string | null;
  transportador?: {
    nome_razao_social?: string;
    cpf_cnpj?: string;
    inscricao_estadual?: string;
    endereco?: string;
    municipio?: string;
    uf?: string;
  } | null;
  veiculo?: {
    rntc?: string;
    placa?: string;
    uf?: string;
  } | null;
  volumes?: VolumeTransporte[];
};

type Props = {
  vendaId?: string;
  numero:
    | number
    | string
    | null;
  dadosTransporte:
    | DadosTransporteVenda
    | null;
  bloqueado?: boolean;
  motivoBloqueio?: string;
  apresentacaoCompacta?: boolean;
  transportadoras?:
    TransportadoraCadastro[];
  onSalvar?: (
    dados: DadosTransporteVenda
  ) => Promise<{
    ok: boolean;
    erro?: string;
    mensagem?: string;
  }>;
};

export type TransporteVendaFormHandle = {
  persistirSeNecessario: () => Promise<{
    ok: boolean;
    erro?: string;
    mensagem?: string;
  }>;
};

const OPCOES_FRETE = [
  {
    value: "0",
    label:
      "0 - Contratação do frete por conta do remetente (CIF)",
  },
  {
    value: "1",
    label:
      "1 - Contratação do frete por conta do destinatário (FOB)",
  },
  {
    value: "2",
    label:
      "2 - Contratação do frete por conta de terceiros",
  },
  {
    value: "3",
    label:
      "3 - Transporte próprio por conta do remetente",
  },
  {
    value: "4",
    label:
      "4 - Transporte próprio por conta do destinatário",
  },
  {
    value: "9",
    label:
      "9 - Sem ocorrência de transporte (sem frete)",
  },
] as const;

function novoVolume(): VolumeTransporte {
  return {
    quantidade: null,
    especie: "",
    marca: "",
    numeracao: "",
    peso_bruto_kg: null,
    peso_liquido_kg: null,
  };
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  );
}

function numeroTexto(
  valor:
    | number
    | null
) {
  return valor === null ||
    valor === undefined
    ? ""
    : String(valor)
        .replace(".", ",");
}

function parseNumero(
  valor: string
):
  | number
  | null {
  const limpo =
    valor
      .trim()
      .replace(/\s/g, "")
      .replace(",", ".");

  if (!limpo) {
    return null;
  }

  const numero =
    Number(limpo);

  return Number.isFinite(
    numero
  )
    ? numero
    : null;
}

export const TransporteVendaForm = forwardRef<
  TransporteVendaFormHandle,
  Props
>(function TransporteVendaForm({
  vendaId,
  numero,
  dadosTransporte,
  bloqueado = false,
  motivoBloqueio,
  apresentacaoCompacta = false,
  transportadoras = [],
  onSalvar,
}: Props, ref) {
  const router =
    useRouter();

  const inicial =
    useMemo(
      () => ({
        modFrete:
          dadosTransporte
            ?.mod_frete ??
          "9",
        transportadoraId:
          texto(
            dadosTransporte
              ?.transportadora_id
          ),
        veiculoId:
          texto(
            dadosTransporte
              ?.veiculo_id
          ),
        nomeRazaoSocial:
          texto(
            dadosTransporte
              ?.transportador
              ?.nome_razao_social
          ),
        cpfCnpj:
          texto(
            dadosTransporte
              ?.transportador
              ?.cpf_cnpj
          ),
        inscricaoEstadual:
          texto(
            dadosTransporte
              ?.transportador
              ?.inscricao_estadual
          ),
        endereco:
          texto(
            dadosTransporte
              ?.transportador
              ?.endereco
          ),
        municipio:
          texto(
            dadosTransporte
              ?.transportador
              ?.municipio
          ),
        ufTransportador:
          texto(
            dadosTransporte
              ?.transportador
              ?.uf
          ),
        rntc:
          texto(
            dadosTransporte
              ?.veiculo
              ?.rntc
          ),
        placa:
          texto(
            dadosTransporte
              ?.veiculo
              ?.placa
          ),
        ufVeiculo:
          texto(
            dadosTransporte
              ?.veiculo
              ?.uf
          ),
        volumes:
          dadosTransporte
            ?.volumes
            ?.length
            ? dadosTransporte
                .volumes
                .map(
                  (volume) => ({
                    quantidade:
                      volume.quantidade ??
                      null,
                    especie:
                      texto(
                        volume.especie
                      ),
                    marca:
                      texto(
                        volume.marca
                      ),
                    numeracao:
                      texto(
                        volume.numeracao
                      ),
                    peso_bruto_kg:
                      volume
                        .peso_bruto_kg ??
                      null,
                    peso_liquido_kg:
                      volume
                        .peso_liquido_kg ??
                      null,
                  })
                )
            : [
                novoVolume(),
              ],
      }),
      [dadosTransporte]
    );

  const [
    aberto,
    setAberto,
  ] =
    useState(false);

  const [
    modFrete,
    setModFrete,
  ] =
    useState(
      inicial.modFrete
    );

  const [
    transportadoraId,
    setTransportadoraId,
  ] =
    useState(
      inicial.transportadoraId
    );

  const [
    veiculoId,
    setVeiculoId,
  ] =
    useState(
      inicial.veiculoId
    );

  const [
    nomeRazaoSocial,
    setNomeRazaoSocial,
  ] =
    useState(
      inicial.nomeRazaoSocial
    );

  const [
    cpfCnpj,
    setCpfCnpj,
  ] =
    useState(
      inicial.cpfCnpj
    );

  const [
    inscricaoEstadual,
    setInscricaoEstadual,
  ] =
    useState(
      inicial.inscricaoEstadual
    );

  const [
    endereco,
    setEndereco,
  ] =
    useState(
      inicial.endereco
    );

  const [
    municipio,
    setMunicipio,
  ] =
    useState(
      inicial.municipio
    );

  const [
    ufTransportador,
    setUfTransportador,
  ] =
    useState(
      inicial.ufTransportador
    );

  const [
    rntc,
    setRntc,
  ] =
    useState(
      inicial.rntc
    );

  const [
    placa,
    setPlaca,
  ] =
    useState(
      inicial.placa
    );

  const [
    ufVeiculo,
    setUfVeiculo,
  ] =
    useState(
      inicial.ufVeiculo
    );

  const [
    volumes,
    setVolumes,
  ] =
    useState<
      VolumeTransporte[]
    >(
      inicial.volumes
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

  const semTransporte =
    modFrete === "9";

  const rotuloFrete =
    OPCOES_FRETE.find(
      (item) =>
        item.value ===
        modFrete
    )?.label ??
    modFrete;

  function restaurar() {
    setModFrete(
      inicial.modFrete
    );
    setTransportadoraId(
      inicial.transportadoraId
    );
    setVeiculoId(
      inicial.veiculoId
    );
    setNomeRazaoSocial(
      inicial.nomeRazaoSocial
    );
    setCpfCnpj(
      inicial.cpfCnpj
    );
    setInscricaoEstadual(
      inicial.inscricaoEstadual
    );
    setEndereco(
      inicial.endereco
    );
    setMunicipio(
      inicial.municipio
    );
    setUfTransportador(
      inicial.ufTransportador
    );
    setRntc(
      inicial.rntc
    );
    setPlaca(
      inicial.placa
    );
    setUfVeiculo(
      inicial.ufVeiculo
    );
    setVolumes(
      inicial.volumes
    );
    setMensagem(null);
    setSucesso(false);
  }

  function enderecoCadastro(
    transportadora:
      TransportadoraCadastro
  ) {
    const partes = [
      transportadora.logradouro,
      transportadora.numero,
      transportadora.complemento,
      transportadora.bairro,
    ]
      .map(
        (item) =>
          item.trim()
      )
      .filter(
        Boolean
      );

    return partes.join(
      ", "
    );
  }

  function selecionarTransportadora(
    id: string
  ) {
    setTransportadoraId(
      id
    );
    setVeiculoId("");

    if (!id) {
      return;
    }

    const cadastro =
      transportadoras.find(
        (item) =>
          item.id === id
      );

    if (!cadastro) {
      return;
    }

    setNomeRazaoSocial(
      cadastro.nome_razao_social
    );
    setCpfCnpj(
      cadastro.cpf_cnpj
    );
    setInscricaoEstadual(
      cadastro.inscricao_estadual
    );
    setEndereco(
      enderecoCadastro(
        cadastro
      )
    );
    setMunicipio(
      cadastro.municipio
    );
    setUfTransportador(
      cadastro.uf
    );
    setRntc(
      cadastro.rntrc
    );
    setPlaca("");
    setUfVeiculo("");
  }

  function selecionarVeiculo(
    id: string
  ) {
    setVeiculoId(id);

    if (!id) {
      setPlaca("");
      setUfVeiculo("");
      return;
    }

    const cadastro =
      transportadoras.find(
        (item) =>
          item.id ===
          transportadoraId
      );

    const veiculo =
      cadastro?.veiculos.find(
        (item) =>
          item.id === id
      );

    if (!veiculo) {
      return;
    }

    setPlaca(
      veiculo.placa
    );
    setUfVeiculo(
      veiculo.uf
    );

    if (veiculo.rntrc) {
      setRntc(
        veiculo.rntrc
      );
    }
  }

  const veiculosDisponiveis =
    transportadoras.find(
      (item) =>
        item.id ===
        transportadoraId
    )?.veiculos ??
    [];

  function atualizarVolume(
    indice: number,
    patch:
      Partial<
        VolumeTransporte
      >
  ) {
    setVolumes(
      (atual) =>
        atual.map(
          (
            volume,
            index
          ) =>
            index === indice
              ? {
                  ...volume,
                  ...patch,
                }
              : volume
        )
    );
  }

  async function persistirAtual() {
    const dados: DadosTransporteVenda = {
      mod_frete: modFrete,
      transportadora_id: transportadoraId || null,
      veiculo_id: veiculoId || null,
      transportador: {
        nome_razao_social: nomeRazaoSocial,
        cpf_cnpj: cpfCnpj,
        inscricao_estadual: inscricaoEstadual,
        endereco,
        municipio,
        uf: ufTransportador,
      },
      veiculo: {
        rntc,
        placa,
        uf: ufVeiculo,
      },
      volumes: volumes.map((volume) => ({
        quantidade: volume.quantidade,
        especie: texto(volume.especie),
        marca: texto(volume.marca),
        numeracao: texto(volume.numeracao),
        peso_bruto_kg: volume.peso_bruto_kg,
        peso_liquido_kg: volume.peso_liquido_kg,
      })),
    };

    if (transporteConflitaComFrete9(dados)) {
      return {
        ok: false as const,
        erro: MENSAGEM_FRETE_9_COM_DADOS,
      };
    }

    if (onSalvar) {
      return onSalvar(dados);
    }

    const response = await fetch(
      `/api/vendas/${vendaId}/transporte`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dados),
      }
    );

    const payload = (await response.json()) as {
      ok?: boolean;
      erro?: string;
    };

    if (!response.ok || !payload.ok) {
      return {
        ok: false as const,
        erro:
          payload.erro ??
          "Não foi possível salvar os dados de transporte.",
      };
    }

    return {
      ok: true as const,
      mensagem: "Dados de transporte salvos com sucesso.",
    };
  }

  function transporteEstaSujo() {
    return (
      JSON.stringify({
        mod_frete: modFrete,
        transportadora_id: transportadoraId || null,
        veiculo_id: veiculoId || null,
        nome_razao_social: nomeRazaoSocial,
        cpf_cnpj: cpfCnpj,
        inscricao_estadual: inscricaoEstadual,
        endereco,
        municipio,
        uf: ufTransportador,
        rntc,
        placa,
        uf_veiculo: ufVeiculo,
        volumes,
      }) !==
      JSON.stringify({
        mod_frete: inicial.modFrete,
        transportadora_id: inicial.transportadoraId || null,
        veiculo_id: inicial.veiculoId || null,
        nome_razao_social: inicial.nomeRazaoSocial,
        cpf_cnpj: inicial.cpfCnpj,
        inscricao_estadual: inicial.inscricaoEstadual,
        endereco: inicial.endereco,
        municipio: inicial.municipio,
        uf: inicial.ufTransportador,
        rntc: inicial.rntc,
        placa: inicial.placa,
        uf_veiculo: inicial.ufVeiculo,
        volumes: inicial.volumes,
      })
    );
  }

  useImperativeHandle(ref, () => ({
    persistirSeNecessario: async () => {
      if (bloqueado || !transporteEstaSujo()) {
        return { ok: true };
      }
      return persistirAtual();
    },
  }));

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const resultado = await persistirAtual();
      if (!resultado.ok) {
        setMensagem(
          resultado.erro ?? "Não foi possível salvar o transporte."
        );
        return;
      }
      setSucesso(true);
      setMensagem(
        resultado.mensagem ?? "Dados de transporte salvos com sucesso."
      );
      if (!onSalvar) {
        setAberto(false);
      }
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada ao salvar os dados de transporte."
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          {apresentacaoCompacta ? (
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-zinc-500" />
              <h2 className="text-[15px] font-semibold text-zinc-950">
                Transportador / Volumes Transportados
              </h2>
            </div>
          ) : (
            <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            NF-e modelo 55
          </p>

          <h2 className="mt-1 text-[15px] font-semibold text-zinc-950">
            Transportador / Volumes Transportados
          </h2>
            </>
          )}

          <p className="mt-1 max-w-3xl text-[13px] text-zinc-500">
            {bloqueado
              ? motivoBloqueio ??
                "Informações de transporte não podem ser alteradas após a autorização da NF-e."
              : vendaId
                ? `Venda #${numero ?? "—"} · defina modalidade do frete, transportador, veículo e volumes antes da emissão da NF-e.`
                : `NF-e ${numero ?? "—"} · defina modalidade do frete, transportador, veículo e volumes antes da emissão da NF-e.`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {bloqueado ? (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-600">
              <Lock className="h-3 w-3" />
              Somente leitura
            </span>
          ) : (
        <button
          type="button"
          disabled={
            bloqueado
          }
          onClick={() => {
            if (aberto) {
              restaurar();
              setAberto(false);
            } else {
              setAberto(true);
              setMensagem(null);
            }
          }}
          className="updv-btn updv-btn-ghost shrink-0 disabled:opacity-50"
        >
          {aberto
            ? "Fechar sem salvar"
            : dadosTransporte
              ? "Alterar dados de transporte"
              : "Preencher dados de transporte"}
        </button>
          )}
        </div>
      </div>

      {bloqueado && !apresentacaoCompacta && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {motivoBloqueio ??
            "Os dados de transporte estão bloqueados porque a venda já possui documento fiscal em estado sensível."}
        </div>
      )}

      {!aberto && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Resumo
            titulo="Frete por conta"
            valor={rotuloFrete}
          />

          <Resumo
            titulo="Transportador"
            valor={
              nomeRazaoSocial ||
              cpfCnpj ||
              "Não informado"
            }
          />

          <Resumo
            titulo="Volumes"
            valor={`${volumes.length} volume${volumes.length === 1 ? "" : "s"}`}
          />
        </div>
      )}

      {mensagem && !aberto && (
        <div
          className={[
            "mt-4 rounded-xl border p-3 text-sm",
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800",
          ].join(" ")}
        >
          {mensagem}
        </div>
      )}

      {aberto && (
        <div className="mt-5 space-y-5 border-t border-zinc-200 pt-5">
          <label className="block">
            <span className="text-sm font-semibold text-zinc-800">
              Frete por conta
            </span>

            <select
              value={
                modFrete
              }
              disabled={
                salvando
              }
              onChange={(
                event
              ) =>
                setModFrete(
                  event.target
                    .value
                )
              }
              className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
            >
              {OPCOES_FRETE.map(
                (opcao) => (
                  <option
                    key={
                      opcao.value
                    }
                    value={
                      opcao.value
                    }
                  >
                    {
                      opcao.label
                    }
                  </option>
                )
              )}
            </select>
          </label>

          {semTransporte ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              Modalidade <strong>9 - Sem ocorrência de transporte</strong>.
              Transportador, veículo e volumes continuam salvos no UltraPDV,
              mas não podem ficar preenchidos com esta modalidade.
            </div>
          ) : null}

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <label className="block flex-1">
                    <span className="text-sm font-semibold text-blue-950">
                      Transportadora cadastrada
                    </span>

                    <select
                      value={
                        transportadoraId
                      }
                      disabled={
                        salvando
                      }
                      onChange={(
                        event
                      ) =>
                        selecionarTransportadora(
                          event.target
                            .value
                        )
                      }
                      className="mt-2 h-11 w-full rounded-xl border border-blue-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
                    >
                      <option value="">
                        Preencher manualmente
                      </option>

                      {transportadoras.map(
                        (
                          transportadora
                        ) => (
                          <option
                            key={
                              transportadora.id
                            }
                            value={
                              transportadora.id
                            }
                          >
                            {
                              transportadora.nome_razao_social
                            }
                            {
                              transportadora.cpf_cnpj
                                ? ` · ${transportadora.cpf_cnpj}`
                                : ""
                            }
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <a
                    href="/transportadoras?nova=1"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    + Cadastrar transportadora
                  </a>

                  <button
                    type="button"
                    onClick={() =>
                      router.refresh()
                    }
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Atualizar lista
                  </button>
                </div>

                {transportadoraId && (
                  <label className="mt-4 block">
                    <span className="text-sm font-semibold text-blue-950">
                      Veículo cadastrado
                    </span>

                    <select
                      value={
                        veiculoId
                      }
                      disabled={
                        salvando
                      }
                      onChange={(
                        event
                      ) =>
                        selecionarVeiculo(
                          event.target
                            .value
                        )
                      }
                      className="mt-2 h-11 w-full rounded-xl border border-blue-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
                    >
                      <option value="">
                        Sem veículo cadastrado / preencher manualmente
                      </option>

                      {veiculosDisponiveis.map(
                        (
                          veiculo
                        ) => (
                          <option
                            key={
                              veiculo.id
                            }
                            value={
                              veiculo.id
                            }
                          >
                            {
                              veiculo.placa
                            }
                            {
                              veiculo.descricao
                                ? ` · ${veiculo.descricao}`
                                : ""
                            }
                          </option>
                        )
                      )}
                    </select>
                  </label>
                )}
              </div>

              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <legend className="px-2 text-sm font-semibold text-zinc-900">
                  Transportador
                </legend>

                <div className="grid gap-4 md:grid-cols-2">
                  <Campo
                    label="Nome / Razão Social"
                    value={
                      nomeRazaoSocial
                    }
                    onChange={
                      setNomeRazaoSocial
                    }
                    disabled={
                      salvando
                    }
                  />

                  <Campo
                    label="CNPJ / CPF"
                    value={
                      cpfCnpj
                    }
                    onChange={
                      setCpfCnpj
                    }
                    disabled={
                      salvando
                    }
                    placeholder="Somente números ou formatado"
                  />

                  <Campo
                    label="Inscrição Estadual"
                    value={
                      inscricaoEstadual
                    }
                    onChange={
                      setInscricaoEstadual
                    }
                    disabled={
                      salvando
                    }
                  />

                  <Campo
                    label="Endereço"
                    value={
                      endereco
                    }
                    onChange={
                      setEndereco
                    }
                    disabled={
                      salvando
                    }
                  />

                  <Campo
                    label="Município"
                    value={
                      municipio
                    }
                    onChange={
                      setMunicipio
                    }
                    disabled={
                      salvando
                    }
                  />

                  <Campo
                    label="UF"
                    value={
                      ufTransportador
                    }
                    onChange={(
                      value
                    ) =>
                      setUfTransportador(
                        value
                          .toUpperCase()
                          .slice(
                            0,
                            2
                          )
                      )
                    }
                    disabled={
                      salvando
                    }
                    maxLength={2}
                    placeholder="MT"
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <legend className="px-2 text-sm font-semibold text-zinc-900">
                  Veículo
                </legend>

                <div className="grid gap-4 md:grid-cols-3">
                  <Campo
                    label="Código ANTT / RNTC"
                    value={
                      rntc
                    }
                    onChange={
                      setRntc
                    }
                    disabled={
                      salvando
                    }
                  />

                  <Campo
                    label="Placa do veículo"
                    value={
                      placa
                    }
                    onChange={(
                      value
                    ) =>
                      setPlaca(
                        value
                          .toUpperCase()
                      )
                    }
                    disabled={
                      salvando
                    }
                    placeholder="ABC1D23"
                  />

                  <Campo
                    label="UF"
                    value={
                      ufVeiculo
                    }
                    onChange={(
                      value
                    ) =>
                      setUfVeiculo(
                        value
                          .toUpperCase()
                          .slice(
                            0,
                            2
                          )
                      )
                    }
                    disabled={
                      salvando
                    }
                    maxLength={2}
                    placeholder="MT"
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-zinc-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <legend className="px-2 text-sm font-semibold text-zinc-900">
                    Volumes Transportados
                  </legend>

                  <button
                    type="button"
                    disabled={
                      salvando
                    }
                    onClick={() =>
                      setVolumes(
                        (atual) => [
                          ...atual,
                          novoVolume(),
                        ]
                      )
                    }
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    + Adicionar volume
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {volumes.map(
                    (
                      volume,
                      indice
                    ) => (
                      <div
                        key={
                          indice
                        }
                        className="rounded-xl bg-zinc-50 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-zinc-800">
                            Volume{" "}
                            {indice +
                              1}
                          </p>

                          {volumes.length >
                            1 && (
                            <button
                              type="button"
                              disabled={
                                salvando
                              }
                              onClick={() =>
                                setVolumes(
                                  (
                                    atual
                                  ) =>
                                    atual.filter(
                                      (
                                        _,
                                        index
                                      ) =>
                                        index !==
                                        indice
                                    )
                                )
                              }
                              className="text-xs font-semibold text-red-700 hover:underline"
                            >
                              Remover
                            </button>
                          )}
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                          <Campo
                            label="Quantidade"
                            value={numeroTexto(
                              volume.quantidade
                            )}
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  quantidade:
                                    parseNumero(
                                      value
                                    ),
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                            inputMode="numeric"
                          />

                          <Campo
                            label="Espécie"
                            value={
                              volume.especie
                            }
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  especie:
                                    value,
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                            placeholder="CAIXA"
                          />

                          <Campo
                            label="Marca"
                            value={
                              volume.marca
                            }
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  marca:
                                    value,
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                          />

                          <Campo
                            label="Numeração"
                            value={
                              volume.numeracao
                            }
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  numeracao:
                                    value,
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                          />

                          <Campo
                            label="Peso Bruto (Kg)"
                            value={numeroTexto(
                              volume.peso_bruto_kg
                            )}
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  peso_bruto_kg:
                                    parseNumero(
                                      value
                                    ),
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                            inputMode="decimal"
                          />

                          <Campo
                            label="Peso Líquido (Kg)"
                            value={numeroTexto(
                              volume.peso_liquido_kg
                            )}
                            onChange={(
                              value
                            ) =>
                              atualizarVolume(
                                indice,
                                {
                                  peso_liquido_kg:
                                    parseNumero(
                                      value
                                    ),
                                }
                              )
                            }
                            disabled={
                              salvando
                            }
                            inputMode="decimal"
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
              </fieldset>

          {mensagem && (
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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                salvando
              }
              onClick={
                salvar
              }
              className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
            >
              {salvando
                ? "Salvando..."
                : "Salvar dados de transporte"}
            </button>

            <button
              type="button"
              disabled={
                salvando
              }
              onClick={() => {
                restaurar();
                setAberto(false);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            Estes dados ficam salvos como snapshot comercial da venda para uso da NF-e 55. O campo <strong>Frete por conta</strong> corresponde à modalidade de transporte; ele não é o mesmo que o valor monetário de frete da venda.
          </div>
        </div>
      )}
    </section>
  );
});

function Campo({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (
    value: string
  ) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  inputMode?:
    | "text"
    | "numeric"
    | "decimal";
}) {
  const InputCampo =
    inputMode === "decimal" || inputMode === "numeric" ? CampoValor : "input";
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">
        {label}
      </span>

      <InputCampo
        type="text"
        value={value}
        disabled={disabled}
        placeholder={
          placeholder
        }
        maxLength={
          maxLength
        }
        inputMode={
          inputMode
        }
        onChange={(
          event
        ) =>
          onChange(
            event.target.value
          )
        }
        className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500"
      />
    </label>
  );
}

function Resumo({
  titulo,
  valor,
}: {
  titulo: string;
  valor: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {titulo}
      </p>

      <p className="mt-1 text-sm font-medium text-zinc-900">
        {valor}
      </p>
    </div>
  );
}
