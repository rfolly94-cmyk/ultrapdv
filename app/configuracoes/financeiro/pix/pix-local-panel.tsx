"use client";

import { useMemo, useState } from "react";

import { inferirTipoChavePix } from "@/lib/pagamentos/pix/brcode";

import { gerarQrPixLocalTeste, salvarConfiguracaoPix } from "./actions";

type Props = {
  chavePix: string;
  recebedorNome: string;
  recebedorCidade: string;
  onMensagem: (mensagem: string, sucesso: boolean) => void;
};

const ROTULO_TIPO: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  evp: "Chave aleatória",
  outra: "Outra",
};

function formatarValorBr(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function PixLocalPanel({
  chavePix,
  recebedorNome,
  recebedorCidade,
  onMensagem,
}: Props) {
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [chave, setChave] = useState(chavePix);
  const [valorTeste, setValorTeste] = useState("1.00");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [valorGerado, setValorGerado] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

  const tipoChave = useMemo(() => inferirTipoChavePix(chave), [chave]);

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSalvando(true);
    try {
      const resultado = await salvarConfiguracaoPix(
        new FormData(event.currentTarget)
      );
      onMensagem(
        resultado.ok
          ? "Configuração PIX Local salva. Nenhuma credencial bancária foi gravada."
          : resultado.erro,
        Boolean(resultado.ok)
      );
    } catch (error) {
      onMensagem(
        error instanceof Error ? error.message : "Falha ao salvar o PIX Local.",
        false
      );
    } finally {
      setSalvando(false);
    }
  }

  async function gerarTeste() {
    setGerando(true);
    setCopiado(false);
    try {
      const resultado = await gerarQrPixLocalTeste(
        Number(valorTeste.replace(",", "."))
      );
      if (!resultado.ok) {
        setQrCode(null);
        setPayload(null);
        setValorGerado(null);
        onMensagem(resultado.erro, false);
        return;
      }

      setQrCode(resultado.qrCode);
      setPayload(resultado.payload);
      setValorGerado(resultado.valor);
      onMensagem(resultado.mensagem, true);
    } catch (error) {
      onMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao gerar o QR Code PIX Local.",
        false
      );
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    if (!payload) {
      return;
    }
    await navigator.clipboard.writeText(payload);
    setCopiado(true);
  }

  return (
    <>
      <form
        onSubmit={salvar}
        className="rounded-md border border-zinc-200 bg-white p-4"
      >
        <input type="hidden" name="modo" value="local_manual" />
        <h2 className="text-[15px] font-semibold text-zinc-950">
          PIX Local / Manual
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          Sem integração bancária. O UltraPDV gera o QR Code estático e o
          operador confirmará o recebimento no PDV em etapa posterior.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[13px] font-medium text-zinc-700 md:col-span-2">
            Chave PIX
            <input
              name="chave_pix"
              value={chave}
              onChange={(event) => setChave(event.target.value)}
              required
              className="updv-input mt-1 w-full"
            />
            {chave.trim() && (
              <span className="mt-1 block text-[12px] text-zinc-500">
                Tipo detectado: {ROTULO_TIPO[tipoChave] ?? tipoChave}
              </span>
            )}
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            Nome do recebedor
            <input
              name="recebedor_nome"
              defaultValue={recebedorNome}
              required
              maxLength={25}
              className="updv-input mt-1 w-full"
            />
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            Cidade
            <input
              name="recebedor_cidade"
              defaultValue={recebedorCidade}
              required
              maxLength={15}
              className="updv-input mt-1 w-full"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={salvando}
          className="updv-btn updv-btn-primary mt-4"
        >
          {salvando ? "Salvando..." : "Salvar PIX Local"}
        </button>
      </form>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">
          Teste de QR Code
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          Gera um BR Code estático com os dados salvos desta empresa. Não
          registra cobrança e não confirma pagamento.
        </p>

        <label className="mt-3 block text-[13px] font-medium text-zinc-700">
          Valor
          <input
            value={valorTeste}
            onChange={(event) => setValorTeste(event.target.value)}
            className="updv-input mt-1 w-40"
          />
        </label>

        <button
          type="button"
          disabled={gerando}
          onClick={() => void gerarTeste()}
          className="updv-btn updv-btn-primary mt-4"
        >
          {gerando ? "Gerando..." : "Gerar QR de teste"}
        </button>

        {qrCode && payload && valorGerado != null && (
          <div className="mt-4 space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="QR Code PIX Local"
              className="h-48 w-48 bg-white"
            />
            <p className="text-[13px] text-zinc-700">
              Valor: {formatarValorBr(valorGerado)}
            </p>
            <p className="text-[12px] font-medium text-zinc-700">
              PIX Copia e Cola
            </p>
            <p className="break-all rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[12px] text-zinc-700">
              {payload}
            </p>
            <button
              type="button"
              onClick={() => void copiar()}
              className="updv-btn updv-btn-ghost"
            >
              {copiado ? "Código copiado" : "Copiar código"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
