"use client";

import { FiscalCodeSelect } from "@/app/produtos/grupos-fiscais/fiscal-code-select";
import {
  CFOPS_INTERESTADUAIS,
  CFOPS_INTERNOS,
} from "@/lib/fiscal/tabelas-fiscais";

export type GrupoFiscalNaturezaCfop = {
  id: string;
  nome: string;
  ativo: boolean;
  cfop_interno: string | null;
  cfop_interestadual: string | null;
};

export type RegraCfopNaturezaForm = {
  grupo_fiscal_id: string;
  tipo_destino: "interna" | "interestadual";
  cfop: string;
  ativo: boolean;
};

function cfopDaRegra(
  regras: RegraCfopNaturezaForm[],
  grupoId: string,
  tipoDestino: "interna" | "interestadual"
) {
  return (
    regras.find(
      (regra) =>
        regra.grupo_fiscal_id === grupoId &&
        regra.tipo_destino === tipoDestino &&
        regra.ativo
    )?.cfop ?? ""
  );
}

export function NaturezaCfopRegrasCampos({
  grupos,
  regras,
  naturezaPadraoVenda,
  tipoOperacaoInterno,
}: {
  grupos: GrupoFiscalNaturezaCfop[];
  regras: RegraCfopNaturezaForm[];
  naturezaPadraoVenda: boolean;
  tipoOperacaoInterno?: string;
}) {
  if (grupos.length === 0) {
    return (
      <p className="mt-3 text-sm text-zinc-600">
        Nenhum grupo fiscal ativo nesta empresa. Cadastre grupos em
        Produtos → Grupos fiscais para configurar a matriz de CFOP.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      {tipoOperacaoInterno === "devolucao_fornecedor" ? (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Devolução ao fornecedor: configure CFOP por grupo (interna 5xxx e
          interestadual 6xxx). O Ultra não escolhe 5202/6202 sozinho. Sem
          regra, a emissão é bloqueada.
        </p>
      ) : null}
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500">
            <th className="py-2 pr-3 font-medium">Grupo fiscal</th>
            <th className="py-2 pr-3 font-medium">Interna</th>
            <th className="py-2 font-medium">Interestadual</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((grupo) => {
            const interno = cfopDaRegra(regras, grupo.id, "interna");
            const interestadual = cfopDaRegra(
              regras,
              grupo.id,
              "interestadual"
            );

            return (
              <tr key={grupo.id} className="border-b border-zinc-100 align-top">
                <td className="py-3 pr-3">
                  <p className="font-medium text-zinc-900">{grupo.nome}</p>
                  {naturezaPadraoVenda ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      Sem regra: fallback {grupo.cfop_interno || "—"} /{" "}
                      {grupo.cfop_interestadual || "—"}.
                    </p>
                  ) : null}
                </td>
                <td className="py-3 pr-3 min-w-[220px]">
                  <FiscalCodeSelect
                    label="Interna"
                    name={`cfop_interna_${grupo.id}`}
                    opcoes={CFOPS_INTERNOS}
                    defaultValue={interno || null}
                    placeholder={
                      naturezaPadraoVenda
                        ? "Fallback do grupo fiscal"
                        : "Não configurado"
                    }
                  />
                </td>
                <td className="py-3 min-w-[220px]">
                  <FiscalCodeSelect
                    label="Interestadual"
                    name={`cfop_interestadual_${grupo.id}`}
                    opcoes={CFOPS_INTERESTADUAIS}
                    defaultValue={interestadual || null}
                    placeholder={
                      naturezaPadraoVenda
                        ? "Fallback do grupo fiscal"
                        : "Não configurado"
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
