"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  CODIGOS_TIPO_OPERACAO_INTERNO,
  ehFinNfeSuportada,
  ehTpNf,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  ehTipoDestinoCfop,
  type TipoDestinoCfop,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  CFOPS_INTERESTADUAIS,
  CFOPS_INTERNOS,
  existeCodigo,
} from "@/lib/fiscal/tabelas-fiscais";

const BASE = "/configuracoes/fiscal/naturezas";

function irComErro(mensagem: string): never {
  redirect(`${BASE}?erro=${encodeURIComponent(mensagem)}`);
}

function irComSucesso(mensagem: string): never {
  redirect(`${BASE}?sucesso=${encodeURIComponent(mensagem)}`);
}

async function getContextoAdministrador() {
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo, error } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !vinculo) {
    redirect("/onboarding");
  }

  try {
    await exigirPermissao({ modulo: "fiscal", acao: "configurar_fiscal" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      irComErro(error.message);
    }
    throw error;
  }

  return {
    empresaId: vinculo.empresa_id,
    admin: createAdminClient(),
  };
}

function campo(formData: FormData, nome: string) {
  return String(formData.get(nome) ?? "").trim();
}

function lerNaturezaForm(formData: FormData) {
  const descricao = campo(formData, "descricao");
  const tipoOperacaoInterno = campo(formData, "tipo_operacao_interno");
  const tpNf = campo(formData, "tp_nf");
  const finNfe = campo(formData, "fin_nfe");
  const padrao = campo(formData, "padrao") === "true";
  const ativo = campo(formData, "ativo") !== "false";

  if (descricao.length < 1 || descricao.length > 60) {
    irComErro("A descrição da natureza deve ter entre 1 e 60 caracteres.");
  }

  if (
    !CODIGOS_TIPO_OPERACAO_INTERNO.includes(
      tipoOperacaoInterno as (typeof CODIGOS_TIPO_OPERACAO_INTERNO)[number]
    )
  ) {
    irComErro("Selecione um tipo de operação interno válido.");
  }

  if (!ehTpNf(tpNf)) {
    irComErro("Selecione entrada (0) ou saída (1).");
  }

  if (!ehFinNfeSuportada(finNfe)) {
    irComErro(
      "A finalidade fiscal deve ser 1 (Normal), 2 (Complementar), 3 (Ajuste) ou 4 (Devolução)."
    );
  }

  return {
    descricao,
    tipo_operacao_interno: tipoOperacaoInterno,
    tp_nf: tpNf,
    fin_nfe: finNfe,
    padrao,
    ativo,
  };
}

function cfopValidoNaMatriz(
  cfop: string,
  tipoDestino: TipoDestinoCfop
) {
  if (tipoDestino === "interna") {
    return existeCodigo(CFOPS_INTERNOS, cfop);
  }

  return existeCodigo(CFOPS_INTERESTADUAIS, cfop);
}

async function persistirRegrasCfopNatureza(params: {
  admin: ReturnType<typeof createAdminClient>;
  empresaId: string;
  naturezaId: string;
  formData: FormData;
}) {
  const { admin, empresaId, naturezaId, formData } = params;

  const { data: natureza, error: naturezaError } = await admin
    .from("fiscal_naturezas_operacao")
    .select("id, empresa_id")
    .eq("id", naturezaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (
    naturezaError ||
    !natureza ||
    !registroPertenceAEmpresaAtiva(natureza, empresaId)
  ) {
    irComErro("Natureza de operação não encontrada nesta empresa.");
  }

  const { data: grupos, error: gruposError } = await admin
    .from("grupos_fiscais")
    .select("id, empresa_id")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);

  if (gruposError) {
    irComErro(gruposError.message);
  }

  const gruposDaEmpresa = (grupos ?? []).filter((grupo) =>
    registroPertenceAEmpresaAtiva(grupo, empresaId)
  );

  const { data: regrasAtuais, error: regrasError } = await admin
    .from("fiscal_natureza_cfop_regras")
    .select("id, empresa_id, grupo_fiscal_id, tipo_destino, ativo")
    .eq("empresa_id", empresaId)
    .eq("natureza_id", naturezaId);

  if (regrasError) {
    irComErro(regrasError.message);
  }

  const regrasDaEmpresa = (regrasAtuais ?? []).filter((regra) =>
    registroPertenceAEmpresaAtiva(regra, empresaId)
  );

  for (const grupo of gruposDaEmpresa) {
    for (const tipoDestino of ["interna", "interestadual"] as const) {
      const cfop = campo(formData, `cfop_${tipoDestino}_${grupo.id}`);
      const existente = regrasDaEmpresa.find(
        (regra) =>
          regra.grupo_fiscal_id === grupo.id &&
          ehTipoDestinoCfop(regra.tipo_destino) &&
          regra.tipo_destino === tipoDestino
      );

      if (!cfop) {
        if (existente?.ativo) {
          const { error } = await admin
            .from("fiscal_natureza_cfop_regras")
            .update({ ativo: false })
            .eq("id", existente.id)
            .eq("empresa_id", empresaId)
            .eq("natureza_id", naturezaId);

          if (error) {
            irComErro(error.message);
          }
        }
        continue;
      }

      if (!cfopValidoNaMatriz(cfop, tipoDestino)) {
        irComErro(
          `CFOP ${cfop} inválido para operação ${
            tipoDestino === "interna" ? "interna" : "interestadual"
          }. Use o catálogo fiscal (5xxx interna / 6xxx interestadual).`
        );
      }

      if (existente) {
        const { error } = await admin
          .from("fiscal_natureza_cfop_regras")
          .update({
            cfop,
            ativo: true,
          })
          .eq("id", existente.id)
          .eq("empresa_id", empresaId)
          .eq("natureza_id", naturezaId);

        if (error) {
          irComErro(error.message);
        }
        continue;
      }

      const { error } = await admin
        .from("fiscal_natureza_cfop_regras")
        .insert({
          empresa_id: empresaId,
          natureza_id: naturezaId,
          grupo_fiscal_id: grupo.id,
          tipo_destino: tipoDestino,
          cfop,
          ativo: true,
        });

      if (error) {
        irComErro(error.message);
      }
    }
  }
}

export async function salvarNaturezaOperacao(formData: FormData) {
  const { empresaId, admin } = await getContextoAdministrador();
  const id = campo(formData, "id");
  const dados = lerNaturezaForm(formData);

  if (id) {
    const { data: atual, error: atualError } = await admin
      .from("fiscal_naturezas_operacao")
      .select("id, empresa_id")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (
      atualError ||
      !atual ||
      !registroPertenceAEmpresaAtiva(atual, empresaId)
    ) {
      irComErro("Natureza de operação não encontrada nesta empresa.");
    }

    const { error } = await admin
      .from("fiscal_naturezas_operacao")
      .update(dados)
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (error) {
      irComErro(error.message);
    }

    await persistirRegrasCfopNatureza({
      admin,
      empresaId,
      naturezaId: id,
      formData,
    });

    revalidatePath(BASE);
    irComSucesso("Natureza de operação atualizada.");
  }

  const { error } = await admin.from("fiscal_naturezas_operacao").insert({
    ...dados,
    empresa_id: empresaId,
  });

  if (error) {
    irComErro(error.message);
  }

  revalidatePath(BASE);
  irComSucesso("Natureza de operação cadastrada.");
}

export async function alternarNaturezaOperacao(formData: FormData) {
  const { empresaId, admin } = await getContextoAdministrador();
  const id = campo(formData, "id");
  const ativo = campo(formData, "ativo") === "true";

  if (!id) {
    irComErro("Natureza inválida.");
  }

  const { data: atual, error: atualError } = await admin
    .from("fiscal_naturezas_operacao")
    .select("id, empresa_id")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (
    atualError ||
    !atual ||
    !registroPertenceAEmpresaAtiva(atual, empresaId)
  ) {
    irComErro("Natureza de operação não encontrada nesta empresa.");
  }

  const { error } = await admin
    .from("fiscal_naturezas_operacao")
    .update({ ativo })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    irComErro(error.message);
  }

  revalidatePath(BASE);
  irComSucesso(
    ativo
      ? "Natureza de operação ativada."
      : "Natureza de operação desativada."
  );
}

export async function definirNaturezaPadrao(formData: FormData) {
  const { empresaId, admin } = await getContextoAdministrador();
  const id = campo(formData, "id");

  if (!id) {
    irComErro("Natureza inválida.");
  }

  const { data: natureza, error: naturezaError } = await admin
    .from("fiscal_naturezas_operacao")
    .select("id, ativo, empresa_id")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (
    naturezaError ||
    !natureza ||
    !registroPertenceAEmpresaAtiva(natureza, empresaId)
  ) {
    irComErro("Natureza de operação não encontrada nesta empresa.");
  }

  if (!natureza.ativo) {
    irComErro("Ative a natureza antes de defini-la como padrão.");
  }

  const { error } = await admin
    .from("fiscal_naturezas_operacao")
    .update({ padrao: true })
    .eq("id", id)
    .eq("empresa_id", empresaId);

  if (error) {
    irComErro(error.message);
  }

  revalidatePath(BASE);
  irComSucesso("Natureza definida como padrão deste tipo de operação.");
}
