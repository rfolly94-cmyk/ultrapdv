"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Cliente = {
  id: string;
  nome: string;
  cpf_cnpj:
    | string
    | null;
};

type Props = {
  vendaId: string;
  numero:
    | number
    | string
    | null;
  clienteId:
    | string
    | null;
  tipoVenda:
    | string
    | null;
  modeloFiscalIntencao:
    | string
    | null;
  observacao:
    | string
    | null;
  clientes: Cliente[];
  clienteBloqueado: boolean;
};

type Resposta = {
  ok?: boolean;
  erro?: string;
};

export function EditarVendaForm({
  vendaId,
  numero,
  clienteId,
  tipoVenda,
  modeloFiscalIntencao,
  observacao,
  clientes,
  clienteBloqueado,
}: Props) {
  const router =
    useRouter();

  const [
    cliente,
    setCliente,
  ] =
    useState(
      clienteId ?? ""
    );

  const [
    tipo,
    setTipo,
  ] =
    useState(
      tipoVenda ??
      "balcao"
    );

  const [
    modelo,
    setModelo,
  ] =
    useState(
      modeloFiscalIntencao ??
      ""
    );

  const [
    obs,
    setObs,
  ] =
    useState(
      observacao ??
      ""
    );

  const [
    salvando,
    setSalvando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const [
    sucesso,
    setSucesso,
  ] =
    useState(false);

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          `/api/vendas/${vendaId}/editar`,
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                cliente_id:
                  cliente || null,
                tipo_venda:
                  tipo,
                modelo_fiscal_intencao:
                  modelo || null,
                observacao:
                  obs,
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as Resposta;

      if (
        !response.ok ||
        !data.ok
      ) {
        setMensagem(
          data.erro ??
          "Não foi possível alterar a venda."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        "Alteração realizada com sucesso."
      );

      router.push(
        `/vendas/${vendaId}`
      );
      router.refresh();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada ao editar a venda."
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>
          Venda #{numero ?? "—"}.
        </strong>{" "}
        Esta edição altera apenas dados comerciais que não exigem refazer estoque ou pagamentos.
        Para alterar produtos, quantidades, preços ou formas de pagamento, cancele a venda e refaça o lançamento.
      </div>

      {clienteBloqueado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          O cliente está bloqueado para edição porque esta venda possui título na Carteira/FIADO.
          Alterar o cliente diretamente deslocaria a dívida para uma pessoa diferente.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-zinc-800">
            Cliente
          </span>

          <select
            value={cliente}
            disabled={
              clienteBloqueado ||
              salvando
            }
            onChange={(event) =>
              setCliente(
                event.target.value
              )
            }
            className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500"
          >
            <option value="">
              Consumidor / sem cliente
            </option>

            {clientes.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.nome}
                  {item.cpf_cnpj
                    ? ` · ${item.cpf_cnpj}`
                    : ""}
                </option>
              )
            )}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-zinc-800">
            Tipo da venda
          </span>

          <select
            value={tipo}
            disabled={salvando}
            onChange={(event) =>
              setTipo(
                event.target.value
              )
            }
            className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
          >
            <option value="balcao">
              Balcão
            </option>
            <option value="entrega">
              Entrega
            </option>
            <option value="completa">
              Venda completa
            </option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-zinc-800">
            Intenção fiscal
          </span>

          <select
            value={modelo}
            disabled={salvando}
            onChange={(event) =>
              setModelo(
                event.target.value
              )
            }
            className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
          >
            <option value="">
              Não definida
            </option>
            <option value="65">
              NFC-e — modelo 65
            </option>
            <option value="55">
              NF-e — modelo 55
            </option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-zinc-800">
            Observação
          </span>

          <textarea
            rows={5}
            maxLength={2000}
            value={obs}
            disabled={salvando}
            onChange={(event) =>
              setObs(
                event.target.value
              )
            }
            placeholder="Observações comerciais da venda."
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-950 outline-none focus:border-blue-500"
          />

          <p className="mt-1 text-right text-xs text-zinc-500">
            {obs.length}/2000
          </p>
        </label>
      </div>

      {mensagem && (
        <div
          className={[
            "rounded-xl border p-3 text-sm",
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800",
          ].join(" ")}
        >
          {mensagem}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
        >
          {salvando
            ? "Salvando..."
            : "Salvar alterações"}
        </button>

        <button
          type="button"
          disabled={salvando}
          onClick={() =>
            router.push(
              `/vendas/${vendaId}`
            )
          }
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
        >
          Cancelar edição
        </button>
      </div>
    </div>
  );
}
