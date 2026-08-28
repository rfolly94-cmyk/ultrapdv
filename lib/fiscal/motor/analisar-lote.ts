import type { SupabaseClient } from "@supabase/supabase-js";

import { regraVigenteEm } from "@/lib/fiscal/base-oficial/tipos";
import { listarRegrasNcmAtivas } from "@/lib/fiscal/base-oficial/consultar";
import { ncmOitoDigitos } from "./tipos";

export async function analisarGruposFiscaisProdutos(params: {
  supabase: SupabaseClient;
  empresaId: string;
  dataReferencia: string;
}) {
  const { data: produtos } = await params.supabase
    .from("produtos")
    .select(
      "id, empresa_id, nome, grupo_fiscal_id, produtos_fiscal ( ncm, cest, origem_produto )"
    )
    .eq("empresa_id", params.empresaId)
    .eq("ativo", true)
    .limit(500);

  const daEmpresa = (produtos ?? []).filter(
    (item) => String(item.empresa_id) === params.empresaId
  );

  const { data: grupos } = await params.supabase
    .from("grupos_fiscais")
    .select(
      "id, empresa_id, nome, ativo, icms_cst_csosn, cst_ibscbs, classificacao_ibscbs"
    )
    .eq("empresa_id", params.empresaId);

  const gruposEmpresa = (grupos ?? []).filter(
    (item) => String(item.empresa_id) === params.empresaId
  );
  const gruposPorId = new Map(gruposEmpresa.map((item) => [String(item.id), item]));

  const ncmCodigos = [
    ...new Set(
      daEmpresa
        .map((item) => {
          const fiscal = Array.isArray(item.produtos_fiscal)
            ? item.produtos_fiscal[0]
            : item.produtos_fiscal;
          return ncmOitoDigitos(fiscal?.ncm);
        })
        .filter((item): item is string => Boolean(item))
    ),
  ];

  const regrasNcm = ncmCodigos.length
    ? (
        await Promise.all(
          ncmCodigos.slice(0, 80).map((codigo) =>
            listarRegrasNcmAtivas({
              supabase: params.supabase,
              codigo,
              limite: 3,
            })
          )
        )
      ).flat()
    : [];

  const ncmExtinto: Array<{ id: string; nome: string; ncm: string }> = [];
  const grupoIncompativel: Array<{ id: string; nome: string; motivo: string }> = [];
  const ibsNaoPreparados: Array<{ id: string; nome: string }> = [];
  const revisao: Array<{ id: string; nome: string; motivos: string[] }> = [];

  for (const produto of daEmpresa) {
    const fiscal = Array.isArray(produto.produtos_fiscal)
      ? produto.produtos_fiscal[0]
      : produto.produtos_fiscal;
    const ncm = ncmOitoDigitos(fiscal?.ncm);
    const motivos: string[] = [];
    const grupo = produto.grupo_fiscal_id
      ? gruposPorId.get(String(produto.grupo_fiscal_id))
      : null;

    if (ncm && regrasNcm.length > 0) {
      const regra = regrasNcm.find((item) => item.codigo === ncm);
      if (!regra) {
        ncmExtinto.push({ id: String(produto.id), nome: String(produto.nome), ncm });
        motivos.push(`NCM ${ncm} inexistente na base oficial vigente.`);
      } else if (
        !regraVigenteEm(
          { vigenciaInicio: regra.vigenciaInicio, vigenciaFim: regra.vigenciaFim },
          params.dataReferencia
        )
      ) {
        ncmExtinto.push({ id: String(produto.id), nome: String(produto.nome), ncm });
        motivos.push(`NCM ${ncm} extinto em ${params.dataReferencia}.`);
      }
    } else if (!ncm) {
      motivos.push("NCM ausente.");
    }

    if (!grupo) {
      motivos.push("Sem grupo fiscal da empresa.");
    } else if (!grupo.ativo) {
      grupoIncompativel.push({
        id: String(produto.id),
        nome: String(produto.nome),
        motivo: `Grupo ${grupo.nome} inativo.`,
      });
      motivos.push("Grupo fiscal inativo.");
    }

    if (grupo && (!grupo.cst_ibscbs || !grupo.classificacao_ibscbs)) {
      ibsNaoPreparados.push({
        id: String(grupo.id),
        nome: String(grupo.nome),
      });
      motivos.push("Grupo sem CST IBS/CBS ou cClassTrib.");
    }

    if (motivos.length) {
      revisao.push({
        id: String(produto.id),
        nome: String(produto.nome),
        motivos,
      });
    }
  }

  const gruposIbs = [...new Map(ibsNaoPreparados.map((item) => [item.id, item])).values()];

  return {
    totalProdutos: daEmpresa.length,
    precisamRevisao: revisao.slice(0, 40),
    quantidadeRevisao: revisao.length,
    ncmExtinto: ncmExtinto.slice(0, 40),
    gruposIncompativeis: grupoIncompativel.slice(0, 40),
    gruposSemIbsCbs: gruposIbs.slice(0, 40),
    aviso:
      daEmpresa.length >= 500
        ? "Análise limitada aos 500 primeiros produtos ativos da empresa."
        : null,
  };
}
