import { sugerirDepartamentoPadrao } from "./departamento";
import {
  ETIQUETA_BALANCA_PADRAO,
  TIPOS_INTEGRACAO_BALANCA,
  type ConfiguracaoBalanca,
  type ConfiguracaoEtiquetaBalanca,
  type FabricanteBalanca,
  type TipoIntegracaoBalanca,
} from "./tipos";

export const MODELO_OUTRO_ID = "outro";
export const LAYOUT_AUTOMATICO = "automatico";
export const LAYOUT_MANUAL = "manual";

export const MENSAGEM_MODELO_SEM_AUTOMATICO =
  "Este modelo ainda não possui configuração automática no UltraPDV.";

export const MENSAGEM_FORMATO_AUTOMATICO =
  "O UltraPDV selecionará automaticamente o formato compatível com o modelo escolhido.";

export const MENSAGEM_AVANCADO_ETIQUETA =
  "Altere somente se souber o padrão utilizado pela etiqueta da sua balança.";

export const MENSAGEM_TROCA_MODELO_AVANCADO =
  "A troca de modelo substitui as configurações avançadas personalizadas. Deseja substituir?";

export type LayoutModeloBalanca = {
  id: string;
  nome: string;
  arquivo?: string;
  versaoArquivo?: string;
  descricaoSecundaria?: string;
};

export type ModeloBalanca = {
  id: string;
  fabricante: FabricanteBalanca;
  nome: string;
  layouts: LayoutModeloBalanca[];
  layoutRecomendado: string | null;
  tiposIntegracao: TipoIntegracaoBalanca[];
  etiquetaPadrao: ConfiguracaoEtiquetaBalanca | null;
};

export type OpcaoFormatoBalanca = {
  value: string;
  label: string;
};

/**
 * Catálogo de produção fabricante + modelo + layout.
 *
 * Só cadastrar entrada com documentação oficial da Toledo do Brasil.
 * Urano e Filizola ficam de fora até existir spec confiável.
 *
 * Referências:
 * - Compatibilidade Prix 4 Uno + MGV7:
 *   https://help.toledobrasil.com/mgv7/v7_0_/HTML_PAGES/compatibilidade_balancas.html
 * - Arquivo Itensmgv.txt versão 4:
 *   https://help.toledobrasil.com/mgv7/v7_0_/HTML_PAGES/arquivos_de_cadastro.html
 */
export const MODELOS_BALANCA: readonly ModeloBalanca[] = [
  {
    id: "toledo-prix-4-uno",
    fabricante: "toledo",
    nome: "Prix 4 Uno",
    layouts: [
      {
        id: "mgv7",
        nome: "MGV7",
        arquivo: "Itensmgv.txt",
        versaoArquivo: "4",
        descricaoSecundaria:
          "Arquivo gerado: Itensmgv.txt (versão 4 do MGV7).",
      },
    ],
    layoutRecomendado: "mgv7",
    tiposIntegracao: ["arquivo"],
    etiquetaPadrao: null,
  },
];

export function modelosDoFabricante(
  fabricante: FabricanteBalanca,
  catalogo: readonly ModeloBalanca[] = MODELOS_BALANCA
): ModeloBalanca[] {
  return catalogo.filter((item) => item.fabricante === fabricante);
}

export function buscarModelo(
  params: {
    fabricante: FabricanteBalanca;
    modeloId?: string | null;
    nome?: string | null;
  },
  catalogo: readonly ModeloBalanca[] = MODELOS_BALANCA
): ModeloBalanca | null {
  if (params.modeloId === MODELO_OUTRO_ID) {
    return null;
  }

  const conhecidos = modelosDoFabricante(params.fabricante, catalogo);

  if (params.modeloId) {
    return conhecidos.find((item) => item.id === params.modeloId) ?? null;
  }

  const nome = String(params.nome ?? "")
    .trim()
    .toLowerCase();
  if (!nome) {
    return null;
  }

  return (
    conhecidos.find((item) => item.nome.trim().toLowerCase() === nome) ?? null
  );
}

export function modeloPossuiConfiguracaoAutomatica(
  modelo: ModeloBalanca | null
): modelo is ModeloBalanca {
  return Boolean(
    modelo &&
      modelo.layouts.length > 0 &&
      modelo.layoutRecomendado &&
      modelo.layouts.some((item) => item.id === modelo.layoutRecomendado)
  );
}

export function opcoesFormatoModelo(
  modelo: ModeloBalanca | null
): OpcaoFormatoBalanca[] {
  if (!modeloPossuiConfiguracaoAutomatica(modelo)) {
    return [{ value: LAYOUT_MANUAL, label: "Manual / não identificado" }];
  }

  if (modelo.layouts.length === 1) {
    return [
      {
        value: LAYOUT_AUTOMATICO,
        label: `Automático (${modelo.layouts[0].nome})`,
      },
    ];
  }

  return [
    { value: LAYOUT_AUTOMATICO, label: "Automático (recomendado)" },
    ...modelo.layouts.map((item) => ({
      value: item.id,
      label: item.nome,
    })),
  ];
}

export function ajudaFormatoModelo(modelo: ModeloBalanca | null): string {
  if (!modeloPossuiConfiguracaoAutomatica(modelo)) {
    return MENSAGEM_MODELO_SEM_AUTOMATICO;
  }
  const recomendado = modelo.layouts.find(
    (item) => item.id === modelo.layoutRecomendado
  );
  if (recomendado?.descricaoSecundaria) {
    return `${MENSAGEM_FORMATO_AUTOMATICO} ${recomendado.descricaoSecundaria}`;
  }
  return MENSAGEM_FORMATO_AUTOMATICO;
}

export function inferirFormatoSalvo(params: {
  modelo: ModeloBalanca | null;
  formato?: string | null;
  layout?: string | null;
}): string {
  if (!modeloPossuiConfiguracaoAutomatica(params.modelo)) {
    return LAYOUT_MANUAL;
  }

  const formato = String(params.formato ?? "").trim();
  if (formato === LAYOUT_AUTOMATICO) {
    return LAYOUT_AUTOMATICO;
  }
  if (params.modelo.layouts.some((item) => item.id === formato)) {
    return formato;
  }

  const layout = String(params.layout ?? "").trim();
  if (!layout || layout === params.modelo.layoutRecomendado) {
    return LAYOUT_AUTOMATICO;
  }
  if (params.modelo.layouts.some((item) => item.id === layout)) {
    return layout;
  }

  return LAYOUT_AUTOMATICO;
}

export function resolverLayoutPersistido(
  modelo: ModeloBalanca | null,
  formatoEscolha: string | null | undefined
): string | null {
  if (!modeloPossuiConfiguracaoAutomatica(modelo)) {
    return null;
  }

  const formato = String(formatoEscolha ?? "").trim();
  if (!formato || formato === LAYOUT_AUTOMATICO) {
    return modelo.layoutRecomendado;
  }
  if (formato === LAYOUT_MANUAL) {
    return null;
  }

  return (
    modelo.layouts.find((item) => item.id === formato)?.id ??
    modelo.layoutRecomendado
  );
}

export function tiposIntegracaoDoModelo(
  modelo: ModeloBalanca | null
): TipoIntegracaoBalanca[] {
  if (!modelo || modelo.tiposIntegracao.length === 0) {
    return TIPOS_INTEGRACAO_BALANCA.map((item) => item.value);
  }
  return modelo.tiposIntegracao;
}

export function etiquetaDoModelo(
  modelo: ModeloBalanca | null
): ConfiguracaoEtiquetaBalanca {
  return modelo?.etiquetaPadrao ?? { ...ETIQUETA_BALANCA_PADRAO };
}

export function etiquetasIguais(
  a: ConfiguracaoEtiquetaBalanca,
  b: ConfiguracaoEtiquetaBalanca
): boolean {
  return (
    a.prefixo === b.prefixo &&
    a.plu === b.plu &&
    a.modo === b.modo &&
    a.quantidadeDigitos === b.quantidadeDigitos &&
    a.casasDecimais === b.casasDecimais &&
    a.digitoVerificador === b.digitoVerificador
  );
}

export function deveConfirmarTrocaModelo(params: {
  etiquetaAtual: ConfiguracaoEtiquetaBalanca;
  etiquetaNova: ConfiguracaoEtiquetaBalanca;
  etiquetaManual: boolean;
}): boolean {
  if (!params.etiquetaManual) {
    return false;
  }
  return !etiquetasIguais(params.etiquetaAtual, params.etiquetaNova);
}

export function aplicarSelecaoModelo(params: {
  modelo: ModeloBalanca | null;
  formatoEscolha?: string | null;
  etiquetaAtual: ConfiguracaoEtiquetaBalanca;
  etiquetaManual: boolean;
  substituirAvancado: boolean;
}): {
  formato: string;
  layout: string | null;
  etiqueta: ConfiguracaoEtiquetaBalanca;
  etiquetaManual: boolean;
  exigeConfirmacao: boolean;
} {
  const etiquetaNova = etiquetaDoModelo(params.modelo);
  const exigeConfirmacao = deveConfirmarTrocaModelo({
    etiquetaAtual: params.etiquetaAtual,
    etiquetaNova,
    etiquetaManual: params.etiquetaManual,
  });
  const formato = inferirFormatoSalvo({
    modelo: params.modelo,
    formato:
      params.formatoEscolha ??
      (modeloPossuiConfiguracaoAutomatica(params.modelo)
        ? LAYOUT_AUTOMATICO
        : LAYOUT_MANUAL),
  });
  const layout = resolverLayoutPersistido(params.modelo, formato);

  if (exigeConfirmacao && !params.substituirAvancado) {
    return {
      formato,
      layout,
      etiqueta: params.etiquetaAtual,
      etiquetaManual: true,
      exigeConfirmacao,
    };
  }

  return {
    formato,
    layout,
    etiqueta: etiquetaNova,
    etiquetaManual: false,
    exigeConfirmacao,
  };
}

export function rotuloFormatoSalvo(
  params: {
    fabricante: FabricanteBalanca;
    modeloNome?: string | null;
    modeloId?: string | null;
    formato?: string | null;
    layout?: string | null;
  },
  catalogo: readonly ModeloBalanca[] = MODELOS_BALANCA
): string {
  const modelo = buscarModelo(
    {
      fabricante: params.fabricante,
      modeloId: params.modeloId,
      nome: params.modeloId ? null : params.modeloNome,
    },
    catalogo
  );
  const formato = inferirFormatoSalvo({
    modelo,
    formato: params.formato,
    layout: params.layout,
  });
  const opcoes = opcoesFormatoModelo(modelo);
  return (
    opcoes.find((item) => item.value === formato)?.label ??
    opcoes[0]?.label ??
    "Manual / não identificado"
  );
}

export function estadoInicialFormularioBalanca(
  config: ConfiguracaoBalanca | null,
  catalogo: readonly ModeloBalanca[] = MODELOS_BALANCA
) {
  const fabricante = config?.fabricante ?? "toledo";
  const modeloIdSalvo = config?.configuracao.modeloId ?? null;
  const modelo = buscarModelo(
    {
      fabricante,
      modeloId: modeloIdSalvo,
      nome: modeloIdSalvo ? null : config?.modelo,
    },
    catalogo
  );
  const formato = inferirFormatoSalvo({
    modelo,
    formato: config?.configuracao.formato,
    layout: config?.layout,
  });
  const tipos = tiposIntegracaoDoModelo(modelo);
  const tipoAtual = config?.tipoIntegracao ?? "arquivo";
  const layout = resolverLayoutPersistido(modelo, formato);

  return {
    fabricante,
    modeloId: modelo?.id ?? MODELO_OUTRO_ID,
    modeloNome: modelo?.nome ?? config?.modelo ?? "",
    formato,
    layout,
    tipoIntegracao: tipos.includes(tipoAtual) ? tipoAtual : tipos[0],
    ativo: config?.ativo !== false,
    etiqueta: config?.configuracao.etiqueta ?? { ...ETIQUETA_BALANCA_PADRAO },
    etiquetaManual: config?.configuracao.etiquetaManual === true,
    departamentoPadrao: sugerirDepartamentoPadrao({
      layout,
      atual: config?.configuracao.departamentoPadrao,
    }),
  };
}

export function lerSelecaoModeloDoFormulario(
  formData: FormData,
  fabricante: FabricanteBalanca,
  catalogo: readonly ModeloBalanca[] = MODELOS_BALANCA
) {
  const modeloId =
    String(formData.get("modelo_id") ?? "").trim() || MODELO_OUTRO_ID;
  const modeloNome = String(formData.get("modelo") ?? "").trim();
  const formatoBruto = String(formData.get("formato") ?? "").trim();
  const etiquetaManual = formData.get("etiqueta_manual") === "1";
  const modelo = buscarModelo({ fabricante, modeloId, nome: modeloNome }, catalogo);
  const formato = inferirFormatoSalvo({
    modelo,
    formato: formatoBruto,
  });

  return {
    modelo,
    modeloId: modelo?.id ?? MODELO_OUTRO_ID,
    modeloNome: modelo?.nome ?? (modeloNome || null),
    formato,
    layout: resolverLayoutPersistido(modelo, formato),
    etiquetaManual,
  };
}
