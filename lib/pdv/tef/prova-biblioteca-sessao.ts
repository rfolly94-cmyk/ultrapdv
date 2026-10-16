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
}) {
  const ctx = await resolverContextoAutorizadoEmpresa();
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return {
        ok: false,
        efeito: "recusar" as const,
        motivo: "A validação da prova exige permissão de edição do financeiro.",
        instalacaoTecnica: "pendente" as const,
        ambienteBiblioteca: "ausente" as const,
        adquirente: "desconhecida" as const,
        cobrancaLiberada: false as const,
        nfceLiberada: false as const,
      };
    }
    throw error;
  }
  const dispositivoId = String(input.dispositivoId ?? "").trim().toLowerCase();
  if (!ID.test(dispositivoId)) {
    return resposta(
      decidirValidacaoBiblioteca({
        versao: 2,
        campos: input.campos,
        assinatura: input.assinatura,
        chavePublicaPem: "",
        empresaSessaoId: ctx.empresaId,
        dispositivoInformado: dispositivoId,
        terminal: null,
        dispositivoEmOutraEmpresa: false,
        pontoOficial: "",
        servidorOficial: "",
        ambienteOficial: "",
        registroExistente: null,
      })
    );
  }
  const cliente = createAdminClient();
  const terminais = await cliente
    .from("tef_terminais")
    .select("id, empresa_id, dispositivo_id, chave_publica, ativo")
    .eq("dispositivo_id", dispositivoId)
    .eq("ativo", true)
    .is("revogada_em", null);
  if (terminais.error) {
    throw new ErroTef("Não foi possível consultar o terminal da prova.", 500);
  }
  const linhas = terminais.data ?? [];
  const desta = linhas.find((linha) => String(linha.empresa_id) === ctx.empresaId) ?? null;
  const config = await cliente
    .from("tef_configuracoes")
    .select("ponto_captura, ambiente, servidor_producao, servidor_homologacao")
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (config.error) {
    throw new ErroTef("Não foi possível consultar a configuração TEF da empresa.", 500);
  }
  const ambienteOficial = config.data?.ambiente === "producao" ? "producao" : config.data?.ambiente === "homologacao" ? "homologacao" : "";
  const servidorOficial =
    ambienteOficial === "producao"
      ? String(config.data?.servidor_producao ?? "")
      : String(config.data?.servidor_homologacao ?? "");
  let registroExistente: { assinaturaSha256: string; terminalId: string; empresaId: string } | null = null;
  let auditoriaIndisponivel = false;
  if (desta?.id) {
    const registro = await cliente
      .from("tef_validacoes_biblioteca")
      .select("assinatura_sha256, terminal_id, empresa_id")
      .eq("empresa_id", ctx.empresaId)
      .eq("terminal_id", desta.id)
      .is("revogada_em", null)
      .maybeSingle();
    if (registro.error) {
      if (!tabelaAusente(registro.error)) {
        throw new ErroTef("Não foi possível consultar a validação técnica.", 500);
      }
      auditoriaIndisponivel = true;
    } else if (registro.data) {
      registroExistente = {
        assinaturaSha256: String(registro.data.assinatura_sha256 ?? ""),
        terminalId: String(registro.data.terminal_id),
        empresaId: String(registro.data.empresa_id),
      };
    }
  }
  const decisao = decidirValidacaoBiblioteca({
    versao: input.versao,
    campos: input.campos,
    assinatura: input.assinatura,
    chavePublicaPem: desta?.chave_publica ? String(desta.chave_publica) : "",
    empresaSessaoId: ctx.empresaId,
    dispositivoInformado: dispositivoId,
    terminal: desta
      ? {
          id: String(desta.id),
          empresaId: String(desta.empresa_id),
          dispositivoId: String(desta.dispositivo_id),
        }
      : null,
    dispositivoEmOutraEmpresa: linhas.some((linha) => String(linha.empresa_id) !== ctx.empresaId),
    pontoOficial: String(config.data?.ponto_captura ?? ""),
    servidorOficial,
    ambienteOficial,
    registroExistente,
  });
  if (decisao.efeito === "registrar" && auditoriaIndisponivel) {
    return {
      ...resposta(decisao, "recusar"),
      ok: false,
      instalacaoTecnica: "pendente" as const,
      motivo:
        "A assinatura v2 confere com a chave do terminal, mas o registro de auditoria ainda não existe neste banco. A migration 20261013180000_tef_validacao_biblioteca.sql não foi aplicada. A cobrança e a NFC-e não foram liberadas.",
    };
  }
  if (decisao.efeito !== "registrar" || !decisao.campos) {
    return resposta(decisao);
  }
  const inclusao = await cliente.from("tef_validacoes_biblioteca").insert({
    empresa_id: ctx.empresaId,
    dispositivo_id: dispositivoId,
    terminal_id: desta?.id,
    ponto_captura: decisao.campos.pontoCaptura,
    servidor: decisao.campos.servidor,
    ambiente: decisao.campos.ambiente,
    diretorio: decisao.campos.diretorio,
    retorno_set_environment: decisao.campos.retornoSetEnvironment,
    codigo_ambiente: decisao.campos.codigoAmbiente,
    assinatura_sha256: decisao.assinaturaSha256,
    assinatura: String(input.assinatura).trim(),
  });
  if (inclusao.error) {
    if (tabelaAusente(inclusao.error)) {
      return {
        ...resposta(decisao, "recusar"),
        ok: false,
        instalacaoTecnica: "pendente" as const,
        motivo:
          "A assinatura v2 confere com a chave do terminal, mas o registro de auditoria ainda não existe neste banco. A migration 20261013180000_tef_validacao_biblioteca.sql não foi aplicada. A cobrança e a NFC-e não foram liberadas.",
      };
    }
    if (inclusao.error.code === "23505") {
      const atual = await cliente
        .from("tef_validacoes_biblioteca")
        .select("assinatura_sha256, terminal_id, empresa_id")
        .eq("empresa_id", ctx.empresaId)
        .eq("terminal_id", desta?.id)
        .is("revogada_em", null)
        .maybeSingle();
      if (atual.data?.assinatura_sha256 === decisao.assinaturaSha256) {
        return resposta({
          ...decisao,
          efeito: "ja_registrada",
          motivo: "Esta prova já foi registrada para este terminal. Nenhuma instalação foi repetida.",
        });
      }
      return resposta({
        ...decisao,
        efeito: "recusar",
        instalacaoTecnica: "pendente",
        ambienteBiblioteca: "ausente",
        motivo: "Já existe uma validação técnica para este terminal. Esta prova não substitui a anterior.",
      });
    }
    throw new ErroTef("Não foi possível registrar a validação técnica.", 500);
  }
  return resposta(decisao);
}
