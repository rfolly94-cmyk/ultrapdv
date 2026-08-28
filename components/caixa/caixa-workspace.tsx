"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { PageAlert } from "@/components/ui/page-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { CaixaMovimentosTabela } from "@/components/caixa/caixa-movimentos-tabela";
import {
  ModalAbrirCaixa,
  ModalMovimentoCaixa,
} from "@/components/caixa/caixa-modais";
import { CaixaConferenciaMeios } from "@/components/caixa/caixa-conferencia-meios";
import { ModalFecharCaixa } from "@/components/caixa/caixa-fechamento-modal";
import { CaixaResumoSessao } from "@/components/caixa/caixa-resumo-sessao";
import { CaixaResumoValores } from "@/components/caixa/caixa-resumo-valores";
import { definirFechamentoCaixaCego, iniciarFechamentoCaixa } from "@/app/caixa/actions";
import { CaixaHistoricoCiclos } from "@/components/caixa/caixa-historico-ciclos";
import { CaixaEventosGaveta } from "@/components/caixa/caixa-eventos-gaveta";
import { CaixaRelatorioAcoes } from "@/components/caixa/caixa-relatorio-acoes";
import { ModalReabrirCaixa } from "@/components/caixa/caixa-reabrir-modal";
import { conferenciaRevelaEsperado } from "@/lib/caixa/conferencia";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";
import type {
  AbaCaixa,
  CaixaResumoAnterior,
  ConferenciaCaixa,
  PainelCaixa,
} from "@/lib/caixa/tipos";
import {
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from "@/lib/relatorios/formatacao";
import {
  MENSAGEM_CONTROLE_CAIXA_DESATIVADO,
  MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE,
} from "@/lib/caixa/mensagens";
import { executarAberturaGaveta } from "@/lib/caixa/abrir-gaveta-cliente";

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  fechado: "Fechado",
  cancelado: "Cancelado",
};

export function CaixaWorkspace({
  aba,
  painel,
}: {
  aba: AbaCaixa;
  painel: PainelCaixa;
}) {
  const atual = painel.atual;
  const podeAbrir = useTemPermissao("caixa", "abrir") && painel.controleAtivo;
  const podeMovimentar =
    useTemPermissao("caixa", "movimentar") && painel.controleAtivo;
  const podeFechar = useTemPermissao("caixa", "fechar");
  const podeReabrir =
    useTemPermissao("caixa", "reabrir") && painel.controleAtivo;
  const podeConfigurar = useTemPermissao("configuracoes", "editar_empresa");
  const router = useRouter();
  const [pendingCego, startCego] = useTransition();
  const [erroCego, setErroCego] = useState<string | null>(null);
  const [erroFechar, setErroFechar] = useState<string | null>(null);
  const [pendingFechar, startFechar] = useTransition();
  const [pendingGaveta, startGaveta] = useTransition();
  const [msgGaveta, setMsgGaveta] = useState<{
    tipo: "ok" | "erro";
    texto: string;
  } | null>(null);
  const [conferenciaInicial, setConferenciaInicial] =
    useState<ConferenciaCaixa | null>(null);
  const [modal, setModal] = useState<
    "abrir" | "suprimento" | "sangria" | "fechar" | "resumo" | "reabrir" | null
  >(null);
  const [anterior, setAnterior] = useState<CaixaResumoAnterior | null>(null);
  const caixaReabrir =
    anterior && anterior.id === painel.caixaReabrirElegivelId
      ? anterior
      : !atual
        ? painel.anteriores.find((caixa) => caixa.id === painel.caixaReabrirElegivelId) ??
          null
        : null;

  function abrirFechamento() {
    if (!atual) {
      return;
    }
    startFechar(async () => {
      const saida = await iniciarFechamentoCaixa({ caixaId: atual.id });
      if (!saida.ok) {
        setErroFechar(saida.erro);
        return;
      }
      if (
        saida.conferencia.fechamento_cego &&
        conferenciaRevelaEsperado(saida.conferencia)
      ) {
        setErroFechar("Não foi possível iniciar a conferência.");
        return;
      }
      setErroFechar(null);
      setConferenciaInicial(saida.conferencia);
      setModal("fechar");
    });
  }

  function fecharModalFechamento() {
    setModal(null);
    setConferenciaInicial(null);
  }

  function abrirGavetaManual() {
    startGaveta(async () => {
      const saida = await executarAberturaGaveta({ origem: "caixa" });
      if (!saida.ok) {
        setMsgGaveta({ tipo: "erro", texto: saida.erro });
        return;
      }
      setMsgGaveta({ tipo: "ok", texto: saida.mensagem });
      router.refresh();
    });
  }

  function alternarCego(habilitado: boolean) {
    startCego(async () => {
      const saida = await definirFechamentoCaixaCego({ habilitado });
      if (!saida.ok) {
        setErroCego(saida.erro);
        return;
      }
      setErroCego(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {erroCego || erroFechar || msgGaveta?.tipo === "erro" ? (
        <PageAlert type="erro" className="mx-0 mt-0">
          {erroCego || erroFechar || msgGaveta?.texto}
        </PageAlert>
      ) : null}
      {msgGaveta?.tipo === "ok" ? (
        <PageAlert type="sucesso" className="mx-0 mt-0">
          {msgGaveta.texto}
        </PageAlert>
      ) : null}

      {!painel.controleAtivo ? (
        <div data-caixa-controle-desativado="true">
          <PageAlert type="aviso" className="mx-0 mt-0">
            <p className="font-semibold">{MENSAGEM_CONTROLE_CAIXA_DESATIVADO}</p>
            <p>{MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE}</p>
          </PageAlert>
        </div>
      ) : null}

      {podeConfigurar ? (
        <label className="flex items-center gap-2 text-[13px] text-zinc-700">
          <input
            type="checkbox"
            checked={painel.fechamentoCego}
            disabled={pendingCego}
            onChange={(event) => alternarCego(event.target.checked)}
          />
          Fechamento cego (não mostra o esperado durante a conferência)
        </label>
      ) : null}

      {aba === "atual" ? (
        atual ? (
          <section className="space-y-4 rounded-md border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[16px] font-semibold text-zinc-950">
                    Caixa #{atual.numero}
                  </h2>
                  <StatusBadge status="aberto">Aberto</StatusBadge>
                  {atual.reaberto ? (
                    <StatusBadge status="reaberto">REABERTO</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] text-zinc-500">
                  Aberto em {formatarDataHora(atual.aberto_em)} · Operador{" "}
                  {atual.usuario_abertura_nome || "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {podeMovimentar ? (
                  <>
                    <button
                      type="button"
                      className="updv-btn updv-btn-ghost"
                      onClick={() => setModal("suprimento")}
                    >
                      Suprimento
                    </button>
                    <button
                      type="button"
                      className="updv-btn updv-btn-ghost"
                      onClick={() => setModal("sangria")}
                    >
                      Sangria
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  disabled={pendingGaveta}
                  onClick={abrirGavetaManual}
                >
                  {pendingGaveta ? "Abrindo..." : "Abrir gaveta"}
                </button>
                {podeFechar ? (
                  <button
                    type="button"
                    className="updv-btn updv-btn-primary"
                    disabled={pendingFechar}
                    onClick={abrirFechamento}
                  >
                    {pendingFechar ? "Preparando..." : "Fechar Caixa"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  onClick={() => setModal("resumo")}
                >
                  Ver Resumo
                </button>
                <CaixaRelatorioAcoes
                  caixaId={atual.id}
                  numero={atual.numero}
                  abertoEm={atual.aberto_em}
                />
              </div>
            </div>

            {atual.reaberto ? (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950"
                data-caixa-bloco-reaberto="true"
              >
                <p>
                  Reaberto em{" "}
                  {formatarDataHora(atual.reaberturas.at(-1)?.reaberto_em)}
                </p>
                <p>
                  Reaberto por {atual.reaberturas.at(-1)?.reaberto_por_nome || "—"}
                </p>
                <p>Motivo: {atual.reaberturas.at(-1)?.motivo || "—"}</p>
                {atual.reaberturas.length > 1 ? (
                  <p>{atual.reaberturas.length} reaberturas nesta sessão.</p>
                ) : null}
              </div>
            ) : null}

            <CaixaResumoSessao totais={atual} />

            <div>
              <h3 className="mb-2 text-[13px] font-semibold text-zinc-950">
                Movimentações
              </h3>
              <CaixaMovimentosTabela movimentos={atual.movimentos} />
            </div>
            <CaixaEventosGaveta eventos={atual.eventos_gaveta} />
            <CaixaHistoricoCiclos
              ciclos={atual.ciclos_fechamento}
              reaberturas={atual.reaberturas}
            />
          </section>
        ) : (
          <section className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
            <StatusBadge status="fechado">Fechado</StatusBadge>
            <h2 className="mt-3 text-[16px] font-semibold text-zinc-950">
              {painel.controleAtivo ? "Caixa fechado" : MENSAGEM_CONTROLE_CAIXA_DESATIVADO}
            </h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              {painel.controleAtivo
                ? "Abra uma sessão para registrar suprimentos e sangrias."
                : MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE}
            </p>
            {painel.controleAtivo && podeAbrir ? (
              <button
                type="button"
                className="updv-btn updv-btn-primary mt-4"
                onClick={() => setModal("abrir")}
              >
                Abrir Caixa
              </button>
            ) : null}
            {painel.controleAtivo && !podeAbrir ? (
              <p className="mt-4 text-[13px] text-zinc-500">
                Você não tem permissão para abrir o caixa.
              </p>
            ) : null}
            {podeReabrir && caixaReabrir ? (
              <button
                type="button"
                className="updv-btn updv-btn-ghost mt-2"
                onClick={() => setModal("reabrir")}
              >
                Reabrir Caixa
              </button>
            ) : null}
            {caixaReabrir ? (
              <div className="mt-4 flex justify-center">
                <CaixaRelatorioAcoes
                  caixaId={caixaReabrir.id}
                  numero={caixaReabrir.numero}
                  abertoEm={caixaReabrir.aberto_em}
                />
              </div>
            ) : null}
          </section>
        )
      ) : (
        <DataTable minWidth={980}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Abertura</th>
              <th>Fechamento</th>
              <th>Operador</th>
              <th className="num">Saldo inicial</th>
              <th className="num">Entradas</th>
              <th className="num">Saídas</th>
              <th className="num">Saldo final</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {painel.anteriores.length === 0 ? (
              <DataTableEmpty colSpan={9}>
                Nenhum caixa anterior nesta empresa.
              </DataTableEmpty>
            ) : (
              painel.anteriores.map((caixa) => (
                <tr
                  key={caixa.id}
                  className="cursor-pointer"
                  onClick={() => setAnterior(caixa)}
                >
                  <td>{formatarData(caixa.aberto_em)}</td>
                  <td>{formatarDataHora(caixa.aberto_em)}</td>
                  <td>{formatarDataHora(caixa.fechado_em)}</td>
                  <td>{caixa.usuario_abertura_nome || "—"}</td>
                  <td className="num">{formatarMoeda(caixa.saldoInicial)}</td>
                  <td className="num">{formatarMoeda(caixa.entradas)}</td>
                  <td className="num">{formatarMoeda(caixa.saidas)}</td>
                  <td className="num">{formatarMoeda(caixa.saldoAtual)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={caixa.status}>
                        {STATUS_LABEL[caixa.status] ?? caixa.status}
                      </StatusBadge>
                      {caixa.reaberto ? (
                        <StatusBadge status="reaberto">REABERTO</StatusBadge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      )}

      <ModalAbrirCaixa
        open={modal === "abrir"}
        onClose={() => setModal(null)}
      />
      {atual ? (
        <>
          <ModalMovimentoCaixa
            open={modal === "suprimento"}
            tipo="suprimento"
            caixaId={atual.id}
            saldoAtual={atual.saldoAtual}
            onClose={() => setModal(null)}
          />
          <ModalMovimentoCaixa
            open={modal === "sangria"}
            tipo="sangria"
            caixaId={atual.id}
            saldoAtual={atual.saldoAtual}
            onClose={() => setModal(null)}
          />
          <ModalFecharCaixa
            key={conferenciaInicial?.versao_livro ?? "fechamento"}
            open={modal === "fechar"}
            caixaId={atual.id}
            operadorNome={atual.usuario_abertura_nome}
            conferenciaInicial={conferenciaInicial}
            onClose={fecharModalFechamento}
          />
          <AppResumoAtual
            open={modal === "resumo"}
            onClose={() => setModal(null)}
            caixa={atual}
          />
        </>
      ) : null}

      <DetailDrawer
        title={anterior ? `Caixa #${anterior.numero}` : "Caixa anterior"}
        open={Boolean(anterior)}
        onClose={() => setAnterior(null)}
        size="md"
      >
        {anterior ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {anterior.reaberto ? (
                <StatusBadge status="reaberto">REABERTO</StatusBadge>
              ) : null}
              <CaixaRelatorioAcoes
                caixaId={anterior.id}
                numero={anterior.numero}
                abertoEm={anterior.aberto_em}
              />
              {podeReabrir && anterior.id === painel.caixaReabrirElegivelId ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-primary"
                  onClick={() => setModal("reabrir")}
                >
                  Reabrir Caixa
                </button>
              ) : null}
            </div>
            {podeReabrir && anterior.id !== painel.caixaReabrirElegivelId ? (
              <PageAlert type="aviso" className="mx-0 mt-0">
                Só é possível reabrir o último caixa fechado desta empresa.
              </PageAlert>
            ) : null}
            {anterior.reaberto && anterior.reaberturas.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
                <p>
                  Reaberto em{" "}
                  {formatarDataHora(anterior.reaberturas.at(-1)?.reaberto_em)}
                </p>
                <p>
                  Reaberto por{" "}
                  {anterior.reaberturas.at(-1)?.reaberto_por_nome || "—"}
                </p>
                <p>Motivo: {anterior.reaberturas.at(-1)?.motivo || "—"}</p>
                {anterior.reaberturas.length > 1 ? (
                  <p>{anterior.reaberturas.length} reaberturas nesta sessão.</p>
                ) : null}
              </div>
            ) : null}
            <p className="text-[13px] text-zinc-500">
              Aberto em {formatarDataHora(anterior.aberto_em)} por{" "}
              {anterior.usuario_abertura_nome || "—"}
              {anterior.fechado_em
                ? ` · Fechado em ${formatarDataHora(anterior.fechado_em)} por ${
                    anterior.usuario_fechamento_nome || "—"
                  }`
                : ""}
            </p>
            <CaixaResumoValores
              saldoInicial={anterior.saldoInicial}
              suprimentos={anterior.suprimentos}
              sangrias={anterior.sangrias}
              saldoAtual={anterior.saldoAtual}
              rotuloSaldoAtual="Dinheiro físico esperado"
              dinheiroContado={anterior.dinheiro_contado}
              diferenca={anterior.diferenca}
            />
            <CaixaResumoSessao totais={anterior} />
            {anterior.conferencia.length > 0 ? (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-zinc-950">
                  Conferência por meio
                </h3>
                <CaixaConferenciaMeios
                  meios={anterior.conferencia}
                  somenteLeitura
                />
              </div>
            ) : null}
            {anterior.observacao_fechamento ? (
              <p className="text-[13px] text-zinc-500">
                {anterior.observacao_fechamento}
              </p>
            ) : null}
            <CaixaMovimentosTabela movimentos={anterior.movimentos} />
            <CaixaEventosGaveta eventos={anterior.eventos_gaveta} />
            <CaixaHistoricoCiclos
              ciclos={anterior.ciclos_fechamento}
              reaberturas={anterior.reaberturas}
            />
          </div>
        ) : null}
      </DetailDrawer>
      <ModalReabrirCaixa
        open={modal === "reabrir"}
        onClose={() => setModal(null)}
        caixaId={caixaReabrir?.id ?? anterior?.id ?? ""}
        numero={caixaReabrir?.numero ?? anterior?.numero ?? 0}
        ciclo={
          (caixaReabrir ?? anterior)?.ciclos_fechamento.at(-1) ?? null
        }
        ocultarEsperado={painel.fechamentoCego && !podeConfigurar}
      />
    </div>
  );
}

function AppResumoAtual({
  open,
  onClose,
  caixa,
}: {
  open: boolean;
  onClose: () => void;
  caixa: NonNullable<PainelCaixa["atual"]>;
}) {
  return (
    <DetailDrawer title={`Resumo · Caixa #${caixa.numero}`} open={open} onClose={onClose} size="md">
      <div className="space-y-4">
        <CaixaResumoSessao totais={caixa} />
        {caixa.observacao_abertura ? (
          <p className="text-[13px] text-zinc-500">{caixa.observacao_abertura}</p>
        ) : null}
        <CaixaMovimentosTabela movimentos={caixa.movimentos} />
        <CaixaEventosGaveta eventos={caixa.eventos_gaveta} />
      </div>
    </DetailDrawer>
  );
}
