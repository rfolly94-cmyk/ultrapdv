import { tituloCredenciaisProvedor } from "./credenciais";
import {
  ambientesSuportadosDoProvedor,
  camposCredencialDoProvedor,
  obterProvedorPixGeranet,
  type CampoCredencialPix,
} from "./provedores-geranet";

export const AJUDA_CREDENCIAIS_PIX =
  "Informe as credenciais fornecidas pelo seu banco para a API PIX.";

export const MENSAGEM_PROVEDOR_NAO_MAPEADO =
  "Configuração deste provedor ainda não foi mapeada no UltraPDV.";

export function formularioCredenciaisProvedor(
  codigo: string,
  ambiente?: string
) {
  const meta = obterProvedorPixGeranet(codigo);

  return {
    codigo,
    titulo: tituloCredenciaisProvedor(codigo),
    ajuda: AJUDA_CREDENCIAIS_PIX,
    configuracaoDisponivel: Boolean(meta?.configuracaoDisponivel),
    usaChavePix: Boolean(meta?.usaChavePix),
    chavePixObrigatoria: Boolean(meta?.chavePixObrigatoria),
    ambientes: ambientesSuportadosDoProvedor(codigo),
    campos: camposCredencialDoProvedor(codigo, ambiente),
    mensagemIndisponivel:
      meta?.motivoBloqueio ?? MENSAGEM_PROVEDOR_NAO_MAPEADO,
  };
}

export function rotuloEscolherArquivo(campo: CampoCredencialPix) {
  return campo.chave === "chavePrivadaPemHexadecimal"
    ? "Escolher chave privada"
    : "Escolher certificado";
}

export function rotuloArquivoConfigurado(campo: CampoCredencialPix) {
  return campo.chave === "chavePrivadaPemHexadecimal"
    ? "✓ Chave privada configurada"
    : "✓ Certificado configurado";
}

export function rotuloSegredoConfigurado(campo: CampoCredencialPix) {
  if (
    campo.chave === "token" ||
    campo.chave === "tokenAcesso" ||
    campo.chave === "tokenPagamento" ||
    campo.chave === "tokenHomologacao"
  ) {
    return "✓ Token configurado";
  }
  return `✓ ${campo.label} configurado`;
}

export function acceptArquivo(campo: CampoCredencialPix) {
  return (campo.formatoArquivo ?? campo.formatosArquivo ?? []).join(",");
}
