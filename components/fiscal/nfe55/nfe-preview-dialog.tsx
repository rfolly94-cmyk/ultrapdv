"use client";

import type { ReactNode } from "react";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const ROTULOS_TPAG: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "05": "Crédito loja",
  "10": "Vale alimentação",
  "11": "Vale refeição",
  "12": "Vale presente",
  "13": "Vale combustível",
  "14": "Duplicata mercantil",
  "15": "Boleto bancário",
  "16": "Depósito bancário",
  "17": "PIX",
  "18": "Transferência",
  "19": "Cashback",
  "90": "Sem pagamento",
  "99": "Outros",
};

const ROTULOS_FRETE: Record<string, string> = {
  "0": "0 — Contratação por conta do remetente",
  "1": "1 — Contratação por conta do destinatário",
  "2": "2 — Contratação por conta de terceiros",
  "3": "3 — Transporte próprio por conta do remetente",
  "4": "4 — Transporte próprio por conta do destinatário",
  "9": "9 — Sem frete",
};

const ROTULOS_CRT: Record<string, string> = {
  "1": "1 — Simples Nacional",
  "2": "2 — Simples Nacional, excesso de sublimite",
  "3": "3 — Regime normal",
  "4": "4 — Simples Nacional, MEI",
};

const ROTULOS_FIN: Record<string, string> = {
  "1": "1 — Normal",
  "2": "2 — Complementar",
  "3": "3 — Ajuste",
  "4": "4 — Devolução",
};

const ROTULOS_TP: Record<string, string> = {
  "0": "0 — Entrada",
  "1": "1 — Saída",
};

type Registro = Record<string, unknown>;

export type RespostaPreviewNfe = {
  ok?: boolean;
  preview?: boolean;
  transmitido?: boolean;
  numeroReservado?: boolean;
  pronta?: boolean;
  mensagem?: string;
  erro?: string;
  pendencias?: string[];
  dados?: {
    serie?: number | string;
    numero?: string;
    ambiente?: string;
    natureza?: string;
    finalidade?: string;
    tipoOperacao?: string;
    crt?: number | string;
  };
  payload?: {
    nfe?: Registro;
  };
};

type Props = {
  aberto: boolean;
  carregando: boolean;
  resposta: RespostaPreviewNfe | null;
  onFechar: () => void;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown) {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function reais(valor: unknown) {
  return moeda.format(numero(valor));
}

function registro(valor: unknown): Registro | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Registro;
}

function lista(valor: unknown): Registro[] {
  return Array.isArray(valor)
    ? valor.filter((item): item is Registro => registro(item) != null)
    : [];
}

function endereco(parte: Registro | null) {
  if (!parte) return "—";
  const linha = [
    texto(parte.logradouro),
    texto(parte.numero),
    texto(parte.complemento),
    texto(parte.bairro),
    [texto(parte.municipio), texto(parte.uf)].filter(Boolean).join("/"),
    texto(parte.cep) ? `CEP ${texto(parte.cep)}` : "",
  ].filter(Boolean);
  return linha.join(" · ") || "—";
}

function Bloco({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-zinc-300">
      <h3 className="border-b border-zinc-300 bg-zinc-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
        {titulo}
      </h3>
      <div className="px-3 py-2 text-[13px] text-zinc-900">{children}</div>
    </section>
  );
}

export function NfePreviewDialog({
  aberto,
  carregando,
  resposta,
  onFechar,
}: Props) {
  if (!aberto) return null;

  const nfe = resposta?.payload?.nfe ?? null;
  const empresa = registro(nfe?.empresa);
  const cliente = registro(nfe?.cliente);
  const itens = lista(nfe?.itens);
  const pagamento = registro(nfe?.pagamento);
  const detalhamento = lista(pagamento?.detalhamento);
  const fatura = registro(nfe?.fatura);
  const duplicatas = lista(fatura?.duplicatas);
  const transportador = registro(nfe?.transportador);
  const volumes = lista(nfe?.volumes);
  const frete = texto(nfe?.frete) || "9";
  const temIbscbs = itens.some((item) => texto(item.cstIbscbs));
  const referencias = [
    texto(nfe?.notaFiscalReferencia),
    ...itens.map((item) =>
      texto(registro(item.documentoFiscalReferenciado)?.chaveAcesso)
    ),
  ].filter(Boolean);

  const soma = (campo: string) =>
    itens.reduce((total, item) => total + numero(item[campo]), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/70 p-3 md:p-6">
      <div className="w-full max-w-6xl rounded-xl bg-zinc-200 shadow-2xl">
        <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-bold tracking-wide text-amber-950">
              PRÉ-VISUALIZAÇÃO DA NF-e
            </p>
            <p className="text-sm font-semibold text-amber-900">
              SEM VALOR FISCAL · NÃO TRANSMITIDA À SEFAZ
            </p>
            <p className="mt-1 max-w-3xl text-xs text-amber-800">
              {resposta?.mensagem ||
                "Espelho para conferência. Nenhum número foi reservado."}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-zinc-800"
          >
            Fechar
          </button>
        </div>

        <div className="space-y-3 p-3 md:p-4">
          {carregando ? (
            <p className="rounded-lg bg-white px-4 py-8 text-center text-sm text-zinc-600">
              Montando a NF-e com os mesmos dados da emissão...
            </p>
          ) : null}

          {!carregando && resposta && resposta.ok === false ? (
            <div className="rounded-lg border border-red-200 bg-white p-4">
              <h2 className="font-semibold text-red-800">
                NF-e ainda não está pronta para emissão
              </h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
                {(resposta.pendencias?.length
                  ? resposta.pendencias
                  : [resposta.erro || "Não foi possível montar a pré-visualização."]
                ).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!carregando && resposta?.ok && nfe ? (
            <div className="space-y-3 bg-white p-3 shadow-sm md:p-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <Bloco titulo="Dados do emitente">
                  <p className="font-semibold">{texto(empresa?.razaoSocial) || "—"}</p>
                  {texto(empresa?.nomeFantasia) ? (
                    <p className="text-zinc-600">{texto(empresa?.nomeFantasia)}</p>
                  ) : null}
                  <p className="mt-1">
                    CNPJ {texto(empresa?.cnpj) || "—"} · IE{" "}
                    {texto(empresa?.inscricaoEstadual) || "—"}
                  </p>
                  <p>
                    CRT{" "}
                    {ROTULOS_CRT[texto(empresa?.codigoRegimeTributario)] ||
                      texto(empresa?.codigoRegimeTributario) ||
                      "—"}
                  </p>
                  <p className="mt-1 text-zinc-700">{endereco(empresa)}</p>
                </Bloco>

                <Bloco titulo="Destinatário">
                  <p className="font-semibold">{texto(cliente?.razaoSocial) || "—"}</p>
                  {texto(cliente?.nomeFantasia) ? (
                    <p className="text-zinc-600">{texto(cliente?.nomeFantasia)}</p>
                  ) : null}
                  <p className="mt-1">
                    {texto(cliente?.cnpj)
                      ? `CNPJ ${texto(cliente?.cnpj)}`
                      : texto(cliente?.cpf)
                        ? `CPF ${texto(cliente?.cpf)}`
                        : "CPF/CNPJ —"}
                    {" · "}
                    IE {texto(cliente?.inscricaoEstadual) || "Não informada"}
                  </p>
                  <p className="mt-1 text-zinc-700">{endereco(cliente)}</p>
                </Bloco>
              </div>

              <Bloco titulo="Dados da NF-e">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <p>
                    <span className="text-zinc-500">Natureza</span>
                    <br />
                    <strong>{texto(nfe.naturezaOperacao) || "—"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Modelo</span>
                    <br />
                    <strong>55</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Série</span>
                    <br />
                    <strong>{texto(empresa?.serie) || texto(resposta.dados?.serie) || "—"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Número</span>
                    <br />
                    <strong>Será atribuído na emissão</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Finalidade</span>
                    <br />
                    <strong>
                      {ROTULOS_FIN[texto(nfe.finalidade)] || texto(nfe.finalidade) || "—"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Tipo de operação</span>
                    <br />
                    <strong>{ROTULOS_TP[texto(nfe.tipo)] || texto(nfe.tipo) || "—"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Ambiente</span>
                    <br />
                    <strong>
                      {texto(resposta.dados?.ambiente) === "1" ? "Produção" : "Homologação"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-zinc-500">Emissão prevista</span>
                    <br />
                    <strong>{texto(nfe.dataEmissao) || "—"}</strong>
                  </p>
                </div>
              </Bloco>

              <Bloco titulo="Itens">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-zinc-300 text-[10px] uppercase tracking-wide text-zinc-500">
                        <th className="py-1 pr-2">Item</th>
                        <th className="py-1 pr-2">Código</th>
                        <th className="py-1 pr-2">Descrição</th>
                        <th className="py-1 pr-2">NCM</th>
                        <th className="py-1 pr-2">CEST</th>
                        <th className="py-1 pr-2">CFOP</th>
                        <th className="py-1 pr-2">UN</th>
                        <th className="py-1 pr-2 text-right">Qtd</th>
                        <th className="py-1 pr-2 text-right">Unitário</th>
                        <th className="py-1 pr-2 text-right">Desconto</th>
                        <th className="py-1 pr-2 text-right">Total</th>
                        <th className="py-1 pr-2">Origem</th>
                        <th className="py-1 pr-2">CST/CSOSN</th>
                        <th className="py-1 pr-2">PIS</th>
                        <th className="py-1">COFINS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item, indice) => {
                        const cst = texto(item.icmsCsosn) || texto(item.icmsCst) || "—";
                        return (
                          <tr key={`${texto(item.codigoProduto)}-${indice}`} className="border-b border-zinc-100 align-top">
                            <td className="py-1.5 pr-2">{indice + 1}</td>
                            <td className="py-1.5 pr-2">{texto(item.codigoProduto) || "—"}</td>
                            <td className="py-1.5 pr-2">{texto(item.nomeProduto) || "—"}</td>
                            <td className="py-1.5 pr-2">{texto(item.ncmProduto) || "—"}</td>
                            <td className="py-1.5 pr-2">{texto(item.cest) || "—"}</td>
                            <td className="py-1.5 pr-2">{texto(item.cfop) || "—"}</td>
                            <td className="py-1.5 pr-2">{texto(item.unidadeMedidaProduto) || "—"}</td>
                            <td className="py-1.5 pr-2 text-right">{numero(item.quantidade).toLocaleString("pt-BR")}</td>
                            <td className="py-1.5 pr-2 text-right">{reais(item.valorUnitario)}</td>
                            <td className="py-1.5 pr-2 text-right">{reais(item.desconto)}</td>
                            <td className="py-1.5 pr-2 text-right">{reais(item.valorTotal)}</td>
                            <td className="py-1.5 pr-2">{texto(item.origemProduto) || "—"}</td>
                            <td className="py-1.5 pr-2">{cst}</td>
                            <td className="py-1.5 pr-2">{texto(item.pisCst) || "—"}</td>
                            <td className="py-1.5">{texto(item.cofinsCst) || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 space-y-2">
                  {itens.map((item, indice) => (
                    <details key={`trib-${indice}`} className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <summary className="cursor-pointer text-[12px] font-medium text-zinc-700">
                        Ver tributação do item {indice + 1} — {texto(item.nomeProduto) || "Item"}
                      </summary>
                      <dl className="mt-2 grid gap-1 text-[12px] sm:grid-cols-2">
                        <div>Origem: {texto(item.origemProduto) || "—"}</div>
                        <div>CFOP: {texto(item.cfop) || "—"}</div>
                        <div>NCM: {texto(item.ncmProduto) || "—"}</div>
                        <div>CEST: {texto(item.cest) || "—"}</div>
                        <div>CST ICMS: {texto(item.icmsCst) || "—"}</div>
                        <div>CSOSN: {texto(item.icmsCsosn) || "—"}</div>
                        <div>CST PIS: {texto(item.pisCst) || "—"} · alíquota {texto(item.pisAliquota) || "—"}</div>
                        <div>CST COFINS: {texto(item.cofinsCst) || "—"} · alíquota {texto(item.cofinsAliquota) || "—"}</div>
                        <div>CST IPI: {texto(item.ipiCst) || "—"} · alíquota {texto(item.ipiAliquota) || "—"}</div>
                        <div>Enquadramento IPI: {texto(item.ipiEnquadramento) || "—"}</div>
                        <div>Frete do item: {reais(item.frete)}</div>
                        <div>Seguro: {reais(item.seguro)} · outras: {reais(item.outro)}</div>
                        {texto(item.cstIbscbs) ? (
                          <>
                            <div>CST IBS/CBS: {texto(item.cstIbscbs)}</div>
                            <div>Classificação: {texto(item.cClassTribIbscbs) || "—"}</div>
                            <div>Alíquota IBS UF: {texto(item.aliquotaIbsUf) || "—"}</div>
                            <div>Alíquota IBS município: {texto(item.aliquotaIbsMun) || "—"}</div>
                            <div>Alíquota CBS: {texto(item.aliquotaCbs) || "—"}</div>
                          </>
                        ) : (
                          <div className="sm:col-span-2">IBS/CBS: não incluído neste item.</div>
                        )}
                      </dl>
                    </details>
                  ))}
                </div>
              </Bloco>

              <div className="grid gap-3 lg:grid-cols-2">
                <Bloco titulo="Totais">
                  <dl className="grid grid-cols-2 gap-y-1">
                    <dt>Produtos</dt>
                    <dd className="text-right">{reais(soma("valorTotal"))}</dd>
                    <dt>Desconto</dt>
                    <dd className="text-right">{reais(soma("desconto"))}</dd>
                    <dt>Frete</dt>
                    <dd className="text-right">{reais(soma("frete"))}</dd>
                    <dt>Seguro</dt>
                    <dd className="text-right">{reais(soma("seguro"))}</dd>
                    <dt>Outras despesas</dt>
                    <dd className="text-right">{reais(soma("outro"))}</dd>
                    <dt className="font-semibold">Total da NF-e</dt>
                    <dd className="text-right font-semibold">{reais(nfe.valorTotal)}</dd>
                  </dl>
                  <p className="mt-2 text-[12px] text-zinc-500">
                    ICMS, ST, IPI, PIS e COFINS entram no espelho pelo CST/CSOSN e pela alíquota.
                    Bases e valores monetários desses tributos são calculados na autorização.
                    {temIbscbs
                      ? " IBS/CBS está informado nos itens que possuem CST e classificação."
                      : " IBS/CBS não foi incluído nestes itens."}
                  </p>
                </Bloco>

                <Bloco titulo="Transporte">
                  <p>{ROTULOS_FRETE[frete] || `Modalidade ${frete}`}</p>
                  {transportador ? (
                    <p className="mt-1">
                      {texto(transportador.razaoSocial) || "Transportador"}
                      {texto(transportador.cnpj) ? ` · CNPJ ${texto(transportador.cnpj)}` : ""}
                      {texto(transportador.cpf) ? ` · CPF ${texto(transportador.cpf)}` : ""}
                      {texto(transportador.uf) ? ` · ${texto(transportador.municipio)}/${texto(transportador.uf)}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-zinc-500">Sem transportador no payload.</p>
                  )}
                  {volumes.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {volumes.map((volume, indice) => (
                        <li key={indice}>
                          Qtd {texto(volume.quantidade) || "—"}
                          {texto(volume.descricao) ? ` · ${texto(volume.descricao)}` : ""}
                          {" · "}peso líquido {texto(volume.pesoLiquido) || "—"}
                          {" · "}peso bruto {texto(volume.pesoBruto) || "—"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-zinc-500">Sem volumes.</p>
                  )}
                </Bloco>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <Bloco titulo="Pagamentos">
                  {detalhamento.length === 0 ? (
                    <p>Nenhum pagamento no payload.</p>
                  ) : (
                    <ul className="space-y-1">
                      {detalhamento.map((item, indice) => (
                        <li key={indice} className="flex justify-between gap-3">
                          <span>
                            {ROTULOS_TPAG[texto(item.tipo)] || "Pagamento"} · tPag {texto(item.tipo) || "—"}
                          </span>
                          <span>{reais(item.valor)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2">Troco: {reais(pagamento?.troco)}</p>
                </Bloco>

                <Bloco titulo="Fatura e duplicatas">
                  {fatura ? (
                    <>
                      <p>
                        Fatura {texto(fatura.numero) || "—"} · líquido {reais(fatura.valorLiquido)}
                      </p>
                      {duplicatas.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {duplicatas.map((duplicata) => (
                            <li key={texto(duplicata.numero)} className="flex justify-between gap-3">
                              <span>
                                {texto(duplicata.numero) || "—"} · venc. {texto(duplicata.dataVencimento) || "—"}
                              </span>
                              <span>{reais(duplicata.valor)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-zinc-500">Sem duplicatas.</p>
                      )}
                    </>
                  ) : (
                    <p>Esta NF-e não leva fatura nem duplicatas.</p>
                  )}
                </Bloco>
              </div>

              {referencias.length > 0 ? (
                <Bloco titulo="Documentos referenciados">
                  <ul className="space-y-1 break-all">
                    {referencias.map((chave) => (
                      <li key={chave}>{chave}</li>
                    ))}
                  </ul>
                </Bloco>
              ) : null}

              <Bloco titulo="Informações adicionais">
                <p>
                  <span className="text-zinc-500">Informações complementares (infCpl)</span>
                  <br />
                  {texto(nfe.informacaoComplementar) || "—"}
                </p>
                <p className="mt-2">
                  <span className="text-zinc-500">Informações ao fisco (infAdFisco)</span>
                  <br />
                  {texto(nfe.informacaoAdicionalFisco) || "—"}
                </p>
              </Bloco>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
