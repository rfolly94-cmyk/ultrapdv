"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  aplicarFiscalAssistenteAction,
  cancelarAcaoAssistenteAction,
  carregarAssistenteIaAction,
  confirmarAcaoAssistenteAction,
  desfazerAcaoAssistenteAction,
  enviarMensagemAssistenteIaAction,
} from "@/app/ia/actions";
import { PageAlert } from "@/components/ui/page-alert";
import type { CardPropostaAcao } from "@/lib/ia/acoes/tipos";
import type { MensagemAssistente, PropostaFiscalProduto } from "@/lib/ia/tipos";

function textoValor(valor: string | number | boolean | null | undefined) {
  if (valor == null || valor === "") {
    return "—";
  }
  return String(valor);
}

function CardProposta({
  card,
  onConfirmar,
  onCancelar,
  onDesfazer,
  pending,
}: {
  card: CardPropostaAcao;
  onConfirmar: (id: string, nomeGrupo?: string) => void;
  onCancelar: (id: string) => void;
  onDesfazer: (id: string) => void;
  pending: boolean;
}) {
  const [nome, setNome] = useState(card.nomeSugerido ?? "");
  if (card.card === "erro") {
    return (
      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
        <p className="text-[12px] font-semibold text-red-800">Erro</p>
        <p className="mt-1 text-[12px] text-red-700">{card.descricao}</p>
      </div>
    );
  }
  if (card.card === "resultado") {
    return (
      <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-[12px] font-semibold text-emerald-900">Resultado</p>
        <p className="mt-1 text-[12px] text-emerald-800">{card.descricao}</p>
        {card.podeDesfazer ? (
          <button
            type="button"
            className="updv-btn updv-btn-ghost mt-2 text-[12px]"
            disabled={pending}
            onClick={() => onDesfazer(card.id)}
          >
            Desfazer alteração
          </button>
        ) : null}
      </div>
    );
  }
  if (card.card === "aviso") {
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-[12px] font-semibold text-amber-900">Aviso</p>
        <p className="mt-1 text-[12px] text-amber-800">{card.descricao}</p>
      </div>
    );
  }
  if (!card.diferencas.length && !card.nomeEditavel) {
    return null;
  }
  return (
    <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-[12px] font-semibold text-zinc-800">{card.titulo}</p>
      <p className="mt-0.5 text-[12px] text-zinc-600">{card.descricao}</p>
      {card.nomeEditavel ? (
        <label className="mt-2 block text-[12px] text-zinc-600">
          Nome do grupo
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-[12px] text-zinc-800"
          />
        </label>
      ) : null}
      {card.diferencas.length ? (
        <ul className="mt-2 space-y-1 text-[12px] text-zinc-600">
          {card.diferencas.map((item) => (
            <li key={item.campo}>
              <span className="font-medium text-zinc-800">{item.rotulo}</span>
              <br />
              Atual: {textoValor(item.atual)}
              <br />
              Novo: {textoValor(item.novo)}
            </li>
          ))}
        </ul>
      ) : null}
      {card.avisos.length ? (
        <p className="mt-2 text-[11px] text-zinc-500">{card.avisos.join(" ")}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="updv-btn updv-btn-primary text-[12px]"
          disabled={pending}
          onClick={() => onConfirmar(card.id, card.nomeEditavel ? nome : undefined)}
        >
          Aplicar alterações
        </button>
        <button
          type="button"
          className="updv-btn updv-btn-ghost text-[12px]"
          disabled={pending}
          onClick={() => onCancelar(card.id)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PropostaFiscalCard({
  proposta,
  onAplicar,
}: {
  proposta: PropostaFiscalProduto;
  onAplicar: (id: string) => void;
}) {
  if (proposta.diferencas.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-[12px] font-semibold text-zinc-800">
        Sugestão fiscal · confiança {proposta.confianca}
      </p>
      <ul className="mt-2 space-y-1 text-[12px] text-zinc-600">
        {proposta.diferencas.map((item) => (
          <li key={item.campo}>
            {item.rotulo}: {String(item.atual ?? "—")} → {String(item.sugerido ?? "—")}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="updv-btn updv-btn-primary mt-2 text-[12px]"
        onClick={() => onAplicar(proposta.propostaId)}
      >
        Aplicar alterações
      </button>
    </div>
  );
}

export function AssistenteIaPainel({
  onFechar,
  perguntaInicial,
}: {
  onFechar: () => void;
  perguntaInicial?: string | null;
}) {
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [mensagens, setMensagens] = useState<MensagemAssistente[]>([]);
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [iaDisponivel, setIaDisponivel] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const seq = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const enviouInicial = useRef(false);

  useEffect(() => {
    start(async () => {
      const saida = await carregarAssistenteIaAction();
      if (saida.ok) {
        setMensagens(saida.mensagens);
        setSugestoes(saida.sugestoes);
        setIaDisponivel(saida.iaDisponivel !== false);
        setAviso(saida.aviso ?? null);
      }
    });
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  const enviar = useCallback((pergunta: string) => {
    const valor = pergunta.trim();
    if (!valor) {
      return;
    }
    setTexto("");
    setErro(null);
    const local: MensagemAssistente = {
      id: `local-${seq.current++}`,
      papel: "usuario",
      conteudo: valor,
      acoes: [],
      createdAt: new Date().toISOString(),
    };
    setMensagens((atual) => [...atual, local]);
    start(async () => {
      const saida = await enviarMensagemAssistenteIaAction({
        texto: valor,
        pathname,
        search: typeof window !== "undefined" ? window.location.search : "",
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setMensagens((atual) => [...atual, saida.mensagem]);
    });
  }, [pathname, start]);

  useEffect(() => {
    if (!perguntaInicial || enviouInicial.current) {
      return;
    }
    enviouInicial.current = true;
    enviar(perguntaInicial);
  }, [perguntaInicial, enviar]);

  function anexarMensagem(mensagem: MensagemAssistente | null | undefined) {
    if (mensagem) {
      setMensagens((atual) => [...atual, mensagem]);
    }
  }

  function confirmar(propostaId: string, nomeGrupo?: string) {
    start(async () => {
      const saida = await confirmarAcaoAssistenteAction({ propostaId, nomeGrupo });
      if (!saida.ok) {
        setErro(saida.erro);
        anexarMensagem(saida.mensagem ?? undefined);
        return;
      }
      anexarMensagem(saida.mensagem);
    });
  }

  function cancelar(propostaId: string) {
    start(async () => {
      const saida = await cancelarAcaoAssistenteAction({ propostaId });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      anexarMensagem(saida.mensagem);
    });
  }

  function desfazer(propostaId: string) {
    start(async () => {
      const saida = await desfazerAcaoAssistenteAction({ propostaId });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      anexarMensagem(saida.mensagem);
    });
  }

  function aplicarLegado(propostaId: string) {
    start(async () => {
      const saida = await aplicarFiscalAssistenteAction({ propostaId });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      anexarMensagem(saida.mensagem);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4">
        <div>
          <p className="text-sm font-semibold">Assistente UltraPDV</p>
          <p className="text-[11px] text-zinc-500">Copiloto da empresa ativa</p>
        </div>
        <button
          type="button"
          className="updv-btn updv-btn-icon updv-btn-ghost"
          aria-label="Fechar assistente"
          onClick={onFechar}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {aviso ? (
          <PageAlert type="aviso" className="mx-0">
            {aviso}
          </PageAlert>
        ) : null}
        {erro ? (
          <PageAlert type="erro" className="mx-0">
            {erro}
          </PageAlert>
        ) : null}

        {mensagens.length === 0 ? (
          <div className="pt-4">
            <p className="text-[14px] font-semibold text-zinc-900">
              Como posso ajudar?
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              {iaDisponivel
                ? "Pergunte sobre vendas, estoque, carteira, caixa, fiscal ou avisos."
                : "Consultas de vendas, estoque, clientes, carteira, caixa, fiscal cadastrado e notificações funcionam sem IA."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {sugestoes.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] text-zinc-700 hover:bg-zinc-200"
                  onClick={() => enviar(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {mensagens.map((item) => (
          <div
            key={item.id}
            className={
              item.papel === "usuario"
                ? "ml-8 rounded-2xl bg-zinc-900 px-3 py-2 text-[13px] text-white"
                : "mr-4 rounded-2xl bg-zinc-100 px-3 py-2 text-[13px] text-zinc-800"
            }
          >
            <p className="whitespace-pre-wrap">{item.conteudo}</p>
            {item.papel === "assistente" && item.modo ? (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
                {item.modo === "direto" ? "Consulta direta" : "Assistente IA"}
              </p>
            ) : null}
            {item.propostaAcao ? (
              <CardProposta
                card={item.propostaAcao}
                onConfirmar={confirmar}
                onCancelar={cancelar}
                onDesfazer={desfazer}
                pending={pending}
              />
            ) : item.propostaFiscal ? (
              <PropostaFiscalCard
                proposta={item.propostaFiscal}
                onAplicar={aplicarLegado}
              />
            ) : null}
            {item.acoes?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.acoes.map((acao, index) => {
                  if (item.propostaAcao && (acao.confirmarAcao || acao.cancelarAcao)) {
                    return null;
                  }
                  if (acao.href) {
                    return (
                      <Link
                        key={`${acao.label}-${index}`}
                        href={acao.href}
                        className="updv-btn-row"
                        onClick={onFechar}
                      >
                        {acao.label}
                      </Link>
                    );
                  }
                  if (acao.desfazerAcao) {
                    return (
                      <button
                        key={`${acao.label}-${index}`}
                        type="button"
                        className="updv-btn-row"
                        onClick={() => desfazer(acao.desfazerAcao!.propostaId)}
                      >
                        {acao.label}
                      </button>
                    );
                  }
                  if (acao.aplicarFiscal && !item.propostaAcao) {
                    return (
                      <button
                        key={`${acao.label}-${index}`}
                        type="button"
                        className="updv-btn-row"
                        onClick={() => aplicarLegado(acao.aplicarFiscal!.propostaId)}
                      >
                        {acao.label}
                      </button>
                    );
                  }
                  return null;
                })}
              </div>
            ) : null}
          </div>
        ))}
        {pending ? (
          <p className="text-[12px] text-zinc-400">Consultando dados da empresa...</p>
        ) : null}
        <div ref={fim} />
      </div>

      <form
        className="border-t border-zinc-200 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          enviar(texto);
        }}
      >
        {!iaDisponivel && mensagens.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {sugestoes.map((item) => (
              <button
                key={item}
                type="button"
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] text-zinc-700 hover:bg-zinc-200"
                onClick={() => enviar(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <input
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="Pergunte sobre a empresa ativa..."
          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-[13px]"
        />
      </form>
    </div>
  );
}
