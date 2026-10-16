import path from "node:path";

export const TOKEN_DIRETORIO_PRODUCAO = "producao";
export const TOKEN_DIRETORIO_SANDBOX = "sandbox";

const MARCAS_BIBLIOTECA = new Set([
  "certificado.crt",
  "tstkey.ini",
  "assinatura.sig",
  "check.pos",
  "check_.pos",
]);

export function tokenDiretorioBiblioteca(ambiente) {
  return ambiente === "producao" ? TOKEN_DIRETORIO_PRODUCAO : TOKEN_DIRETORIO_SANDBOX;
}

export function tokenDiretorioInformado(valor) {
  const token = String(valor ?? "").trim();
  if (token === TOKEN_DIRETORIO_PRODUCAO || token === TOKEN_DIRETORIO_SANDBOX) {
    return token;
  }
  return "";
}

export function diretorioProducaoPgWeb(env = process.env) {
  const base = String(env?.PROGRAMDATA || env?.ALLUSERSPROFILE || "").trim();
  if (!base) {
    return "";
  }
  return path.join(base, "UltraPDV", "TEF", "Producao", "PGWeb");
}

export function resolverDiretorioBiblioteca(raizExecutavel, token, env = process.env) {
  const informado = tokenDiretorioInformado(token);
  const raiz = String(raizExecutavel ?? "").trim();
  if (!informado || !raiz) {
    return {
      ok: false,
      motivo: "O diretório da PGWebLib não foi selecionado.",
    };
  }
  const base = path.resolve(raiz);
  const sandbox = path.resolve(base, "TEF", "PGWeb");
  const biblioteca =
    informado === TOKEN_DIRETORIO_PRODUCAO
      ? diretorioProducaoPgWeb(env)
      : sandbox;
  if (!biblioteca) {
    return {
      ok: false,
      motivo: "A pasta de produção da PGWebLib não está em ProgramData.",
    };
  }
  const relativo = path.relative(sandbox, biblioteca);
  const dentroDoSandbox =
    relativo === "" ||
    (relativo !== "" && !relativo.startsWith("..") && !path.isAbsolute(relativo));
  if (informado === TOKEN_DIRETORIO_PRODUCAO && dentroDoSandbox) {
    return {
      ok: false,
      motivo: "A pasta de produção coincide com a pasta de homologação.",
    };
  }
  return {
    ok: true,
    token: informado,
    pai: path.dirname(biblioteca),
    biblioteca,
    sandbox,
  };
}

export function marcaEstadoBiblioteca(nome) {
  const arquivo = path.basename(String(nome ?? "")).toLowerCase();
  return MARCAS_BIBLIOTECA.has(arquivo) || arquivo.endsWith(".pos");
}

export function avaliarIsolamentoProducao({ raizExecutavel, nomes = [], env = process.env } = {}) {
  const resolvido = resolverDiretorioBiblioteca(raizExecutavel, TOKEN_DIRETORIO_PRODUCAO, env);
  if (!resolvido.ok) {
    return { ...resolvido, situacao: "recusada" };
  }
  const marcas = nomes.filter((nome) => marcaEstadoBiblioteca(nome));
  if (marcas.length > 0) {
    return {
      ok: false,
      situacao: "contaminada",
      motivo:
        "A pasta de produção já contém estado da biblioteca. Ela não será reutilizada e nenhum arquivo será apagado. A pasta de homologação permanece intacta.",
      biblioteca: resolvido.biblioteca,
      sandbox: resolvido.sandbox,
    };
  }
  return {
    ok: true,
    situacao: "isolada",
    motivo: "A pasta de produção está vazia e não reutiliza o estado de homologação.",
    biblioteca: resolvido.biblioteca,
    sandbox: resolvido.sandbox,
  };
}

export function descreverDiretoriosAgente(caminhoExecutavel, diretorioSelecionado = "", env = process.env) {
  const caminho = String(caminhoExecutavel ?? "").trim();
  const selecionado = tokenDiretorioInformado(diretorioSelecionado);
  if (!caminho) {
    return {
      diretorioSelecionado: "",
      diretorioSandbox: "",
      diretorioProducao: "",
    };
  }
  const raiz = path.dirname(path.resolve(caminho));
  const sandbox = resolverDiretorioBiblioteca(raiz, TOKEN_DIRETORIO_SANDBOX, env);
  const producao = resolverDiretorioBiblioteca(raiz, TOKEN_DIRETORIO_PRODUCAO, env);
  return {
    diretorioSelecionado: selecionado,
    diretorioSandbox: sandbox.ok ? sandbox.biblioteca : "",
    diretorioProducao: producao.ok ? producao.biblioteca : "",
  };
}
