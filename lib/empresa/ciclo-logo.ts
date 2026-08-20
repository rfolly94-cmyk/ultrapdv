import {
  planejarAtualizacaoLogo,
  validarUploadLogoEmpresa,
  type TipoLogoEmpresa,
} from "./logo";

export const MENSAGEM_LOGO_ATUALIZADA = "Logo da empresa atualizada.";
export const MENSAGEM_FALHA_LOGO = "Não foi possível atualizar a logo.";

export type ResultadoCicloLogo =
  | { ok: true; logoPath: string | null }
  | { ok: false; erro: string; logoPathPreservado: string | null };

type ArquivoLogo = {
  bytes: Buffer;
  nomeArquivo?: string | null;
  mimeInformado?: string | null;
  tamanho: number;
};

export async function executarCicloLogoEmpresa(params: {
  empresaId: string;
  pathAtual: string | null | undefined;
  remover?: boolean;
  arquivo?: ArquivoLogo | null;
  versao?: string;
  upload: (args: {
    path: string;
    bytes: Buffer;
    contentType: TipoLogoEmpresa;
  }) => Promise<{ error: { message: string } | null }>;
  persistir: (
    path: string | null
  ) => Promise<{ error: { message: string } | null }>;
  confirmar: () => Promise<string | null>;
  removerArquivo: (path: string) => Promise<void>;
}): Promise<ResultadoCicloLogo> {
  const pathAtual = params.pathAtual ? String(params.pathAtual) : null;

  try {
    const novo = params.arquivo
      ? validarUploadLogoEmpresa({
          empresaId: params.empresaId,
          nomeArquivo: params.arquivo.nomeArquivo,
          mimeInformado: params.arquivo.mimeInformado,
          tamanho: params.arquivo.tamanho,
          bytes: params.arquivo.bytes,
          versao: params.versao,
        })
      : null;

    const plano = planejarAtualizacaoLogo({
      empresaId: params.empresaId,
      pathAtual,
      remover: params.remover === true,
      novoPath: novo?.path ?? null,
    });

    if (plano.pathNovo && params.arquivo) {
      const enviado = await params.upload({
        path: plano.pathNovo,
        bytes: params.arquivo.bytes,
        contentType: novo!.tipo,
      });

      if (enviado.error) {
        return {
          ok: false,
          erro: MENSAGEM_FALHA_LOGO,
          logoPathPreservado: pathAtual,
        };
      }
    }

    const gravado = await params.persistir(plano.pathFinal);
    if (gravado.error) {
      if (plano.pathNovo) {
        try {
          await params.removerArquivo(plano.pathNovo);
        } catch {
          // Cleanup best-effort do arquivo novo não persistido.
        }
      }

      return {
        ok: false,
        erro: MENSAGEM_FALHA_LOGO,
        logoPathPreservado: pathAtual,
      };
    }

    const persistido = await params.confirmar();
    const logoPath =
      persistido === plano.pathFinal || (!persistido && !plano.pathFinal)
        ? persistido
        : plano.pathFinal;

    if (plano.pathAntigoParaRemover) {
      try {
        await params.removerArquivo(plano.pathAntigoParaRemover);
      } catch {
        // Arquivo antigo órfão não desfaz a logo já persistida.
      }
    }

    return { ok: true, logoPath };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error && error.message
          ? error.message
          : MENSAGEM_FALHA_LOGO,
      logoPathPreservado: pathAtual,
    };
  }
}
