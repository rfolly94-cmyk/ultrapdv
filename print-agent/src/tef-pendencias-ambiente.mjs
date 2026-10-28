import path from "node:path";

import { diretorioEmpresaTef, diretorioProducaoEmpresaTef } from "./tef-csharp-ponte.mjs";

const BLOQUEIAM = new Set(["executando", "aguardando_confirmacao", "resultado_desconhecido", "aguardando_decisao"]);

export function pastasJournalEmpresa(raiz, empresaId, terminalId) {
  const locais = diretorioEmpresaTef(raiz, empresaId, terminalId);
  const producao = diretorioProducaoEmpresaTef(raiz, empresaId, terminalId);
  const empresa = String(empresaId).replace(/-/g, "");
  const terminal = String(terminalId).replace(/-/g, "");
  const homologacao = path.resolve(locais.raiz, empresa, terminal, "journals");
  const producaoJournals = path.resolve(producao.raizJournals, empresa, terminal, "journals");
  if (homologacao === producaoJournals || producaoJournals.startsWith(homologacao + path.sep)) {
    throw new Error("DIRETORIO_HOMOLOGACAO");
  }
  return { homologacao, producao: producaoJournals };
}

export function classificarArquivoJournal(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ilegivel: true, status: "", bloqueia: false };
  }
  const status = typeof json.Status === "string" ? json.Status : typeof json.status === "string" ? json.status : "";
  return { ilegivel: false, status, bloqueia: BLOQUEIAM.has(status) };
}

export function resumirPendencias(lidos, motorOcupado) {
  const ilegivel = lidos.some((item) => item?.ilegivel === true);
  return {
    ok: true,
    pagamentoRecebido: false,
    confirmada: false,
    nativo: false,
    codigo: "pendencias_lidas",
    ilegivel,
    statuses: ilegivel ? [] : lidos.filter((item) => item.bloqueia).map((item) => item.status),
    motorOcupado: motorOcupado === true,
  };
}

export function lerPendenciasNoDisco(raiz, empresaId, terminalId, motorOcupado, fsApi) {
  if (!terminalId) {
    return resumirPendencias([], motorOcupado);
  }
  const pastas = pastasJournalEmpresa(raiz, empresaId, terminalId);
  const lidos = [];
  for (const pasta of [pastas.homologacao, pastas.producao]) {
    let nomes = [];
    try {
      nomes = fsApi.readdirSync(pasta);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        lidos.push({ ilegivel: true });
        continue;
      }
      lidos.push({ ilegivel: true });
      continue;
    }
    for (const nome of nomes) {
      if (!nome.endsWith(".json") || nome.endsWith(".tmp")) continue;
      const arquivo = path.resolve(pasta, nome);
      if (!arquivo.startsWith(pasta + path.sep)) continue;
      try {
        lidos.push(classificarArquivoJournal(JSON.parse(fsApi.readFileSync(arquivo, "utf8"))));
      } catch {
        lidos.push({ ilegivel: true });
      }
    }
  }
  return resumirPendencias(lidos, motorOcupado);
}
