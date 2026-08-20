"use client";

import type { ReactNode } from "react";

export function Nfe55Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <h3 className="text-[14px] font-semibold">{titulo}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Nfe55Editor({
  titulo,
  geral,
  itens,
  documentos,
  fiscal,
  transporte,
  informacoes,
  verificacao,
  emissao,
  origem,
}: {
  titulo: string;
  geral: ReactNode;
  itens: ReactNode;
  documentos: ReactNode;
  fiscal?: ReactNode;
  transporte: ReactNode;
  informacoes: ReactNode;
  verificacao: ReactNode;
  emissao?: ReactNode;
  origem: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {emissao}
      <Nfe55Secao titulo={titulo}>{geral}</Nfe55Secao>
      <Nfe55Secao titulo="Itens">{itens}</Nfe55Secao>
      <Nfe55Secao titulo="Documentos referenciados">{documentos}</Nfe55Secao>
      {fiscal ? <Nfe55Secao titulo="Fiscal">{fiscal}</Nfe55Secao> : null}
      <Nfe55Secao titulo="Transporte e volumes">{transporte}</Nfe55Secao>
      <Nfe55Secao titulo="Informações adicionais">{informacoes}</Nfe55Secao>
      <Nfe55Secao titulo="Verificação da NF-e">{verificacao}</Nfe55Secao>
      <Nfe55Secao titulo="Operação">{origem}</Nfe55Secao>
    </div>
  );
}
