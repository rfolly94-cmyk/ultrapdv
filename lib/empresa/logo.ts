export type IdentidadeEmpresaPublica = {
  empresaId: string;
  nome: string | null;
  logoUrl: string | null;
};

export const BUCKET_LOGOS_EMPRESAS = "logos-empresas";
export const TAMANHO_MAXIMO_LOGO_BYTES = 2 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export type TipoLogoEmpresa = "image/png" | "image/jpeg";

export type PlanoAtualizacaoLogo = {
  pathFinal: string | null;
  pathNovo: string | null;
  pathAntigoParaRemover: string | null;
};

export function novaVersaoLogo(
  agora = Date.now(),
  uuid = crypto.randomUUID()
) {
  const id = String(uuid).replace(/-/g, "").slice(0, 12);
  return `${agora}-${id}`;
}

export function sanitizarVersaoLogo(versao: string | null | undefined) {
  return String(versao ?? "").replace(/[^a-zA-Z0-9-]/g, "");
}

export function caminhoLogoEmpresa(
  empresaId: string,
  tipo: TipoLogoEmpresa,
  versao?: string
) {
  const empresa = String(empresaId ?? "").trim();
  const id = sanitizarVersaoLogo(versao) || sanitizarVersaoLogo(novaVersaoLogo());
  if (!empresa || !id) {
    throw new Error("Empresa não identificada para a logomarca.");
  }

  const extensao = tipo === "image/png" ? "png" : "jpg";
  return `${empresa}/logo-${id}.${extensao}`;
}

export function logoPertenceAEmpresa(empresaId: string, path: string) {
  const empresa = String(empresaId ?? "").trim();
  const arquivo = String(path ?? "").trim();
  if (!empresa || !arquivo) {
    return false;
  }

  const esperado = `${empresa}/`;
  return arquivo.startsWith(esperado) && !arquivo.includes("..");
}

export function pathLogoDaEmpresa(
  empresaId: string,
  path: string | null | undefined
) {
  const arquivo = String(path ?? "").trim();
  return logoPertenceAEmpresa(empresaId, arquivo) ? arquivo : null;
}

export function planejarAtualizacaoLogo(params: {
  empresaId: string;
  pathAtual: string | null | undefined;
  remover?: boolean;
  novoPath?: string | null;
}): PlanoAtualizacaoLogo {
  const atual = pathLogoDaEmpresa(params.empresaId, params.pathAtual);

  if (params.novoPath) {
    const pathNovo = pathLogoDaEmpresa(params.empresaId, params.novoPath);
    if (!pathNovo) {
      throw new Error("O caminho da logomarca não pertence à empresa ativa.");
    }

    return {
      pathFinal: pathNovo,
      pathNovo,
      pathAntigoParaRemover: atual && atual !== pathNovo ? atual : null,
    };
  }

  if (params.remover) {
    return {
      pathFinal: null,
      pathNovo: null,
      pathAntigoParaRemover: atual,
    };
  }

  return {
    pathFinal: atual,
    pathNovo: null,
    pathAntigoParaRemover: null,
  };
}

export function detectarTipoLogo(buffer: Buffer): TipoLogoEmpresa | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(PNG_MAGIC)) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC)) {
    return "image/jpeg";
  }

  return null;
}

export function validarUploadLogoEmpresa(params: {
  empresaId: string;
  nomeArquivo?: string | null;
  mimeInformado?: string | null;
  tamanho: number;
  bytes: Buffer;
  versao?: string;
}) {
  if (!params.empresaId) {
    throw new Error("Empresa não identificada para a logomarca.");
  }

  if (params.tamanho <= 0) {
    throw new Error("Selecione uma imagem PNG ou JPEG.");
  }

  if (params.tamanho > TAMANHO_MAXIMO_LOGO_BYTES) {
    throw new Error("A logomarca deve ter no máximo 2 MB.");
  }

  const tipo = detectarTipoLogo(params.bytes);
  if (!tipo) {
    throw new Error("Envie somente PNG ou JPEG válidos.");
  }

  const mime = String(params.mimeInformado ?? "").toLowerCase();
  if (
    mime &&
    mime !== tipo &&
    !(tipo === "image/jpeg" && (mime === "image/jpg" || mime === "image/jpeg"))
  ) {
    throw new Error("O arquivo não corresponde a um PNG ou JPEG válido.");
  }

  return {
    tipo,
    path: caminhoLogoEmpresa(params.empresaId, tipo, params.versao),
  };
}

export function bufferParaHexLogomarca(buffer: Buffer) {
  return buffer.toString("hex");
}

export function urlPublicaLogoEmpresa(path: string | null | undefined) {
  const arquivo = String(path ?? "").trim();
  if (!arquivo) {
    return null;
  }

  if (arquivo.startsWith("http://") || arquivo.startsWith("https://")) {
    return null;
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return null;
  }

  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET_LOGOS_EMPRESAS}/${arquivo}`;
}

export { logoUrlUtilizavel } from "./logo-url";

export function anexarLogomarcaFiscal<
  T extends { nfe?: { empresa?: Record<string, unknown> } },
>(payload: T, logomarca?: string) {
  const hex = String(logomarca ?? "").trim();
  if (!hex || !payload.nfe?.empresa) {
    return payload;
  }

  return {
    ...payload,
    nfe: {
      ...payload.nfe,
      empresa: {
        ...payload.nfe.empresa,
        logomarca: hex,
      },
    },
  };
}

export function montarPayloadGerarPdf(params: {
  xml: string;
  modelo: string;
  logomarca?: string;
}) {
  const logomarca = String(params.logomarca ?? "").trim();

  return {
    xml: params.xml,
    modelo: params.modelo,
    ...(logomarca
      ? {
          nfe: {
            empresa: {
              logomarca,
            },
          },
        }
      : {}),
  };
}
