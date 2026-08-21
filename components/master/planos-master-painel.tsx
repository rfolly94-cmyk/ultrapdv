"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { masterSalvarPlano } from "@/lib/master/acoes";
import type { PlanoMasterResumo } from "@/lib/master/planos";
import {
  CATALOGO_RECURSOS,
  ROTULOS_CATEGORIA_RECURSO,
  ROTULOS_LIMITE,
  ROTULOS_NIVEL_SUPORTE,
  recursosDaCategoria,
  type CategoriaRecurso,
  type NivelSuporte,
} from "@/lib/plataforma/recursos/catalogo";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

const ABAS = [
  { id: "geral", label: "Geral" },
  { id: "limites", label: "Limites" },
  { id: "recursos", label: "Recursos" },
  { id: "fiscal", label: "Fiscal" },
  { id: "integracoes", label: "Integrações" },
] as const;

type Aba = (typeof ABAS)[number]["id"];

function dinheiroParaInput(valor: number | null | undefined) {
  if (valor == null) {
    return "";
  }
  return valor.toFixed(2).replace(".", ",");
}

function parseDinheiro(valor: string) {
  const limpo = valor.trim();
  if (!limpo) {
    return "";
  }
  return Number(limpo.replace(/\./g, "").replace(",", "."));
}

function PlanoCard({
  plano,
  onEditar,
}: {
  plano: PlanoMasterResumo;
  onEditar: () => void;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-950">
            {plano.nome}
          </h2>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {plano.valorMensal == null ? "—" : formatarMoeda(plano.valorMensal)}
            <span className="ml-1 text-sm font-medium text-zinc-500">/ mês</span>
          </p>
        </div>
        <StatusBadge status={plano.ativo ? "ativo" : "inativo"}>
          {plano.ativo ? "Ativo" : "Inativo"}
        </StatusBadge>
      </div>
      {plano.destaque && plano.textoDestaque ? (
        <p className="mt-2 text-sm font-medium text-zinc-600">
          {plano.textoDestaque}
        </p>
      ) : null}
      <ul className="mt-4 space-y-1 text-sm text-zinc-600">
        <li>
          {plano.empresas} {plano.empresas === 1 ? "empresa" : "empresas"}
        </li>
        <li>
          {plano.limites.usuarios == null
            ? "Usuários ilimitados"
            : `${plano.limites.usuarios} ${
                plano.limites.usuarios === 1 ? "usuário" : "usuários"
              }`}
        </li>
        <li>
          {plano.limites.filiais == null
            ? "Filiais ilimitadas"
            : `${plano.limites.filiais} ${
                plano.limites.filiais === 1 ? "filial" : "filiais"
              }`}
        </li>
        <li>
          {plano.recursosHabilitados}{" "}
          {plano.recursosHabilitados === 1 ? "recurso" : "recursos"}
        </li>
      </ul>
      <button
        type="button"
        onClick={onEditar}
        className="updv-btn updv-btn-ghost mt-5 w-full"
      >
        Editar plano
      </button>
    </article>
  );
}

function SwitchRecurso({
  titulo,
  descricao,
  checked,
  onChange,
}: {
  titulo: string;
  descricao: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-zinc-200 px-3 py-2.5">
      <span>
        <span className="block text-sm font-medium text-zinc-950">{titulo}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">{descricao}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4"
      />
    </label>
  );
}

function GrupoRecursos({
  categoria,
  recursos,
  onToggle,
}: {
  categoria: CategoriaRecurso;
  recursos: Record<string, boolean>;
  onToggle: (chave: string, valor: boolean) => void;
}) {
  const itens = recursosDaCategoria(categoria);
  if (itens.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {ROTULOS_CATEGORIA_RECURSO[categoria]}
      </h3>
      <div className="grid gap-2">
        {itens.map((item) => (
          <SwitchRecurso
            key={item.chave}
            titulo={item.nome}
            descricao={item.descricao}
            checked={Boolean(recursos[item.chave])}
            onChange={(valor) => onToggle(item.chave, valor)}
          />
        ))}
      </div>
    </section>
  );
}

export function PlanosMasterPainel({
  planos,
  metricas,
}: {
  planos: PlanoMasterResumo[];
  metricas: {
    planosAtivos: number;
    empresasAssinantes: number;
    mrrEstimado: number;
    planoMaisUtilizado: string | null;
  };
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("geral");
  const [aberto, setAberto] = useState(false);
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorMensal, setValorMensal] = useState("");
  const [valorAnual, setValorAnual] = useState("");
  const [ordem, setOrdem] = useState("1");
  const [ativo, setAtivo] = useState(true);
  const [destaque, setDestaque] = useState(false);
  const [textoDestaque, setTextoDestaque] = useState("");
  const [oferecerTeste, setOferecerTeste] = useState(false);
  const [diasTeste, setDiasTeste] = useState("7");
  const [nivelSuporte, setNivelSuporte] = useState<NivelSuporte>("normal");
  const [limites, setLimites] = useState<Record<string, number | null>>({
    usuarios: null,
    filiais: null,
  });
  const [recursos, setRecursos] = useState<Record<string, boolean>>({});
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  const tituloEditor = planoId ? `Editar plano ${nome || ""}`.trim() : "Novo plano";

  function abrir(plano?: PlanoMasterResumo) {
    setAba("geral");
    setMensagem(null);
    setPlanoId(plano?.id || null);
    setNome(plano?.nome ?? "");
    setDescricao(plano?.descricao ?? "");
    setValorMensal(dinheiroParaInput(plano?.valorMensal ?? 0));
    setValorAnual(dinheiroParaInput(plano?.valorAnual ?? null));
    setOrdem(String(plano?.ordem ?? planos.length + 1));
    setAtivo(plano?.ativo ?? true);
    setDestaque(Boolean(plano?.destaque));
    setTextoDestaque(plano?.textoDestaque ?? "");
    setOferecerTeste(Boolean(plano && plano.diasTeste > 0));
    setDiasTeste(String(plano && plano.diasTeste > 0 ? plano.diasTeste : 7));
    setNivelSuporte(plano?.nivelSuporte ?? "normal");
    setLimites(plano?.limites ?? { usuarios: null, filiais: null });
    setRecursos(
      plano?.recursos ??
        Object.fromEntries(CATALOGO_RECURSOS.map((item) => [item.chave, true]))
    );
    setAberto(true);
  }

  function fechar() {
    if (pending) {
      return;
    }
    setAberto(false);
  }

  const indicadores = useMemo(
    () => [
      { label: "Planos ativos", valor: String(metricas.planosAtivos) },
      { label: "Empresas assinantes", valor: String(metricas.empresasAssinantes) },
      { label: "MRR estimado", valor: formatarMoeda(metricas.mrrEstimado) },
      {
        label: "Plano mais utilizado",
        valor: metricas.planoMaisUtilizado ?? "—",
      },
    ],
    [metricas]
  );

  function salvar() {
    setMensagem(null);
    startTransition(async () => {
      const resultado = await masterSalvarPlano({
        id: planoId,
        nome,
        descricao,
        valorMensal: parseDinheiro(valorMensal),
        valorAnual: valorAnual.trim() ? parseDinheiro(valorAnual) : "",
        ordem: Number(ordem),
        ativo,
        destaque,
        textoDestaque,
        oferecerTeste,
        diasTeste: Number(diasTeste),
        nivelSuporte,
        limites,
        recursos,
      });

      if (!resultado.ok) {
        setMensagem({ tipo: "erro", texto: resultado.erro });
        return;
      }

      setMensagem({ tipo: "sucesso", texto: "Plano salvo com sucesso." });
      router.refresh();
      window.setTimeout(() => setAberto(false), 400);
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Planos</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Configure preços, limites e recursos disponíveis para cada assinatura do
            UltraPDV.
          </p>
        </div>
        <button
          type="button"
          onClick={() => abrir()}
          className="updv-btn updv-btn-primary"
        >
          + Novo plano
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {indicadores.map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-zinc-200 bg-white px-4 py-3"
          >
            <p className="text-xs text-zinc-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-950">{item.valor}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {planos.map((plano) => (
          <PlanoCard key={plano.id} plano={plano} onEditar={() => abrir(plano)} />
        ))}
      </section>

      <AppModal
        open={aberto}
        title={tituloEditor}
        onClose={fechar}
        size="xl"
        footer={
          <>
            <button
              type="button"
              onClick={fechar}
              disabled={pending}
              className="updv-btn updv-btn-ghost"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="updv-btn updv-btn-primary"
            >
              {pending ? "Salvando..." : "Salvar plano"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {mensagem ? (
            <p
              className={
                mensagem.tipo === "erro"
                  ? "text-sm text-red-700"
                  : "text-sm text-emerald-700"
              }
            >
              {mensagem.texto}
            </p>
          ) : null}

          <div className="flex gap-1 overflow-x-auto border-b border-zinc-200">
            {ABAS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                className={`relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium ${
                  aba === item.id ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                {item.label}
                {aba === item.id ? (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 bg-zinc-950" />
                ) : null}
              </button>
            ))}
          </div>

          {aba === "geral" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-zinc-500">Nome</span>
                <input
                  value={nome}
                  onChange={(event) => setNome(event.target.value)}
                  className="updv-input"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-500">Valor mensal</span>
                <input
                  value={valorMensal}
                  onChange={(event) => setValorMensal(event.target.value)}
                  className="updv-input"
                  placeholder="197,00"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-zinc-500">Descrição curta</span>
                <input
                  value={descricao}
                  onChange={(event) => setDescricao(event.target.value)}
                  className="updv-input"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-500">Valor anual</span>
                <input
                  value={valorAnual}
                  onChange={(event) => setValorAnual(event.target.value)}
                  className="updv-input"
                  placeholder="Opcional"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-500">Ordem</span>
                <input
                  value={ordem}
                  onChange={(event) => setOrdem(event.target.value)}
                  type="number"
                  className="updv-input"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(event) => setAtivo(event.target.checked)}
                />
                Ativo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={destaque}
                  onChange={(event) => setDestaque(event.target.checked)}
                />
                Destaque
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-zinc-500">Texto do destaque</span>
                <input
                  value={textoDestaque}
                  onChange={(event) => setTextoDestaque(event.target.value)}
                  className="updv-input"
                  placeholder="Mais contratado"
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={oferecerTeste}
                  onChange={(event) => setOferecerTeste(event.target.checked)}
                />
                Oferecer período de teste
              </label>
              {oferecerTeste ? (
                <label className="text-sm">
                  <span className="mb-1 block text-zinc-500">Dias de teste</span>
                  <input
                    value={diasTeste}
                    onChange={(event) => setDiasTeste(event.target.value)}
                    type="number"
                    min={0}
                    className="updv-input"
                  />
                </label>
              ) : null}
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-zinc-500">Nível de suporte</span>
                <select
                  value={nivelSuporte}
                  onChange={(event) =>
                    setNivelSuporte(event.target.value as NivelSuporte)
                  }
                  className="updv-input"
                >
                  {(Object.keys(ROTULOS_NIVEL_SUPORTE) as NivelSuporte[]).map(
                    (nivel) => (
                      <option key={nivel} value={nivel}>
                        {ROTULOS_NIVEL_SUPORTE[nivel]}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>
          ) : null}

          {aba === "limites" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["usuarios", "filiais"] as const).map((chave) => {
                const ilimitado = limites[chave] == null;
                return (
                  <section
                    key={chave}
                    className="rounded-xl border border-zinc-200 p-3"
                  >
                    <h3 className="text-sm font-semibold text-zinc-950">
                      {ROTULOS_LIMITE[chave]}
                    </h3>
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`limite-${chave}`}
                        checked={!ilimitado}
                        onChange={() =>
                          setLimites((atual) => ({ ...atual, [chave]: 1 }))
                        }
                      />
                      Limite
                    </label>
                    <input
                      type="number"
                      min={1}
                      disabled={ilimitado}
                      value={ilimitado ? "" : String(limites[chave])}
                      onChange={(event) =>
                        setLimites((atual) => ({
                          ...atual,
                          [chave]: Number(event.target.value),
                        }))
                      }
                      className="updv-input mt-2"
                    />
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`limite-${chave}`}
                        checked={ilimitado}
                        onChange={() =>
                          setLimites((atual) => ({ ...atual, [chave]: null }))
                        }
                      />
                      Ilimitado
                    </label>
                  </section>
                );
              })}
            </div>
          ) : null}

          {aba === "recursos" ? (
            <GrupoRecursos
              categoria="comercial"
              recursos={recursos}
              onToggle={(chave, valor) =>
                setRecursos((atual) => ({ ...atual, [chave]: valor }))
              }
            />
          ) : null}

          {aba === "fiscal" ? (
            <div className="space-y-5">
              <GrupoRecursos
                categoria="fiscal"
                recursos={recursos}
                onToggle={(chave, valor) =>
                  setRecursos((atual) => ({ ...atual, [chave]: valor }))
                }
              />
              <GrupoRecursos
                categoria="contabilidade"
                recursos={recursos}
                onToggle={(chave, valor) =>
                  setRecursos((atual) => ({ ...atual, [chave]: valor }))
                }
              />
            </div>
          ) : null}

          {aba === "integracoes" ? (
            <GrupoRecursos
              categoria="integracoes"
              recursos={recursos}
              onToggle={(chave, valor) =>
                setRecursos((atual) => ({ ...atual, [chave]: valor }))
              }
            />
          ) : null}
        </div>
      </AppModal>
    </div>
  );
}
