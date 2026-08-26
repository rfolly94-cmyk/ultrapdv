export const TIPOS_DOCUMENTO_IMPRESSAO = [
  "recibo",
  "danfe_nfce",
  "danfe_nfe",
] as const;

export type TipoDocumentoImpressao =
  (typeof TIPOS_DOCUMENTO_IMPRESSAO)[number];

export const PAPEIS_IMPRESSAO = ["58mm", "80mm", "a4"] as const;

export type PapelImpressao = (typeof PAPEIS_IMPRESSAO)[number];

export const COPIAS_IMPRESSAO_MIN = 1;
export const COPIAS_IMPRESSAO_MAX = 10;

export const PRINT_AGENT_HOST = "127.0.0.1";
export const PRINT_AGENT_PORT = 18181;
export const PRINT_AGENT_PORTA_MAX_AUTO = 18190;
export const PRINT_AGENT_APP = "UltraPDV-Conector";
export const PRINT_AGENT_SERVICO = "ultrapdv-connector";
export const PRINT_AGENT_ORIGIN = `http://${PRINT_AGENT_HOST}:${PRINT_AGENT_PORT}`;

export const DISPOSITIVO_STORAGE_KEY = "ultrapdv_dispositivo_id";

export type ConfiguracaoImpressao = {
  id: string | null;
  tipoDocumento: TipoDocumentoImpressao;
  impressoraNome: string | null;
  papel: PapelImpressao;
  copias: number;
  impressaoAutomatica: boolean;
  ativo: boolean;
};

export type DestinoImpressaoAutomatica =
  | {
      tipo: "danfe_nfce";
      emissaoId: string;
    }
  | {
      tipo: "danfe_nfe";
      emissaoId: string;
    }
  | {
      tipo: "recibo";
      vendaId: string;
    }
  | {
      tipo: "nenhum";
    };

export type StatusAgenteImpressao = {
  ok: boolean;
  app?: string;
  servico?: string;
  nome?: string;
  versao?: string;
  version?: string;
  port?: number;
  porta?: number;
  dispositivoId?: string;
  lastPrinter?: string | null;
  lastPaper?: string | null;
  motorImpressao?: {
    encontrado: boolean;
    tipo?: string | null;
    caminho?: string | null;
  };
  motivoDescoberta?: "ausente" | "timeout" | "bloqueado" | "invalido";
};

export type ImpressoraWindows = {
  nome: string;
  padrao?: boolean;
};
