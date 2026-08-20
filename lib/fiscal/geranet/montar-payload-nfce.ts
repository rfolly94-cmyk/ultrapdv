import type {
  ItemGeranet,
} from "./montar-item";
import { sanitizarConsultaGeranet } from "./classificar-consulta";
import { aplicarContingenciaContratoGeranet } from "./contingencia-contrato";
import { resolverOffsetFiscal } from "./data-hora";
import { assertIcmsContratoGeranet } from "./resolver-icms-geranet";
import { resolverDestinatarioFiscalNfe } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";

export type SegredosFiscaisGeranet = {
  geranet_api_key?: string | null;
  certificado_a1?: string | null;
  senha_certificado?: string | null;
  csc?: string | null;
};

export type EmitenteNfceGeranet = {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia: string;

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
    | 1
    | 2
    | 3
    | 4;

  tipoAtividade?: string | null;

  informacaoComplementar?: string | null;
  logomarca?: string | null;
};

export type ConfigNfceGeranet = {
  ambiente: "1" | "2";

  serie: number;
  numeroNota: number | string;

  idCsc: string;

  indicadorPresenca: string;
  indicativoIntermediador: string;

  naturezaOperacao: string;
  informacaoComplementar?: string | null;

  dataEmissao: string;
  dataSaida: string;
  fusoHorario: string;
};

export type PagamentoNfceGeranet = {
  tipo: string;
  valor: number;
  indicadorPagamento: "0" | "1";
  troco?: number;
};

export type MontarPayloadNfceInput = {
  emitente: EmitenteNfceGeranet;
  config: ConfigNfceGeranet;
  segredos: SegredosFiscaisGeranet;

  item: ItemGeranet;

  pagamento: PagamentoNfceGeranet;

  codigoNumerico: string;
};

function texto(
  valor: string | null | undefined
) {
  return String(valor ?? "").trim();
}

function somenteDigitos(
  valor: string | null | undefined
) {
  return texto(valor).replace(
    /\D/g,
    ""
  );
}

export function normalizarIdCscGeranet(
  idCsc: string
) {
  const valor = String(
    idCsc ?? ""
  ).trim();

  if (!/^\d{1,6}$/.test(valor)) {
    throw new Error(
      "ID do CSC deve conter de 1 a 6 dígitos numéricos."
    );
  }

  const numero = Number(valor);

  if (
    !Number.isInteger(numero) ||
    numero <= 0
  ) {
    throw new Error(
      "ID do CSC deve ser maior que zero."
    );
  }

  return {
    // Valor canônico que mantemos no ERP.
    canonico:
      valor.padStart(6, "0"),

    // A Geranet mostra o idCsc superior
    // sem zeros não significativos.
    geranet:
      String(numero),
  };
}

export function montarPayloadNfceGeranet({
  emitente,
  config,
  segredos,
  item,
  pagamento,
  codigoNumerico,
}: MontarPayloadNfceInput) {
  const idCsc =
    normalizarIdCscGeranet(
      config.idCsc
    );

  const municipioGeranet =
    emitente.municipio.includes(" - ")
      ? emitente.municipio
      : `${emitente.municipio} - ${emitente.uf}`;

  const empresa = {
    cnpj: somenteDigitos(
      emitente.cnpj
    ),

    inscricaoEstadual:
      somenteDigitos(
        emitente.inscricaoEstadual
      ),

    telefone:
      somenteDigitos(
        emitente.telefone
      ),

    email:
      texto(emitente.email),

    municipio:
      municipioGeranet,

    codigoMunicipio:
      somenteDigitos(
        emitente.codigoMunicipio
      ),

    uf:
      texto(emitente.uf)
        .toUpperCase(),

    ...(texto(
      emitente.tipoAtividade
    )
      ? {
          tipoAtividade:
            texto(
              emitente.tipoAtividade
            ),
        }
      : {}),

    serie:
      String(config.serie),

    // A OpenAPI da Geranet mostra
    // esses campos também dentro
    // de nfe.empresa no exemplo
    // de NFC-e.
    idCodigoSegurancaContribuinte:
      idCsc.canonico,

    codigoSegurancaContribuinte:
      texto(segredos.csc),

    razaoSocial:
      texto(
        emitente.razaoSocial
      ),

    nomeFantasia:
      texto(
        emitente.nomeFantasia
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

    cep:
      somenteDigitos(
        emitente.cep
      ),

    codigoRegimeTributario:
      String(
        emitente
          .codigoRegimeTributario
      ),

    informacaoComplementar:
      texto(
        emitente
          .informacaoComplementar
      ),

    ...(texto(emitente.logomarca)
      ? { logomarca: texto(emitente.logomarca) }
      : {}),
  };

  const payload = {
    acao: "emitir",
    modeloDocumento: "nfe",

    certificadoDigital:
      texto(
        segredos.certificado_a1
      ),

    senhaCertificadoDigital:
      texto(
        segredos
          .senha_certificado
      ),

    ambiente:
      config.ambiente,

    modelo: "65",

    ufEmitente:
      empresa.uf,

    idCsc:
      idCsc.geranet,

    csc:
      texto(segredos.csc),

    nfe: {
      contingencia: "nao" as const,

      empresa,

      // A integração Geranet trabalha com o
      // objeto nfe.cliente. Para NFC-e com
      // consumidor não identificado mantemos
      // o objeto presente, porém vazio.
      //
      // Não inventamos CPF, nome ou endereço.
      // Quando houver cliente selecionado no PDV,
      // este objeto será preenchido com os dados reais.
      cliente: {
        // Consumidor final NÃO identificado.
        // Não inventamos CPF/CNPJ, nome ou endereço.
        // Mantemos as chaves esperadas pelo motor Geranet
        // para evitar conversões internas de Null.
        cnpj: "",
        cpf: "",
        inscricaoEstadual: "",
        razaoSocial: "",
        nomeFantasia: "",

        ...resolverDestinatarioFiscalNfe({
          modelo: "65",
          origemVenda: "pdv",
          contribuinteIcms: false,
        }),

        telefone: "",
        email: "",

        logradouro: "",
        numero: "",
        complemento: "",
        bairro: "",
        municipio: "",
        codigoMunicipio: "",
        codigoPais: "1058",
        nomePais: "Brasil",
        uf: "",
        cep: "",
      },

      indicadorPresenca:
        config.indicadorPresenca,

      indicativoIntermediador:
        config
          .indicativoIntermediador,

      numeroNotaEmitir:
        String(config.numeroNota),

      codigoNumerico,

      dataSaida:
        texto(config.dataSaida),

      dataEmissao:
        texto(config.dataEmissao),

      fusoHorario:
        resolverOffsetFiscal(
          config.fusoHorario,
          config.dataEmissao
        ),

      modelo: "65",
      ambiente: config.ambiente,

      tipo: "1",
      frete: "9",
      finalidade: "1",

      informacaoAdicionalFisco:
        "",

      informacaoComplementar:
        texto(
          config
            .informacaoComplementar
        ),

      notaFiscalReferencia:
        "",

      naturezaOperacao:
        texto(
          config.naturezaOperacao
        ),

      numeroVenda: "",

      pagamento: {
        troco:
          pagamento.troco ?? 0,

        detalhamento: [
          {
            tipo:
              pagamento.tipo,

            valor:
              Number(
                pagamento.valor
                  .toFixed(2)
              ),

            indicadorPagamento:
              pagamento
                .indicadorPagamento,
          },
        ],
      },

      itens: [item],
    },
  };

  aplicarContingenciaContratoGeranet(payload.nfe, "nao");
  assertIcmsContratoGeranet(payload);
  return payload;
}

export function ocultarSegredosPayloadNfce(
  payload: ReturnType<
    typeof montarPayloadNfceGeranet
  >
) {
  return {
    ...payload,

    certificadoDigital:
      payload
        .certificadoDigital
        ? "[CONFIGURADO / OCULTO]"
        : "[NÃO CONFIGURADO]",

    senhaCertificadoDigital:
      payload
        .senhaCertificadoDigital
        ? "[CONFIGURADA / OCULTA]"
        : "[NÃO CONFIGURADA]",

    csc:
      payload.csc
        ? "[CONFIGURADO / OCULTO]"
        : "[NÃO CONFIGURADO]",

    nfe: {
      ...payload.nfe,

      empresa: {
        ...payload.nfe.empresa,

        codigoSegurancaContribuinte:
          payload.nfe.empresa
            .codigoSegurancaContribuinte
            ? "[CONFIGURADO / OCULTO]"
            : "[NÃO CONFIGURADO]",
        ...((payload.nfe.empresa as { logomarca?: string }).logomarca
          ? { logomarca: "[CONFIGURADA / OCULTA]" }
          : {}),
      },
    },
  };
}
