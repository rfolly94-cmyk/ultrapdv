export const STATUS_MOTOR_FISCAL = [
  "ok",
  "atencao",
  "provavel_divergencia",
  "informacao_insuficiente",
  "sem_base",
  "contexto_incompleto",
  "aguardando_legislacao",
] as const;
export type StatusMotorFiscal = (typeof STATUS_MOTOR_FISCAL)[number];

export const CONFIANCAS_MOTOR = ["nenhuma", "baixa", "media", "alta"] as const;
export type ConfiancaMotor = (typeof CONFIANCAS_MOTOR)[number];

export const TIPOS_OPERACAO_FISCAL = [
  "venda",
  "bonificacao",
  "transferencia",
  "devolucao",
  "outra",
] as const;
export type TipoOperacaoFiscal = (typeof TIPOS_OPERACAO_FISCAL)[number];

export type FonteMotor = {
  codigo: string;
  versao: string;
  origem: string;
  status?: string;
};

export type CandidatoNcm = {
  codigo: string;
  descricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  versao: string;
  pontuacao: number;
};

export type CandidatoCest = {
  codigo: string;
  descricao: string;
  ncm: string | null;
  segmento: string | null;
  versao: string;
};

export type ClassificacaoIbsCbs = {
  cst: string | null;
  cstDescricao: string | null;
  cClassTrib: string | null;
  cClassTribDescricao: string | null;
  combinacaoValida: boolean | null;
  reducaoIbs: number | null;
  reducaoCbs: number | null;
  impostoSeletivo: boolean | null;
  status: StatusMotorFiscal;
  motivo: string;
};

export type GrupoFiscalRecomendado = {
  id: string;
  nome: string;
  compatibilidade: "alta" | "media" | null;
  motivos: string[];
  diferencas: string[];
} | null;

export type ContextoFiscalEmpresa = {
  empresaId: string;
  cnpj: string | null;
  razaoSocial: string | null;
  crt: 1 | 2 | 3 | 4 | null;
  regimeTributario: string | null;
  uf: string | null;
  municipio: string | null;
  inscricaoEstadual: string | null;
  contribuinteIcms: boolean | null;
  ambiente: string | null;
  incompleto: boolean;
  faltantes: string[];
};

export type ContextoOperacaoFiscal = {
  empresa: ContextoFiscalEmpresa;
  produtoId: string | null;
  origemMercadoria: string | null;
  quantidade: number | null;
  valor: number | null;
  tipoOperacao: TipoOperacaoFiscal;
  ufOrigem: string | null;
  ufDestino: string | null;
  destinatarioId: string | null;
  contribuinteIcmsDestinatario: boolean | null;
  consumidorFinal: boolean | null;
  naturezaId: string | null;
  dataReferencia: string;
};

export type EntradaClassificacaoFiscal = {
  produtoId?: string | null;
  descricao?: string | null;
  descricaoComplementar?: string | null;
  marca?: string | null;
  categoria?: string | null;
  material?: string | null;
  composicao?: string | null;
  finalidade?: string | null;
  uso?: string | null;
  caracteristicasTecnicas?: string | null;
  origemAtual?: string | null;
  origemInformadaUsuario?: string | null;
  ncmAtual?: string | null;
  cestAtual?: string | null;
  dataReferencia?: string | null;
};

export type ResultadoClassificacaoFiscal = {
  status: StatusMotorFiscal;
  candidatosNcm: CandidatoNcm[];
  ncmSugerido: CandidatoNcm | null;
  cest: CandidatoCest[] | CandidatoCest | null;
  origem: {
    codigo: string | null;
    descricao: string | null;
    fonte: "produto" | "nfe_entrada" | "usuario" | "incerta";
    motivo: string;
  };
  classificacaoIbsCbs: ClassificacaoIbsCbs;
  grupoFiscalRecomendado: GrupoFiscalRecomendado;
  grupoAtual: { id: string; nome: string } | null;
  confianca: ConfiancaMotor;
  motivoConfianca: string;
  informacoesFaltantes: string[];
  justificativa: string;
  fontes: FonteMotor[];
  versoes: Record<string, string>;
  diferencas: Array<{
    campo: string;
    rotulo: string;
    atual: string | null;
    sugerido: string | null;
  }>;
  produtoPossuiCest: boolean | null;
  operacaoSujeitaSt: boolean | null;
  empresa: {
    crt: 1 | 2 | 3 | 4 | null;
    regime: string | null;
    uf: string | null;
  };
};

export type ResultadoValidacaoProduto = {
  status: "correto" | "atencao" | "provavel_divergencia" | "informacao_insuficiente";
  classificacao: ResultadoClassificacaoFiscal;
};

export type PropostaAtualizacaoFiscal = {
  empresaId: string;
  produtoId: string;
  campo: string;
  atual: string | null;
  sugerido: string | null;
  confianca: ConfiancaMotor;
  justificativa: string;
  fontes: string[];
  versao: string;
  criadoEm: string;
};

export function dataReferenciaIso(valor?: Date | string | null) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor ?? "").trim();
  const match = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) {
    return match[1];
  }
  return new Date().toISOString().slice(0, 10);
}

export function somenteDigitosFiscal(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function ncmOitoDigitos(valor: unknown) {
  const digitos = somenteDigitosFiscal(valor);
  return digitos.length === 8 ? digitos : null;
}

export function cestSeteDigitos(valor: unknown) {
  const digitos = somenteDigitosFiscal(valor);
  return digitos.length === 7 ? digitos : null;
}
