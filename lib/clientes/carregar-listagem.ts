import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";
import { createClient } from "@/lib/supabase/server";

import {
  agregarCarteiraPorCliente,
  buscaPareceUuidCliente,
  clientePassaNoFiltroListagem,
  contadoresListagemClientes,
  sanitizarBuscaCliente,
  situacaoCarteiraCliente,
  totalFinanceiroListagem,
  type ClienteListagem,
  type FiltroListagemClientes,
} from "./listagem";

export type { ClienteListagem };

const COLUNAS_CLIENTE = `
  id,
  empresa_id,
  nome,
  nome_fantasia,
  tipo_pessoa,
  cpf_cnpj,
  inscricao_estadual,
  contribuinte_icms,
  indicador_ie_destinatario,
  consumidor_final,
  telefone,
  email,
  cep,
  logradouro,
  numero,
  complemento,
  bairro,
  municipio,
  codigo_municipio_ibge,
  uf,
  limite_credito,
  saldo_devedor,
  bloqueado,
  dia_vencimento,
  observacao,
  ativo
`;

export async function carregarListagemClientes(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  busca: string;
  filtro: FiltroListagemClientes;
}): Promise<{
  clientes: ClienteListagem[];
  total: number;
  contadores: {
    debito: number;
    credito: number;
    vencidos: number;
  };
}> {
  const hojeIso = chaveDiaSaoPaulo(new Date());
  const buscaSegura = sanitizarBuscaCliente(input.busca);

  let query = input.supabase
    .from("clientes")
    .select(COLUNAS_CLIENTE)
    .eq("empresa_id", input.empresaId)
    .order("ativo", { ascending: false })
    .order("nome");

  if (buscaSegura) {
    const documento = buscaSegura.replace(/\D/g, "");
    const partes = [
      `nome.ilike.%${buscaSegura}%`,
      `nome_fantasia.ilike.%${buscaSegura}%`,
    ];
    if (documento) {
      partes.push(`cpf_cnpj.ilike.%${documento}%`);
      partes.push(`telefone.ilike.%${documento}%`);
    } else {
      partes.push(`cpf_cnpj.ilike.%${buscaSegura}%`);
      partes.push(`telefone.ilike.%${buscaSegura}%`);
    }
    if (buscaPareceUuidCliente(buscaSegura)) {
      partes.push(`id.eq.${buscaSegura}`);
    }
    query = query.or(partes.join(","));
  }

  const [clientesResult, titulosResult, creditosResult] = await Promise.all([
    query,
    input.supabase
      .from("carteira_cliente_titulos")
      .select("cliente_id, empresa_id, valor_aberto, status, vencimento")
      .eq("empresa_id", input.empresaId)
      .in("status", ["ABERTO", "PARCIAL"]),
    input.supabase
      .from("carteira_cliente_creditos")
      .select("cliente_id, empresa_id, valor_disponivel, status")
      .eq("empresa_id", input.empresaId)
      .in("status", ["DISPONIVEL", "PARCIAL"])
      .gt("valor_disponivel", 0),
  ]);

  if (clientesResult.error) {
    throw new Error(clientesResult.error.message);
  }
  if (titulosResult.error) {
    throw new Error(titulosResult.error.message);
  }
  if (creditosResult.error) {
    throw new Error(creditosResult.error.message);
  }

  const titulos = filtrarRegistrosDaEmpresaAtiva(
    titulosResult.data ?? [],
    input.empresaId
  );
  const creditos = filtrarRegistrosDaEmpresaAtiva(
    creditosResult.data ?? [],
    input.empresaId
  );
  const carteiraPorCliente = agregarCarteiraPorCliente({
    titulos,
    creditos,
    hojeIso,
  });

  const clientesEmpresa = filtrarRegistrosDaEmpresaAtiva(
    clientesResult.data ?? [],
    input.empresaId
  );

  const situacoesBusca = clientesEmpresa.map((cliente) =>
    situacaoCarteiraCliente({
      cliente,
      carteira: carteiraPorCliente.get(cliente.id),
    })
  );

  const clientes = clientesEmpresa
    .map((cliente, indice) => ({
      ...cliente,
      situacaoCarteira: situacoesBusca[indice]!,
    }))
    .filter((cliente) =>
      clientePassaNoFiltroListagem({
        filtro: input.filtro,
        cliente,
        situacao: cliente.situacaoCarteira,
      })
    );

  const situacoesEmpresa = [
    ...new Set([
      ...titulos.map((titulo) => titulo.cliente_id),
      ...creditos.map((credito) => credito.cliente_id),
    ]),
  ].map((clienteId) =>
    situacaoCarteiraCliente({
      cliente: { id: clienteId },
      carteira: carteiraPorCliente.get(clienteId),
    })
  );

  return {
    clientes,
    total: totalFinanceiroListagem({
      filtro: input.filtro,
      situacoes: clientes.map((cliente) => cliente.situacaoCarteira),
    }),
    contadores: contadoresListagemClientes(situacoesEmpresa),
  };
}
