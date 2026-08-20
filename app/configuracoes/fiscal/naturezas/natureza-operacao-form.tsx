import {
  CODIGOS_TIPO_OPERACAO_INTERNO,
  ROTULOS_FIN_NFE,
  ROTULOS_TIPO_OPERACAO,
  ROTULOS_TP_NF,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  NaturezaCfopRegrasCampos,
  type GrupoFiscalNaturezaCfop,
  type RegraCfopNaturezaForm,
} from "./natureza-cfop-regras-campos";

const inputClass =
  "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900";

export function NaturezaOperacaoForm({
  natureza,
  action,
  gruposFiscais = [],
  regrasCfop = [],
}: {
  natureza?: NaturezaOperacaoFiscal | null;
  action: (formData: FormData) => void | Promise<void>;
  gruposFiscais?: GrupoFiscalNaturezaCfop[];
  regrasCfop?: RegraCfopNaturezaForm[];
}) {
  return (
    <form
      action={action}
      className="mt-5 grid gap-5 md:grid-cols-2"
    >
      {natureza && (
        <input type="hidden" name="id" value={natureza.id} />
      )}

      <div className="md:col-span-2">
        <h3 className="text-lg font-semibold text-zinc-900">
          {natureza ? "Editar natureza" : "Nova natureza de operação"}
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          A descrição vira o natOp da NF-e. O tipo interno não é a
          finalidade fiscal (finNFe).
        </p>
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-zinc-700">
          Descrição (natOp)
        </label>
        <input
          name="descricao"
          required
          maxLength={60}
          defaultValue={natureza?.descricao ?? ""}
          placeholder="Ex.: Venda de mercadoria"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Tipo de operação interno
        </label>
        <select
          name="tipo_operacao_interno"
          defaultValue={natureza?.tipo_operacao_interno ?? "venda"}
          className={inputClass}
        >
          {CODIGOS_TIPO_OPERACAO_INTERNO.map((codigo) => (
            <option key={codigo} value={codigo}>
              {ROTULOS_TIPO_OPERACAO[codigo]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Entrada / saída (tpNF)
        </label>
        <select
          name="tp_nf"
          defaultValue={natureza?.tp_nf ?? "1"}
          className={inputClass}
        >
          <option value="1">{ROTULOS_TP_NF["1"]}</option>
          <option value="0">{ROTULOS_TP_NF["0"]}</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Finalidade fiscal (finNFe)
        </label>
        <select
          name="fin_nfe"
          defaultValue={natureza?.fin_nfe ?? "1"}
          className={inputClass}
        >
          {(Object.keys(ROTULOS_FIN_NFE) as Array<keyof typeof ROTULOS_FIN_NFE>).map(
            (codigo) => (
              <option key={codigo} value={codigo}>
                {ROTULOS_FIN_NFE[codigo]}
              </option>
            )
          )}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Status
        </label>
        <select
          name="ativo"
          defaultValue={natureza?.ativo === false ? "false" : "true"}
          className={inputClass}
        >
          <option value="true">Ativa</option>
          <option value="false">Inativa</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="padrao"
            value="true"
            defaultChecked={Boolean(natureza?.padrao)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Natureza padrão deste tipo de operação
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Só pode existir uma padrão por tipo e empresa. A emissão de
          venda usa a natureza padrão de venda se nenhuma for escolhida
          na preparação da NF-e.
        </p>
      </div>

      <div className="md:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <h4 className="font-semibold text-zinc-900">Regras de CFOP</h4>
        <p className="mt-1 text-sm text-zinc-500">
          Matriz por grupo fiscal desta empresa. Não preenchemos CFOP
          automaticamente. Saídas 5xxx (interna) e 6xxx (interestadual),
          inclusive devolução ao fornecedor. Sem fallback da venda.
        </p>
        {natureza ? (
          <NaturezaCfopRegrasCampos
            grupos={gruposFiscais}
            regras={regrasCfop}
            tipoOperacaoInterno={natureza.tipo_operacao_interno}
            naturezaPadraoVenda={
              natureza.tipo_operacao_interno === "venda" &&
              Boolean(natureza.padrao)
            }
          />
        ) : (
          <p className="mt-3 text-sm text-zinc-600">
            Salve a natureza para configurar as regras de CFOP por grupo
            fiscal.
          </p>
        )}
      </div>

      <div className="md:col-span-2 flex gap-2">
        <button type="submit" className="updv-btn updv-btn-primary">
          {natureza ? "Salvar natureza" : "Cadastrar natureza"}
        </button>
        <a href="/configuracoes/fiscal/naturezas" className="updv-btn updv-btn-ghost">
          Cancelar
        </a>
      </div>
    </form>
  );
}
