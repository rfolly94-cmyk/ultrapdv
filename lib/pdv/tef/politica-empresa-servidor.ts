import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import {
  ACAO_REGISTRAR_COMPROVACAO,
  decidirRegistroComprovacao,
  validarIdentificacaoCredenciamento,
  type SituacaoCredenciamento,
} from "@/lib/pdv/tef/credenciamento-comercial";
import {
  type AmbienteTefEmpresa,
  type ConfiguracaoTefEmpresa,
} from "@/lib/pdv/tef/politica-empresa";
import { classificarServidorComercial } from "@/lib/pdv/tef/servidor-comercial";

export type IdentidadeEmpresaTef = {
  empresaId: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
};

const VAZIA: ConfiguracaoTefEmpresa = {
  existe: false,
  habilitado: false,
  ambiente: "homologacao",
  producaoAutorizada: false,
  credenciamentoComprovado: false,
  referenciaCredenciamento: "",
  situacaoCredenciamento: "nao_informado",
  comprovadoEm: null,
  servidorComercial: "",
  servidorComercialValidado: false,
};

export async function identidadeEmpresaSessao(): Promise<IdentidadeEmpresaTef | null> {
  const sessao = await obterPermissoesSessao();
  if (!sessao) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, cnpj")
    .eq("id", sessao.empresaId)
    .maybeSingle();
  if (!data || String(data.id) !== sessao.empresaId) return null;
  return {
    empresaId: sessao.empresaId,
    razaoSocial: String(data.razao_social ?? ""),
    nomeFantasia: String(data.nome_fantasia ?? ""),
    cnpj: String(data.cnpj ?? ""),
  };
}

export async function carregarConfiguracaoMotor(empresaId: string): Promise<ConfiguracaoTefEmpresa> {
  try {
    const admin = createAdminClient();
    const consulta = await admin
      .from("tef_motor_empresas")
      .select("habilitado, ambiente, producao_autorizada, credenciamento_comprovado, provedor, referencia_credenciamento, situacao_validacao, comprovado_em, servidor_comercial, servidor_comercial_validado")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    const credenciamento = consulta.error
      ? await admin
          .from("tef_motor_empresas")
          .select("habilitado, ambiente, producao_autorizada, credenciamento_comprovado, provedor, referencia_credenciamento, situacao_validacao, comprovado_em")
          .eq("empresa_id", empresaId)
          .maybeSingle()
      : consulta;
    const data = credenciamento.error
      ? (await admin
          .from("tef_motor_empresas")
          .select("habilitado, ambiente, producao_autorizada")
          .eq("empresa_id", empresaId)
          .maybeSingle()).data
      : credenciamento.data;
    const error = consulta.error ? !data : false;
    if (error || !data) return VAZIA;
    const ambiente: AmbienteTefEmpresa = data.ambiente === "producao" ? "producao" : "homologacao";
    return {
      existe: true,
      habilitado: data.habilitado === true,
      ambiente,
      producaoAutorizada: data.producao_autorizada === true,
      credenciamentoComprovado:
        "credenciamento_comprovado" in data &&
        data.credenciamento_comprovado === true &&
        (!("situacao_validacao" in data) || data.situacao_validacao === "comprovado"),
      referenciaCredenciamento: "referencia_credenciamento" in data ? String(data.referencia_credenciamento ?? "") : "",
      situacaoCredenciamento: situacaoGravada("situacao_validacao" in data ? data.situacao_validacao : ""),
      comprovadoEm: "comprovado_em" in data && data.comprovado_em ? String(data.comprovado_em) : null,
      servidorComercial: "servidor_comercial" in data ? String(data.servidor_comercial ?? "") : "",
      servidorComercialValidado:
        "servidor_comercial_validado" in data &&
        data.servidor_comercial_validado === true &&
        classificarServidorComercial("servidor_comercial" in data ? data.servidor_comercial : "").ok,
    };
  } catch {
    return VAZIA;
  }
}

export async function salvarConfiguracaoMotor(input: { habilitado: boolean; ambiente: AmbienteTefEmpresa }) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return { ok: false as const, erro: "A empresa ativa não foi resolvida." };
  }
  if (sessao.perfil.trim().toLowerCase() !== "administrador") {
    return { ok: false as const, erro: "Somente o administrador da empresa pode alterar o TEF." };
  }
  const ambiente: AmbienteTefEmpresa = input.ambiente === "producao" ? "producao" : "homologacao";
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("tef_motor_empresas").upsert(
      {
        empresa_id: sessao.empresaId,
        habilitado: input.habilitado === true,
        ambiente,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id" }
    );
    if (error) {
      return { ok: false as const, erro: "Não foi possível salvar a configuração TEF desta empresa." };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, erro: "A configuração TEF por empresa ainda não está disponível neste ambiente." };
  }
}

function situacaoGravada(valor: unknown): SituacaoCredenciamento {
  return valor === "comprovado" || valor === "informado" ? valor : "nao_informado";
}

async function gravarCredenciamento(input: {
  empresaId: string;
  usuarioId: string;
  referencia: string;
  situacao: SituacaoCredenciamento;
  comprovado: boolean;
}) {
  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { error } = await admin.from("tef_motor_empresas").upsert(
    {
      empresa_id: input.empresaId,
      provedor: "PayGo",
      referencia_credenciamento: input.referencia,
      situacao_validacao: input.situacao,
      credenciamento_comprovado: input.comprovado,
      comprovado_por: input.comprovado ? input.usuarioId : null,
      comprovado_em: input.comprovado ? agora : null,
      updated_at: agora,
    },
    { onConflict: "empresa_id" }
  );
  if (error) {
    return { ok: false as const, erro: "Não foi possível gravar o credenciamento desta empresa." };
  }
  if (!input.comprovado) {
    return { ok: true as const, comprovadoEm: null as string | null };
  }
  const auditoria = await admin.from("tef_motor_credenciamento_auditoria").insert({
    empresa_id: input.empresaId,
    usuario_id: input.usuarioId,
    acao: "comprovacao_registrada",
    provedor: "PayGo",
    referencia: input.referencia,
  });
  if (auditoria.error) {
    await admin.from("tef_motor_empresas").update({
      credenciamento_comprovado: false,
      situacao_validacao: "informado",
      comprovado_por: null,
      comprovado_em: null,
    }).eq("empresa_id", input.empresaId);
    return { ok: false as const, erro: "A comprovação não foi registrada na auditoria." };
  }
  return { ok: true as const, comprovadoEm: agora };
}

export async function salvarIdentificacaoCredenciamento(referencia: string) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) return { ok: false as const, erro: "A empresa ativa não foi resolvida." };
  if (sessao.perfil.trim().toLowerCase() !== "administrador") {
    return { ok: false as const, erro: "Somente o administrador da empresa pode alterar o credenciamento." };
  }
  const identificacao = validarIdentificacaoCredenciamento(referencia);
  if (!identificacao.ok) return identificacao;
  const atual = await carregarConfiguracaoMotor(sessao.empresaId);
  if (atual.credenciamentoComprovado && atual.referenciaCredenciamento === identificacao.referencia) {
    return { ok: true as const, comprovado: true as const, situacao: "comprovado" as const, comprovadoEm: atual.comprovadoEm };
  }
  const gravado = await gravarCredenciamento({
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    referencia: identificacao.referencia,
    situacao: "informado",
    comprovado: false,
  });
  if (!gravado.ok) return gravado;
  return { ok: true as const, comprovado: false as const, situacao: "informado" as const, comprovadoEm: null };
}

export async function registrarComprovacaoCredenciamento(input: { referencia: string; acao: string }) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) return { ok: false as const, erro: "A empresa ativa não foi resolvida." };
  const decisao = decidirRegistroComprovacao({
    administrador: sessao.perfil.trim().toLowerCase() === "administrador",
    acao: input.acao,
    referencia: input.referencia,
  });
  if (!decisao.ok) return decisao;
  if (input.acao !== ACAO_REGISTRAR_COMPROVACAO) {
    return { ok: false as const, erro: "Preencher a referência não comprova o credenciamento." };
  }
  const gravado = await gravarCredenciamento({
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    referencia: decisao.referencia,
    situacao: "comprovado",
    comprovado: true,
  });
  if (!gravado.ok) return gravado;
  return {
    ok: true as const,
    comprovado: true as const,
    situacao: "comprovado" as const,
    comprovadoEm: gravado.comprovadoEm,
    producaoLiberada: false as const,
  };
}
