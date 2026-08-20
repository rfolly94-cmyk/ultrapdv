"use client";

import {
  formatarAjusteEstoque,
  formatarQuantidadeEstoque,
} from "@/lib/importacao/normalizadores";
import type { LinhaRevisaoImportacao, ResumoImportacao } from "@/lib/importacao/tipos";

const ROTULO: Record<LinhaRevisaoImportacao["situacao"], string> = {
  criar: "Será criado",
  atualizar: "Será atualizado",
  ignorado: "Ignorado",
  erro: "Erro",
  aviso: "Aviso",
};

export function PreviewImportacao({
  resumo,
  linhas,
  pagina,
  porPagina,
  onPagina,
}: {
  resumo: ResumoImportacao;
  linhas: LinhaRevisaoImportacao[];
  pagina: number;
  porPagina: number;
  onPagina: (pagina: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const fatia = linhas.slice((pagina - 1) * porPagina, pagina * porPagina);
  const mostrarEstoque = linhas.some(
    (linha) => !linha.ignorarEstoque && linha.estoquePlanilha != null
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-5">
        <ResumoCard rotulo="Linhas encontradas" valor={resumo.total} />
        <ResumoCard rotulo="Novos" valor={resumo.criar} />
        <ResumoCard rotulo="Atualizações" valor={resumo.atualizar} />
        <ResumoCard rotulo="Ignorados" valor={resumo.ignorados} />
        <ResumoCard rotulo="Com erro" valor={resumo.erros} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <table className="updv-table min-w-[800px]">
            <thead>
              <tr>
                <th>Linha</th>
                <th>Situação</th>
                <th>Código</th>
                <th>Descrição</th>
                <th>Venda</th>
                {mostrarEstoque ? (
                  <>
                    <th>Estoque atual</th>
                    <th>Estoque da planilha</th>
                    <th>Ajuste</th>
                    <th>Estoque após importação</th>
                  </>
                ) : null}
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {fatia.map((linha) => (
                <tr key={linha.numero}>
                  <td>{linha.numero}</td>
                  <td>{ROTULO[linha.situacao]}</td>
                  <td>{linha.codigo || "—"}</td>
                  <td className="max-w-[260px] truncate">{linha.descricao || "—"}</td>
                  <td>{linha.venda || "—"}</td>
                  {mostrarEstoque ? (
                    <>
                      <td>
                        {linha.ignorarEstoque || linha.estoqueAtualSistema == null
                          ? "—"
                          : formatarQuantidadeEstoque(linha.estoqueAtualSistema)}
                      </td>
                      <td>
                        {linha.ignorarEstoque || linha.estoquePlanilha == null
                          ? "—"
                          : formatarQuantidadeEstoque(linha.estoquePlanilha)}
                      </td>
                      <td>
                        {linha.ignorarEstoque || linha.ajusteEstoque == null
                          ? "—"
                          : formatarAjusteEstoque(linha.ajusteEstoque)}
                      </td>
                      <td>
                        {linha.ignorarEstoque || linha.estoqueAposImportacao == null
                          ? "—"
                          : formatarQuantidadeEstoque(linha.estoqueAposImportacao)}
                      </td>
                    </>
                  ) : null}
                  <td className="max-w-[320px] truncate">{linha.observacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2 text-[13px]">
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            disabled={pagina <= 1}
            onClick={() => onPagina(pagina - 1)}
          >
            Anterior
          </button>
          <span>
            Página {pagina} de {totalPaginas}
          </span>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            disabled={pagina >= totalPaginas}
            onClick={() => onPagina(pagina + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

function ResumoCard({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[11px] text-zinc-400">{rotulo}</p>
      <p className="mt-1 text-[17px] font-semibold">{valor.toLocaleString("pt-BR")}</p>
    </div>
  );
}
