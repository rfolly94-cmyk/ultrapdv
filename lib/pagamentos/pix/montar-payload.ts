import { ehProvedorPixGeranet } from "./provedores";
import type {
  AmbientePixGeranet,
  CredenciaisBancariasPix,
  DevedorPix,
  PayloadCobrancaPix,
  RecebedorPix,
} from "./types";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function garantirEmpresa(empresaAtual: string, recursoEmpresa: string) {
  if (empresaAtual !== recursoEmpresa) {
    throw new Error("Recurso PIX pertence a outra empresa.");
  }
}

export function montarPayloadCobrancaPix({
  ambiente,
  provedor,
  cnpj,
  credenciais,
  recebedor,
  cobranca,
  txid,
  devedor,
}: {
  ambiente: AmbientePixGeranet;
  provedor: string;
  cnpj: string;
  credenciais: CredenciaisBancariasPix;
  recebedor: RecebedorPix;
  cobranca?: PayloadCobrancaPix["cobranca"];
  txid?: string;
  devedor?: DevedorPix;
}): PayloadCobrancaPix {
  if (!ehProvedorPixGeranet(provedor)) {
    throw new Error("Provedor PIX não suportado pela Geranet.");
  }

  if (ambiente !== "1" && ambiente !== "2") {
    throw new Error("Ambiente PIX inválido.");
  }

  const cnpjcpf = somenteDigitos(cnpj);
  if (cnpjcpf.length !== 14) {
    throw new Error("CNPJ da empresa inválido para emissão PIX.");
  }

  const payload: PayloadCobrancaPix = {
    ambiente,
    provedor,
    cnpjcpf,
    credenciais,
    recebedor: {
      nome: texto(recebedor.nome),
      cep: somenteDigitos(recebedor.cep),
      cidade: texto(recebedor.cidade),
      uf: texto(recebedor.uf).toUpperCase(),
    },
  };

  if (texto(txid)) {
    payload.txid = texto(txid);
  }

  if (cobranca) {
    payload.cobranca = {
      valor: Number(cobranca.valor),
      expiracaoSegundos: cobranca.expiracaoSegundos ?? 3600,
      solicitacaoPagador:
        cobranca.solicitacaoPagador ?? "Teste UltraPDV",
      permitirAlterarValor: cobranca.permitirAlterarValor ?? false,
    };
  }

  if (devedor && (texto(devedor.nome) || texto(devedor.cpfCnpj))) {
    payload.devedor = {
      ...(texto(devedor.nome) ? { nome: texto(devedor.nome) } : {}),
      ...(texto(devedor.cpfCnpj)
        ? { cpfCnpj: somenteDigitos(devedor.cpfCnpj) }
        : {}),
    };
  }

  return payload;
}
