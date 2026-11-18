"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  descreverCampo,
  exibirReais,
  orientacaoCaptura,
  prepararValorCaptura,
  semMascara,
  tituloCaptura,
  valorDaVenda,
  type CapturaBiblioteca,
} from "@/lib/pdv/tef/captura-administrativa";

export function TefCapturaBiblioteca({
  operacao = "Operação administrativa",
  tipoDado,
  identificador,
  prompt,
  oculto,
  captura,
  ocupado,
  homologacao = false,
  vendaChave = "",
  onVenda,
  onEnviar,
}: {
  operacao?: string;
  tipoDado: number | null;
  identificador: number | null;
  prompt: string;
  oculto: boolean;
  captura: CapturaBiblioteca | null;
  ocupado: boolean;
  homologacao?: boolean;
  vendaChave?: string;
  onVenda?: (chave: string) => void;
  onEnviar: (valor: string) => void;
}) {
  const descricao = descreverCampo(identificador, tipoDado, captura);
  const titulo = tituloCaptura(tipoDado, identificador, captura, prompt);
  const mensagem = (captura?.promptBiblioteca || prompt).trim();
  const [digitado, setDigitado] = useState(captura?.valorInicial ?? "");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const somenteLeitura = tipoDado === 2 && captura?.tiposEntrada === 0;
  const senha = oculto || tipoDado === 17 || descricao.formato === "autenticacao";
  const preparado = prepararValorCaptura(somenteLeitura ? captura?.valorInicial ?? "" : digitado, tipoDado, identificador, captura);
  const podeEnviar = !ocupado && (preparado.ok || (captura?.aceitaNulo === true && digitado.trim() === ""));

  const manual = vendaChave === "manual";
  const vendaUnica = !vendaChave && captura?.vendas?.length === 1 ? captura.vendas[0] : undefined;
  const chaveSelecionada = manual ? "" : vendaChave || vendaUnica?.chave || "";

  useEffect(() => {
    if (manual) {
      setDigitado("");
      setConfirmacao("");
      setErro("");
      return;
    }
    const escolhida = captura?.vendas?.find((venda) => venda.chave === chaveSelecionada);
    const daVenda = escolhida ? valorDaVenda(escolhida, identificador) : "";
    setDigitado(daVenda || captura?.valorInicial || "");
    setConfirmacao("");
    setErro("");
  }, [identificador, tipoDado, captura?.valorInicial, captura?.promptBiblioteca, captura?.vendas, chaveSelecionada, manual]);

  function aplicarCalendario(iso: string) {
    const [ano, mes, dia] = iso.split("-");
    if (ano && mes && dia) setDigitado(`${dia}/${mes}/${ano}`);
  }

  function aplicarMes(iso: string) {
    const [ano, mes] = iso.split("-");
    if (ano && mes) setDigitado(`${mes}/${ano}`);
  }

  function normalizarReais() {
    const resultado = prepararValorCaptura(digitado, tipoDado, identificador, captura);
    if (resultado.ok) setDigitado(exibirReais(Number(resultado.valor)));
  }

  function escolherVenda(chave: string) {
    onVenda?.(chave || "manual");
    const venda = captura?.vendas?.find((item) => item.chave === chave);
    setDigitado(venda ? valorDaVenda(venda, identificador) : "");
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (!preparado.ok) {
      setErro(preparado.erro);
      return;
    }
    if (captura?.validacaoDado === 6 && confirmacao === "" && descricao.formato === "nativo") {
      setConfirmacao(preparado.valor);
      setDigitado(captura.valorInicial);
      setErro("");
      return;
    }
    if (captura?.validacaoDado === 6 && descricao.formato === "nativo" && semMascara(digitado, captura.mascara) !== confirmacao) {
      setConfirmacao("");
      setDigitado(captura.valorInicial);
      setErro(captura.mensagemValidacao || captura.mensagemConfirmacao || "Os dois valores são diferentes.");
      return;
    }
    setErro("");
    onEnviar(preparado.valor);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{operacao}</p>
        <h3 className="mt-1 text-base font-semibold text-zinc-950">{confirmacao ? captura?.mensagemConfirmacao || "Digite o mesmo dado novamente." : titulo}</h3>
        {mensagem && mensagem !== titulo ? <p className="mt-1 text-sm text-zinc-700">Mensagem da biblioteca: {mensagem}</p> : null}
      </div>
      <div className="flex flex-col gap-4 md:flex-row">
        <form className="min-w-0 flex-1 space-y-2" onSubmit={enviar}>
          {captura?.vendas && captura.vendas.length > 0 ? (
            <label className="block text-sm text-zinc-800">
              Venda registrada
              <select
                aria-label="Venda registrada"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                value={chaveSelecionada}
                disabled={ocupado}
                onChange={(event) => escolherVenda(event.target.value)}
              >
                <option value="">Preencher manualmente</option>
                {captura.vendas.map((venda) => (
                  <option key={venda.chave} value={venda.chave}>{venda.texto}</option>
                ))}
              </select>
            </label>
          ) : null}
          {descricao.formato === "ddmmaa" ? (
            <input aria-label="Calendário" type="date" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" onChange={(event) => aplicarCalendario(event.target.value)} />
          ) : null}
          {descricao.formato === "mmaa" ? (
            <input aria-label="Mês e ano" type="month" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" onChange={(event) => aplicarMes(event.target.value)} />
          ) : null}
          {descricao.formato === "hora" ? (
            <input aria-label="Hora" type="time" step={1} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" onChange={(event) => setDigitado(event.target.value.length === 5 ? `${event.target.value}:00` : event.target.value)} />
          ) : null}
          {descricao.formato === "centavos" ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              R$
              <input
                id="tef-captura-valor"
                data-tef-captura="digitada"
                autoFocus
                autoComplete="off"
                inputMode="decimal"
                aria-label="Valor em reais"
                placeholder="0,00"
                value={somenteLeitura ? captura?.valorInicial ?? "" : digitado}
                readOnly={somenteLeitura}
                disabled={ocupado}
                onBlur={normalizarReais}
                onChange={(event) => setDigitado(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal"
              />
            </label>
          ) : (
            <input
              id="tef-captura-valor"
              data-tef-captura="digitada"
              autoFocus
              autoComplete="off"
              type={senha ? "password" : "text"}
              inputMode={descricao.formato === "texto" || senha ? "text" : descricao.formato === "ddmmaa" || descricao.formato === "mmaa" ? "numeric" : undefined}
              placeholder={descricao.formato === "ddmmaa" ? "DD/MM/AAAA" : descricao.exemplo || captura?.mascara || undefined}
              value={somenteLeitura ? captura?.valorInicial ?? "" : digitado}
              readOnly={somenteLeitura}
              disabled={ocupado}
              onChange={(event) => setDigitado(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          )}
          {preparado.ok && !senha && !descricao.sensivel && digitado.trim() !== "" ? (
            <p className="text-sm text-zinc-700">A biblioteca recebe: {preparado.valor}</p>
          ) : null}
          {erro || (!preparado.ok && digitado.trim() !== "") ? <p className="text-sm text-red-700">{erro || preparado.erro}</p> : null}
          <button
            type="submit"
            disabled={!podeEnviar}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40"
          >
            Enviar
          </button>
        </form>
        <aside className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700 md:w-72">
          <p className="font-semibold text-zinc-950">Como preencher</p>
          <p className="mt-2">{descricao.origem}</p>
          {descricao.exemplo ? <p className="mt-2">Exemplo: {descricao.exemplo}</p> : null}
          {descricao.enviadoExemplo && !descricao.sensivel ? <p className="mt-1">A biblioteca recebe: {descricao.enviadoExemplo}</p> : null}
          <ul className="mt-2 space-y-1">
            {orientacaoCaptura(tipoDado, captura).map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>
        </aside>
      </div>
      {homologacao ? (
        <details className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600">
          <summary>Detalhes técnicos de homologação</summary>
          <dl className="mt-2 space-y-1">
            <div>Identificador: {identificador === null ? "ausente" : `0x${identificador.toString(16).toUpperCase()}`}</div>
            <div>Tipo de captura: {tipoDado ?? "ausente"}</div>
            <div>Máscara nativa: {captura?.mascara || "nenhuma"}</div>
            <div>Validação: {captura?.validacaoDado ?? "ausente"}</div>
            <div>Tamanho: {captura?.tamanhoMinimo ?? 0} a {captura?.tamanhoMaximo ?? 0}</div>
            <div>Valor convertido: {descricao.sensivel || senha ? "não exibido" : preparado.ok ? preparado.valor : "ainda inválido"}</div>
          </dl>
        </details>
      ) : null}
    </div>
  );
}
