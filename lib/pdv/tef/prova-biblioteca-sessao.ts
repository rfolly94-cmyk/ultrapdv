import "server-only";

import { resolverContextoAutorizadoEmpresa } from "@/lib/auth/contexto-autorizado";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErroTef } from "@/lib/pdv/tef/persistencia";
import {
  decidirValidacaoBiblioteca,
  type DecisaoValidacaoBiblioteca,
} from "@/lib/pdv/tef/prova-biblioteca";

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tabelaAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST205|42P01|does not exist|schema cache/i.test(texto);
}

function resposta(decisao: DecisaoValidacaoBiblioteca, efeito = decisao.efeito) {
  return {
    ok: efeito !== "recusar",
    efeito,
    motivo: decisao.motivo,
    instalacaoTecnica: decisao.instalacaoTecnica,
    ambienteBiblioteca: decisao.ambienteBiblioteca,
    adquirente: "desconhecida" as const,
    cobrancaLiberada: false as const,
    nfceLiberada: false as const,
  };
}

export async function validarProvaBibliotecaSessao(input: {
  dispositivoId: string;
  versao: number | null;
  campos: unknown;
  assinatura: string;
}): Promise<any> {
  void input;
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}

