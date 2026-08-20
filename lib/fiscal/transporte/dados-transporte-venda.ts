export type ModFreteNfe =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "9";

export const MENSAGEM_FRETE_9_COM_DADOS =
  "Há dados de transporte preenchidos, mas a modalidade está como Sem frete.";

export type DadosTransporteNfeVenda = {
  versao?: number;
  mod_frete?: ModFreteNfe;
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
  volumes?: Array<{
    quantidade?:
      | number
      | null;
    especie?: string;
    marca?: string;
    numeracao?: string;
    peso_bruto_kg?:
      | number
      | null;
    peso_liquido_kg?:
      | number
      | null;
  }>;
};

const VALIDOS =
  new Set<
    ModFreteNfe
  >([
    "0",
    "1",
    "2",
    "3",
    "4",
    "9",
  ]);

export const OPCOES_MOD_FRETE_NFE: Array<{
  value: ModFreteNfe;
  label: string;
}> = [
  {
    value: "0",
    label: "0 - Contratação do frete por conta do remetente (CIF)",
  },
  {
    value: "1",
    label: "1 - Contratação do frete por conta do destinatário (FOB)",
  },
  {
    value: "2",
    label: "2 - Contratação do frete por conta de terceiros",
  },
  {
    value: "3",
    label: "3 - Transporte próprio por conta do remetente",
  },
  {
    value: "4",
    label: "4 - Transporte próprio por conta do destinatário",
  },
  {
    value: "9",
    label: "9 - Sem ocorrência de transporte (sem frete)",
  },
];

export function normalizarDadosTransporteVenda(
  valor: unknown
): DadosTransporteNfeVenda {
  if (
    !valor ||
    typeof valor !==
      "object" ||
    Array.isArray(valor)
  ) {
    return {
      versao: 1,
      mod_frete: "9",
      transportador:
        null,
      veiculo: null,
      volumes: [],
    };
  }

  const dados =
    valor as
      DadosTransporteNfeVenda;

  const modFrete =
    VALIDOS.has(
      dados.mod_frete ??
        "9"
    )
      ? dados.mod_frete ??
        "9"
      : "9";

  return {
    versao: 1,
    mod_frete:
      modFrete,
    transportadora_id:
      textoId(
        dados.transportadora_id
      ),
    veiculo_id:
      textoId(
        dados.veiculo_id
      ),
    transportador:
      dados.transportador ??
      null,
    veiculo:
      dados.veiculo ??
      null,
    volumes: normalizarVolumesTransporte(dados.volumes),
  };
}

function normalizarVolumesTransporte(
  volumes: unknown
): NonNullable<DadosTransporteNfeVenda["volumes"]> {
  if (!Array.isArray(volumes)) {
    return [];
  }
  return volumes.map((volume) => {
    const bruto =
      volume && typeof volume === "object" && !Array.isArray(volume)
        ? (volume as Record<string, unknown>)
        : {};
    return {
      quantidade: bruto.quantidade as number | null | undefined,
      especie: texto(bruto.especie) || texto(bruto.descricao),
      marca: texto(bruto.marca),
      numeracao: texto(bruto.numeracao),
      peso_bruto_kg: bruto.peso_bruto_kg as number | null | undefined,
      peso_liquido_kg: bruto.peso_liquido_kg as number | null | undefined,
    };
  });
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function textoId(valor: unknown) {
  const id = texto(valor);
  return id || null;
}

function campoPreenchido(valor: unknown) {
  if (valor === null || valor === undefined) {
    return false;
  }
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor !== 0;
  }
  return texto(valor).length > 0;
}

export function transporteTemDetalhesPreenchidos(
  valor: unknown
) {
  const dados = normalizarDadosTransporteVenda(valor);
  if (
    campoPreenchido(dados.transportadora_id) ||
    campoPreenchido(dados.veiculo_id)
  ) {
    return true;
  }
  const transportador = dados.transportador;
  if (
    transportador &&
    (campoPreenchido(transportador.nome_razao_social) ||
      campoPreenchido(transportador.cpf_cnpj) ||
      campoPreenchido(transportador.inscricao_estadual) ||
      campoPreenchido(transportador.endereco) ||
      campoPreenchido(transportador.municipio) ||
      campoPreenchido(transportador.uf))
  ) {
    return true;
  }
  const veiculo = dados.veiculo;
  if (
    veiculo &&
    (campoPreenchido(veiculo.rntc) ||
      campoPreenchido(veiculo.placa) ||
      campoPreenchido(veiculo.uf))
  ) {
    return true;
  }
  return (dados.volumes ?? []).some(
    (volume) =>
      campoPreenchido(volume.quantidade) ||
      campoPreenchido(volume.especie) ||
      campoPreenchido(volume.marca) ||
      campoPreenchido(volume.numeracao) ||
      campoPreenchido(volume.peso_bruto_kg) ||
      campoPreenchido(volume.peso_liquido_kg)
  );
}

export function transporteConflitaComFrete9(valor: unknown) {
  const dados = normalizarDadosTransporteVenda(valor);
  return (
    (dados.mod_frete ?? "9") === "9" &&
    transporteTemDetalhesPreenchidos(dados)
  );
}

export function obterModFreteVenda(
  valor: unknown
): ModFreteNfe {
  return (
    normalizarDadosTransporteVenda(
      valor
    ).mod_frete ??
    "9"
  );
}
