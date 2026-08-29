import { redirect } from "next/navigation";

import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { NfeRascunhosWorkspace } from "@/components/vendas/nfe-rascunhos-workspace";
import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  montarItemListaRascunhoNfe55,
  STATUS_RASCUNHO_NFE55,
} from "@/lib/fiscal/nfe55/rascunhos-nfe";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rascunhos NF-e",
};

function idsUnicos(valores: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      valores.filter(
        (valor): valor is string => typeof valor === "string" && valor.length > 0
      )
    )
  );
}

export default async function RascunhosNfePage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);
  const plano = await planoPermiteRecursoEmpresa(empresaId, "nfe");
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(empresaId);
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="NF-e"
            descricao="A emissão de NF-e não está disponível no plano atual da sua empresa. Rascunhos já salvos não são apagados."
            planoNome={entitlements.planoNome}
            voltarHref="/vendas"
            voltarLabel="Voltar para Vendas"
          />
        </div>
      </main>
    );
  }

  const pedidosNovosResult = await supabase
    .from("catalogo_pedidos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("status", "NOVO");

  const { data: operacoes, error } = await supabase
    .from("fiscal_operacoes")
    .select(
      `
      id,
      empresa_id,
      status,
      natureza_descricao,
      destinatario_tipo,
      destinatario_id,
      destino_empresa_id,
      snapshot_fiscal,
      created_by,
      created_at,
      updated_at
    `
    )
    .eq("empresa_id", empresaId)
    .in("status", [...STATUS_RASCUNHO_NFE55])
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Erro ao listar rascunhos de NF-e: ${error.message}`);
  }

  const rascunhosSeguros = filtrarRegistrosDaEmpresaAtiva(
    operacoes ?? [],
    empresaId
  );

  const operacaoIds = rascunhosSeguros.map((item) => item.id);
  const clienteIds = idsUnicos(
    rascunhosSeguros
      .filter((item) => item.destinatario_tipo === "cliente")
      .map((item) => item.destinatario_id)
  );
  const destinoIds = idsUnicos(
    rascunhosSeguros.map((item) => item.destino_empresa_id)
  );
  const usuarioIds = idsUnicos(
    rascunhosSeguros.map((item) => item.created_by)
  );

  const [{ data: itens }, { data: clientes }, { data: destinos }, { data: usuarios }] =
    await Promise.all([
      operacaoIds.length > 0
        ? supabase
            .from("fiscal_operacoes_itens")
            .select("operacao_id, empresa_id, valor_total")
            .eq("empresa_id", empresaId)
            .in("operacao_id", operacaoIds)
        : Promise.resolve({ data: [] as Array<{
            operacao_id: string;
            empresa_id: string;
            valor_total: number | string;
          }> }),
      clienteIds.length > 0
        ? supabase
            .from("clientes")
            .select("id, nome")
            .eq("empresa_id", empresaId)
            .in("id", clienteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nome: string }> }),
      destinoIds.length > 0
        ? supabase
            .from("empresas")
            .select("id, razao_social, nome_fantasia")
            .in("id", destinoIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              razao_social: string | null;
              nome_fantasia: string | null;
            }>,
          }),
      usuarioIds.length > 0
        ? supabase.from("usuarios").select("id, nome").in("id", usuarioIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nome: string | null }> }),
    ]);

  const itensSeguros = filtrarRegistrosDaEmpresaAtiva(itens ?? [], empresaId);
  const totaisPorOperacao = new Map<string, { quantidade: number; produtos: number }>();
  for (const item of itensSeguros) {
    const atual = totaisPorOperacao.get(item.operacao_id) ?? {
      quantidade: 0,
      produtos: 0,
    };
    atual.quantidade += 1;
    atual.produtos += Number(item.valor_total ?? 0);
    totaisPorOperacao.set(item.operacao_id, atual);
  }

  const clientePorId = new Map(
    (clientes ?? []).map((cliente) => [cliente.id, cliente.nome])
  );
  const destinoPorId = new Map(
    (destinos ?? []).map((empresa) => [
      empresa.id,
      String(empresa.nome_fantasia || empresa.razao_social || "").trim(),
    ])
  );
  const usuarioPorId = new Map(
    (usuarios ?? []).map((usuario) => [usuario.id, String(usuario.nome ?? "").trim()])
  );

  const rascunhos = rascunhosSeguros
    .map((operacao) => {
      const totais = totaisPorOperacao.get(operacao.id);
      const destinatarioNome =
        operacao.destinatario_tipo === "estabelecimento"
          ? destinoPorId.get(String(operacao.destino_empresa_id ?? "")) ?? null
          : clientePorId.get(String(operacao.destinatario_id ?? "")) ?? null;
      return montarItemListaRascunhoNfe55({
        id: String(operacao.id),
        status: String(operacao.status),
        naturezaDescricao: operacao.natureza_descricao,
        snapshotFiscal: operacao.snapshot_fiscal,
        createdAt: operacao.created_at,
        updatedAt: operacao.updated_at,
        destinatarioNome,
        usuarioNome: usuarioPorId.get(String(operacao.created_by ?? "")) ?? null,
        quantidadeItens: totais?.quantidade ?? 0,
        totalProdutos: totais?.produtos ?? 0,
      });
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <NfeRascunhosWorkspace
      rascunhos={rascunhos}
      rascunhosNfe={rascunhos.length}
      pedidosNovos={
        pedidosNovosResult.error ? 0 : (pedidosNovosResult.count ?? 0)
      }
    />
  );
}
