export type TipoCampoCredencialPix = "text" | "password" | "file" | "select";
export type AmbienteCampoPix = "1" | "2";

export type CampoCredencialPix = {
  chave: string;
  label: string;
  tipo: TipoCampoCredencialPix;
  formatoArquivo?: string[];
  formatosArquivo?: string[];
  opcoes?: { valor: string; rotulo: string }[];
  segredo: boolean;
  obrigatorio: boolean;
  ajuda?: string;
  ambientes?: AmbienteCampoPix[];
};

export type ProvedorPixGeranet = {
  codigo: string;
  nome: string;
  aliases?: string[];
  ativo: boolean;
  configuracaoDisponivel: boolean;
  usaChavePix: boolean;
  chavePixObrigatoria: boolean;
  incluirChavePixPublica: boolean;
  suportaHomologacao: boolean;
  suportaProducao: boolean;
  autenticacao: string;
  campos: CampoCredencialPix[];
  documentacaoGeranet: string;
  documentacaoInstituicao?: string;
  observacoes?: string;
  motivoBloqueio?: string;
};

const DOC_GERANET = "https://nfe.geranet.net/api-v1-openapi.json";

function campoTexto(
  chave: string,
  label: string,
  extra: Partial<CampoCredencialPix> = {}
): CampoCredencialPix {
  return {
    chave,
    label,
    tipo: "text",
    segredo: extra.segredo ?? true,
    obrigatorio: extra.obrigatorio ?? true,
    ...extra,
  };
}

function campoSenha(
  chave: string,
  label: string,
  extra: Partial<CampoCredencialPix> = {}
): CampoCredencialPix {
  return {
    chave,
    label,
    tipo: "password",
    segredo: true,
    obrigatorio: extra.obrigatorio ?? true,
    ...extra,
  };
}

function campoArquivo(
  chave: string,
  label: string,
  formatos: string[],
  extra: Partial<CampoCredencialPix> = {}
): CampoCredencialPix {
  return {
    chave,
    label,
    tipo: "file",
    formatoArquivo: formatos,
    formatosArquivo: formatos,
    segredo: true,
    obrigatorio: extra.obrigatorio ?? true,
    ...extra,
  };
}

const CAMPOS_OAUTH_PFX: CampoCredencialPix[] = [
  campoTexto("clienteId", "Client ID"),
  campoSenha("clienteSegredo", "Client Secret"),
  campoArquivo(
    "certificadoPfxHexadecimal",
    "Certificado (.p12/.pfx)",
    [".p12", ".pfx"],
    { ajuda: "Arquivo .p12 ou .pfx fornecido pelo PSP." }
  ),
  campoSenha("senhaCertificadoPfx", "Senha do certificado"),
];

const CAMPOS_OAUTH_MTLS: CampoCredencialPix[] = [
  campoTexto("clienteId", "Client ID"),
  campoSenha("clienteSegredo", "Client Secret"),
  campoArquivo(
    "certificadoPemHexadecimal",
    "Certificado",
    [".cer", ".crt", ".pem"],
    { ajuda: "Certificado público em .cer, .crt ou .pem." }
  ),
  campoArquivo(
    "chavePrivadaPemHexadecimal",
    "Chave privada",
    [".key", ".pem"],
    { ajuda: "Chave privada em .key ou .pem." }
  ),
];

function perfilMapeado(
  codigo: string,
  nome: string,
  autenticacao: string,
  campos: CampoCredencialPix[],
  extra: Partial<ProvedorPixGeranet> = {}
): ProvedorPixGeranet {
  const usaChavePix = extra.usaChavePix ?? true;
  return {
    codigo,
    nome,
    ativo: true,
    configuracaoDisponivel: true,
    usaChavePix,
    chavePixObrigatoria: extra.chavePixObrigatoria ?? usaChavePix,
    incluirChavePixPublica: usaChavePix,
    suportaHomologacao: extra.suportaHomologacao ?? true,
    suportaProducao: extra.suportaProducao ?? true,
    autenticacao,
    campos,
    documentacaoGeranet: DOC_GERANET,
    ...extra,
  };
}

function perfilBloqueado(
  codigo: string,
  nome: string,
  motivoBloqueio: string,
  documentacaoInstituicao?: string
): ProvedorPixGeranet {
  return {
    codigo,
    nome,
    ativo: true,
    configuracaoDisponivel: false,
    usaChavePix: true,
    chavePixObrigatoria: false,
    incluirChavePixPublica: true,
    suportaHomologacao: true,
    suportaProducao: true,
    autenticacao: "não comprovada",
    campos: [],
    documentacaoGeranet: DOC_GERANET,
    documentacaoInstituicao,
    motivoBloqueio,
  };
}

export const provedoresPixGeranet: Record<string, ProvedorPixGeranet> = {
  efibank: perfilMapeado(
    "efibank",
    "Efí Bank",
    "OAuth2 + PFX",
    CAMPOS_OAUTH_PFX,
    {
      aliases: ["gerencianet"],
      documentacaoInstituicao:
        "https://dev.efipay.com.br/docs/api-pix/credenciais/",
      observacoes:
        "Gerencianet rebatizada para Efí. Homologação e produção usam pares distintos de Client ID/Secret.",
    }
  ),
  gerencianet: perfilMapeado(
    "gerencianet",
    "Gerencianet",
    "OAuth2 + PFX",
    CAMPOS_OAUTH_PFX,
    {
      aliases: ["efibank"],
      documentacaoInstituicao:
        "https://dev.efipay.com.br/docs/api-pix/credenciais/",
      observacoes:
        "Código histórico na Geranet para o mesmo PSP da Efí. Credenciais idênticas; o código enviado continua gerencianet.",
    }
  ),
  sicredi: perfilMapeado(
    "sicredi",
    "Sicredi",
    "OAuth2 + mTLS",
    CAMPOS_OAUTH_MTLS.map((campo) => {
      if (campo.chave === "certificadoPemHexadecimal") {
        return {
          ...campo,
          label: "Certificado Sicredi (.cer/.pem)",
          formatoArquivo: [".cer", ".pem"],
          formatosArquivo: [".cer", ".pem"],
          ajuda: "Certificado público emitido pelo Sicredi.",
        };
      }
      if (campo.chave === "chavePrivadaPemHexadecimal") {
        return {
          ...campo,
          label: "Chave privada (.key/.pem)",
          formatoArquivo: [".key", ".pem"],
          formatosArquivo: [".key", ".pem"],
        };
      }
      return campo;
    }),
    {
      documentacaoInstituicao:
        "https://developers.sicredi.com.br/public/docs/getting-started-pix",
    }
  ),
  inter: perfilMapeado(
    "inter",
    "Banco Inter",
    "OAuth2 + mTLS",
    CAMPOS_OAUTH_MTLS.map((campo) => {
      if (campo.chave === "certificadoPemHexadecimal") {
        return {
          ...campo,
          label: "Certificado (.crt/.pem)",
          formatoArquivo: [".crt", ".pem"],
          formatosArquivo: [".crt", ".pem"],
        };
      }
      if (campo.chave === "chavePrivadaPemHexadecimal") {
        return {
          ...campo,
          label: "Chave privada (.key)",
          formatoArquivo: [".key"],
          formatosArquivo: [".key"],
        };
      }
      return campo;
    }),
    {
      documentacaoInstituicao:
        "https://developers.inter.co/docs/introducao/como-criar-uma-aplicacao",
    }
  ),
  bancodobrasil: perfilMapeado(
    "bancodobrasil",
    "Banco do Brasil",
    "OAuth2 + mTLS + app key",
    [
      campoTexto("clienteId", "Client ID"),
      campoSenha("clienteSegredo", "Client Secret"),
      campoTexto(
        "chaveAplicacaoDesenvolvedor",
        "Chave da aplicação do desenvolvedor",
        {
          ajuda: "developer_application_key / gw-dev-app-key do portal BB.",
        }
      ),
      campoArquivo(
        "certificadoPemHexadecimal",
        "Certificado (.crt/.pem)",
        [".crt", ".pem"],
        {
          ambientes: ["1"],
          ajuda: "mTLS obrigatório em produção no BB.",
        }
      ),
      campoArquivo(
        "chavePrivadaPemHexadecimal",
        "Chave privada (.key/.pem)",
        [".key", ".pem"],
        { ambientes: ["1"] }
      ),
    ],
    {
      documentacaoInstituicao: "https://developers.bb.com.br/",
      observacoes:
        "Sandbox do BB não exige mTLS. Produção exige certificado cadastrado no portal.",
    }
  ),
  itau: perfilMapeado(
    "itau",
    "Itaú",
    "OAuth2 + mTLS",
    CAMPOS_OAUTH_MTLS.map((campo) => {
      if (campo.chave === "certificadoPemHexadecimal") {
        return {
          ...campo,
          label: "Certificado (.crt)",
          formatoArquivo: [".crt", ".pem"],
          formatosArquivo: [".crt", ".pem"],
        };
      }
      if (campo.chave === "chavePrivadaPemHexadecimal") {
        return {
          ...campo,
          label: "Chave privada (.key)",
          formatoArquivo: [".key"],
          formatosArquivo: [".key"],
        };
      }
      return campo;
    }),
    {
      documentacaoInstituicao:
        "https://devportal.itau.com.br/autenticacao-documentacao",
    }
  ),
  santander: perfilMapeado(
    "santander",
    "Santander",
    "OAuth2 consumer key + mTLS",
    [
      campoTexto("chaveConsumidor", "Chave do consumidor", {
        ajuda: "Consumer Key / Client ID do portal Santander Developers.",
      }),
      campoSenha("segredoConsumidor", "Segredo do consumidor", {
        ajuda: "Consumer Secret do portal Santander Developers.",
      }),
      campoArquivo(
        "certificadoPemHexadecimal",
        "Certificado (.pem/.crt)",
        [".pem", ".crt", ".cer"],
        { ajuda: "Chave pública cadastrada no portal Santander." }
      ),
      campoArquivo(
        "chavePrivadaPemHexadecimal",
        "Chave privada (.key/.pem)",
        [".key", ".pem"]
      ),
    ],
    {
      documentacaoInstituicao: "https://developer.santander.com.br/",
    }
  ),
  sicoob: perfilMapeado(
    "sicoob",
    "Sicoob",
    "OAuth2 + mTLS",
    [
      campoTexto("clienteId", "Client ID"),
      campoSenha("clienteSegredo", "Client Secret", {
        obrigatorio: false,
        ajuda:
          "Presente no manual oficial antigo. O portal atual pode emitir só o Client ID.",
      }),
      campoTexto("escopo", "Escopo", {
        segredo: false,
        obrigatorio: false,
        ajuda: "Ex.: cob.read cob.write pix.read",
      }),
      campoSenha("tokenHomologacao", "Token de homologação", {
        obrigatorio: false,
        ambientes: ["2"],
        ajuda: "Campo Geranet tokenHomologacao, quando o Sicoob o fornecer.",
      }),
      campoArquivo(
        "certificadoPemHexadecimal",
        "Certificado (.cer/.pem)",
        [".cer", ".crt", ".pem"],
        { ajuda: "Certificado ICP-Brasil A1 (parte pública)." }
      ),
      campoArquivo(
        "chavePrivadaPemHexadecimal",
        "Chave privada (.key/.pem)",
        [".key", ".pem"]
      ),
    ],
    {
      documentacaoInstituicao: "https://developers.sicoob.com.br/",
    }
  ),
  bradesco: perfilMapeado(
    "bradesco",
    "Bradesco",
    "OAuth2 + mTLS",
    CAMPOS_OAUTH_MTLS,
    {
      documentacaoInstituicao: "https://developers.bradesco.com.br/",
      observacoes:
        "Sandbox aceita certificado autoassinado. Produção exige A1 de AC reconhecida.",
    }
  ),
  banrisul: perfilMapeado(
    "banrisul",
    "Banrisul",
    "OAuth2 + mTLS",
    [
      ...CAMPOS_OAUTH_MTLS,
      campoTexto("escopo", "Escopo", {
        segredo: false,
        obrigatorio: false,
        ajuda: "Escopos OAuth2 do catálogo PIX Banrisul, separados por espaço.",
      }),
    ],
    {
      documentacaoInstituicao:
        "https://developers.banrisul.com.br/pages/docs/clientes-banrisul/api-pix-v2.8.1.html",
      observacoes:
        "Endpoints oficiais usam mtls-api / mtls-api-h.",
    }
  ),
  c6bank: perfilMapeado(
    "c6bank",
    "C6 Bank",
    "OAuth2 + mTLS",
    CAMPOS_OAUTH_MTLS.map((campo) => {
      if (campo.chave === "certificadoPemHexadecimal") {
        return {
          ...campo,
          label: "Certificado (.crt)",
          formatoArquivo: [".crt", ".pem"],
          formatosArquivo: [".crt", ".pem"],
        };
      }
      if (campo.chave === "chavePrivadaPemHexadecimal") {
        return {
          ...campo,
          label: "Chave privada (.key)",
          formatoArquivo: [".key"],
          formatosArquivo: [".key"],
        };
      }
      return campo;
    }),
    {
      suportaHomologacao: false,
      documentacaoInstituicao: "https://www.c6bank.com.br/apis-integracao/",
      observacoes:
        "Credenciais saem de Meu Perfil → Integrações via API no Web Banking PJ. Sandbox público não está documentado.",
    }
  ),
  cielo: perfilMapeado(
    "cielo",
    "Cielo",
    "OAuth2 + mTLS em produção",
    [
      campoTexto("clienteId", "Client ID"),
      campoSenha("clienteSegredo", "Client Secret"),
      campoArquivo(
        "certificadoPemHexadecimal",
        "Certificado (.crt/.pem)",
        [".crt", ".pem"],
        {
          ambientes: ["1"],
          ajuda: "mTLS obrigatório só em produção na API Pix Cielo.",
        }
      ),
      campoArquivo(
        "chavePrivadaPemHexadecimal",
        "Chave privada (.key)",
        [".key", ".pem"],
        { ambientes: ["1"] }
      ),
    ],
    {
      documentacaoInstituicao: "https://developercielo.github.io/manual/apipix",
    }
  ),
  mercadopago: perfilMapeado(
    "mercadopago",
    "Mercado Pago",
    "Access Token",
    [
      campoSenha("tokenAcesso", "Access Token", {
        ajuda: "Access Token de produção ou teste em Suas integrações.",
      }),
    ],
    {
      usaChavePix: false,
      chavePixObrigatoria: false,
      documentacaoInstituicao:
        "https://www.mercadopago.com.br/developers/pt/docs/credentials",
    }
  ),
  pagseguro: perfilMapeado(
    "pagseguro",
    "PagSeguro",
    "Token Bearer",
    [
      campoSenha("tokenPagamento", "Token de pagamento", {
        ajuda: "Token de integração PagBank / PagSeguro (Authorization Bearer).",
      }),
    ],
    {
      usaChavePix: false,
      chavePixObrigatoria: false,
      documentacaoInstituicao: "https://developer.pagbank.com.br/v1/reference/autenticacao",
    }
  ),
  shipay: perfilMapeado(
    "shipay",
    "Shipay",
    "Access Key + Secret Key + Client ID",
    [
      campoTexto("clienteId", "Client ID", {
        ajuda: "Client ID do caixa no painel Shipay.",
      }),
      campoSenha("clienteSegredo", "Secret Key"),
      campoSenha("chaveUsuario", "Access Key"),
    ],
    {
      usaChavePix: false,
      chavePixObrigatoria: false,
      documentacaoInstituicao: "https://docs.shipay.com.br/setup.html",
    }
  ),
  pixpdv: perfilMapeado(
    "pixpdv",
    "PIX PDV",
    "Token + Secret Key",
    [
      campoSenha("token", "Token", {
        ajuda: "Token PIXPDV (tk-...). O CNPJ da empresa já vai no payload.",
      }),
      campoSenha("clienteSegredo", "Secret Key", {
        ajuda: "Secret Key (sk-...) usada no HMAC-SHA256 oficial.",
      }),
    ],
    {
      usaChavePix: false,
      chavePixObrigatoria: false,
      documentacaoInstituicao: "https://pixpdv.com.br/api/index.html",
    }
  ),
  gate2all: perfilMapeado(
    "gate2all",
    "Gate2All",
    "Usuário + chave de API",
    [
      campoTexto("autenticacaoApi", "Autenticação API", {
        ajuda: "Header authenticationApi da documentação Gate2All.",
      }),
      campoSenha("chaveAutenticacao", "Chave de autenticação", {
        ajuda: "Header authenticationKey da documentação Gate2All.",
      }),
    ],
    {
      usaChavePix: true,
      chavePixObrigatoria: false,
      documentacaoInstituicao: "https://docs.gate2all.com.br/",
    }
  ),
  ailos: perfilBloqueado(
    "ailos",
    "Ailos",
    "A documentação pública do portal Ailos descreve client_id/access_token de Open Finance. O PDF oficial de PIX Cobrança não está acessível publicamente, então as chaves Geranet não puderam ser comprovadas.",
    "https://developer.ailos.coop.br/api-portal/content/api-guide"
  ),
  matera: perfilBloqueado(
    "matera",
    "Matera",
    "A documentação oficial (doc-api.matera.com) autentica servidor com Secret Key + Data Signature. A Geranet não documenta campo de assinatura; mapear só um segredo seria inventar o contrato.",
    "https://doc-api.matera.com/"
  ),
  appless: perfilBloqueado(
    "appless",
    "Appless",
    "O site menciona sessões JWT, mas o portal doc.appless.com.br não expõe publicamente quais campos enviar. Sem lista oficial de credenciais.",
    "https://doc.appless.com.br/"
  ),
  qqpag: perfilBloqueado(
    "qqpag",
    "QQPag",
    "A documentação oficial docs.qqpag.com.br não respondeu de forma utilizável. Sem fonte primária, o UltraPDV não inventa Client ID/Secret.",
    "https://docs.qqpag.com.br/pix-cobranca"
  ),
};

export const PROVEDORES_PIX_GERANET = Object.values(provedoresPixGeranet).sort(
  (a, b) => a.nome.localeCompare(b.nome, "pt-BR")
);

export const PROVEDORES_PIX_SELECIONAVEIS = PROVEDORES_PIX_GERANET.filter(
  (item) => item.configuracaoDisponivel
);

export type CodigoProvedorPix = keyof typeof provedoresPixGeranet;

export function ehProvedorPixGeranet(
  valor: unknown
): valor is CodigoProvedorPix {
  return typeof valor === "string" && valor in provedoresPixGeranet;
}

export function obterProvedorPixGeranet(codigo: string) {
  return ehProvedorPixGeranet(codigo)
    ? provedoresPixGeranet[codigo]
    : null;
}

export function nomeProvedorPix(codigo: string) {
  return obterProvedorPixGeranet(codigo)?.nome ?? codigo;
}

export function campoAplicaAoAmbiente(
  campo: CampoCredencialPix,
  ambiente?: string
) {
  if (!campo.ambientes?.length || !ambiente) {
    return true;
  }
  return campo.ambientes.includes(ambiente as AmbienteCampoPix);
}

export function camposCredencialDoProvedor(
  codigo: string,
  ambiente?: string
) {
  const campos = obterProvedorPixGeranet(codigo)?.campos ?? [];
  if (!ambiente) {
    return campos;
  }
  return campos.filter((campo) => campoAplicaAoAmbiente(campo, ambiente));
}

export function ambientesSuportadosDoProvedor(codigo: string): AmbienteCampoPix[] {
  const meta = obterProvedorPixGeranet(codigo);
  const saida: AmbienteCampoPix[] = [];
  if (meta?.suportaProducao !== false) {
    saida.push("1");
  }
  if (meta?.suportaHomologacao !== false) {
    saida.push("2");
  }
  return saida.length > 0 ? saida : ["2"];
}

export function ambientePadraoDoProvedor(codigo: string): AmbienteCampoPix {
  const suportados = ambientesSuportadosDoProvedor(codigo);
  return suportados.includes("2") ? "2" : (suportados[0] ?? "2");
}

export function rotuloAmbienteVault(ambiente: string) {
  return ambiente === "1" ? "producao" : "homologacao";
}

export function nomeSegredoBancario(params: {
  empresaId: string;
  provedor: string;
  ambiente: string;
  campo: string;
}) {
  return [
    "pix",
    params.empresaId,
    params.provedor,
    rotuloAmbienteVault(params.ambiente),
    params.campo,
  ].join("/");
}

export const CAMPOS_GERANET_CREDENCIAIS = [
  "clienteId",
  "clienteSegredo",
  "chaveUsuario",
  "chavePix",
  "escopo",
  "token",
  "tokenAcesso",
  "certificadoPemHexadecimal",
  "chavePrivadaPemHexadecimal",
  "certificadoPfxHexadecimal",
  "senhaCertificadoPfx",
  "chaveAplicacaoDesenvolvedor",
  "chaveConsumidor",
  "segredoConsumidor",
  "tokenPagamento",
  "tokenHomologacao",
  "autenticacaoApi",
  "chaveAutenticacao",
] as const;

const LEGADO_EFI: Record<string, string> = {
  cliente_id: "clienteId",
  cliente_segredo: "clienteSegredo",
  certificado_pfx: "certificadoPfxHexadecimal",
  senha_certificado_pfx: "senhaCertificadoPfx",
};

export function mapearSegredosLegadoEfi(
  bruto: Record<string, unknown>
): Record<string, string> {
  const saida: Record<string, string> = {};

  for (const [legado, campo] of Object.entries(LEGADO_EFI)) {
    const valor = String(bruto[legado] ?? "").trim();
    if (valor) {
      saida[campo] = valor;
    }
  }

  return saida;
}

export function prefixoSegredosProvedor(params: {
  empresaId: string;
  provedor: string;
  ambiente: string;
}) {
  return `pix/${params.empresaId}/${params.provedor}/${rotuloAmbienteVault(params.ambiente)}/`;
}

export function filtrarSegredosPorNamespace(
  secrets: Record<string, unknown>,
  prefixo: string
) {
  const saida: Record<string, string> = {};

  for (const [nome, valor] of Object.entries(secrets)) {
    if (!nome.startsWith(prefixo)) {
      continue;
    }

    const campo = nome.slice(prefixo.length);
    if (!campo || campo.includes("/")) {
      continue;
    }

    const limpo = String(valor ?? "").trim();
    if (limpo) {
      saida[campo] = limpo;
    }
  }

  return saida;
}
