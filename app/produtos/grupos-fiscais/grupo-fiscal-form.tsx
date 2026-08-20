"use client";

import {
  useState,
  type ReactNode,
} from "react";

import {
  CFOPS_INTERNOS,
  CFOPS_INTERESTADUAIS,
  CSOSN,
  CST_ICMS,
  CST_PIS_COFINS,
  CST_IPI_SAIDA,
} from "@/lib/fiscal/tabelas-fiscais";

import {
  FiscalCodeSelect,
} from "./fiscal-code-select";

import {
  IbsCbsSelect,
} from "./ibs-cbs-select";

type Grupo = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  cfop_interno: string | null;
  cfop_interestadual: string | null;
  icms_cst_csosn: string | null;
  icms_aliquota: number | string;
  pis_cst: string | null;
  pis_aliquota: number | string;
  cofins_cst: string | null;
  cofins_aliquota: number | string;
  ipi_aplicavel?: boolean | null;
  ipi_cst: string | null;
  ipi_aliquota:
    | number
    | string
    | null;
  ipi_enquadramento?: string | null;

  cst_ibscbs: string | null;
  classificacao_ibscbs: string | null;

  aliquota_ibs_uf:
    | number
    | string
    | null;

  aliquota_ibs_municipio:
    | number
    | string
    | null;

  aliquota_cbs:
    | number
    | string
    | null;
};

type CstIbscbs = {
  codigo: string;
  descricao: string;
  permite_nfe: boolean;
  permite_nfce: boolean;
};

type ClassTrib = {
  codigo: string;
  cst_codigo: string;
  descricao: string;
  percentual_reducao_ibs:
    | number
    | string
    | null;
  percentual_reducao_cbs:
    | number
    | string
    | null;
  permite_nfe: boolean;
  permite_nfce: boolean;
};

type Props = {
  grupo?: Grupo | null;
  action: (
    formData: FormData
  ) => void | Promise<void>;
  tipoIcms:
    | "CSOSN"
    | "CST"
    | "AMBOS";
  cstsIbscbs: CstIbscbs[];
  classificacoesIbscbs: ClassTrib[];
};

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="md:col-span-2 mt-2 border-t border-zinc-200 pt-6">
        <h3 className="text-lg font-semibold text-zinc-900">
          {titulo}
        </h3>
        {descricao && (
          <p className="mt-1 text-sm text-zinc-500">
            {descricao}
          </p>
        )}
      </div>
      {children}
    </>
  );
}

function CampoPercentual({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>

      <div className="relative mt-2">
        <input
          name={name}
          inputMode="decimal"
          defaultValue={
            defaultValue ?? "0"
          }
          placeholder="0,00"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 pr-10 outline-none focus:border-zinc-900"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-500">
          %
        </span>
      </div>
    </div>
  );
}

export function GrupoFiscalForm({
  grupo,
  action,
  tipoIcms,
  cstsIbscbs,
  classificacoesIbscbs,
}: Props) {
  const [ipiAplicavel, setIpiAplicavel] =
    useState(Boolean(grupo?.ipi_aplicavel));

  const opcoesIcms =
    tipoIcms === "CSOSN"
      ? CSOSN
      : tipoIcms === "CST"
        ? CST_ICMS
        : [
            ...CSOSN.map((item) => ({
              ...item,
              descricao:
                `CSOSN - ${item.descricao}`,
            })),
            ...CST_ICMS.map((item) => ({
              ...item,
              descricao:
                `CST - ${item.descricao}`,
            })),
          ];

  return (
    <form
      action={action}
      className="mt-5 grid gap-5 md:grid-cols-2"
    >
      {grupo && (
        <input
          type="hidden"
          name="id"
          value={grupo.id}
        />
      )}

      <div className="md:col-span-2">
        <h3 className="text-lg font-semibold text-zinc-900">
          Dados gerais
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          Identificação do grupo. As regras tributárias
          ficam nas seções abaixo.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Nome
        </label>

        <input
          name="nome"
          defaultValue={grupo?.nome ?? ""}
          required
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
        />
      </div>

      {grupo && (
        <div>
          <label className="block text-sm font-medium text-zinc-700">
            Status
          </label>

          <select
            name="ativo"
            defaultValue={
              grupo.ativo
                ? "true"
                : "false"
            }
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
          >
            <option value="true">
              Ativo
            </option>
            <option value="false">
              Inativo
            </option>
          </select>
        </div>
      )}

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-zinc-700">
          Descrição
        </label>

        <input
          name="descricao"
          defaultValue={
            grupo?.descricao ?? ""
          }
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
        />
      </div>

      <Secao
        titulo="CFOP"
        descricao="Clique no campo e pesquise pelo código ou pela descrição."
      />

      <FiscalCodeSelect
        label="CFOP interno"
        name="cfop_interno"
        opcoes={CFOPS_INTERNOS}
        defaultValue={
          grupo?.cfop_interno
        }
        required
        placeholder="Ex.: 5405 ou substituição"
      />

      <FiscalCodeSelect
        label="CFOP interestadual"
        name="cfop_interestadual"
        opcoes={CFOPS_INTERESTADUAIS}
        defaultValue={
          grupo?.cfop_interestadual
        }
        required
        placeholder="Ex.: 6102 ou venda"
      />

      <Secao
        titulo="ICMS"
        descricao={
          tipoIcms === "CSOSN"
            ? "A empresa está configurada para usar CSOSN."
            : tipoIcms === "CST"
              ? "A empresa está configurada para usar CST ICMS."
              : "CRT não identificado. Serão exibidos CSOSN e CST até a configuração fiscal ser concluída."
        }
      />

      <FiscalCodeSelect
        label={
          tipoIcms === "CSOSN"
            ? "CSOSN"
            : tipoIcms === "CST"
              ? "CST ICMS"
              : "CSOSN / CST ICMS"
        }
        name="icms_cst_csosn"
        opcoes={opcoesIcms}
        defaultValue={
          grupo?.icms_cst_csosn
        }
        required
        placeholder="Digite código ou descrição"
      />

      <CampoPercentual
        label="Alíquota ICMS"
        name="icms_aliquota"
        defaultValue={
          grupo?.icms_aliquota
        }
      />

      <Secao titulo="PIS" />

      <FiscalCodeSelect
        label="CST PIS"
        name="pis_cst"
        opcoes={CST_PIS_COFINS}
        defaultValue={grupo?.pis_cst}
        required
      />

      <CampoPercentual
        label="Alíquota PIS"
        name="pis_aliquota"
        defaultValue={
          grupo?.pis_aliquota
        }
      />

      <Secao titulo="COFINS" />

      <FiscalCodeSelect
        label="CST COFINS"
        name="cofins_cst"
        opcoes={CST_PIS_COFINS}
        defaultValue={
          grupo?.cofins_cst
        }
        required
      />

      <CampoPercentual
        label="Alíquota COFINS"
        name="cofins_aliquota"
        defaultValue={
          grupo?.cofins_aliquota
        }
      />

      <Secao
        titulo="IPI"
        descricao="Regra da mercadoria/operação. O perfil IPI da empresa (não contribuinte, industrial ou equiparado) fica em Configurações fiscais. NFC-e modelo 65 nunca envia IPI."
      />

      <div className="md:col-span-2">
        <label className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
          <input
            type="checkbox"
            name="ipi_aplicavel"
            value="true"
            checked={ipiAplicavel}
            onChange={(event) =>
              setIpiAplicavel(event.target.checked)
            }
            className="mt-0.5"
          />
          <span>
            <strong>Aplicar IPI</strong>
            <span className="mt-1 block text-zinc-500">
              Desmarcado: a emissão não envia grupo IPI.
              CST, cEnq e alíquota ficam ocultos e não
              são exigidos.
            </span>
          </span>
        </label>
      </div>

      {ipiAplicavel ? (
        <>
          <FiscalCodeSelect
            label="CST do IPI"
            name="ipi_cst"
            opcoes={CST_IPI_SAIDA}
            defaultValue={grupo?.ipi_cst}
            required
            placeholder="50, 51, 52, 53, 54, 55 ou 99"
          />

          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Código de enquadramento do IPI — cEnq
            </label>
            <input
              name="ipi_enquadramento"
              defaultValue={
                grupo?.ipi_enquadramento ?? ""
              }
              required
              inputMode="numeric"
              maxLength={3}
              pattern="[0-9]{1,3}"
              placeholder="1, 01, 001 ou 999"
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Somente 1 a 3 dígitos, como informado.
              O sistema não completa zeros nem preenche 999.
            </p>
          </div>

          <CampoPercentual
            label="Alíquota do IPI"
            name="ipi_aliquota"
            defaultValue={grupo?.ipi_aliquota}
          />

          <p className="md:col-span-2 text-sm text-zinc-500">
            CST 50 e 99 usam alíquota. CST 50 exige valor
            maior que zero. CST 51 a 55 não exigem alíquota
            positiva.
          </p>
        </>
      ) : (
        <>
          <input
            type="hidden"
            name="ipi_cst"
            value={grupo?.ipi_cst ?? ""}
          />
          <input
            type="hidden"
            name="ipi_enquadramento"
            value={grupo?.ipi_enquadramento ?? ""}
          />
          <input
            type="hidden"
            name="ipi_aliquota"
            value={
              grupo?.ipi_aliquota == null
                ? "0"
                : String(grupo.ipi_aliquota)
            }
          />
        </>
      )}

      <Secao
        titulo="IBS / CBS"
        descricao="Escolha o CST e depois o cClassTrib. O UltraPDV mostra somente as classificações compatíveis e aplica automaticamente os percentuais de redução do catálogo oficial."
      />

      <IbsCbsSelect
        csts={cstsIbscbs}
        classificacoes={
          classificacoesIbscbs
        }
        defaultCst={
          grupo?.cst_ibscbs
        }
        defaultClassTrib={
          grupo?.classificacao_ibscbs
        }
      />

      <CampoPercentual
        label="Alíquota IBS UF"
        name="aliquota_ibs_uf"
        defaultValue={
          grupo?.aliquota_ibs_uf
        }
      />

      <CampoPercentual
        label="Alíquota IBS Município"
        name="aliquota_ibs_municipio"
        defaultValue={
          grupo?.aliquota_ibs_municipio
        }
      />

      <CampoPercentual
        label="Alíquota CBS"
        name="aliquota_cbs"
        defaultValue={
          grupo?.aliquota_cbs
        }
      />

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        O grupo será salvo com
        <strong> ibscbs_manual = false</strong>.
        Na emissão, o UltraPDV enviará os dados
        estruturados para o motor fiscal Geranet.
      </div>

      <div className="md:col-span-2 flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-800"
        >
          {grupo
            ? "Salvar"
            : "Cadastrar"}
        </button>

        {grupo && (
          <a
            href="/produtos/grupos-fiscais"
            className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancelar
          </a>
        )}
      </div>
    </form>
  );
}
