import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";
import { diretorioProducaoPgWeb, marcaEstadoBiblioteca } from "./tef-diretorio.mjs";
import { pastaLegadaPayGo } from "./tef-pasta.mjs";

const ID_PERFIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function arquivoPerfilAutonomo(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-perfil-autonomo.json");
}

export function raizPerfisProducao(env = process.env) {
  const biblioteca = diretorioProducaoPgWeb(env);
  if (!biblioteca) {
    return "";
  }
  return path.win32.join(path.win32.dirname(biblioteca), "perfis");
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function mesmaPasta(esquerda, direita) {
  const normal = (valor) =>
    path.win32.normalize(texto(valor)).replace(/[\\/]+$/u, "").toLowerCase();
  const a = normal(esquerda);
  const b = normal(direita);
  return Boolean(a) && a === b;
}

function dentroDaRaiz(caminho, raiz) {
  if (!caminho || !raiz) {
    return false;
  }
  const relativo = path.win32.relative(path.win32.resolve(raiz), path.win32.resolve(caminho));
  return relativo !== "" && !relativo.startsWith("..") && !path.win32.isAbsolute(relativo);
}

function paiControlado(env, id) {
  if (!ID_PERFIL.test(texto(id))) {
    return "";
  }
  const raiz = raizPerfisProducao(env);
  if (!raiz) {
    return "";
  }
  const pai = path.win32.join(raiz, texto(id).toLowerCase());
  if (!dentroDaRaiz(pai, raiz) || pastaLegadaPayGo(pai)) {
    return "";
  }
  const historico = path.win32.dirname(diretorioProducaoPgWeb(env));
  if (mesmaPasta(pai, historico) || mesmaPasta(path.win32.dirname(pai), historico)) {
    return "";
  }
  return pai;
}

function publico(perfil, estado, reutilizado) {
  return {
    id: perfil.id,
    efetivo: perfil.efetivo,
    estado,
    reutilizado: reutilizado === true,
  };
}

async function lerRegistro(arquivo, fsApi) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    if (!json || typeof json !== "object" || !Array.isArray(json.perfis)) {
      return { ok: false, mensagem: "O registro do perfil autônomo está ilegível. Ele não foi reescrito." };
    }
    return { ok: true, registro: json };
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return { ok: true, registro: { versao: 1, perfis: [] } };
    }
    return { ok: false, mensagem: "O registro do perfil autônomo não pôde ser lido. Nenhum diretório foi alterado." };
  }
}

async function gravarRegistro(arquivo, registro, fsApi) {
  await fsApi.mkdir(path.win32.dirname(arquivo), { recursive: true });
  await fsApi.writeFile(arquivo, JSON.stringify(registro), "utf8");
}

async function contemDadosBiblioteca(efetivo, fsApi) {
  for (const pasta of [efetivo, path.win32.join(efetivo, "Data")]) {
    try {
      const nomes = await fsApi.readdir(pasta);
      if (nomes.some((nome) => marcaEstadoBiblioteca(nome))) {
        return true;
      }
    } catch (erro) {
      if (erro?.code !== "ENOENT") {
        throw erro;
      }
    }
  }
  return false;
}

function mesmoVinculo(perfil, empresaId, dispositivoId) {
  return (
    texto(perfil?.empresaId).toLowerCase() === empresaId &&
    texto(perfil?.dispositivoId).toLowerCase() === dispositivoId &&
    perfil?.ambiente === "producao"
  );
}

export async function garantirPerfilAutonomo({
  empresaId = "",
  dispositivoId = "",
  explicito = false,
  env = process.env,
  fsApi = fs,
  arquivo = arquivoPerfilAutonomo(env),
} = {}) {
  const empresa = texto(empresaId).toLowerCase();
  const dispositivo = texto(dispositivoId).toLowerCase();
  if (!ID_PERFIL.test(empresa) || !ID_PERFIL.test(dispositivo)) {
    return {
      ok: false,
      mensagem:
        "O terminal precisa estar vinculado à empresa antes de preparar o perfil. Nenhum diretório foi criado.",
    };
  }
  const lido = await lerRegistro(arquivo, fsApi);
  if (!lido.ok) {
    return lido;
  }
  const registro = lido.registro;
  const doVinculo = registro.perfis.filter((perfil) => mesmoVinculo(perfil, empresa, dispositivo));
  const ativo = doVinculo.find((perfil) => perfil.estado !== "bloqueado");
  if (ativo) {
    const pai = paiControlado(env, ativo.id);
    if (!pai || !mesmaPasta(pai, ativo.pai)) {
      return {
        ok: false,
        mensagem: "O perfil registrado não está na pasta controlada pelo Connector. Nada foi alterado.",
      };
    }
    let ocupado = false;
    try {
      ocupado = await contemDadosBiblioteca(ativo.efetivo, fsApi);
    } catch {
      return {
        ok: false,
        mensagem: "Não foi possível verificar o perfil preparado. Nenhum arquivo foi alterado.",
      };
    }
    if (!ocupado) {
      return {
        ok: true,
        pai,
        efetivo: path.win32.join(pai, "PGWeb"),
        publico: publico(ativo, "vazio", true),
      };
    }
    if (explicito !== true) {
      return {
        ok: false,
        codigo: "PERFIL_OCUPADO",
        mensagem:
          "O perfil preparado já contém dados da biblioteca. Ele não será reutilizado e nenhum arquivo foi apagado. Outro perfil só é criado com provisionamento explícito.",
        publico: publico(ativo, "ocupado", false),
      };
    }
    ativo.estado = "bloqueado";
    ativo.bloqueadoEm = new Date().toISOString();
    ativo.motivo = "dados preexistentes";
  } else if (doVinculo.length > 0 && explicito !== true) {
    return {
      ok: false,
      codigo: "PERFIL_OCUPADO",
      mensagem:
        "Os perfis anteriores deste terminal permanecem preservados. Outro perfil só é criado com provisionamento explícito.",
    };
  }

  const id = randomUUID().toLowerCase();
  const pai = paiControlado(env, id);
  if (!pai) {
    return {
      ok: false,
      mensagem: "Não foi possível reservar uma pasta de perfil dentro de ProgramData. Nada foi alterado.",
    };
  }
  const efetivo = path.win32.join(pai, "PGWeb");
  const criado = {
    id,
    empresaId: empresa,
    dispositivoId: dispositivo,
    ambiente: "producao",
    pai,
    efetivo,
    estado: "vazio",
    criadoEm: new Date().toISOString(),
    anteriorId: ativo?.id ?? doVinculo.at(-1)?.id ?? "",
  };
  registro.versao = 1;
  registro.perfis.push(criado);
  await gravarRegistro(arquivo, registro, fsApi);
  await fsApi.mkdir(pai, { recursive: true });
  return {
    ok: true,
    pai,
    efetivo,
    publico: publico(criado, "vazio", false),
  };
}

export async function descreverPerfilAutonomo({
  empresaId = "",
  dispositivoId = "",
  env = process.env,
  fsApi = fs,
  arquivo = arquivoPerfilAutonomo(env),
} = {}) {
  const empresa = texto(empresaId).toLowerCase();
  const dispositivo = texto(dispositivoId).toLowerCase();
  if (!ID_PERFIL.test(empresa) || !ID_PERFIL.test(dispositivo)) {
    return null;
  }
  const lido = await lerRegistro(arquivo, fsApi);
  if (!lido.ok) {
    return null;
  }
  const ativo = lido.registro.perfis.find(
    (perfil) => mesmoVinculo(perfil, empresa, dispositivo) && perfil.estado !== "bloqueado"
  );
  if (!ativo || !paiControlado(env, ativo.id)) {
    return null;
  }
  let ocupado = false;
  try {
    ocupado = await contemDadosBiblioteca(ativo.efetivo, fsApi);
  } catch {
    return publico(ativo, "ocupado", true);
  }
  return publico(ativo, ocupado ? "ocupado" : "vazio", true);
}
