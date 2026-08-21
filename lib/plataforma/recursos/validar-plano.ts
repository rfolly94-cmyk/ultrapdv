import {
  CATALOGO_RECURSOS,
  CHAVES_LIMITE,
  chaveLimiteValida,
  nivelSuporteValido,
  type NivelSuporte,
} from "@/lib/plataforma/recursos/catalogo";

export type PayloadPlanoMaster = {
  id?: string | null;
  nome: string;
  descricao: string;
  valorMensal: number;
  valorAnual: number | null;
  ordem: number;
  ativo: boolean;
  destaque: boolean;
  textoDestaque: string;
  diasTeste: number;
  nivelSuporte: NivelSuporte;
  limites: Record<string, number | null>;
  recursos: Record<string, boolean>;
};

export type ResultadoValidacaoPlano =
  | { ok: true; payload: PayloadPlanoMaster }
  | { ok: false; erro: string };

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numeroNaoNegativo(valor: unknown, obrigatorio: boolean) {
  if (valor == null || texto(valor) === "") {
    return obrigatorio ? { ok: false as const } : { ok: true as const, valor: null };
  }

  const bruto =
    typeof valor === "number"
      ? valor
      : Number(String(valor).replace(/\./g, "").replace(",", "."));

  if (!Number.isFinite(bruto) || bruto < 0) {
    return { ok: false as const };
  }

  return { ok: true as const, valor: Math.round(bruto * 100) / 100 };
}

function inteiro(valor: unknown, minimo: number) {
  if (valor == null || texto(valor) === "") {
    return { ok: false as const };
  }
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(numero) || numero < minimo) {
    return { ok: false as const };
  }
  return { ok: true as const, valor: numero };
}

export function validarPayloadPlano(entrada: {
  id?: unknown;
  nome?: unknown;
  descricao?: unknown;
  valorMensal?: unknown;
  valorAnual?: unknown;
  ordem?: unknown;
  ativo?: unknown;
  destaque?: unknown;
  textoDestaque?: unknown;
  oferecerTeste?: unknown;
  diasTeste?: unknown;
  nivelSuporte?: unknown;
  limites?: unknown;
  recursos?: unknown;
}): ResultadoValidacaoPlano {
  const nome = texto(entrada.nome);
  if (!nome) {
    return { ok: false, erro: "Informe o nome do plano." };
  }

  const mensal = numeroNaoNegativo(entrada.valorMensal, true);
  if (!mensal.ok || mensal.valor == null) {
    return { ok: false, erro: "Informe um valor mensal válido." };
  }

  const anual = numeroNaoNegativo(entrada.valorAnual, false);
  if (!anual.ok) {
    return { ok: false, erro: "Informe um valor anual válido ou deixe em branco." };
  }

  const ordem = inteiro(entrada.ordem, 0);
  if (!ordem.ok) {
    return { ok: false, erro: "Informe uma ordem válida." };
  }

  const oferecerTeste = Boolean(entrada.oferecerTeste);
  const dias = oferecerTeste
    ? inteiro(entrada.diasTeste, 0)
    : { ok: true as const, valor: 0 };
  if (!dias.ok || dias.valor == null) {
    return { ok: false, erro: "Informe os dias de teste." };
  }

  const nivel = texto(entrada.nivelSuporte) || "normal";
  if (!nivelSuporteValido(nivel)) {
    return { ok: false, erro: "Nível de suporte inválido." };
  }

  const limitesEntrada =
    entrada.limites && typeof entrada.limites === "object"
      ? (entrada.limites as Record<string, unknown>)
      : {};
  const limites: Record<string, number | null> = {};
  for (const chave of CHAVES_LIMITE) {
    const bruto = limitesEntrada[chave];
    if (bruto == null || bruto === "" || bruto === "ilimitado") {
      limites[chave] = null;
      continue;
    }
    const numero = typeof bruto === "number" ? bruto : Number(bruto);
    if (!Number.isInteger(numero) || numero < 1) {
      return {
        ok: false,
        erro: `Informe um limite válido para ${chave} ou marque ilimitado.`,
      };
    }
    limites[chave] = numero;
  }
  for (const chave of Object.keys(limitesEntrada)) {
    if (!chaveLimiteValida(chave)) {
      return { ok: false, erro: "Limite desconhecido." };
    }
  }

  const recursosEntrada =
    entrada.recursos && typeof entrada.recursos === "object"
      ? (entrada.recursos as Record<string, unknown>)
      : {};
  const recursos: Record<string, boolean> = {};
  for (const recurso of CATALOGO_RECURSOS) {
    recursos[recurso.chave] = Boolean(recursosEntrada[recurso.chave]);
  }
  recursos.suporte_prioritario = nivel !== "normal";

  const id = texto(entrada.id);
  return {
    ok: true,
    payload: {
      id: id || null,
      nome,
      descricao: texto(entrada.descricao),
      valorMensal: mensal.valor,
      valorAnual: anual.valor,
      ordem: ordem.valor,
      ativo: Boolean(entrada.ativo),
      destaque: Boolean(entrada.destaque),
      textoDestaque: texto(entrada.textoDestaque),
      diasTeste: dias.valor,
      nivelSuporte: nivel,
      limites,
      recursos,
    },
  };
}

export function payloadPlanoParaRpc(payload: PayloadPlanoMaster) {
  return {
    id: payload.id,
    nome: payload.nome,
    descricao: payload.descricao || null,
    valor_mensal: payload.valorMensal,
    valor_anual: payload.valorAnual,
    ordem: payload.ordem,
    ativo: payload.ativo,
    destaque: payload.destaque,
    texto_destaque: payload.textoDestaque || null,
    dias_teste: payload.diasTeste,
    nivel_suporte: payload.nivelSuporte,
    limites: payload.limites,
    recursos: payload.recursos,
  };
}
