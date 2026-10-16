import { createHash, createPublicKey, verify } from "node:crypto";

import { fingerprintChavePublicaEd25519 } from "@/lib/pdv/tef/fingerprint-chave";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export const PREFIXO_PROVA_BIBLIOTECA_V2 = "ultrapdv-tef-biblioteca-v2";

const HOST_SANDBOX = /tpgweb\.io|pos-transac-sb|sandbox|homolog/i;
const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CamposProvaBibliotecaV2 = {
  pontoCaptura: string;
  servidor: string;
  ambiente: "producao" | "homologacao";
  retornoSetEnvironment: number;
  codigoAmbiente: number;
  diretorio: string;
};

export type RegistroValidacaoBiblioteca = {
  assinaturaSha256: string;
  terminalId: string;
  empresaId: string;
};

export type DecisaoValidacaoBiblioteca = {
  efeito: "recusar" | "registrar" | "ja_registrada";
  motivo: string;
  instalacaoTecnica: "comprovada" | "pendente";
  ambienteBiblioteca: "configurado" | "divergente" | "ausente";
  adquirente: "desconhecida";
  cobrancaLiberada: false;
  nfceLiberada: false;
  assinaturaSha256: string;
  campos: CamposProvaBibliotecaV2 | null;
};

function campo(valor: unknown) {
  return String(valor ?? "").trim().replace(/[\r\n]/g, "");
}

export function mensagemProvaBibliotecaV2(campos: {
  pontoCaptura: unknown;
  servidor: unknown;
  ambiente: unknown;
  retornoSetEnvironment: unknown;
  codigoAmbiente: unknown;
  diretorio: unknown;
}) {
  return [
    PREFIXO_PROVA_BIBLIOTECA_V2,
    campo(campos.pontoCaptura),
    campo(campos.servidor),
    campo(campos.ambiente),
    String(Math.round(Number(campos.retornoSetEnvironment) || 0)),
    String(Math.round(Number(campos.codigoAmbiente) || 0)),
    campo(campos.diretorio),
  ].join("\n");
}

export function hashAssinaturaBiblioteca(assinatura: string) {
  return createHash("sha256").update(String(assinatura ?? "").trim()).digest("hex");
}

export function camposProvaBibliotecaV2(valor: unknown): CamposProvaBibliotecaV2 | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }
  const bruto = valor as Record<string, unknown>;
  if ("empresaId" in bruto || "dispositivoId" in bruto || "terminalId" in bruto) {
    return null;
  }
  const ambiente = bruto.ambiente === "producao" || bruto.ambiente === "homologacao" ? bruto.ambiente : "";
  const retorno = Number(bruto.retornoSetEnvironment);
  const codigo = Number(bruto.codigoAmbiente);
  const servidor = validarServidorPayGo(bruto.servidor);
  const ponto = campo(bruto.pontoCaptura);
  const diretorio = campo(bruto.diretorio);
  if (!ambiente || !servidor.ok || !/^[A-Za-z0-9._-]{1,40}$/.test(ponto) || !diretorio) {
    return null;
  }
  if (!Number.isInteger(retorno) || !Number.isInteger(codigo)) {
    return null;
  }
  return {
    pontoCaptura: ponto,
    servidor: servidor.servidor,
    ambiente,
    retornoSetEnvironment: retorno,
    codigoAmbiente: codigo,
    diretorio,
  };
}

export function verificarProvaBibliotecaV2(
  chavePublicaPem: string,
  campos: CamposProvaBibliotecaV2,
  assinatura: string
) {
  const assinaturaLimpa = String(assinatura ?? "").trim();
  if (!fingerprintChavePublicaEd25519(chavePublicaPem) || assinaturaLimpa.length < 80 || assinaturaLimpa.length > 200) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(mensagemProvaBibliotecaV2(campos)),
      createPublicKey(chavePublicaPem),
      Buffer.from(assinaturaLimpa, "base64")
    );
  } catch {
    return false;
  }
}

function pendente(
  motivo: string,
  ambienteBiblioteca: DecisaoValidacaoBiblioteca["ambienteBiblioteca"] = "ausente"
): DecisaoValidacaoBiblioteca {
  return {
    efeito: "recusar",
    motivo,
    instalacaoTecnica: "pendente",
    ambienteBiblioteca,
    adquirente: "desconhecida",
    cobrancaLiberada: false,
    nfceLiberada: false,
    assinaturaSha256: "",
    campos: null,
  };
}

export function decidirValidacaoBiblioteca(input: {
  versao: number | null;
  campos: unknown;
  assinatura: string;
  chavePublicaPem: string;
  empresaSessaoId: string;
  dispositivoInformado: string;
  terminal: { id: string; empresaId: string; dispositivoId: string } | null;
  dispositivoEmOutraEmpresa: boolean;
  pontoOficial: string;
  servidorOficial: string;
  ambienteOficial: "producao" | "homologacao" | "";
  registroExistente: RegistroValidacaoBiblioteca | null;
}): DecisaoValidacaoBiblioteca {
  if (input.dispositivoEmOutraEmpresa) {
    return pendente("Este computador está vinculado a outra empresa.");
  }
  if (!input.terminal || input.terminal.empresaId !== input.empresaSessaoId) {
    return pendente("O terminal deste computador não está autorizado nesta empresa.");
  }
  if (input.terminal.dispositivoId !== input.dispositivoInformado) {
    return pendente(
      "A prova foi apresentada por outro computador. A assinatura v2 não identifica o dispositivo."
    );
  }
  if (input.versao !== 2) {
    return pendente("A prova armazenada não é a versão 2 da biblioteca.");
  }
  const assinatura = String(input.assinatura ?? "").trim();
  if (!assinatura) {
    return pendente("A prova assinada da biblioteca não foi apresentada.");
  }
  const campos = camposProvaBibliotecaV2(input.campos);
  if (!campos) {
    return pendente("A prova armazenada não tem o formato da biblioteca v2.");
  }
  if (!verificarProvaBibliotecaV2(input.chavePublicaPem, campos, assinatura)) {
    return pendente("A assinatura não confere com a chave pública Ed25519 do terminal autorizado.");
  }
  if (!input.pontoOficial || campos.pontoCaptura !== input.pontoOficial) {
    return pendente("O ponto da prova diverge do ponto oficial da empresa.", "divergente");
  }
  const servidorOficial = validarServidorPayGo(input.servidorOficial);
  if (!servidorOficial.ok) {
    return pendente("A empresa não possui servidor PayGoWeb oficial para conferir a prova.", "divergente");
  }
  if (HOST_SANDBOX.test(campos.servidor)) {
    return pendente("O servidor da prova é de homologação.", "divergente");
  }
  if (campos.servidor !== servidorOficial.servidor) {
    return pendente("O servidor da prova diverge do servidor oficial da empresa.", "divergente");
  }
  if (!input.ambienteOficial || campos.ambiente !== input.ambienteOficial) {
    return pendente("O ambiente da prova diverge do ambiente autorizado da empresa.", "divergente");
  }
  if (campos.ambiente === "producao" && campos.diretorio !== "producao") {
    return pendente("O diretório da prova não é a pasta de produção.", "divergente");
  }
  if (campos.retornoSetEnvironment !== 0 || campos.codigoAmbiente !== 0) {
    return pendente(
      "A prova não registra PW_iSetEnvironment com retorno 0 no código de ambiente de produção.",
      "divergente"
    );
  }
  const assinaturaSha256 = hashAssinaturaBiblioteca(assinatura);
  const registro = input.registroExistente;
  if (registro) {
    if (registro.empresaId !== input.empresaSessaoId || registro.terminalId !== input.terminal.id) {
      return pendente("O registro técnico existente pertence a outro terminal.");
    }
    if (registro.assinaturaSha256 === assinaturaSha256) {
      return {
        efeito: "ja_registrada",
        motivo: "Esta prova já foi registrada para este terminal. Nenhuma instalação foi repetida.",
        instalacaoTecnica: "comprovada",
        ambienteBiblioteca: "configurado",
        adquirente: "desconhecida",
        cobrancaLiberada: false,
        nfceLiberada: false,
        assinaturaSha256,
        campos,
      };
    }
    return pendente(
      "Já existe uma validação técnica para este terminal. Esta prova não substitui a anterior."
    );
  }
  if (!ID.test(input.empresaSessaoId) || !ID.test(input.terminal.id) || !ID.test(input.dispositivoInformado)) {
    return pendente("Os identificadores do terminal autorizado estão incompletos.");
  }
  return {
    efeito: "registrar",
    motivo:
      "A assinatura v2 confere com a chave do terminal. Ela não inclui empresa nem dispositivo e não habilita a adquirente.",
    instalacaoTecnica: "comprovada",
    ambienteBiblioteca: "configurado",
    adquirente: "desconhecida",
    cobrancaLiberada: false,
    nfceLiberada: false,
    assinaturaSha256,
    campos,
  };
}
