"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { definirEmpresaAtiva } from "@/app/contabilidade/actions";
import { chaveCompetencia, competenciaAtual, rotuloCompetencia } from "@/lib/contabilidade/competencia";
import { StatusBadge } from "@/components/ui/status-badge";

type EmpresaOpcao = {
  empresaId: string;
  nome: string;
  cnpj: string | null;
};

type CompetenciaRow = {
  ano: number;
  mes: number;
  status: string;
};

const MESES = [
  "01", "02", "03", "04", "05", "06",
  "07", "08", "09", "10", "11", "12",
];

export function ContabilidadeTopo({
  empresaId,
  empresaNome,
  empresaCnpj,
  empresas,
  ehContador,
  competencias,
}: {
  empresaId: string;
  empresaNome: string;
  empresaCnpj: string | null;
  empresas: EmpresaOpcao[];
  ehContador: boolean;
  competencias: CompetenciaRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const atual = competenciaAtual();
  const competencia = params.get("competencia") ?? chaveCompetencia(atual);
  const [ano, mes] = competencia.split("-");
  const registro = competencias.find(
    (item) =>
      item.ano === Number(ano) && item.mes === Number(mes)
  );
  const liberada = registro?.status === "LIBERADA_CONTABILIDADE";

  function atualizarCompetencia(proximoAno: string, proximoMes: string) {
    const query = new URLSearchParams(params.toString());
    query.set("competencia", `${proximoAno}-${proximoMes}`);
    router.push(`${pathname}?${query.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-zinc-950">
          {empresaNome}
        </p>
        <p className="text-[12px] text-zinc-500">
          {empresaCnpj || "CNPJ não informado"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {empresas.length > 1 && (
          <form action={definirEmpresaAtiva} className="flex items-center gap-1.5">
            <input type="hidden" name="destino" value={`${pathname}?${params.toString()}`} />
            <select
              name="empresa_id"
              defaultValue={empresaId}
              className="updv-input h-8 text-[12px]"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              {empresas.map((empresa) => (
                <option key={empresa.empresaId} value={empresa.empresaId}>
                  {empresa.nome}
                </option>
              ))}
            </select>
          </form>
        )}

        <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
          Competência
          <select
            value={mes}
            className="updv-input h-8 text-[12px]"
            onChange={(event) => atualizarCompetencia(ano, event.target.value)}
          >
            {MESES.map((item, index) => (
              <option key={item} value={item}>
                {rotuloCompetencia({ ano: Number(ano), mes: index + 1 }).split("/")[0]}
              </option>
            ))}
          </select>
          <select
            value={ano}
            className="updv-input h-8 w-[84px] text-[12px]"
            onChange={(event) => atualizarCompetencia(event.target.value, mes)}
          >
            {Array.from({ length: 6 }, (_, index) => atual.ano - 3 + index).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        {ehContador && (
          <StatusBadge status={liberada ? "sucesso" : "pendente"}>
            {liberada ? "Liberada pela empresa" : "Em preparação"}
          </StatusBadge>
        )}
      </div>
    </div>
  );
}
