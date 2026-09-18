export type MetaArquivoFormData = {
  existe: boolean;
  constructorName: string | null;
  name: string | null;
  size: number | null;
  type: string | null;
  temArrayBuffer: boolean;
  instanceofFile: boolean;
  duckTypeValido: boolean;
  valorTipo: string;
};

export function ehArquivoUpload(valor: unknown): valor is {
  size: number;
  name?: string;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  bytes?: () => Promise<Uint8Array>;
} {
  if (valor == null || typeof valor !== "object") {
    return false;
  }

  const item = valor as {
    size?: unknown;
    arrayBuffer?: unknown;
  };

  return (
    typeof item.size === "number" &&
    Number.isFinite(item.size) &&
    item.size > 0 &&
    typeof item.arrayBuffer === "function"
  );
}

export function metaArquivoFormData(valor: unknown): MetaArquivoFormData {
  if (valor == null || valor === "") {
    return {
      existe: false,
      constructorName: null,
      name: null,
      size: null,
      type: null,
      temArrayBuffer: false,
      instanceofFile: false,
      duckTypeValido: false,
      valorTipo: valor === "" ? "string-vazia" : "ausente",
    };
  }

  const objeto = typeof valor === "object" ? (valor as Record<string, unknown>) : null;
  const size = objeto && typeof objeto.size === "number" ? objeto.size : null;
  const name = objeto && typeof objeto.name === "string" ? objeto.name : null;
  const type = objeto && typeof objeto.type === "string" ? objeto.type : null;
  const temArrayBuffer = Boolean(
    objeto && typeof objeto.arrayBuffer === "function"
  );

  return {
    existe: true,
    constructorName:
      objeto && valor.constructor && typeof valor.constructor.name === "string"
        ? valor.constructor.name
        : null,
    name,
    size,
    type,
    temArrayBuffer,
    instanceofFile: typeof File !== "undefined" && valor instanceof File,
    duckTypeValido: ehArquivoUpload(valor),
    valorTipo: typeof valor,
  };
}
