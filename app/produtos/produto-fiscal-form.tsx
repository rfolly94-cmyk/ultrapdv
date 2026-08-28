"use client";

import {
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { salvarFiscalProduto } from "./actions";
import { analisarProdutoFiscalAction } from "./analisar-fiscal-action";
import { AnaliseFiscalPainel } from "@/components/ia/analise-fiscal-painel";
import {
  avaliarStatusFiscalProduto,
  type GrupoFiscalResumo,
} from "@/lib/fiscal/status-fiscal-produto";
import type { ResultadoClassificacaoFiscal } from "@/lib/fiscal/motor/tipos";
import { ORIGENS_MERCADORIA } from "@/lib/fiscal/tabelas-fiscais";

type Props = {
  produtoId: string;
  produtoNome: string;
  grupoFiscalId: string | null;
  ncm: string | null;
  cest: string | null;
  origemProduto: string | null;
  grupos: GrupoFiscalResumo[];
};

function percentual(
  valor: number | string | null | undefined
) {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) {
    return "—";
  }

  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function texto(valor: string | null | undefined) {
  const t = String(valor ?? "").trim();
  return t || "—";
}

export function ProdutoFiscalForm({
  produtoId,
  produtoNome,
  grupoFiscalId,
  ncm,
  cest,
  origemProduto,
  grupos,
}: Props) {
  const [grupoId, setGrupoId] = useState(
    grupoFiscalId ?? ""
  );
  const [ncmAtual, setNcmAtual] = useState(ncm ?? "");
  const [analise, setAnalise] = useState<ResultadoClassificacaoFiscal | null>(
    null
  );
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);
  const [pendingAnalise, startAnalise] = useTransition();

  const grupoSelecionado = useMemo(
    () => grupos.find((grupo) => grupo.id === grupoId) ?? null,
    [grupos, grupoId]
  );

  const status = avaliarStatusFiscalProduto({
    ncm: ncmAtual,
    grupo: grupoSelecionado,
  });

  const gruposSelect = grupos.filter(
    (grupo) => grupo.ativo || grupo.id === (grupoFiscalId ?? "")
  );

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-500">
            Configuração fiscal
          </p>
          <h2 className="mt-1 text-2xl font-bold">{produtoNome}</h2>
          <p className="mt-2 text-sm text-zinc-500">
            NCM, CEST e origem pertencem ao produto. CFOP, ICMS, PIS,
            COFINS, IPI e IBS/CBS vêm do grupo fiscal na emissão.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <a
            href="/produtos"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
          >
            Fechar
          </a>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            disabled={pendingAnalise}
            onClick={() => {
              setErroAnalise(null);
              startAnalise(async () => {
                const saida = await analisarProdutoFiscalAction(produtoId);
                if (!saida.ok) {
                  setErroAnalise(saida.erro);
                  return;
                }
                setAnalise(saida.resultado);
              });
            }}
          >
            {pendingAnalise ? "Analisando..." : "Analisar com IA"}
          </button>
        </div>
      </div>

      <form action={salvarFiscalProduto} className="mt-7">
        <input type="hidden" name="produto_id" value={produtoId} />

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              status.ok
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {status.rotulo}
          </span>
          {status.motivos.length > 0 && (
            <ul className="text-sm text-amber-700">
              {status.motivos.map((motivo) => (
                <li key={motivo}>{motivo}</li>
              ))}
            </ul>
          )}
        </div>

        <h3 className="mt-8 font-semibold text-zinc-900">
          Dados do produto
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          Estes campos são gravados em produtos_fiscal e lidos na emissão.
        </p>

        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <div>
            <Label>NCM</Label>
            <input
              name="ncm"
              value={ncmAtual}
              onChange={(event) => setNcmAtual(event.target.value)}
              required
              placeholder="8 dígitos"
              className={inputClass}
            />
          </div>
          <Campo
            label="CEST"
            name="cest"
            defaultValue={cest}
            placeholder="7 dígitos, se houver"
            dica="Opcional — informe somente quando aplicável ao produto."
          />
          <div>
            <Label>Origem da mercadoria</Label>
            <select
              name="origem_produto"
              defaultValue={origemProduto ?? "0"}
              className={inputClass}
            >
              {ORIGENS_MERCADORIA.map((origem) => (
                <option key={origem.codigo} value={origem.codigo}>
                  {origem.codigo} — {origem.descricao}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8 border-t border-zinc-200 pt-6">
          <h3 className="font-semibold text-zinc-900">
            Tributação herdada do grupo fiscal
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Somente leitura. Trocar o grupo altera só o vínculo do
            produto. Os tributos não são copiados para o cadastro
            fiscal do item.
          </p>

          <div className="mt-4 max-w-xl">
            <Label>Grupo fiscal</Label>
            <select
              name="grupo_fiscal_id"
              value={grupoId}
              onChange={(event) => setGrupoId(event.target.value)}
              className={inputClass}
            >
              <option value="">— Sem grupo fiscal —</option>
              {gruposSelect.map((grupo) => (
                <option key={grupo.id} value={grupo.id}>
                  {grupo.nome}
                  {grupo.ativo ? "" : " (inativo)"}
                </option>
              ))}
            </select>
          </div>

          {!grupoSelecionado ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Nenhum grupo fiscal selecionado. A emissão não tem de onde
              herdar CFOP, ICMS, PIS e COFINS.
            </div>
          ) : (
            <>
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Tributação herdada do grupo fiscal{" "}
                <strong>{grupoSelecionado.nome}</strong>. Editar CFOP ou
                CST nesta tela do produto não alteraria a emissão — por
                isso esses campos não são editáveis aqui. Para mudar a
                regra, edite o{" "}
                <a
                  href={`/produtos/grupos-fiscais?editar=${grupoSelecionado.id}`}
                  className="font-semibold underline"
                >
                  grupo fiscal
                </a>
                .
              </div>

              {!grupoSelecionado.ativo && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Este grupo está inativo e não pode ser usado na emissão.
                </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <DadoLeitura
                  label="Nome do grupo"
                  valor={grupoSelecionado.nome}
                />
                <DadoLeitura
                  label="CFOP interno"
                  valor={texto(grupoSelecionado.cfop_interno)}
                />
                <DadoLeitura
                  label="CFOP interestadual"
                  valor={texto(grupoSelecionado.cfop_interestadual)}
                />
                <DadoLeitura
                  label="ICMS CST/CSOSN"
                  valor={texto(grupoSelecionado.icms_cst_csosn)}
                />
                <DadoLeitura
                  label="Alíquota ICMS"
                  valor={`${percentual(grupoSelecionado.icms_aliquota)}%`}
                />
                <DadoLeitura
                  label="CST PIS"
                  valor={texto(grupoSelecionado.pis_cst)}
                />
                <DadoLeitura
                  label="Alíquota PIS"
                  valor={`${percentual(grupoSelecionado.pis_aliquota)}%`}
                />
                <DadoLeitura
                  label="CST COFINS"
                  valor={texto(grupoSelecionado.cofins_cst)}
                />
                <DadoLeitura
                  label="Alíquota COFINS"
                  valor={`${percentual(grupoSelecionado.cofins_aliquota)}%`}
                />
                <DadoLeitura
                  label="Aplicar IPI"
                  valor={
                    grupoSelecionado.ipi_aplicavel
                      ? "Sim"
                      : "Não"
                  }
                />
                <DadoLeitura
                  label="CST IPI"
                  valor={texto(grupoSelecionado.ipi_cst)}
                />
                <DadoLeitura
                  label="cEnq IPI"
                  valor={texto(grupoSelecionado.ipi_enquadramento)}
                />
                <DadoLeitura
                  label="Alíquota IPI"
                  valor={
                    grupoSelecionado.ipi_aplicavel
                      ? `${percentual(grupoSelecionado.ipi_aliquota)}%`
                      : "—"
                  }
                />
                <DadoLeitura
                  label="CST IBS/CBS"
                  valor={texto(grupoSelecionado.cst_ibscbs)}
                />
                <DadoLeitura
                  label="cClassTrib IBS/CBS"
                  valor={texto(grupoSelecionado.classificacao_ibscbs)}
                />
                <DadoLeitura
                  label="Alíquota IBS UF"
                  valor={`${percentual(grupoSelecionado.aliquota_ibs_uf)}%`}
                />
                <DadoLeitura
                  label="Alíquota IBS Município"
                  valor={`${percentual(grupoSelecionado.aliquota_ibs_municipio)}%`}
                />
                <DadoLeitura
                  label="Alíquota CBS"
                  valor={`${percentual(grupoSelecionado.aliquota_cbs)}%`}
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-8 flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-800"
          >
            Salvar configuração fiscal
          </button>
          <a
            href="/produtos"
            className="rounded-lg border border-zinc-300 bg-white px-6 py-3 font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancelar
          </a>
        </div>
      </form>
      {erroAnalise ? (
        <p className="mt-4 text-sm text-red-700">{erroAnalise}</p>
      ) : null}
      {analise ? (
        <AnaliseFiscalPainel
          resultado={analise}
          onConversar={() => {
            window.dispatchEvent(
              new CustomEvent("ultrapdv:abrir-assistente-ia", {
                detail: { pergunta: "Analise este produto." },
              })
            );
          }}
        />
      ) : null}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-zinc-700">
      {children}
    </label>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  required = false,
  placeholder,
  dica,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  dica?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        className={inputClass}
      />
      {dica && (
        <p className="mt-1 text-xs text-zinc-500">{dica}</p>
      )}
    </div>
  );
}

function DadoLeitura({
  label,
  valor,
}: {
  label: string;
  valor: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-900">
        {valor}
      </p>
    </div>
  );
}

const inputClass =
  "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900";
