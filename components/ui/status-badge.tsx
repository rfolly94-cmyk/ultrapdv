const cores: Record<string, string> = {
  autorizada: "bg-emerald-50 text-emerald-700",
  emitida: "bg-emerald-50 text-emerald-700",
  cancelada: "bg-rose-50 text-rose-800",
  rejeitada: "bg-red-50 text-red-700",
  inutilizada: "bg-zinc-100 text-zinc-600",
  aguardando_reconciliacao: "bg-amber-50 text-amber-800",
  aguardando_inutilizacao: "bg-amber-50 text-amber-800",
  processando: "bg-sky-50 text-sky-800",
  enviando: "bg-sky-50 text-sky-800",
  transmitindo_contingencia: "bg-sky-50 text-sky-800",
  aguardando_transmissao_contingencia: "bg-sky-50 text-sky-800",
  erro_comunicacao: "bg-orange-50 text-orange-800",
  reservada: "bg-zinc-100 text-zinc-600",
  nfe: "bg-violet-50 text-violet-700",
  nfce: "bg-violet-50 text-violet-700",
  ativo: "bg-emerald-50 text-emerald-700",
  inativo: "bg-zinc-100 text-zinc-500",
  finalizada: "bg-emerald-50 text-emerald-700",
  sucesso: "bg-emerald-50 text-emerald-700",
  baixo: "bg-amber-50 text-amber-800",
  normal: "bg-emerald-50 text-emerald-700",
  pendente: "bg-amber-50 text-amber-800",
  importada: "bg-sky-50 text-sky-800",
  rascunho: "bg-zinc-100 text-zinc-600",
  aguardando_vinculacao: "bg-amber-50 text-amber-800",
  aguardando_saida: "bg-indigo-50 text-indigo-700",
  pronta_para_verificacao: "bg-amber-50 text-amber-800",
  pronta_para_emissao: "bg-indigo-50 text-indigo-700",
  concluida: "bg-emerald-50 text-emerald-700",
  aguardando_conferencia: "bg-amber-50 text-amber-800",
  pronta_para_entrada: "bg-indigo-50 text-indigo-700",
  processando_entrada: "bg-amber-50 text-amber-800",
  entrada_concluida: "bg-emerald-50 text-emerald-700",
  bloqueado: "bg-red-50 text-red-700",
  trial: "bg-sky-50 text-sky-800",
  ativa: "bg-emerald-50 text-emerald-700",
  carencia: "bg-amber-50 text-amber-800",
  suspensa: "bg-red-50 text-red-700",
  novo: "bg-sky-50 text-sky-800",
  em_atendimento: "bg-amber-50 text-amber-800",
  aceito: "bg-indigo-50 text-indigo-700",
  convertido: "bg-emerald-50 text-emerald-700",
  pdv: "bg-zinc-100 text-zinc-600",
  nfe_manual: "bg-indigo-50 text-indigo-700",
  aguardando_suporte: "bg-amber-50 text-amber-800",
  aguardando_cliente: "bg-sky-50 text-sky-800",
  encerrada: "bg-zinc-100 text-zinc-600",
  aberta: "bg-emerald-50 text-emerald-700",
  aberto: "bg-emerald-50 text-emerald-700",
  vencido: "bg-red-50 text-red-700",
  vence_7: "bg-orange-50 text-orange-800",
  vence_30: "bg-amber-50 text-amber-800",
  vence_60: "bg-sky-50 text-sky-800",
  reaberto: "bg-amber-100 text-amber-900",
  fechado: "bg-zinc-100 text-zinc-600",
  cancelado: "bg-rose-50 text-rose-800",
};

function rotulo(valor: string) {
  return valor.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export function StatusBadge({
  status,
  children,
}: {
  status: string;
  children?: string;
}) {
  const chave = status.toLowerCase();
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-medium ${
        cores[chave] ?? "bg-zinc-100 text-zinc-600"
      }`}
    >
      {children ?? rotulo(status)}
    </span>
  );
}
