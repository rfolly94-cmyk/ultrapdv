import {
  MENSAGEM_IDENTIDADE_FISCAL_AUSENTE,
} from "@/lib/fiscal/operacoes/catalogo";
import { sanitizarConsultaGeranet } from "@/lib/fiscal/geranet/classificar-consulta";
import { aplicarContingenciaContratoGeranet } from "@/lib/fiscal/geranet/contingencia-contrato";
import { resolverOffsetFiscal } from "@/lib/fiscal/geranet/data-hora";
import { IBPT_AUTOMATICO_GERANET } from "@/lib/fiscal/geranet/montar-item";
import { assertIcmsContratoGeranet } from "@/lib/fiscal/geranet/resolver-icms-geranet";

export type AmbienteNfeGeranet =
  | "1"
  | "2";

export type IndicadorIeDestinatarioNfe =
  | "1"
  | "2"
  | "9";

export type ConsumidorFinalNfe =
  | "0"
  | "1";

export type IndicadorPagamentoNfe =
  | "0"
  | "1";

export type TipoOperacaoNfe =
  | "0"
  | "1";

export type FinalidadeNfe =
  | "1"
  | "2"
  | "3"
  | "4";

export type ModalidadeFreteNfe =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "9";


export type TransportadorNfeGeranet = {
  cnpj?: string | null;
  cpf?: string | null;
  razaoSocial?: string | null;
  inscricaoEstadual?: string | null;
  endereco?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

export type VolumeNfeGeranet = {
  quantidade?:
    | string
    | number
    | null;
  descricao?: string | null;
  marca?: string | null;
  pesoLiquido?:
    | string
    | number
    | null;
  pesoBruto?:
    | string
    | number
    | null;
};

export type TransporteNfeGeranet = {
  transportador?:
    TransportadorNfeGeranet | null;
  volumes?:
    VolumeNfeGeranet[];
};

export type AutorizadoXmlNfeGeranet = {
  cnpj?: string | null;
  cpf?: string | null;
};

export type ResponsavelTecnicoNfeGeranet = {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
  idCSRT?: string | null;
  CSRT?: string | null;
};

export const NOME_DESTINATARIO_HOMOLOGACAO =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export type EmitenteNfeGeranet = {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  telefone?: string | null;
  email?: string | null;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
  codigoRegimeTributario:
    string | number;
  tipoAtividade?: string | null;
  informacaoComplementar?:
    string | null;
  logomarca?: string | null;
};

export type EnderecoEntregaNfeGeranet = {
  nome?: string | null;
  telefone?: string | null;
  cnpj?: string | null;
  cpf?: string | null;
  inscricaoEstadual?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigoMunicipio?: string | null;
  municipio?: string | null;
  codigoPais?: string | null;
  nomePais?: string | null;
  uf?: string | null;
  cep?: string | null;
  email?: string | null;
};

export type DestinatarioNfeGeranet = {
  cnpj?: string | null;
  cpf?: string | null;
  inscricaoEstadual?:
    string | null;
  razaoSocial?:
    string | null;
  nomeFantasia?:
    string | null;
  consumidorFinal:
    ConsumidorFinalNfe;
  indicadorIEdestinatario:
    IndicadorIeDestinatarioNfe;
  telefone?: string | null;
  email?: string | null;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  codigoPais?: string | null;
  nomePais?: string | null;
  uf: string;
  cep: string;
  entrega?: EnderecoEntregaNfeGeranet | null;
};

export type ConfigNfeGeranet = {
  serie:
    string | number;
  numeroNota:
    string | number;
  codigoNumerico:
    string;
  dataSaida:
    string;
  dataEmissao:
    string;
  fusoHorario:
    string;
  indicadorPresenca:
    string;
  indicativoIntermediador:
    string;
  naturezaOperacao:
    string;
  informacaoComplementar?:
    string | null;

  tipo:
    TipoOperacaoNfe;
  frete?: ModalidadeFreteNfe;
  finalidade:
    FinalidadeNfe;

  informacaoAdicionalFisco?:
    string | null;
  notaFiscalReferencia?:
    string | null;
  numeroVenda?:
    string | number | null;
};

export type DetalhamentoPagamentoNfeGeranet = {
  tipo:
    string;
  valor:
    number;
  indicadorPagamento:
    IndicadorPagamentoNfe;
};

export type PagamentoNfeGeranet = {
  troco:
    number;
  detalhamento:
    DetalhamentoPagamentoNfeGeranet[];
};

export type MontarPayloadNfeGeranetParams = {
  ambiente:
    AmbienteNfeGeranet;
  ufEmitente:
    string;
  certificadoDigital:
    string;
  senhaCertificadoDigital:
    string;
  emitente:
    EmitenteNfeGeranet;
  destinatario:
    DestinatarioNfeGeranet;
  config:
    ConfigNfeGeranet;
  pagamento:
    PagamentoNfeGeranet;
  transporte?:
    TransporteNfeGeranet | null;
  autorizadosXml?:
    AutorizadoXmlNfeGeranet[] | null;
  responsavelTecnico?:
    ResponsavelTecnicoNfeGeranet | null;
  itens:
    unknown[];
};

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function exigirIdentidadeFiscalNfe(config: ConfigNfeGeranet) {
  const tipo = texto(config.tipo);
  const finalidade = texto(config.finalidade);
  const naturezaOperacao = texto(config.naturezaOperacao);

  if (
    (tipo !== "0" && tipo !== "1") ||
    (finalidade !== "1" &&
      finalidade !== "2" &&
      finalidade !== "3" &&
      finalidade !== "4") ||
    !naturezaOperacao
  ) {
    throw new Error(MENSAGEM_IDENTIDADE_FISCAL_AUSENTE);
  }
}

function somenteDigitos(
  valor: unknown
) {
  return texto(valor).replace(
    /\D/g,
    ""
  );
}


function mapearEntregaPayloadGeranet(
  entrega:
    | EnderecoEntregaNfeGeranet
    | null
    | undefined
): EnderecoEntregaNfeGeranet | null {
  if (!entrega) {
    return null;
  }

  const geranet: EnderecoEntregaNfeGeranet = {};
  const nome = texto(entrega.nome);
  if (nome) {
    geranet.nome = nome;
  }
  const telefone = somenteDigitos(entrega.telefone);
  if (telefone) {
    geranet.telefone = telefone;
  }
  const cnpj = somenteDigitos(entrega.cnpj);
  const cpf = somenteDigitos(entrega.cpf);
  if (cnpj.length === 14) {
    geranet.cnpj = cnpj;
  } else if (cpf.length === 11) {
    geranet.cpf = cpf;
  }
  const inscricaoEstadual = texto(entrega.inscricaoEstadual);
  if (inscricaoEstadual) {
    geranet.inscricaoEstadual = inscricaoEstadual;
  }
  const logradouro = texto(entrega.logradouro);
  if (logradouro) {
    geranet.logradouro = logradouro;
  }
  const numero = texto(entrega.numero);
  if (numero) {
    geranet.numero = numero;
  }
  const complemento = texto(entrega.complemento);
  if (complemento) {
    geranet.complemento = complemento;
  }
  const bairro = texto(entrega.bairro);
  if (bairro) {
    geranet.bairro = bairro;
  }
  const codigoMunicipio = somenteDigitos(entrega.codigoMunicipio);
  if (codigoMunicipio) {
    geranet.codigoMunicipio = codigoMunicipio;
  }
  const municipio = texto(entrega.municipio);
  if (municipio) {
    geranet.municipio = municipio;
  }
  const codigoPais =
    somenteDigitos(entrega.codigoPais) || "1058";
  geranet.codigoPais = codigoPais;
  const nomePais = texto(entrega.nomePais) || "Brasil";
  geranet.nomePais = nomePais;
  const uf = texto(entrega.uf).toUpperCase();
  if (uf) {
    geranet.uf = uf;
  }
  const cep = somenteDigitos(entrega.cep);
  if (cep) {
    geranet.cep = cep;
  }
  const email = texto(entrega.email);
  if (email) {
    geranet.email = email;
  }

  const temEndereco =
    Boolean(geranet.logradouro) ||
    Boolean(geranet.municipio) ||
    Boolean(geranet.uf) ||
    Boolean(geranet.cep) ||
    Boolean(geranet.nome) ||
    Boolean(geranet.cpf) ||
    Boolean(geranet.cnpj);
  return temEndereco ? geranet : null;
}

function mapearTransportadorPayloadGeranet(
  transportador:
    | TransportadorNfeGeranet
    | null
    | undefined
): TransportadorNfeGeranet | null {
  if (!transportador) {
    return null;
  }

  const geranet: TransportadorNfeGeranet = {};
  const cnpj = somenteDigitos(
    transportador.cnpj
  );
  const cpf = somenteDigitos(
    transportador.cpf
  );
  if (cnpj.length === 14) {
    geranet.cnpj = cnpj;
  } else if (cpf.length === 11) {
    geranet.cpf = cpf;
  }

  const razaoSocial = texto(
    transportador.razaoSocial
  );
  if (razaoSocial) {
    geranet.razaoSocial = razaoSocial;
  }
  const inscricaoEstadual = texto(
    transportador.inscricaoEstadual
  );
  if (inscricaoEstadual) {
    geranet.inscricaoEstadual =
      inscricaoEstadual;
  }
  const endereco = texto(
    transportador.endereco
  );
  if (endereco) {
    geranet.endereco = endereco;
  }
  const municipio = texto(
    transportador.municipio
  );
  if (municipio) {
    geranet.municipio = municipio;
  }
  const uf = texto(
    transportador.uf
  ).toUpperCase();
  if (uf) {
    geranet.uf = uf;
  }

  return Object.keys(geranet).length > 0
    ? geranet
    : null;
}

function mapearResponsavelTecnicoPayloadGeranet(
  responsavel:
    | ResponsavelTecnicoNfeGeranet
    | null
    | undefined
): ResponsavelTecnicoNfeGeranet | null {
  if (!responsavel) {
    return null;
  }
  const cnpj = somenteDigitos(responsavel.cnpj);
  const contato = texto(responsavel.contato);
  const email = texto(responsavel.email);
  const fone = somenteDigitos(responsavel.fone);
  const idCSRT = somenteDigitos(responsavel.idCSRT);
  const CSRT = texto(responsavel.CSRT);
  if (
    cnpj.length !== 14 ||
    contato.length < 2 ||
    !email.includes("@") ||
    fone.length < 6 ||
    fone.length > 14
  ) {
    return null;
  }
  const geranet: ResponsavelTecnicoNfeGeranet = {
    cnpj,
    contato,
    email,
    fone,
  };
  if (idCSRT.length === 2 && CSRT) {
    geranet.idCSRT = idCSRT;
    geranet.CSRT = CSRT;
  }
  return geranet;
}

function mapearAutorizadosXmlPayloadGeranet(
  lista:
    | AutorizadoXmlNfeGeranet[]
    | null
    | undefined
): AutorizadoXmlNfeGeranet[] {
  if (!Array.isArray(lista)) {
    return [];
  }
  const geranet: AutorizadoXmlNfeGeranet[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const cnpj = somenteDigitos(item.cnpj);
    const cpf = somenteDigitos(item.cpf);
    if (cnpj.length === 14) {
      geranet.push({ cnpj });
    } else if (cpf.length === 11) {
      geranet.push({ cpf });
    }
  }
  return geranet;
}

function decimal4(
  valor: unknown
) {
  const numero =
    Number(
      valor ??
      0
    );

  if (
    !Number.isFinite(
      numero
    ) ||
    numero < 0
  ) {
    return "0.0000";
  }

  return numero.toFixed(4);
}

function validarPayloadBase({
  ambiente,
  emitente,
  destinatario,
  pagamento,
  itens,
}: Pick<
  MontarPayloadNfeGeranetParams,
  | "ambiente"
  | "emitente"
  | "destinatario"
  | "pagamento"
  | "itens"
>) {
  if (
    ambiente !== "1" &&
    ambiente !== "2"
  ) {
    throw new Error(
      "Ambiente da NF-e deve ser 1 ou 2."
    );
  }

  if (
    somenteDigitos(
      emitente.cnpj
    ).length !== 14
  ) {
    throw new Error(
      "CNPJ do emitente da NF-e é inválido."
    );
  }

  if (
    !texto(
      emitente.inscricaoEstadual
    )
  ) {
    throw new Error(
      "Inscrição Estadual do emitente da NF-e é obrigatória."
    );
  }

  const cpf =
    somenteDigitos(
      destinatario.cpf
    );

  const cnpj =
    somenteDigitos(
      destinatario.cnpj
    );

  if (cpf && cnpj) {
    throw new Error(
      "Informe CPF ou CNPJ do destinatário da NF-e, não os dois."
    );
  }

  if (
    cpf &&
    cpf.length !== 11
  ) {
    throw new Error(
      "CPF do destinatário da NF-e é inválido."
    );
  }

  if (
    cnpj &&
    cnpj.length !== 14
  ) {
    throw new Error(
      "CNPJ do destinatário da NF-e é inválido."
    );
  }

  if (
    ambiente === "1" &&
    !texto(
      destinatario.razaoSocial
    )
  ) {
    throw new Error(
      "Nome/Razão Social do destinatário é obrigatório em produção."
    );
  }

  if (
    !Array.isArray(itens) ||
    itens.length === 0
  ) {
    throw new Error(
      "A NF-e deve possuir ao menos um item."
    );
  }

  if (
    !Array.isArray(
      pagamento.detalhamento
    ) ||
    pagamento
      .detalhamento.length === 0
  ) {
    throw new Error(
      "A NF-e deve possuir ao menos um detalhamento de pagamento."
    );
  }

  for (
    const detalhe of
    pagamento.detalhamento
  ) {
    if (
      !Number.isFinite(
        detalhe.valor
      ) ||
      detalhe.valor < 0
    ) {
      throw new Error(
        "Valor de pagamento da NF-e é inválido."
      );
    }
  }

  if (
    !Number.isFinite(
      pagamento.troco
    ) ||
    pagamento.troco < 0
  ) {
    throw new Error(
      "Troco da NF-e é inválido."
    );
  }
}

/**
 * Monta somente o contrato da NF-e modelo 55
 * esperado pelo provider Geranet.
 *
 * Responsabilidades que NÃO pertencem aqui:
 * - autenticação;
 * - banco;
 * - reserva de numeração;
 * - cálculo tributário do item;
 * - transmissão HTTP;
 * - persistência/reconciliação.
 */
export function montarPayloadNfeGeranet(
  params:
    MontarPayloadNfeGeranetParams
) {
  validarPayloadBase(params);
  exigirIdentidadeFiscalNfe(params.config);

  const {
    ambiente,
    ufEmitente,
    certificadoDigital,
    senhaCertificadoDigital,
    emitente,
    destinatario,
    config,
    pagamento,
    transporte,
    autorizadosXml,
    responsavelTecnico,
    itens,
  } = params;

  const entregaGeranet =
    mapearEntregaPayloadGeranet(
      destinatario.entrega
    );

  const cpf =
    somenteDigitos(
      destinatario.cpf
    );

  const cnpjDestinatario =
    somenteDigitos(
      destinatario.cnpj
    );

  const razaoSocialDestinatario =
    ambiente === "2"
      ? NOME_DESTINATARIO_HOMOLOGACAO
      : texto(
          destinatario
            .razaoSocial
        );

  const transportadorGeranet =
    mapearTransportadorPayloadGeranet(
      transporte
        ?.transportador
    );

  const volumesGeranet =
    Array.isArray(
      transporte?.volumes
    )
      ? transporte!.volumes!
          .map(
            (volume) => {
              const geranet: VolumeNfeGeranet = {
                quantidade:
                  texto(
                    volume
                      .quantidade ??
                    0
                  ),
                pesoLiquido:
                  decimal4(
                    volume
                      .pesoLiquido
                  ),
                pesoBruto:
                  decimal4(
                    volume
                      .pesoBruto
                  ),
              };
              const descricao =
                texto(
                  volume
                    .descricao
                );
              if (descricao) {
                geranet.descricao =
                  descricao;
              }
              const marca =
                texto(
                  volume.marca
                );
              if (marca) {
                geranet.marca =
                  marca;
              }
              return geranet;
            }
          )
      : [];

  const autorizadosXmlGeranet =
    mapearAutorizadosXmlPayloadGeranet(
      autorizadosXml
    );

  const responsavelTecnicoGeranet =
    mapearResponsavelTecnicoPayloadGeranet(
      responsavelTecnico
    );

  const payload = {
    acao:
      "emitir",
    modeloDocumento:
      "nfe",
    certificadoDigital,
    senhaCertificadoDigital,
    ambiente,
    modelo:
      "55",
    ufEmitente,

    nfe: {
      contingencia: "nao" as const,

      ...(
        transportadorGeranet
          ? {
              transportador:
                transportadorGeranet,
            }
          : {}
      ),

      ...(
        volumesGeranet.length >
        0
          ? {
              volumes:
                volumesGeranet,
            }
          : {}
      ),

      empresa: {
        cnpj:
          somenteDigitos(
            emitente.cnpj
          ),

        inscricaoEstadual:
          texto(
            emitente
              .inscricaoEstadual
          ),

        razaoSocial:
          texto(
            emitente.razaoSocial
          ),

        nomeFantasia:
          texto(
            emitente.nomeFantasia
          ),

        telefone:
          somenteDigitos(
            emitente.telefone
          ),

        email:
          texto(
            emitente.email
          ),

        logradouro:
          texto(
            emitente.logradouro
          ),

        numero:
          texto(
            emitente.numero
          ),

        complemento:
          texto(
            emitente.complemento
          ),

        bairro:
          texto(
            emitente.bairro
          ),

        municipio:
          texto(
            emitente.municipio
          ),

        codigoMunicipio:
          somenteDigitos(
            emitente
              .codigoMunicipio
          ),

        uf:
          texto(
            emitente.uf
          ).toUpperCase(),

        cep:
          somenteDigitos(
            emitente.cep
          ),

        codigoRegimeTributario:
          String(
            emitente
              .codigoRegimeTributario
          ),

        tipoAtividade:
          texto(
            emitente
              .tipoAtividade
          ),

        serie:
          String(
            config.serie
          ),

        idCodigoSegurancaContribuinte:
          "",

        codigoSegurancaContribuinte:
          "",

        // Geranet: cálculo automático IBPT considera valorTotal − desconto.
        ibptAutomatico: IBPT_AUTOMATICO_GERANET,

        informacaoComplementar:
          texto(
            emitente
              .informacaoComplementar
          ),

        ...(texto(emitente.logomarca)
          ? { logomarca: texto(emitente.logomarca) }
          : {}),
      },

      cliente: {
        cnpj:
          cnpjDestinatario,

        cpf,

        inscricaoEstadual:
          texto(
            destinatario
              .inscricaoEstadual
          ),

        razaoSocial:
          razaoSocialDestinatario,

        nomeFantasia:
          texto(
            destinatario
              .nomeFantasia
          ),

        consumidorFinal:
          destinatario
            .consumidorFinal,

        indicadorIEdestinatario:
          destinatario
            .indicadorIEdestinatario,

        telefone:
          somenteDigitos(
            destinatario.telefone
          ),

        email:
          texto(
            destinatario.email
          ),

        logradouro:
          texto(
            destinatario.logradouro
          ),

        numero:
          texto(
            destinatario.numero
          ),

        complemento:
          texto(
            destinatario.complemento
          ),

        bairro:
          texto(
            destinatario.bairro
          ),

        municipio:
          texto(
            destinatario.municipio
          ),

        codigoMunicipio:
          somenteDigitos(
            destinatario
              .codigoMunicipio
          ),

        codigoPais:
          texto(
            destinatario
              .codigoPais
          ) || "1058",

        nomePais:
          texto(
            destinatario.nomePais
          ) || "Brasil",

        uf:
          texto(
            destinatario.uf
          ).toUpperCase(),

        cep:
          somenteDigitos(
            destinatario.cep
          ),

        ...(entregaGeranet
          ? { entrega: entregaGeranet }
          : {}),
      },

      ...(
        autorizadosXmlGeranet.length >
        0
          ? {
              autorizadosXml:
                autorizadosXmlGeranet,
            }
          : {}
      ),

      indicadorPresenca:
        config
          .indicadorPresenca,

      indicativoIntermediador:
        config
          .indicativoIntermediador,

      numeroNotaEmitir:
        String(
          config.numeroNota
        ),

      codigoNumerico:
        texto(
          config.codigoNumerico
        ),

      dataSaida:
        config.dataSaida,

      dataEmissao:
        config.dataEmissao,

      fusoHorario:
        resolverOffsetFiscal(
          config.fusoHorario,
          config.dataEmissao
        ),

      modelo:
        "55",

      ambiente,

      tipo:
        config.tipo,

      frete:
        config.frete ??
        "9",

      finalidade:
        config.finalidade,

      informacaoAdicionalFisco:
        texto(
          config
            .informacaoAdicionalFisco
        ),

      // Geranet mapeia nfe.informacaoComplementar → infAdic.infCpl no XML/DANFE.
      informacaoComplementar:
        texto(
          config
            .informacaoComplementar
        ),

      notaFiscalReferencia:
        texto(
          config
            .notaFiscalReferencia
        ),

      naturezaOperacao:
        texto(
          config
            .naturezaOperacao
        ),

      numeroVenda:
        texto(
          config.numeroVenda
        ),

      pagamento: {
        troco:
          pagamento.troco,

        detalhamento:
          pagamento
            .detalhamento
            .map(
              (detalhe) => ({
                tipo:
                  texto(
                    detalhe.tipo
                  ),

                valor:
                  detalhe.valor,

                indicadorPagamento:
                  detalhe
                    .indicadorPagamento,
              })
            ),
      },

      ...(
        responsavelTecnicoGeranet
          ? {
              responsavelTecnico:
                responsavelTecnicoGeranet,
            }
          : {}
      ),

      itens,
    },
  };

  aplicarContingenciaContratoGeranet(payload.nfe, "nao");
  assertIcmsContratoGeranet(payload);
  return payload;
}

export function ocultarSegredosPayloadNfe(
  payload: ReturnType<typeof montarPayloadNfeGeranet>
) {
  return sanitizarConsultaGeranet(payload) as ReturnType<
    typeof montarPayloadNfeGeranet
  >;
}
