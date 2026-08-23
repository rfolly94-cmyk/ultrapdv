import {
  campoAplicaAoAmbiente,
  camposCredencialDoProvedor,
  ehProvedorPixGeranet,
  mapearSegredosLegadoEfi,
  nomeProvedorPix,
  obterProvedorPixGeranet,
} from "./provedores-geranet";
import type { AmbientePixGeranet, CredenciaisBancariasPix, ModoPix } from "./types";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function rotuloValidacao(campo: { chave: string; label: string }) {
  if (
    campo.chave === "certificadoPemHexadecimal" ||
    campo.chave === "certificadoPfxHexadecimal"
  ) {
    return "certificado";
  }
  if (campo.chave === "chavePrivadaPemHexadecimal") {
    return "chave privada";
  }
  if (campo.chave === "senhaCertificadoPfx") {
    return "senha do certificado";
  }
  if (
    campo.chave === "token" ||
    campo.chave === "tokenAcesso" ||
    campo.chave === "tokenPagamento" ||
    campo.chave === "tokenHomologacao"
  ) {
    return campo.label;
  }
  return campo.label;
}

function sufixoAusente(campo: { chave: string }) {
  return campo.chave === "senhaCertificadoPfx"
    ? "não configurada"
    : "não configurado";
}

export function removerVaziosCredencial(
  credenciais: Record<string, unknown>
): CredenciaisBancariasPix {
  const saida: Record<string, string> = {};

  for (const [chave, valor] of Object.entries(credenciais)) {
    const limpo = texto(valor);
    if (limpo) {
      saida[chave] = limpo;
    }
  }

  return saida;
}

export function filtrarCredenciaisDoProvedor(
  provedor: string,
  credenciais: Record<string, unknown>,
  chavePixPublica?: string | null,
  ambiente?: string
): CredenciaisBancariasPix {
  const meta = obterProvedorPixGeranet(provedor);
  const permitidas = new Set(
    camposCredencialDoProvedor(provedor, ambiente).map((campo) => campo.chave)
  );

  if (meta?.usaChavePix) {
    permitidas.add("chavePix");
  }

  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(credenciais)) {
    if (permitidas.has(chave)) {
      saida[chave] = valor;
    }
  }

  if (meta?.usaChavePix && texto(chavePixPublica)) {
    saida.chavePix = texto(chavePixPublica);
  }

  return removerVaziosCredencial(saida);
}

export function validarCredenciaisDoProvedor(
  provedor: string,
  credenciais: Record<string, unknown>,
  ambiente?: string
) {
  const meta = obterProvedorPixGeranet(provedor);

  if (!meta || !ehProvedorPixGeranet(provedor)) {
    return ["Provedor PIX não suportado pela Geranet."];
  }

  if (!meta.configuracaoDisponivel) {
    return [
      "Configuração deste provedor ainda não foi mapeada no UltraPDV.",
    ];
  }

  const erros: string[] = [];
  const nome = nomeProvedorPix(provedor);

  for (const campo of meta.campos) {
    if (!campo.obrigatorio || !campoAplicaAoAmbiente(campo, ambiente)) {
      continue;
    }

    if (!texto(credenciais[campo.chave])) {
      erros.push(`${nome}: ${rotuloValidacao(campo)} ${sufixoAusente(campo)}.`);
    }
  }

  if (meta.chavePixObrigatoria && !texto(credenciais.chavePix)) {
    erros.push(`${nome}: Chave PIX não configurada.`);
  }

  return erros;
}

export function mesclarSegredosProvedor(params: {
  provedor: string;
  ambiente: AmbientePixGeranet;
  novos: Record<string, unknown>;
  existentes: Record<string, unknown>;
  legado?: Record<string, unknown>;
}) {
  const campos = camposCredencialDoProvedor(
    params.provedor,
    params.ambiente
  );
  const legado =
    params.provedor === "efibank" || params.provedor === "gerencianet"
      ? mapearSegredosLegadoEfi(params.legado ?? {})
      : {};
  const saida: Record<string, string> = {};

  for (const campo of campos) {
    const novo = texto(params.novos[campo.chave]);
    const atual = texto(params.existentes[campo.chave]);
    const antigo = texto(legado[campo.chave]);
    const escolhido = novo || atual || antigo;

    if (escolhido) {
      saida[campo.chave] = escolhido;
    }
  }

  return saida;
}

export function flagsPublicasCredenciais(
  provedor: string,
  credenciais: Record<string, unknown>
) {
  const flags: Record<string, boolean> = {};

  for (const campo of camposCredencialDoProvedor(provedor)) {
    if (campo.segredo) {
      flags[campo.chave] = Boolean(texto(credenciais[campo.chave]));
    }
  }

  return flags;
}

export function lerFlagsPublicas(
  configuracaoPublica: Record<string, unknown> | null | undefined,
  provedor: string,
  ambiente: string
) {
  const credenciais = configuracaoPublica?.credenciais;
  if (!credenciais || typeof credenciais !== "object") {
    return {} as Record<string, boolean>;
  }

  const porProvedor = (credenciais as Record<string, unknown>)[provedor];
  if (!porProvedor || typeof porProvedor !== "object") {
    return {} as Record<string, boolean>;
  }

  const porAmbiente = (porProvedor as Record<string, unknown>)[ambiente];
  if (!porAmbiente || typeof porAmbiente !== "object") {
    return {} as Record<string, boolean>;
  }

  const saida: Record<string, boolean> = {};
  for (const [chave, valor] of Object.entries(
    porAmbiente as Record<string, unknown>
  )) {
    saida[chave] = Boolean(valor);
  }

  return saida;
}

export function gravarFlagsPublicas(
  atual: Record<string, unknown> | null | undefined,
  provedor: string,
  ambiente: string,
  flags: Record<string, boolean>
) {
  const base =
    atual && typeof atual === "object" ? { ...atual } : {};
  const credenciais =
    base.credenciais && typeof base.credenciais === "object"
      ? { ...(base.credenciais as Record<string, unknown>) }
      : {};
  const porProvedor =
    credenciais[provedor] && typeof credenciais[provedor] === "object"
      ? { ...(credenciais[provedor] as Record<string, unknown>) }
      : {};
  const porAmbiente =
    porProvedor[ambiente] && typeof porProvedor[ambiente] === "object"
      ? { ...(porProvedor[ambiente] as Record<string, boolean>) }
      : {};

  porProvedor[ambiente] = { ...porAmbiente, ...flags };
  credenciais[provedor] = porProvedor;
  base.credenciais = credenciais;
  return base;
}

export function tituloCredenciaisProvedor(codigo: string) {
  const nome = nomeProvedorPix(codigo);
  return `Credenciais ${nome}`;
}

export function flagsCredenciaisParaCliente(
  configuracaoPublica: Record<string, unknown> | null | undefined
) {
  const credenciais = configuracaoPublica?.credenciais;
  const saida: Record<string, Record<string, Record<string, boolean>>> = {};

  if (!credenciais || typeof credenciais !== "object") {
    return saida;
  }

  for (const [provedor, porProvedor] of Object.entries(
    credenciais as Record<string, unknown>
  )) {
    if (!porProvedor || typeof porProvedor !== "object") {
      continue;
    }

    saida[provedor] = {};

    for (const [ambiente, flags] of Object.entries(
      porProvedor as Record<string, unknown>
    )) {
      if (!flags || typeof flags !== "object") {
        continue;
      }

      saida[provedor][ambiente] = {};
      for (const [campo, valor] of Object.entries(
        flags as Record<string, unknown>
      )) {
        saida[provedor][ambiente][campo] = Boolean(valor);
      }
    }
  }

  return saida;
}

export function flagsVisiveisDoProvedor(params: {
  flags: Record<string, Record<string, Record<string, boolean>>>;
  provedor: string;
  ambiente: string;
  provedorSalvo?: string | null;
  credenciaisConfiguradas?: boolean;
  certificadoConfigurado?: boolean;
}) {
  const atuais =
    params.flags[params.provedor]?.[params.ambiente] ??
    (params.provedor === "efibank"
      ? params.flags.gerencianet?.[params.ambiente]
      : undefined) ??
    {};

  if (Object.keys(atuais).length > 0) {
    return atuais;
  }

  const legadoEfi =
    params.provedor === "efibank" &&
    (params.provedorSalvo === "efibank" ||
      params.provedorSalvo === "gerencianet");
  if (!legadoEfi) {
    return atuais;
  }

  const legado: Record<string, boolean> = {};
  if (params.credenciaisConfiguradas) {
    legado.clienteId = true;
    legado.clienteSegredo = true;
  }
  if (params.certificadoConfigurado) {
    legado.certificadoPfxHexadecimal = true;
  }
  return legado;
}

export function integracaoPublicaParaCliente(params: {
  modo?: string | null;
  provedor: string | null;
  ambiente: string;
  chave_pix: string | null;
  recebedor_nome: string | null;
  recebedor_cep: string | null;
  recebedor_cidade: string | null;
  recebedor_uf: string | null;
  credenciais_configuradas: boolean;
  certificado_configurado: boolean;
  configuracao_publica?: Record<string, unknown> | null;
}): {
  modo: ModoPix;
  provedor: string | null;
  ambiente: string;
  chave_pix: string | null;
  recebedor_nome: string | null;
  recebedor_cep: string | null;
  recebedor_cidade: string | null;
  recebedor_uf: string | null;
  credenciais_configuradas: boolean;
  certificado_configurado: boolean;
  flags: Record<string, Record<string, Record<string, boolean>>>;
} {
  return {
    modo: params.modo === "local_manual" ? "local_manual" : "geranet",
    provedor: params.provedor,
    ambiente: params.ambiente,
    chave_pix: params.chave_pix,
    recebedor_nome: params.recebedor_nome,
    recebedor_cep: params.recebedor_cep,
    recebedor_cidade: params.recebedor_cidade,
    recebedor_uf: params.recebedor_uf,
    credenciais_configuradas: params.credenciais_configuradas,
    certificado_configurado: params.certificado_configurado,
    flags: flagsCredenciaisParaCliente(params.configuracao_publica),
  };
}
