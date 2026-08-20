import { aplicarCrcBrCode } from "./crc";
import { campoEmv } from "./emv";
import {
  normalizarChavePix,
  normalizarCidadeRecebedor,
  normalizarNomeRecebedor,
  normalizarValorPix,
} from "./normalizar";
import { sanitizarTxidPix } from "./txid";

export type DadosPixEstatico = {
  chave: string;
  nomeRecebedor: string;
  cidadeRecebedor: string;
  valor: number;
  txid: string;
};

export function montarPayloadPixEstatico(dados: DadosPixEstatico) {
  const chave = normalizarChavePix(dados.chave);
  const nome = normalizarNomeRecebedor(dados.nomeRecebedor);
  const cidade = normalizarCidadeRecebedor(dados.cidadeRecebedor);
  const valor = normalizarValorPix(dados.valor);
  const txid = sanitizarTxidPix(dados.txid);

  if (!nome) {
    throw new Error("Informe o nome do recebedor.");
  }
  if (!cidade) {
    throw new Error("Informe a cidade do recebedor.");
  }

  const merchantAccount = [
    campoEmv("00", "br.gov.bcb.pix"),
    campoEmv("01", chave),
  ].join("");

  const adicional = campoEmv("05", txid);

  const semCrc = [
    campoEmv("00", "01"),
    campoEmv("01", "11"),
    campoEmv("26", merchantAccount),
    campoEmv("52", "0000"),
    campoEmv("53", "986"),
    campoEmv("54", valor),
    campoEmv("58", "BR"),
    campoEmv("59", nome),
    campoEmv("60", cidade),
    campoEmv("62", adicional),
  ].join("");

  return aplicarCrcBrCode(semCrc);
}
