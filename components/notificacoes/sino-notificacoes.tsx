"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  acaoNotificacaoUsuarioAction,
  contarNotificacoesAction,
  listarCentralNotificacoesAction,
} from "@/app/notificacoes/actions";
import { ActionMenu } from "@/components/ui/action-menu";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { PageAlert } from "@/components/ui/page-alert";
import { tempoRelativoNotificacao } from "@/lib/notificacoes/estado-usuario";
import {
  FILTROS_CENTRAL_NOTIFICACOES,
  ROTULO_ACAO_NOTIFICACAO,
  ROTULO_CATEGORIA_NOTIFICACAO,
  ROTULO_NIVEL_NOTIFICACAO,
  type FiltroCentralNotificacoes,
  type NotificacaoCentral,
} from "@/lib/notificacoes/tipos";

const pontoNivel: Record<NotificacaoCentral["nivel"], string> = {
  info: "bg-zinc-400",
  atencao: "bg-amber-400",
  importante: "bg-orange-500",
  critico: "bg-rose-500",
};

const rotuloFiltro: Record<FiltroCentralNotificacoes, string> = {
  todas: "Todas",
  importantes: "Importantes",
  estoque: "Estoque",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  sistema: "Sistema",
};

export function SinoNotificacoes({
  compacto = false,
}: {
  compacto?: boolean;
}) {
  const [pending, start] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [contador, setContador] = useState(0);
  const [filtro, setFiltro] = useState<FiltroCentralNotificacoes>("todas");
  const [itens, setItens] = useState<NotificacaoCentral[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function atualizarContador() {
    start(async () => {
      const saida = await contarNotificacoesAction();
      if (saida.ok) {
        setContador(saida.contador);
      }
    });
  }

  useEffect(() => {
    atualizarContador();
  }, []);

  function carregar(proximoFiltro: FiltroCentralNotificacoes) {
    start(async () => {
      const saida = await listarCentralNotificacoesAction(proximoFiltro);
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setErro(null);
      setAviso(saida.aviso ?? null);
      setItens(saida.itens);
      setContador(saida.contador);
    });
  }

  function abrir() {
    setAberto(true);
    carregar(filtro);
  }

  function acao(
    id: string,
    tipo: "lida" | "nao_lida" | "dispensar" | "adiar",
    adiar?: "1h" | "amanha" | "7d"
  ) {
    start(async () => {
      const saida = await acaoNotificacaoUsuarioAction({
        notificacaoId: id,
        acao: tipo,
        adiar,
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      carregar(filtro);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={
          compacto
            ? "relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            : "relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
        }
        aria-label="Central de notificações"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.268 21a2 2 0 0 0 3.464 0" />
          <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
        </svg>
        {contador > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {contador > 99 ? "99+" : contador}
          </span>
        ) : null}
      </button>

      <DetailDrawer
        title="Central de notificações"
        open={aberto}
        onClose={() => setAberto(false)}
        size="md"
      >
        <div className="flex flex-wrap gap-1">
          {FILTROS_CENTRAL_NOTIFICACOES.map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                filtro === item
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
              onClick={() => {
                setFiltro(item);
                carregar(item);
              }}
            >
              {rotuloFiltro[item]}
            </button>
          ))}
        </div>

        {erro ? (
          <PageAlert type="erro" className="mx-0 mt-3">
            {erro}
          </PageAlert>
        ) : null}
        {aviso ? (
          <PageAlert type="aviso" className="mx-0 mt-3">
            {aviso}
          </PageAlert>
        ) : null}

        {pending && itens.length === 0 ? (
          <p className="mt-6 text-[13px] text-zinc-400">Atualizando avisos...</p>
        ) : itens.length === 0 ? (
          <div className="mt-8 text-center">
            <p className="text-[15px] font-semibold text-zinc-900">
              Tudo certo por aqui
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Nenhum aviso precisa da sua atenção no momento.
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {itens.map((item) => (
              <li
                key={item.id}
                className={`py-3 ${item.lida ? "opacity-70" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${pontoNivel[item.nivel]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-zinc-900">
                          {item.titulo}
                        </p>
                        <p className="mt-0.5 text-[12px] text-zinc-500">
                          {ROTULO_CATEGORIA_NOTIFICACAO[item.categoria]} ·{" "}
                          {ROTULO_NIVEL_NOTIFICACAO[item.nivel]}
                          {item.lida ? " · Lida" : " · Não lida"}
                          {item.adiada ? " · Adiada" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {tempoRelativoNotificacao(item.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-zinc-700">
                      {item.mensagem}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {item.actionUrl ? (
                        <Link
                          href={item.actionUrl}
                          className="updv-btn-row"
                          onClick={() => {
                            acao(item.id, "lida");
                            setAberto(false);
                          }}
                        >
                          {ROTULO_ACAO_NOTIFICACAO[item.tipo]}
                        </Link>
                      ) : null}
                      <ActionMenu
                        items={[
                          {
                            label: item.lida
                              ? "Marcar como não lida"
                              : "Marcar como lida",
                            onClick: () =>
                              acao(item.id, item.lida ? "nao_lida" : "lida"),
                          },
                          {
                            label: "Adiar 1 hora",
                            onClick: () => acao(item.id, "adiar", "1h"),
                          },
                          {
                            label: "Adiar para amanhã",
                            onClick: () => acao(item.id, "adiar", "amanha"),
                          },
                          {
                            label: "Adiar 7 dias",
                            onClick: () => acao(item.id, "adiar", "7d"),
                          },
                          {
                            label: "Dispensar",
                            danger: true,
                            onClick: () => acao(item.id, "dispensar"),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailDrawer>
    </>
  );
}
