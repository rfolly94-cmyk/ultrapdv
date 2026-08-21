export const PALETAS_PDV = [
  "padrao",
  "azul",
  "azul_claro",
  "laranja",
  "verde",
  "verde_escuro",
  "roxo",
  "rosa",
  "rosa_claro",
  "vermelho",
  "grafite",
  "cinza",
  "escuro",
  "marrom",
  "turquesa",
] as const;

export type PaletaPdv = (typeof PALETAS_PDV)[number];

export type TokensPaletaPdv = {
  bg: string;
  surface: string;
  surfaceSecondary: string;
  header: string;
  sidebar: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryForeground: string;
  hover: string;
  input: string;
  selected: string;
  error: string;
  success: string;
  warning: string;
};

export const TOKENS_PALETA_PDV: Record<PaletaPdv, TokensPaletaPdv> = {
  padrao: {
    bg: "#ffffff",
    surface: "#ffffff",
    surfaceSecondary: "#fafafa",
    header: "#ffffff",
    sidebar: "#ffffff",
    card: "#ffffff",
    border: "#e4e4e7",
    text: "#18181b",
    textMuted: "#71717a",
    primary: "#2563eb",
    primaryForeground: "#ffffff",
    hover: "#f4f4f5",
    input: "#ffffff",
    selected: "#eff6ff",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  azul: {
    bg: "#eff6ff",
    surface: "#ffffff",
    surfaceSecondary: "#dbeafe",
    header: "#dbeafe",
    sidebar: "#dbeafe",
    card: "#ffffff",
    border: "#93c5fd",
    text: "#0f172a",
    textMuted: "#334155",
    primary: "#1d4ed8",
    primaryForeground: "#ffffff",
    hover: "#bfdbfe",
    input: "#ffffff",
    selected: "#bfdbfe",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  azul_claro: {
    bg: "#f0f9ff",
    surface: "#ffffff",
    surfaceSecondary: "#e0f2fe",
    header: "#e0f2fe",
    sidebar: "#e0f2fe",
    card: "#ffffff",
    border: "#7dd3fc",
    text: "#0c4a6e",
    textMuted: "#0369a1",
    primary: "#0369a1",
    primaryForeground: "#ffffff",
    hover: "#bae6fd",
    input: "#ffffff",
    selected: "#bae6fd",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  laranja: {
    bg: "#fff7ed",
    surface: "#fffbeb",
    surfaceSecondary: "#ffedd5",
    header: "#ffedd5",
    sidebar: "#ffedd5",
    card: "#ffffff",
    border: "#fdba74",
    text: "#431407",
    textMuted: "#9a3412",
    primary: "#ea580c",
    primaryForeground: "#ffffff",
    hover: "#fed7aa",
    input: "#ffffff",
    selected: "#fed7aa",
    error: "#b91c1c",
    success: "#047857",
    warning: "#c2410c",
  },
  verde: {
    bg: "#f0fdf4",
    surface: "#ffffff",
    surfaceSecondary: "#dcfce7",
    header: "#dcfce7",
    sidebar: "#dcfce7",
    card: "#ffffff",
    border: "#86efac",
    text: "#14532d",
    textMuted: "#166534",
    primary: "#16a34a",
    primaryForeground: "#ffffff",
    hover: "#bbf7d0",
    input: "#ffffff",
    selected: "#bbf7d0",
    error: "#dc2626",
    success: "#047857",
    warning: "#d97706",
  },
  verde_escuro: {
    bg: "#eef3ee",
    surface: "#f7faf7",
    surfaceSecondary: "#d7e4d9",
    header: "#d7e4d9",
    sidebar: "#d0ddd3",
    card: "#ffffff",
    border: "#8fa894",
    text: "#14261a",
    textMuted: "#3f5c48",
    primary: "#14532d",
    primaryForeground: "#ffffff",
    hover: "#c5d5c8",
    input: "#ffffff",
    selected: "#c5d5c8",
    error: "#dc2626",
    success: "#047857",
    warning: "#d97706",
  },
  roxo: {
    bg: "#f5f3ff",
    surface: "#ffffff",
    surfaceSecondary: "#ede9fe",
    header: "#ede9fe",
    sidebar: "#ede9fe",
    card: "#ffffff",
    border: "#c4b5fd",
    text: "#2e1065",
    textMuted: "#5b21b6",
    primary: "#7c3aed",
    primaryForeground: "#ffffff",
    hover: "#ddd6fe",
    input: "#ffffff",
    selected: "#ddd6fe",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  rosa: {
    bg: "#fdf6f8",
    surface: "#fffafb",
    surfaceSecondary: "#f6ebf0",
    header: "#f6ebf0",
    sidebar: "#f3e6ec",
    card: "#ffffff",
    border: "#e4c4d1",
    text: "#3b1524",
    textMuted: "#7a4558",
    primary: "#9f1239",
    primaryForeground: "#ffffff",
    hover: "#efd0db",
    input: "#ffffff",
    selected: "#f3d6e2",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  rosa_claro: {
    bg: "#fffafb",
    surface: "#ffffff",
    surfaceSecondary: "#fdf2f5",
    header: "#fdf4f7",
    sidebar: "#fdf4f7",
    card: "#ffffff",
    border: "#f0dce4",
    text: "#3f272f",
    textMuted: "#8a6a74",
    primary: "#9f3d5a",
    primaryForeground: "#ffffff",
    hover: "#f7e6ec",
    input: "#ffffff",
    selected: "#f8e8ee",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  vermelho: {
    bg: "#fef2f2",
    surface: "#ffffff",
    surfaceSecondary: "#fee2e2",
    header: "#fee2e2",
    sidebar: "#fee2e2",
    card: "#ffffff",
    border: "#fca5a5",
    text: "#450a0a",
    textMuted: "#991b1b",
    primary: "#b91c1c",
    primaryForeground: "#ffffff",
    hover: "#fecaca",
    input: "#ffffff",
    selected: "#fecaca",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  grafite: {
    bg: "#f4f4f5",
    surface: "#ffffff",
    surfaceSecondary: "#e4e4e7",
    header: "#e4e4e7",
    sidebar: "#e4e4e7",
    card: "#ffffff",
    border: "#d4d4d8",
    text: "#18181b",
    textMuted: "#52525b",
    primary: "#3f3f46",
    primaryForeground: "#fafafa",
    hover: "#d4d4d8",
    input: "#ffffff",
    selected: "#d4d4d8",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  cinza: {
    bg: "#fafafa",
    surface: "#ffffff",
    surfaceSecondary: "#f4f4f5",
    header: "#eeeeee",
    sidebar: "#eeeeee",
    card: "#ffffff",
    border: "#e4e4e7",
    text: "#27272a",
    textMuted: "#71717a",
    primary: "#4b5563",
    primaryForeground: "#ffffff",
    hover: "#e5e7eb",
    input: "#ffffff",
    selected: "#e5e7eb",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  escuro: {
    bg: "#09090b",
    surface: "#18181b",
    surfaceSecondary: "#27272a",
    header: "#18181b",
    sidebar: "#121214",
    card: "#18181b",
    border: "#3f3f46",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    primary: "#38bdf8",
    primaryForeground: "#0f172a",
    hover: "#27272a",
    input: "#27272a",
    selected: "#1e3a5f",
    error: "#f87171",
    success: "#34d399",
    warning: "#fbbf24",
  },
  marrom: {
    bg: "#faf6f1",
    surface: "#fffdfb",
    surfaceSecondary: "#f3e8d9",
    header: "#f0e6d8",
    sidebar: "#efe4d6",
    card: "#ffffff",
    border: "#d6c4ae",
    text: "#3c2a1e",
    textMuted: "#7c5c45",
    primary: "#78350f",
    primaryForeground: "#ffffff",
    hover: "#e8d5c0",
    input: "#ffffff",
    selected: "#ead9c4",
    error: "#dc2626",
    success: "#059669",
    warning: "#d97706",
  },
  turquesa: {
    bg: "#f0fdfa",
    surface: "#ffffff",
    surfaceSecondary: "#ccfbf1",
    header: "#ccfbf1",
    sidebar: "#ccfbf1",
    card: "#ffffff",
    border: "#5eead4",
    text: "#134e4a",
    textMuted: "#0f766e",
    primary: "#0f766e",
    primaryForeground: "#ffffff",
    hover: "#99f6e4",
    input: "#ffffff",
    selected: "#99f6e4",
    error: "#dc2626",
    success: "#047857",
    warning: "#d97706",
  },
};

export const PALETAS_PDV_OPCOES: Array<{
  id: PaletaPdv;
  label: string;
}> = [
  { id: "padrao", label: "Padrão" },
  { id: "azul", label: "Azul" },
  { id: "azul_claro", label: "Azul claro" },
  { id: "laranja", label: "Laranja" },
  { id: "verde", label: "Verde" },
  { id: "verde_escuro", label: "Verde escuro" },
  { id: "roxo", label: "Roxo" },
  { id: "rosa", label: "Rosa" },
  { id: "rosa_claro", label: "Rosa claro" },
  { id: "vermelho", label: "Vermelho" },
  { id: "grafite", label: "Grafite" },
  { id: "cinza", label: "Cinza" },
  { id: "escuro", label: "Escuro" },
  { id: "marrom", label: "Marrom" },
  { id: "turquesa", label: "Turquesa" },
];

export type PreferenciasPdv = {
  paleta: PaletaPdv;
  mostrarLogoCentro: boolean;
  mostrarFotosProdutos: boolean;
};

export const PREFERENCIAS_PDV_PADRAO: PreferenciasPdv = {
  paleta: "padrao",
  mostrarLogoCentro: false,
  mostrarFotosProdutos: false,
};

const HEX_PARA_PALETA: Record<string, PaletaPdv> = {
  "#2563eb": "azul",
  "#1d4ed8": "azul",
  "#ea580c": "laranja",
  "#16a34a": "verde",
  "#7c3aed": "roxo",
  "#18181b": "grafite",
  "#3f3f46": "grafite",
};

export function ehPaletaPdv(valor: unknown): valor is PaletaPdv {
  return PALETAS_PDV.includes(String(valor ?? "") as PaletaPdv);
}

export function sanitizarPaletaPdv(valor: unknown): PaletaPdv {
  const texto = String(valor ?? "").trim().toLowerCase();
  if (ehPaletaPdv(texto)) {
    return texto;
  }

  const hex = texto.startsWith("#") ? texto : "";
  return HEX_PARA_PALETA[hex] ?? "padrao";
}

export function sanitizarPreferenciasPdv(
  valor?: Partial<PreferenciasPdv> & {
    corPrimaria?: string | null;
    paleta?: string | null;
  } | null
): PreferenciasPdv {
  const paleta = sanitizarPaletaPdv(valor?.paleta ?? valor?.corPrimaria);
  return {
    paleta,
    mostrarLogoCentro: valor?.mostrarLogoCentro === true,
    mostrarFotosProdutos: valor?.mostrarFotosProdutos === true,
  };
}

export function tokensDaPaleta(paleta: PaletaPdv) {
  return TOKENS_PALETA_PDV[sanitizarPaletaPdv(paleta)];
}

export function amostrasDaPaleta(paleta: PaletaPdv) {
  const tokens = tokensDaPaleta(paleta);
  return [tokens.bg, tokens.primary, tokens.selected] as const;
}

export function estiloTokensPdv(paleta: PaletaPdv) {
  const t = tokensDaPaleta(paleta);
  return {
    "--pdv-bg": t.bg,
    "--pdv-surface": t.surface,
    "--pdv-surface-secondary": t.surfaceSecondary,
    "--pdv-header": t.header,
    "--pdv-sidebar": t.sidebar,
    "--pdv-card": t.card,
    "--pdv-border": t.border,
    "--pdv-text": t.text,
    "--pdv-text-muted": t.textMuted,
    "--pdv-primary": t.primary,
    "--pdv-primary-foreground": t.primaryForeground,
    "--pdv-hover": t.hover,
    "--pdv-input": t.input,
    "--pdv-selected": t.selected,
    "--pdv-error": t.error,
    "--pdv-success": t.success,
    "--pdv-warning": t.warning,
  };
}

export function paletaAlteraConjuntoCompleto(
  origem: PaletaPdv,
  destino: PaletaPdv
) {
  const a = tokensDaPaleta(origem);
  const b = tokensDaPaleta(destino);
  const chaves = Object.keys(a) as Array<keyof TokensPaletaPdv>;
  const diferentes = chaves.filter((chave) => a[chave] !== b[chave]);
  return diferentes.length > 1 && diferentes.some((chave) => chave !== "primary");
}

export function preferenciasAposCancelarPreview(
  salvas: PreferenciasPdv,
  _rascunho: PreferenciasPdv
) {
  return salvas;
}

export function deveRenderizarLogoCentro(input: {
  mostrarLogoCentro: boolean;
  logoUrl: string | null | undefined;
  carrinhoVazio?: boolean;
  buscaAtiva?: boolean;
  resultadosAbertos?: boolean;
  buscaCarregando?: boolean;
}) {
  if (input.mostrarLogoCentro !== true || !input.logoUrl) {
    return false;
  }
  if (input.carrinhoVazio === false) {
    return false;
  }
  if (input.buscaAtiva || input.resultadosAbertos || input.buscaCarregando) {
    return false;
  }
  return true;
}

export function imagemProdutoDaEmpresaAtiva(
  path: string | null | undefined,
  empresaId: string
) {
  const arquivo = String(path ?? "").trim();
  const empresa = String(empresaId ?? "").trim();
  if (!arquivo || !empresa) {
    return false;
  }

  if (arquivo.startsWith("http://") || arquivo.startsWith("https://")) {
    return false;
  }

  return arquivo.startsWith(`${empresa}/`) && !arquivo.includes("..");
}

export function deveMostrarFotoProduto(input: {
  mostrarFotosProdutos: boolean;
  imagemPath: string | null | undefined;
  empresaId: string;
}) {
  return (
    input.mostrarFotosProdutos === true &&
    imagemProdutoDaEmpresaAtiva(input.imagemPath, input.empresaId)
  );
}

export function preferenciaDaSessao<
  T extends { usuario_id: string; empresa_id: string },
>(registros: T[], usuarioId: string, empresaId: string) {
  return (
    registros.find(
      (item) => item.usuario_id === usuarioId && item.empresa_id === empresaId
    ) ?? null
  );
}

export function logoDaEmpresaAtiva<
  T extends { id: string; logoUrl?: string | null; logo_path?: string | null },
>(empresas: T[], empresaId: string) {
  const empresa = empresas.find((item) => item.id === empresaId);
  if (!empresa) {
    return null;
  }

  return empresa.logoUrl ?? empresa.logo_path ?? null;
}
