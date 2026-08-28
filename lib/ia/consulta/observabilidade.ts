export function registrarObservabilidadeConsulta(params: {
  empresaId: string;
  usuarioId: string;
  ok: boolean;
  error: string | null;
  fontes: string[];
  duracaoMs: number;
  rowCount: number;
  querySummary?: string;
}) {
  const payload = {
    origem: "ia-consultar-dados",
    requestId: params.usuarioId.slice(0, 8),
    empresa: params.empresaId.slice(0, 8),
    fontes: params.fontes,
    ok: params.ok,
    error: params.error,
    duracaoMs: params.duracaoMs,
    rowCount: params.rowCount,
    querySummary: params.querySummary,
  };
  if (process.env.NODE_ENV === "development") {
    console.info(JSON.stringify(payload));
  }
}
