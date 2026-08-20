import type {
  TransportadorNfeGeranet,
  TransporteNfeGeranet,
  VolumeNfeGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  normalizarDadosTransporteVenda,
  type DadosTransporteNfeVenda,
  type ModFreteNfe,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { resolverGrupoVeiculoNfe } from "@/lib/fiscal/transporte/resolver-veiculo-nfe";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export type TransporteGeranetMapeado = {
  modFrete: ModFreteNfe;
  transportador: TransportadorNfeGeranet | null;
  volumes: VolumeNfeGeranet[];
  veiculo: DecisaoVeiculoSnapshot;
};

export type DecisaoVeiculoSnapshot = {
  rntc?: string;
  placa?: string;
  uf?: string;
  transmitirGeranet: boolean;
};

export function mapearTransporteParaGeranet(
  valor: unknown
): TransporteGeranetMapeado {
  const dados = normalizarDadosTransporteVenda(valor);
  const modFrete = dados.mod_frete ?? "9";
  const veiculo = resolverGrupoVeiculoNfe({ modFrete });

  if (modFrete === "9") {
    return {
      modFrete,
      transportador: null,
      volumes: [],
      veiculo: {
        transmitirGeranet: false,
      },
    };
  }

  const transportador = mapearTransportadorGeranet(dados.transportador);
  const volumes: VolumeNfeGeranet[] = (dados.volumes ?? [])
    .filter((volume) => {
      const quantidade = Number(volume.quantidade ?? 0);
      const pesoBruto = Number(volume.peso_bruto_kg ?? 0);
      const pesoLiquido = Number(volume.peso_liquido_kg ?? 0);
      return (
        quantidade > 0 ||
        pesoBruto > 0 ||
        pesoLiquido > 0 ||
        texto(volume.especie) ||
        texto(volume.marca)
      );
    })
    .map((volume) => {
      const geranet: VolumeNfeGeranet = {
        quantidade: volume.quantidade ?? 0,
        pesoLiquido: volume.peso_liquido_kg ?? 0,
        pesoBruto: volume.peso_bruto_kg ?? 0,
      };
      const descricao = texto(volume.especie);
      if (descricao) {
        geranet.descricao = descricao;
      }
      const marca = texto(volume.marca);
      if (marca) {
        geranet.marca = marca;
      }
      return geranet;
    });

  return {
    modFrete,
    transportador,
    volumes,
    veiculo: {
      rntc: texto(dados.veiculo?.rntc),
      placa: texto(dados.veiculo?.placa).toUpperCase(),
      uf: texto(dados.veiculo?.uf).toUpperCase(),
      transmitirGeranet: veiculo.transmitirGeranet,
    },
  };
}

function mapearTransportadorGeranet(
  transportador: DadosTransporteNfeVenda["transportador"]
): TransportadorNfeGeranet | null {
  if (!transportador) {
    return null;
  }

  const geranet: TransportadorNfeGeranet = {};
  const documento = somenteDigitos(transportador.cpf_cnpj);
  if (documento.length === 14) {
    geranet.cnpj = documento;
  } else if (documento.length === 11) {
    geranet.cpf = documento;
  }

  const razaoSocial = texto(transportador.nome_razao_social);
  if (razaoSocial) {
    geranet.razaoSocial = razaoSocial;
  }
  const inscricaoEstadual = texto(transportador.inscricao_estadual);
  if (inscricaoEstadual) {
    geranet.inscricaoEstadual = inscricaoEstadual;
  }
  const endereco = texto(transportador.endereco);
  if (endereco) {
    geranet.endereco = endereco;
  }
  const municipio = texto(transportador.municipio);
  if (municipio) {
    geranet.municipio = municipio;
  }
  const uf = texto(transportador.uf).toUpperCase();
  if (uf) {
    geranet.uf = uf;
  }

  return Object.keys(geranet).length > 0 ? geranet : null;
}

export function transporteNfeParaPayloadGeranet(
  valor: unknown
): TransporteNfeGeranet | null {
  const mapeado = mapearTransporteParaGeranet(valor);
  if (mapeado.modFrete === "9") {
    return null;
  }
  if (!mapeado.transportador && mapeado.volumes.length === 0) {
    return null;
  }
  return {
    transportador: mapeado.transportador,
    volumes: mapeado.volumes,
  };
}

export function validarVolumesTransporte(dados: DadosTransporteNfeVenda) {
  const erros: string[] = [];
  for (const volume of dados.volumes ?? []) {
    const quantidade = Number(volume.quantidade ?? 0);
    const pesoBruto = Number(volume.peso_bruto_kg ?? 0);
    const pesoLiquido = Number(volume.peso_liquido_kg ?? 0);
    if (quantidade < 0) {
      erros.push("A quantidade do volume não pode ser negativa.");
    }
    if (pesoBruto < 0 || pesoLiquido < 0) {
      erros.push("O peso do volume não pode ser negativo.");
    }
  }
  return erros;
}
