import "server-only";

import type { EmissaoParaConsulta } from "@/lib/fiscal/geranet/classificar-consulta";
import {
  classificarFalhaConsultaSefaz,
  interpretarRetConsSitNFe,
  montarAtualizacaoConsultaSefaz,
  validarEntradaConsultaProtocolo,
} from "@/lib/fiscal/sefaz/consulta-protocolo";
import { postSoapMtlsSefaz } from "@/lib/fiscal/sefaz/soap-mtls";

export async function consultarProtocoloNfe(params: {
  chaveAcesso: string;
  ambiente: unknown;
  modelo: unknown;
  certificadoHex: string;
  senha: string;
}) {
  const preparado = validarEntradaConsultaProtocolo(params);
  if (!preparado.ok) {
    return {
      ok: false as const,
      falha: preparado.falha,
      mensagem: preparado.mensagem,
      erroTecnico:
        preparado.falha === "certificado"
          ? "sefaz_direta:certificado_ausente"
          : "sefaz_direta:validacao",
    };
  }

  const { certificadoHex, senha, endpoint, soap, soapAction } = preparado.entrada;

  try {
    const resposta = await postSoapMtlsSefaz({
      endpoint,
      soap,
      certificadoHex,
      senha,
      soapAction,
    });

    if (resposta.httpStatus >= 500 || resposta.httpStatus === 0) {
      const falha = classificarFalhaConsultaSefaz(
        new Error(`HTTP ${resposta.httpStatus}`),
        resposta.httpStatus
      );
      return { ok: false as const, ...falha };
    }

    const retorno = interpretarRetConsSitNFe(resposta.body);
    if (!retorno?.cStat) {
      const falha = classificarFalhaConsultaSefaz(new Error("SOAP sem retConsSitNFe"));
      return { ok: false as const, ...falha };
    }

    return { ok: true as const, retorno, endpoint };
  } catch (error) {
    const falha = classificarFalhaConsultaSefaz(error);
    return { ok: false as const, ...falha };
  }
}

export async function consultarSefazParaReconciliacao(params: {
  emissao: EmissaoParaConsulta;
  certificadoHex: string;
  senha: string;
  origem: "manual" | "cron";
  posteriorAutorizada: boolean;
}) {
  const consulta = await consultarProtocoloNfe({
    chaveAcesso: String(params.emissao.chave_acesso ?? ""),
    ambiente: params.emissao.ambiente,
    modelo: params.emissao.modelo,
    certificadoHex: params.certificadoHex,
    senha: params.senha,
  });

  if (!consulta.ok) {
    return consulta;
  }

  const aplicada = montarAtualizacaoConsultaSefaz({
    emissao: params.emissao,
    retorno: consulta.retorno,
    origem: params.origem,
    posteriorAutorizada: params.posteriorAutorizada,
  });

  return {
    ok: true as const,
    fonte: "sefaz_direta" as const,
    situacao: aplicada.situacao,
    atualizacao: aplicada.atualizacao,
    erroTecnico: null as string | null,
  };
}
