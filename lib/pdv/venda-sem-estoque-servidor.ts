import "server-only";

import {
  filtrarRegistrosDaEmpresaAtiva,
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import { createClient } from "@/lib/supabase/server";

import {
  permitirVendaSemEstoqueDoRegistro,
  validarItensEstoquePdv,
} from "./venda-sem-estoque";

type ClienteConsulta = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabela: string) => any;
};

export async function permitirVendaSemEstoqueEmpresa(
  supabase: ClienteConsulta,
  empresaId: string
): Promise<boolean> {
  const id = String(empresaId ?? "").trim();
  if (!id) {
    return false;
  }

  const { data, error } = await supabase
    .from("pdv_configuracoes")
    .select("empresa_id, permitir_venda_sem_estoque")
    .eq("empresa_id", id)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  if (!registroPertenceAEmpresaAtiva(data, id)) {
    return false;
  }

  return permitirVendaSemEstoqueDoRegistro(
    (data as { permitir_venda_sem_estoque?: unknown }).permitir_venda_sem_estoque
  );
}

export async function validarEstoqueNaFinalizacaoPdv(params: {
  supabase: ClienteConsulta;
  empresaId: string;
  itens: Array<{ produtoId: string; quantidade: number }>;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const empresaId = String(params.empresaId ?? "").trim();
  if (!empresaId) {
    return { ok: false, erro: "Empresa ativa não encontrada." };
  }

  const permitir = await permitirVendaSemEstoqueEmpresa(
    params.supabase,
    empresaId
  );
  if (permitir) {
    return { ok: true };
  }

  const produtoIds = [
    ...new Set(params.itens.map((item) => item.produtoId)),
  ];

  const { data, error } = await params.supabase
    .from("estoque_atual")
    .select("empresa_id, produto_id, quantidade")
    .eq("empresa_id", empresaId)
    .in("produto_id", produtoIds);

  if (error) {
    return {
      ok: false,
      erro: "Não foi possível validar o estoque da venda.",
    };
  }

  const daEmpresa = filtrarRegistrosDaEmpresaAtiva(
    (data ?? []) as Array<{
      empresa_id?: string | null;
      produto_id: string;
      quantidade: number | string;
    }>,
    empresaId
  );

  const estoquePorProduto = new Map<string, number>(
    daEmpresa.map((item) => [item.produto_id, Number(item.quantidade)])
  );

  return validarItensEstoquePdv({
    permitirVendaSemEstoque: false,
    itens: params.itens,
    estoquePorProduto,
  });
}

export async function gravarPermitirVendaSemEstoqueSessao(permitir: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "rpc_definir_pdv_permitir_venda_sem_estoque",
    { p_permitir: permitir === true }
  );

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  const registro = data as {
    ok?: boolean;
    permitir_venda_sem_estoque?: boolean;
  } | null;

  if (!registro || registro.ok !== true) {
    return { ok: false as const, erro: "Não foi possível salvar a configuração." };
  }

  return {
    ok: true as const,
    permitirVendaSemEstoque: registro.permitir_venda_sem_estoque === true,
  };
}
