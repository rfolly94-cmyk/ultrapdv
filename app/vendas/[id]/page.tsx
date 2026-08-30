import Link from "next/link";
import {
  notFound,
  redirect,
} from "next/navigation";

import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import { createClient } from "@/lib/supabase/server";
import { CancelarVendaComercial } from "@/components/vendas/cancelar-venda-comercial";
import { TransporteVendaForm } from "@/components/vendas/transporte-venda-form";
import { ReservaFiscalPendente } from "@/components/vendas/reserva-fiscal-pendente";
import { EmitirNfceContingenciaButton } from "@/components/vendas/emitir-nfce-contingencia-button";
import { NfceContingenciaCard } from "@/components/vendas/nfce-contingencia-card";
import { ReconciliarEmissaoFiscal } from "@/components/vendas/reconciliar-emissao-fiscal";
import { InutilizarNumeracaoFiscal } from "@/components/vendas/inutilizar-numeracao-fiscal";
import { EmissaoFiscalAcoes } from "@/components/fiscal/emissao-fiscal-acoes";
import { EmissaoFiscalHistorico } from "@/components/fiscal/emissao-fiscal-historico";
import { PageAlert } from "@/components/ui/page-alert";
import {
  escolherEmissaoFiscalVenda,
  escolherStatusFiscalVenda,
  mensagemFeedbackEmissaoVenda,
  resolverOrigemVendaComercial,
  resolverRotaEdicaoVenda,
  rotuloOrigemVendaComercial,
} from "@/lib/vendas/resolver-rota-edicao-venda";
import {
  resolverPoliticaCancelamentoFiscal,
  serializarPoliticaCancelamento,
} from "@/lib/fiscal/politica-cancelamento";
import {
  classificacaoResumoDaEmissao,
  resolverApresentacaoEmissaoFiscal,
} from "@/lib/fiscal/apresentacao-emissao";
import {
  vendaPossuiDocumentoFiscalBloqueante,
  vendaPossuiTransporteFiscalBloqueante,
} from "@/lib/fiscal/estado-operacional-fiscal";
import { consolidarEvidencia539 } from "@/lib/fiscal/geranet/cstat";
import { ultimaTentativaFiscal } from "@/lib/fiscal/emissao-tentativas";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { nomeProvedorPix } from "@/lib/pagamentos/pix/provedores-geranet";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import {
  conferenciaFinanceiraVenda,
  filtrarPagamentosFinanceiros,
  filtrarPagamentosHistorico,
} from "@/lib/vendas/pagamentos-financeiros";

export const dynamic = "force-dynamic";

const moeda =
  new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  );

function formatarData(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle: "short",
      timeStyle: "short",
    }
  ).format(data);
}

function textoStatus(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  return valor
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (letra) =>
        letra.toUpperCase()
    );
}

function modeloFiscal(
  modelo:
    | string
    | null
) {
  if (modelo === "65") {
    return "NFC-e (65)";
  }

  if (modelo === "55") {
    return "NF-e (55)";
  }

  return "Não definido";
}

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    emissao?: string;
  }>;
};

export default async function VendaDetalhePage({
  params,
  searchParams,
}: PageProps) {
  const { id } =
    await params;
  const query =
    await searchParams;

  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } = await supabase.auth.getClaims();

  const authUserId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !authUserId
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(authUserId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "vendas"
  );
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(
      String(vinculo.empresa_id)
    );
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Vendas"
            descricao="Este recurso não está disponível no plano atual da sua empresa. A visualização do histórico comercial de vendas está disponível em planos que incluem este recurso. As vendas já registradas não são apagadas. Emissão fiscal, recibo e DANFE continuam nos recursos fiscais correspondentes, e o PDV segue independente."
            planoNome={entitlements.planoNome}
            voltarHref="/pdv"
            voltarLabel="Ir ao PDV"
          />
        </div>
      </main>
    );
  }

  const {
    data: venda,
    error: vendaError,
  } = await supabase
    .from("vendas")
    .select(`
      id,
      numero,
      empresa_id,
      cliente_id,
      usuario_id,
      status,
      tipo_venda,
      modelo_fiscal_intencao,
      valor_produtos,
      desconto,
      acrescimo,
      frete,
      dados_transporte,
      valor_total,
      troco,
      observacao,
      finalizada_at,
      cancelada_at,
      motivo_cancelamento,
      created_at
    `)
    .eq("id", id)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .maybeSingle();

  if (vendaError) {
    throw new Error(
      `Erro ao carregar venda: ${vendaError.message}`
    );
  }

  if (!venda) {
    notFound();
  }

  const {
    data: operacaoVenda,
  } = await supabase
    .from("fiscal_operacoes")
    .select("id")
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .eq(
      "venda_id",
      venda.id
    )
    .eq(
      "tipo_operacao_interno",
      "venda"
    )
    .limit(1)
    .maybeSingle();

  let clienteNome =
    "Consumidor";

  if (venda.cliente_id) {
    const {
      data: cliente,
    } = await supabase
      .from("clientes")
      .select(`
        nome,
        cpf_cnpj,
        telefone,
        email
      `)
      .eq(
        "id",
        venda.cliente_id
      )
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

    if (cliente?.nome) {
      clienteNome =
        cliente.nome;
    }
  }

  let usuarioNome = "—";

  if (venda.usuario_id) {
    const {
      data: usuario,
    } = await supabase
      .from("usuarios")
      .select("nome")
      .eq(
        "id",
        venda.usuario_id
      )
      .maybeSingle();

    if (usuario?.nome) {
      usuarioNome =
        usuario.nome;
    }
  }

  const {
    data:
      transportadorasCadastro,
    error:
      transportadorasCadastroError,
  } =
    await supabase
      .from(
        "transportadoras"
      )
      .select(`
        id,
        nome_razao_social,
        nome_fantasia,
        cpf_cnpj,
        inscricao_estadual,
        rntrc,
        telefone,
        email,
        logradouro,
        numero,
        complemento,
        bairro,
        municipio,
        codigo_municipio_ibge,
        uf,
        cep
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "ativo",
        true
      )
      .order(
        "nome_razao_social",
        {
          ascending:
            true,
        }
      );

  if (
    transportadorasCadastroError
  ) {
    throw new Error(
      `Erro ao carregar transportadoras: ${transportadorasCadastroError.message}`
    );
  }

  const transportadorasIds =
    (
      transportadorasCadastro ??
      []
    ).map(
      (item) =>
        item.id
    );

  let veiculosCadastro:
    Array<{
      id: string;
      transportadora_id: string;
      placa: string;
      uf:
        | string
        | null;
      rntrc:
        | string
        | null;
      descricao:
        | string
        | null;
    }> = [];

  if (
    transportadorasIds.length >
    0
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "transportadoras_veiculos"
        )
        .select(`
          id,
          transportadora_id,
          placa,
          uf,
          rntrc,
          descricao
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "ativo",
          true
        )
        .in(
          "transportadora_id",
          transportadorasIds
        )
        .order(
          "placa",
          {
            ascending:
              true,
          }
        );

    if (error) {
      throw new Error(
        `Erro ao carregar veículos das transportadoras: ${error.message}`
      );
    }

    veiculosCadastro =
      data ?? [];
  }

  const transportadorasParaVenda =
    (
      transportadorasCadastro ??
      []
    ).map(
      (transportadora) => ({
        id:
          transportadora.id,
        nome_razao_social:
          transportadora
            .nome_razao_social,
        nome_fantasia:
          transportadora
            .nome_fantasia ??
          "",
        cpf_cnpj:
          transportadora
            .cpf_cnpj,
        inscricao_estadual:
          transportadora
            .inscricao_estadual ??
          "",
        rntrc:
          transportadora.rntrc ??
          "",
        telefone:
          transportadora.telefone ??
          "",
        email:
          transportadora.email ??
          "",
        logradouro:
          transportadora.logradouro ??
          "",
        numero:
          transportadora.numero ??
          "",
        complemento:
          transportadora.complemento ??
          "",
        bairro:
          transportadora.bairro ??
          "",
        municipio:
          transportadora.municipio ??
          "",
        codigo_municipio_ibge:
          transportadora
            .codigo_municipio_ibge ??
          "",
        uf:
          transportadora.uf ??
          "",
        cep:
          transportadora.cep ??
          "",
        veiculos:
          veiculosCadastro
            .filter(
              (veiculo) =>
                veiculo
                  .transportadora_id ===
                transportadora.id
            )
            .map(
              (veiculo) => ({
                id:
                  veiculo.id,
                placa:
                  veiculo.placa,
                uf:
                  veiculo.uf ??
                  "",
                rntrc:
                  veiculo.rntrc ??
                  "",
                descricao:
                  veiculo.descricao ??
                  "",
              })
            ),
      })
    );

  const {
    data: itens,
    error: itensError,
  } = await supabase
    .from("vendas_itens")
    .select(`
      id,
      produto_id,
      produto_codigo,
      produto_nome,
      unidade_medida,
      quantidade,
      valor_unitario,
      desconto,
      acrescimo,
      valor_total
    `)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .eq("venda_id", id)
    .order(
      "created_at",
      { ascending: true }
    );

  if (itensError) {
    throw new Error(
      `Erro ao carregar itens da venda: ${itensError.message}`
    );
  }

  const {
    data: pagamentos,
    error: pagamentosError,
  } = await supabase
    .from("vendas_pagamentos")
    .select(`
      id,
      forma_pagamento_nome,
      forma_pagamento_codigo,
      codigo_fiscal,
      valor,
      quantidade_parcelas,
      indicador_pagamento,
      bandeira,
      autorizacao,
      troco,
      status
    `)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .eq("venda_id", id)
    .order(
      "created_at",
      { ascending: true }
    );

  if (pagamentosError) {
    throw new Error(
      `Erro ao carregar pagamentos: ${pagamentosError.message}`
    );
  }

  const { data: pixLocais } = await supabase
    .from("cobrancas_pix")
    .select(
      "id, venda_pagamento_id, txid, valor, status, modo_pix, provedor, confirmado_manualmente, confirmado_por, confirmado_em, pago_em"
    )
    .eq("empresa_id", vinculo.empresa_id)
    .eq("venda_id", id)
    .in("modo_pix", ["local_manual", "geranet"]);

  const confirmadoresIds = [
    ...new Set(
      (pixLocais ?? [])
        .map((item) => item.confirmado_por)
        .filter((item): item is string => Boolean(item))
    ),
  ];

  const { data: confirmadores } =
    confirmadoresIds.length > 0
      ? await supabase
          .from("usuarios")
          .select("id, nome")
          .in("id", confirmadoresIds)
      : { data: [] as Array<{ id: string; nome: string | null }> };

  const nomesConfirmadores = new Map(
    (confirmadores ?? []).map((usuario) => [usuario.id, usuario.nome])
  );

  const {
    data: emissoesFiscais,
    error: emissoesFiscaisError,
  } = await supabase
    .from("fiscal_emissoes")
    .select(`
      id,
      modelo,
      serie,
      numero,
      ambiente,
      status,
      tipo_emissao,
      contingencia_justificativa,
      contingencia_gerada_at,
      contingencia_transmitida_at,
      contingencia_tentativas,
      contingencia_erro,
      xml_contingencia_hex,
      pdf_contingencia_hex,
      chave_acesso,
      protocolo,
      cstat,
      motivo,
      geranet_http_status,
      geranet_situacao,
      erro_comunicacao,
      resposta_resumo,
      tentativas,
      reservada_at,
      enviada_at,
      xml_hex,
      pdf_hex,
      autorizada_at,
      cancelada_at,
      created_at
    `)
    .eq(
      "empresa_id",
      vinculo.empresa_id
    )
    .eq(
      "origem_tipo",
      "venda"
    )
    .eq(
      "origem_id",
      venda.id
    )
    .order(
      "created_at",
      {
        ascending: false,
      }
    );

  if (emissoesFiscaisError) {
    throw new Error(
      `Erro ao carregar documentos fiscais: ${emissoesFiscaisError.message}`
    );
  }

  const {
    data: contingenciaConfig,
    error: contingenciaConfigError,
  } =
    await supabase
      .from(
        "fiscal_contingencia_config"
      )
      .select(`
        nfce_offline_habilitada,
        justificativa_padrao
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

  const {
    data: fiscalEmpresa,
  } =
    await supabase
      .from(
        "empresas_fiscal"
      )
      .select(
        "uf, fuso_horario"
      )
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

  if (
    contingenciaConfigError
  ) {
    throw new Error(
      `Erro ao carregar configuração de contingência: ${contingenciaConfigError.message}`
    );
  }

  const emissaoContingencia =
    (emissoesFiscais ?? []).find(
      (emissao) =>
        emissao.tipo_emissao ===
        "contingencia_offline"
    ) ?? null;

  const emissaoFiscalPrincipal =
    escolherEmissaoFiscalVenda(emissoesFiscais ?? []);

  const {
    data: eventosFiscais,
    error: eventosFiscaisError,
  } =
    await supabase
      .from(
        "fiscal_emissao_eventos"
      )
      .select(`
        id,
        emissao_id,
        tipo,
        status,
        sequencia,
        justificativa,
        texto_correcao,
        cstat,
        protocolo,
        motivo,
        xml_hex,
        pdf_hex,
        concluido_at,
        created_at
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .in(
        "emissao_id",
        (emissoesFiscais ?? []).map(
          (emissao) =>
            emissao.id
        ).length > 0
          ? (emissoesFiscais ?? []).map(
              (emissao) =>
                emissao.id
            )
          : [
              "00000000-0000-0000-0000-000000000000",
            ]
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      );

  if (
    eventosFiscaisError
  ) {
    throw new Error(
      `Erro ao carregar eventos fiscais: ${eventosFiscaisError.message}`
    );
  }

  const idsEmissoesFiscais = (emissoesFiscais ?? []).map(
    (emissao) => emissao.id
  );
  const { data: tentativasFiscais, error: tentativasFiscaisError } =
    idsEmissoesFiscais.length > 0
      ? await supabase
          .from("fiscal_emissao_tentativas")
          .select(
            "id, emissao_id, tentativa, cstat, motivo, classificacao_inicial, http_status, iniciada_at, respondida_at, finalizada_at"
          )
          .eq("empresa_id", vinculo.empresa_id)
          .in("emissao_id", idsEmissoesFiscais)
          .order("tentativa", { ascending: true })
      : { data: [] as Array<{
          id: string;
          emissao_id: string;
          tentativa: number;
          cstat: string | null;
          motivo: string | null;
          classificacao_inicial: string | null;
          http_status: number | null;
          iniciada_at: string | null;
          respondida_at: string | null;
          finalizada_at: string | null;
        }>, error: null };

  if (tentativasFiscaisError) {
    throw new Error(
      `Erro ao carregar tentativas fiscais: ${tentativasFiscaisError.message}`
    );
  }

  const eventosInutilizacao =
    (eventosFiscais ?? []).filter(
      (evento) =>
        evento.tipo ===
        "inutilizacao"
    );

  const emissoesInutilizacao =
    (emissoesFiscais ?? []).filter(
      (emissao) =>
        [
          "aguardando_inutilizacao",
          "inutilizada",
        ].includes(emissao.status)
    );

  const apresentacoesFiscais = (emissoesFiscais ?? []).map((emissao) => {
    const tentativa = ultimaTentativaFiscal(
      tentativasFiscais,
      String(emissao.id)
    );
    const consolidado = consolidarEvidencia539({
      cstat: emissao.cstat,
      motivo: emissao.motivo,
      tentativaCstat: tentativa?.cstat,
      tentativaMotivo: tentativa?.motivo,
    });
    return {
      emissao,
      tentativa,
      consolidado,
      ui: resolverApresentacaoEmissaoFiscal(
        {
          modelo: emissao.modelo,
          status: emissao.status,
          classificacao: classificacaoResumoDaEmissao(emissao.resposta_resumo),
          resposta_resumo: emissao.resposta_resumo,
          cstat: consolidado.cstat,
          motivo: consolidado.motivo,
          protocolo: emissao.protocolo,
          chaveAcesso: emissao.chave_acesso,
          geranetHttpStatus: emissao.geranet_http_status,
          geranetSituacao: emissao.geranet_situacao,
          erroComunicacao: emissao.erro_comunicacao,
        },
        tentativa
          ? {
              classificacao_inicial: tentativa.classificacao_inicial,
              http_status: tentativa.http_status,
              cstat: tentativa.cstat,
              motivo: tentativa.motivo,
            }
          : null
      ),
    };
  });

  const emissoesPendentesReconciliacao = apresentacoesFiscais
    .filter((item) => item.ui.caso === "aguardando_reconciliacao")
    .map((item) => item.emissao);

  const emissoesNaoTransmitidas = apresentacoesFiscais
    .filter((item) => item.ui.caso === "nao_transmitida")
    .map((item) => item.emissao);

  const emissoesNaoClassificadas = apresentacoesFiscais
    .filter((item) => item.ui.caso === "nao_classificada")
    .map((item) => item.emissao);

  const reservasFiscaisDescartaveis =
    (emissoesFiscais ?? []).filter(
      (emissao) =>
        emissao.status ===
          "reservada" &&
        Number(
          emissao.tentativas ??
            0
        ) === 0 &&
        !emissao.enviada_at &&
        !emissao.chave_acesso &&
        !emissao.protocolo
    );

  const possuiFiscalBloqueante = vendaPossuiDocumentoFiscalBloqueante(
    emissoesFiscais ?? []
  );

  const possuiFiscalTransporteBloqueante = vendaPossuiTransporteFiscalBloqueante(
    emissoesFiscais ?? []
  );

  const origemVenda =
    resolverOrigemVendaComercial(
      operacaoVenda?.id
    );
  const statusFiscal =
    escolherStatusFiscalVenda(
      emissoesFiscais ?? []
    );
  const emissaoDoStatusFiscal =
    (emissoesFiscais ?? []).find(
      (emissao) => emissao.status === statusFiscal
    ) ?? null;
  const rotaEdicao =
    resolverRotaEdicaoVenda({
      vendaId: venda.id,
      origem: origemVenda,
      operacaoFiscalId:
        operacaoVenda?.id,
      statusFiscal,
      classificacaoFiscal: classificacaoResumoDaEmissao(
        emissaoDoStatusFiscal?.resposta_resumo
      ),
    });
  const feedbackEmissao =
    mensagemFeedbackEmissaoVenda(
      query.emissao
    );

  const pagamentosAtuais =
    filtrarPagamentosFinanceiros(pagamentos ?? []);
  const pagamentosHistorico =
    filtrarPagamentosHistorico(pagamentos ?? []);
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: venda.valor_total,
    pagamentos: pagamentos ?? [],
    troco: venda.troco,
  });

  return (
    <main className="updv-page">
      <PageHeader
        title={`Venda #${venda.numero ?? "—"}`}
        breadcrumb={[
          { label: "Vendas", href: "/vendas" },
          { label: `Venda #${venda.numero ?? "—"}` },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[11px] text-zinc-400">Total da venda</p>
              <p className="text-[17px] font-semibold text-zinc-950">
                {moeda.format(Number(venda.valor_total ?? 0))}
              </p>
            </div>
            {venda.status === "finalizada" && (
              <div className="flex flex-wrap justify-end gap-2">
                {origemVenda === "pdv" ? (
                  <>
                <Link
                  href={`/vendas/${venda.id}/nfce`}
                  className="updv-btn updv-btn-ghost"
                >
                  Preparar NFC-e
                </Link>
                <Link
                  href={`/vendas/${venda.id}/nfe`}
                  className="updv-btn updv-btn-primary"
                >
                  Preparar NF-e
                </Link>
                  </>
                ) : rotaEdicao.modo === "nfe_formulario" ? (
                  <Link
                    href={rotaEdicao.href}
                    className="updv-btn updv-btn-primary"
                  >
                    {rotaEdicao.label}
                  </Link>
                ) : null}
                {origemVenda === "pdv" && !emissaoContingencia && (
                  <EmitirNfceContingenciaButton
                    vendaId={venda.id}
                    numero={venda.numero}
                    habilitada={Boolean(
                      contingenciaConfig?.nfce_offline_habilitada
                    )}
                    bloqueada={
                      possuiFiscalBloqueante ||
                      reservasFiscaisDescartaveis.length > 0
                    }
                    justificativaPadrao={
                      contingenciaConfig?.justificativa_padrao ||
                      "Indisponibilidade temporária de comunicação com a SEFAZ."
                    }
                  />
                )}
              </div>
            )}
          </div>
        }
      />

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 text-[13px]">
        <StatusBadge status={venda.status} />
        <StatusBadge status={origemVenda}>
          {rotuloOrigemVendaComercial(origemVenda)}
        </StatusBadge>
        {emissaoFiscalPrincipal ? (
          <>
            <StatusBadge
              status={emissaoFiscalPrincipal.modelo === "65" ? "nfce" : "nfe"}
            >
              {emissaoFiscalPrincipal.modelo === "65" ? "NFC-e" : "NF-e"}
            </StatusBadge>
            <StatusBadge status={emissaoFiscalPrincipal.status}>
              {`${emissaoFiscalPrincipal.modelo === "65" ? "NFC-e" : "NF-e"} ${textoStatus(emissaoFiscalPrincipal.status)}${emissaoFiscalPrincipal.serie ? ` ${emissaoFiscalPrincipal.serie}/${emissaoFiscalPrincipal.numero}` : ""}`}
            </StatusBadge>
          </>
        ) : (
          <StatusBadge status="pendente">
            {modeloFiscal(venda.modelo_fiscal_intencao)}
          </StatusBadge>
        )}
        <span className="text-zinc-400">
          {formatarData(venda.finalizada_at ?? venda.created_at)}
        </span>
      </div>

      {feedbackEmissao ? (
        <PageAlert type={feedbackEmissao.type}>
          {feedbackEmissao.texto}
        </PageAlert>
      ) : null}

      <section className="space-y-3 px-4 py-3">
        {venda.status === "finalizada" && (
          <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-[13px] text-zinc-500">
              {possuiFiscalBloqueante
                ? "Existe documento fiscal autorizado ou em estado fiscal sensível. Cancele/reconcilie o documento fiscal antes de editar ou cancelar a venda comercial."
                : "Edite os dados comerciais permitidos ou cancele a venda com estorno transacional de estoque, pagamentos e Carteira."}
            </p>

            <div className="flex shrink-0 flex-wrap gap-2">
              <BotaoImprimirConector
                pdfUrl={`/api/impressao/recibo/${venda.id}?papel=80mm`}
                tipoDocumento="recibo"
                papel="80mm"
                label="Imprimir recibo"
                className="updv-btn updv-btn-ghost"
              />
              <a
                href={`/pdv/imprimir/recibo/${venda.id}`}
                target="_blank"
                rel="noreferrer"
                className="updv-btn updv-btn-ghost"
              >
                Visualizar recibo
              </a>

              {possuiFiscalBloqueante ? (
                <button
                  type="button"
                  disabled
                  title="Cancele ou reconcilie o documento fiscal antes de editar."
                  className="updv-btn updv-btn-ghost opacity-50"
                >
                  {rotaEdicao.label}
                </button>
              ) : rotaEdicao.modo === "venda_detalhe" ? null : (
                <Link
                  href={rotaEdicao.href}
                  className="updv-btn updv-btn-ghost"
                >
                  {rotaEdicao.label}
                </Link>
              )}

              {possuiFiscalBloqueante ? (
                <button
                  type="button"
                  disabled
                  title="Cancele ou reconcilie o documento fiscal antes de cancelar a venda."
                  className="updv-btn updv-btn-ghost opacity-50"
                >
                  Cancelar venda
                </button>
              ) : (
                <CancelarVendaComercial
                  vendaId={venda.id}
                  numero={venda.numero}
                />
              )}
            </div>
          </div>
        )}

        {emissaoContingencia && (
          <NfceContingenciaCard
            emissaoId={
              emissaoContingencia.id
            }
            serie={
              emissaoContingencia.serie
            }
            numero={
              emissaoContingencia.numero
            }
            status={
              emissaoContingencia.status
            }
            geradaEm={
              emissaoContingencia
                .contingencia_gerada_at ??
              emissaoContingencia.created_at
            }
            justificativa={
              emissaoContingencia
                .contingencia_justificativa
            }
            temPdf={
              Boolean(
                emissaoContingencia
                  .pdf_contingencia_hex
              )
            }
            temXml={
              Boolean(
                emissaoContingencia
                  .xml_contingencia_hex
              )
            }
            erro={
              emissaoContingencia
                .contingencia_erro ??
              (
                emissaoContingencia.status ===
                  "rejeitada" ||
                emissaoContingencia.status ===
                  "aguardando_reconciliacao"
                  ? emissaoContingencia.motivo
                  : null
              )
            }
          />
        )}

        {emissoesNaoTransmitidas
          .filter((emissao) => emissao.id !== emissaoFiscalPrincipal?.id)
          .map((emissao) => (
            <ReconciliarEmissaoFiscal
              key={`nao-transmitida-${emissao.id}`}
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              serie={emissao.serie}
              numero={emissao.numero}
              status={emissao.status}
              motivo={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.motivo ?? emissao.motivo
              }
              cstat={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.cstat ?? emissao.cstat
              }
              geranetHttpStatus={emissao.geranet_http_status}
              geranetSituacao={emissao.geranet_situacao}
              erroComunicacao={emissao.erro_comunicacao}
              protocolo={emissao.protocolo}
              chaveAcesso={emissao.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissao.resposta_resumo
              )}
              destaque
              retryVenda={{
                vendaId: venda.id,
                ambiente: Number(emissao.ambiente) === 1 ? 1 : 2,
                serie: Number(emissao.serie) || undefined,
              }}
            />
          ))}

        {emissoesNaoClassificadas
          .filter((emissao) => emissao.id !== emissaoFiscalPrincipal?.id)
          .map((emissao) => (
            <ReconciliarEmissaoFiscal
              key={`nao-classificada-${emissao.id}`}
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              serie={emissao.serie}
              numero={emissao.numero}
              status={emissao.status}
              motivo={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.motivo ?? emissao.motivo
              }
              cstat={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.cstat ?? emissao.cstat
              }
              geranetHttpStatus={emissao.geranet_http_status}
              geranetSituacao={emissao.geranet_situacao}
              erroComunicacao={emissao.erro_comunicacao}
              protocolo={emissao.protocolo}
              chaveAcesso={emissao.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissao.resposta_resumo
              )}
              destaque
            />
          ))}

        {emissoesPendentesReconciliacao
          .filter((emissao) => emissao.id !== emissaoFiscalPrincipal?.id)
          .map(
          (emissao) => (
            <ReconciliarEmissaoFiscal
              key={`reconciliar-${emissao.id}`}
              emissaoId={emissao.id}
              modelo={emissao.modelo}
              serie={emissao.serie}
              numero={emissao.numero}
              status={emissao.status}
              motivo={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.motivo ?? emissao.motivo
              }
              cstat={
                apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                  ?.consolidado.cstat ?? emissao.cstat
              }
              geranetHttpStatus={emissao.geranet_http_status}
              geranetSituacao={emissao.geranet_situacao}
              erroComunicacao={emissao.erro_comunicacao}
              protocolo={emissao.protocolo}
              chaveAcesso={emissao.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissao.resposta_resumo
              )}
              destaque
            />
          )
        )}

        {emissoesInutilizacao.map(
          (emissao) => {
            const evento =
              eventosInutilizacao.find(
                (item) =>
                  item.emissao_id ===
                  emissao.id
              ) ?? null;

            return (
              <InutilizarNumeracaoFiscal
                key={`inutilizar-${emissao.id}`}
                emissaoId={emissao.id}
                modelo={emissao.modelo}
                serie={emissao.serie}
                numero={emissao.numero}
                ambiente={emissao.ambiente}
                status={emissao.status}
                motivo={
                  evento?.justificativa ??
                  emissao.motivo
                }
                cstat={
                  evento?.cstat ??
                  emissao.cstat
                }
                protocolo={
                  evento?.protocolo ??
                  emissao.protocolo
                }
                inutilizadaEm={
                  emissao.status ===
                  "inutilizada"
                    ? formatarData(
                        evento?.concluido_at ??
                          emissao.created_at
                      )
                    : null
                }
                xmlEventoId={
                  evento?.status ===
                    "sucesso" &&
                  evento.xml_hex
                    ? evento.id
                    : null
                }
                eventoPendente={
                  evento
                    ? [
                        "processando",
                        "aguardando_reconciliacao",
                      ].includes(
                        evento.status
                      )
                    : false
                }
              />
            );
          }
        )}

        {reservasFiscaisDescartaveis.map(
          (emissao) => (
            <ReservaFiscalPendente
              key={
                emissao.id
              }
              emissaoId={
                emissao.id
              }
              modelo={
                emissao.modelo
              }
              serie={
                emissao.serie
              }
              numero={
                emissao.numero
              }
              reservadaEm={
                emissao.reservada_at ??
                emissao.created_at
              }
            />
          )
        )}

        {venda.status === "finalizada" &&
          emissaoFiscalPrincipal?.modelo !== "65" && (
          <TransporteVendaForm
            vendaId={venda.id}
            numero={venda.numero}
            apresentacaoCompacta
            dadosTransporte={
              (venda.dados_transporte ??
                null) as
                | import("@/components/vendas/transporte-venda-form").DadosTransporteVenda
                | null
            }
            transportadoras={
              transportadorasParaVenda
            }
            bloqueado={
              possuiFiscalTransporteBloqueante
            }
            motivoBloqueio={
              possuiFiscalTransporteBloqueante
                ? reservasFiscaisDescartaveis.length > 0
                  ? "Existe uma reserva fiscal ainda não transmitida. Descarte a reserva acima antes de alterar transportador/volumes."
                  : emissaoContingencia &&
                      [
                        "aguardando_transmissao_contingencia",
                        "transmitindo_contingencia",
                        "aguardando_reconciliacao",
                      ].includes(
                        emissaoContingencia.status
                      )
                    ? "Existe uma NFC-e em contingência pendente ou com situação fiscal sensível. Regularize/reconcilie o documento antes de alterar transportador/volumes."
                    : "Existe uma NF-e/NFC-e em transmissão, autorizada ou com situação fiscal ambígua. Resolva o documento fiscal antes de alterar transportador/volumes."
                : undefined
            }
          />
        )}

        {emissaoFiscalPrincipal && (
          <EmissaoFiscalAcoes
            titulo={
              emissaoFiscalPrincipal.modelo === "65"
                ? "NFC-e"
                : "NF-e"
            }
            emissao={{
              id: emissaoFiscalPrincipal.id,
              modelo: emissaoFiscalPrincipal.modelo,
              serie: emissaoFiscalPrincipal.serie,
              numero: emissaoFiscalPrincipal.numero,
              status: emissaoFiscalPrincipal.status,
              chaveAcesso: emissaoFiscalPrincipal.chave_acesso,
              protocolo: emissaoFiscalPrincipal.protocolo,
              cstat:
                apresentacoesFiscais.find(
                  (item) => item.emissao.id === emissaoFiscalPrincipal.id
                )?.consolidado.cstat ?? emissaoFiscalPrincipal.cstat,
              motivo:
                apresentacoesFiscais.find(
                  (item) => item.emissao.id === emissaoFiscalPrincipal.id
                )?.consolidado.motivo ?? emissaoFiscalPrincipal.motivo,
              geranetHttpStatus: emissaoFiscalPrincipal.geranet_http_status,
              geranetSituacao: emissaoFiscalPrincipal.geranet_situacao,
              erroComunicacao: emissaoFiscalPrincipal.erro_comunicacao,
              classificacao: classificacaoResumoDaEmissao(
                emissaoFiscalPrincipal.resposta_resumo
              ),
              resposta_resumo: emissaoFiscalPrincipal.resposta_resumo,
              autorizadaAt: emissaoFiscalPrincipal.autorizada_at,
              enviadaAt: emissaoFiscalPrincipal.enviada_at,
              createdAt: emissaoFiscalPrincipal.created_at,
            }}
            eventos={(eventosFiscais ?? []).filter(
              (evento) => evento.emissao_id === emissaoFiscalPrincipal.id
            )}
            politicaCancelamento={serializarPoliticaCancelamento(
              resolverPoliticaCancelamentoFiscal({
                uf: fiscalEmpresa?.uf ?? "",
                modelo: emissaoFiscalPrincipal.modelo,
                status: emissaoFiscalPrincipal.status,
                autorizadoEm: emissaoFiscalPrincipal.autorizada_at,
                fusoHorario: fiscalEmpresa?.fuso_horario ?? null,
              })
            )}
            retryVenda={{
              vendaId: venda.id,
              ambiente: Number(emissaoFiscalPrincipal.ambiente) === 1 ? 1 : 2,
              serie: Number(emissaoFiscalPrincipal.serie) || undefined,
            }}
            cartaoDestaque={false}
            ocultarConsulta={false}
          />
        )}

        <EmissaoFiscalHistorico
          emissoes={(emissoesFiscais ?? []).map((emissao) => {
            const consolidado =
              apresentacoesFiscais.find((item) => item.emissao.id === emissao.id)
                ?.consolidado;
            return {
              id: emissao.id,
              modelo: emissao.modelo,
              serie: emissao.serie,
              numero: emissao.numero,
              status: emissao.status,
              cstat: consolidado?.cstat ?? emissao.cstat,
              motivo: consolidado?.motivo ?? emissao.motivo,
            };
          })}
          eventos={eventosFiscais ?? []}
          tentativas={(tentativasFiscais ?? []).map((tentativa) => ({
            id: tentativa.id,
            emissao_id: tentativa.emissao_id,
            tentativa: Number(tentativa.tentativa),
            cstat: tentativa.cstat,
            motivo: tentativa.motivo,
            classificacao_inicial: tentativa.classificacao_inicial,
            http_status: tentativa.http_status,
            iniciada_at: tentativa.iniciada_at,
            respondida_at: tentativa.respondida_at,
            finalizada_at: tentativa.finalizada_at,
          }))}
          tentativasCabecalho={Number(
            emissaoFiscalPrincipal?.tentativas ?? 0
          )}
        />

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[11px] text-zinc-400">Cliente</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-950">
              {clienteNome}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[11px] text-zinc-400">Operador</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-950">
              {usuarioNome}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[11px] text-zinc-400">Tipo</p>
            <p className="mt-1 text-[13px] font-medium text-zinc-950">
              {textoStatus(venda.tipo_venda)}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
          <div className="flex h-9 items-center border-b border-zinc-200 px-3">
            <h2 className="text-[13px] font-semibold text-zinc-800">Itens</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="updv-table min-w-[850px]">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Unitário</th>
                  <th className="num">Desconto</th>
                  <th className="num">Acréscimo</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {(itens ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="font-medium">{item.produto_nome}</span>
                      <span className="ml-2 text-zinc-400">
                        {item.produto_codigo ?? "—"} · {item.unidade_medida}
                      </span>
                    </td>
                    <td className="num">{Number(item.quantidade)}</td>
                    <td className="num">
                      {moeda.format(Number(item.valor_unitario ?? 0))}
                    </td>
                    <td className="num">
                      {moeda.format(Number(item.desconto ?? 0))}
                    </td>
                    <td className="num">
                      {moeda.format(Number(item.acrescimo ?? 0))}
                    </td>
                    <td className="num font-medium">
                      {moeda.format(Number(item.valor_total ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-zinc-200 bg-white">
            <div className="flex h-9 items-center border-b border-zinc-200 px-3">
              <h2 className="text-[13px] font-semibold text-zinc-800">
                Pagamentos
              </h2>
            </div>
            {venda.status !== "cancelada" && !conferencia.ok && (
              <div className="border-b border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[12px] font-semibold text-red-700">
                  Conferência financeira
                </p>
                <p className="mt-0.5 text-[12px] text-red-700">
                  Venda {moeda.format(conferencia.valorVenda)}; pagamentos
                  líquidos {moeda.format(conferencia.pagamentosLiquidos)}.
                </p>
              </div>
            )}
            <div className="divide-y divide-zinc-100">
              {pagamentosAtuais.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Pagamentos atuais
                  </p>
                </div>
              )}
              {pagamentosAtuais.map((pagamento) => {
                const pix = (pixLocais ?? []).find(
                  (item) => item.venda_pagamento_id === pagamento.id
                ) ?? (pixLocais ?? []).find(
                  (item) =>
                    Number(item.valor) === Number(pagamento.valor) &&
                    String(pagamento.forma_pagamento_nome ?? "")
                      .toLowerCase()
                      .includes("pix")
                );

                return (
                <div
                  key={pagamento.id}
                  className="flex items-center justify-between gap-4 px-3 py-2"
                >
                  <div>
                    <p className="text-[13px] font-medium text-zinc-950">
                      {pagamento.forma_pagamento_nome ??
                        pagamento.forma_pagamento_codigo ??
                        "Pagamento"}
                    </p>
                    <p className="text-[12px] text-zinc-400">
                      {pagamento.codigo_fiscal
                        ? `tPag ${pagamento.codigo_fiscal}`
                        : textoStatus(pagamento.status)}
                      {pagamento.quantidade_parcelas > 1
                        ? ` · ${pagamento.quantidade_parcelas}x`
                        : ""}
                      {` · ${moeda.format(Number(pagamento.valor ?? 0))}`}
                    </p>
                    {pix && pix.modo_pix === "local_manual" && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        PIX Local / Manual
                        {pix.txid ? ` · TXID ${pix.txid}` : ""}
                        {pix.confirmado_manualmente
                          ? ` · Confirmação manual por ${
                              nomesConfirmadores.get(
                                String(pix.confirmado_por)
                              ) ?? "operador"
                            }`
                          : ""}
                        {pix.confirmado_em
                          ? ` em ${new Date(pix.confirmado_em).toLocaleString("pt-BR")}`
                          : ""}
                      </p>
                    )}
                    {pix && pix.modo_pix === "geranet" && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        PIX Integrado / Geranet
                        {pix.provedor
                          ? ` · ${nomeProvedorPix(String(pix.provedor))}`
                          : ""}
                        {pix.txid ? ` · TXID ${pix.txid}` : ""}
                        {" · Confirmação automática"}
                        {` · ${
                          pix.status === "vinculado_venda" || pix.status === "paga"
                            ? "Pago"
                            : pix.status
                        }`}
                        {pix.pago_em
                          ? ` em ${new Date(pix.pago_em).toLocaleString("pt-BR")}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <p className="text-[13px] font-medium text-zinc-950">
                    {moeda.format(Number(pagamento.valor ?? 0))}
                  </p>
                </div>
                );
              })}
              {pagamentosHistorico.length > 0 && (
                <>
                  <div className="px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                      Histórico / pagamentos cancelados
                    </p>
                  </div>
                  {pagamentosHistorico.map((pagamento) => (
                    <div
                      key={pagamento.id}
                      className="flex items-center justify-between gap-4 px-3 py-2 text-zinc-500"
                    >
                      <div>
                        <p className="text-[13px] font-medium">
                          {pagamento.forma_pagamento_nome ??
                            pagamento.forma_pagamento_codigo ??
                            "Pagamento"}
                          {" — "}
                          {textoStatus(pagamento.status)}
                        </p>
                        {pagamento.codigo_fiscal ? (
                          <p className="text-[12px] text-zinc-400">
                            tPag {pagamento.codigo_fiscal}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-[13px]">
                        {moeda.format(Number(pagamento.valor ?? 0))}
                      </p>
                    </div>
                  ))}
                </>
              )}
              {(pagamentos ?? []).length === 0 && (
                <p className="px-3 py-4 text-[13px] text-zinc-500">
                  Nenhum pagamento encontrado.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-white">
            <div className="flex h-9 items-center border-b border-zinc-200 px-3">
              <h2 className="text-[13px] font-semibold text-zinc-800">
                Resumo
              </h2>
            </div>
            <div className="px-3 py-3">

            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Produtos
                </dt>
                <dd className="font-medium text-zinc-950">
                  {
                    moeda.format(
                      Number(
                        venda.valor_produtos ??
                          0
                      )
                    )
                  }
                </dd>
              </div>

              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Desconto
                </dt>
                <dd className="font-medium text-zinc-950">
                  -
                  {
                    moeda.format(
                      Number(
                        venda.desconto ??
                          0
                      )
                    )
                  }
                </dd>
              </div>

              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Acréscimo
                </dt>
                <dd className="font-medium text-zinc-950">
                  {
                    moeda.format(
                      Number(
                        venda.acrescimo ??
                          0
                      )
                    )
                  }
                </dd>
              </div>

              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Frete
                </dt>
                <dd className="font-medium text-zinc-950">
                  {
                    moeda.format(
                      Number(
                        venda.frete ??
                          0
                      )
                    )
                  }
                </dd>
              </div>

              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Troco
                </dt>
                <dd className="font-medium text-zinc-950">
                  {
                    moeda.format(
                      Number(
                        venda.troco ??
                          0
                      )
                    )
                  }
                </dd>
              </div>

              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">
                  Pagamentos líquidos
                </dt>
                <dd className="font-medium text-zinc-950">
                  {moeda.format(conferencia.pagamentosLiquidos)}
                </dd>
              </div>

              <div className="flex justify-between gap-4 border-t border-zinc-200 pt-3">
                <dt className="font-semibold text-zinc-950">
                  Total
                </dt>
                <dd className="font-semibold text-zinc-950">
                  {
                    moeda.format(
                      Number(
                        venda.valor_total ??
                          0
                      )
                    )
                  }
                </dd>
              </div>
            </dl>

            {venda.observacao && (
              <div className="mt-5 border-t border-zinc-200 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Observação
                </p>

                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                  {venda.observacao}
                </p>
              </div>
            )}

            {venda.status ===
              "cancelada" && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-red-700">
                  Venda cancelada
                </p>
                <p className="mt-1 text-[13px] text-red-700">
                  {venda.motivo_cancelamento ?? "Sem motivo informado."}
                </p>
              </div>
            )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
