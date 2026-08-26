"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  buscarConfiguracoesImpressaoAction,
  gerarPdfTesteImpressaoAction,
  salvarConfiguracaoImpressaoAction,
} from "@/app/configuracoes/impressao/actions";
import { consultarSaudeAgente, listarImpressorasAgente } from "@/lib/impressao/agente";
import {
  ULTRAPDV_CONNECTOR_DOWNLOAD_URL,
  ULTRAPDV_CONNECTOR_SETUP_FILENAME,
} from "@/lib/impressao/download-conector";
import {
  aplicarDispositivoIdDoConector,
  obterDispositivoId,
  rotuloDispositivo,
} from "@/lib/impressao/dispositivo";
import { ehUuid } from "@/lib/impressao/regras";
import { imprimirPdfNaConfiguracao } from "@/lib/impressao/executar-cliente";
import {
  completarConfiguracoesImpressao,
  configuracaoPadrao,
  rotuloTipoDocumentoImpressao,
} from "@/lib/impressao/regras";
import {
  PAPEIS_IMPRESSAO,
  type ConfiguracaoImpressao,
  type ImpressoraWindows,
  type PapelImpressao,
  type StatusAgenteImpressao,
  type TipoDocumentoImpressao,
} from "@/lib/impressao/tipos";

function rotuloPapel(papel: PapelImpressao) {
  if (papel === "a4") {
    return "A4";
  }
  if (papel === "58mm") {
    return "58 mm";
  }
  return "80 mm";
}

function subscribeVazio() {
  return () => {};
}

export function ImpressaoWorkspace() {
  const dispositivoLocal = useSyncExternalStore(
    subscribeVazio,
    obterDispositivoId,
    () => ""
  );
  const [dispositivoId, setDispositivoId] = useState(dispositivoLocal);
  const [empresaNome, setEmpresaNome] = useState("Empresa");
  const [configs, setConfigs] = useState<ConfiguracaoImpressao[]>(
    completarConfiguracoesImpressao([])
  );
  const [impressoras, setImpressoras] = useState<ImpressoraWindows[]>([]);
  const [agenteOk, setAgenteOk] = useState<boolean | null>(null);
  const [motivoDescoberta, setMotivoDescoberta] = useState<
    StatusAgenteImpressao["motivoDescoberta"]
  >(undefined);
  const [motorOk, setMotorOk] = useState(false);
  const [versaoConector, setVersaoConector] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvandoTipo, setSalvandoTipo] = useState<TipoDocumentoImpressao | null>(
    null
  );

  useEffect(() => {
    if (!dispositivoLocal) {
      return;
    }

    let ativo = true;
    void (async () => {
      const saude = await consultarSaudeAgente();
      let id = dispositivoLocal;
      if (saude.ok && ehUuid(saude.dispositivoId)) {
        aplicarDispositivoIdDoConector(saude.dispositivoId);
        id = saude.dispositivoId;
      }
      const [lista, configuracoes] = await Promise.all([
        listarImpressorasAgente(),
        buscarConfiguracoesImpressaoAction(id),
      ]);
      if (!ativo) {
        return;
      }
      setDispositivoId(id);
      setAgenteOk(saude.ok);
      setMotivoDescoberta(saude.ok ? undefined : saude.motivoDescoberta);
      setMotorOk(Boolean(saude.motorImpressao?.encontrado));
      setVersaoConector(saude.versao ?? null);
      setImpressoras(lista);
      if (configuracoes.ok) {
        setConfigs(configuracoes.configs);
        setEmpresaNome(configuracoes.empresaNome);
      }
      setCarregando(false);
    })();

    return () => {
      ativo = false;
    };
  }, [dispositivoLocal]);

  async function salvar(
    tipo: TipoDocumentoImpressao,
    patch: Partial<ConfiguracaoImpressao>
  ) {
    const atual = configs.find((item) => item.tipoDocumento === tipo) ??
      configuracaoPadrao(tipo);
    const proxima = { ...atual, ...patch, tipoDocumento: tipo };
    setConfigs((lista) =>
      lista.map((item) => (item.tipoDocumento === tipo ? proxima : item))
    );
    setSalvandoTipo(tipo);
    const resultado = await salvarConfiguracaoImpressaoAction({
      dispositivoId,
      tipoDocumento: tipo,
      impressoraNome: proxima.impressoraNome,
      papel: proxima.papel,
      copias: proxima.copias,
      impressaoAutomatica: proxima.impressaoAutomatica,
    });
    setSalvandoTipo(null);
    if (!resultado.ok) {
      setMensagem(resultado.erro);
    }
  }

  async function imprimirTeste(config: ConfiguracaoImpressao) {
    setMensagem(null);
    if (!config.impressoraNome) {
      setMensagem("Selecione uma impressora para o teste.");
      return;
    }
    const pdf = await gerarPdfTesteImpressaoAction({
      tipoDocumento: config.tipoDocumento,
      papel: config.papel,
      impressora: config.impressoraNome,
    });
    if (!pdf.ok) {
      setMensagem(pdf.erro);
      return;
    }
    const resultado = await imprimirPdfNaConfiguracao(config, pdf.pdfBase64);
    setMensagem(
      resultado.ok
        ? resultado.mensagem
        : resultado.erro
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Este computador
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              {rotuloDispositivo(dispositivoId)}
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">{empresaNome}</p>
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  agenteOk && motorOk
                    ? "bg-emerald-500"
                    : agenteOk
                      ? "bg-amber-500"
                      : "bg-zinc-300"
                }`}
              />
              {agenteOk ? "UltraPDV Conector conectado" : "UltraPDV Conector desconectado"}
            </p>
            {agenteOk && versaoConector ? (
              <p className="mt-1 text-[12px] text-zinc-400">{versaoConector}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {agenteOk ? (
              <a
                href={ULTRAPDV_CONNECTOR_DOWNLOAD_URL}
                download={ULTRAPDV_CONNECTOR_SETUP_FILENAME}
                className="updv-btn updv-btn-ghost"
              >
                Baixar instalador
              </a>
            ) : null}
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => {
              setCarregando(true);
              void (async () => {
                const saude = await consultarSaudeAgente();
                let id = dispositivoId || dispositivoLocal;
                if (saude.ok && ehUuid(saude.dispositivoId)) {
                  aplicarDispositivoIdDoConector(saude.dispositivoId);
                  id = saude.dispositivoId;
                }
                const [lista, configuracoes] = await Promise.all([
                  listarImpressorasAgente(),
                  buscarConfiguracoesImpressaoAction(id),
                ]);
                setDispositivoId(id);
                setAgenteOk(saude.ok);
                setMotivoDescoberta(saude.ok ? undefined : saude.motivoDescoberta);
                setMotorOk(Boolean(saude.motorImpressao?.encontrado));
                setVersaoConector(saude.versao ?? null);
                setImpressoras(lista);
                if (configuracoes.ok) {
                  setConfigs(configuracoes.configs);
                  setEmpresaNome(configuracoes.empresaNome);
                }
                setCarregando(false);
              })();
            }}
            disabled={carregando || !dispositivoId}
          >
            {agenteOk ? "Testar conexão" : "Verificar novamente"}
          </button>
          </div>
        </div>
        {agenteOk && !motorOk && !carregando ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Motor de impressão PDF não encontrado. Reinstale o UltraPDV
            Connector neste computador.
          </p>
        ) : null}
        {!agenteOk && !carregando ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
              Impressão UltraPDV
            </p>
            <p className="mt-2 text-sm font-semibold text-amber-950">
              {motivoDescoberta === "bloqueado"
                ? "UltraPDV Connector bloqueado pelo navegador"
                : motivoDescoberta === "timeout"
                  ? "UltraPDV Connector não respondeu a tempo"
                  : "UltraPDV Conector não encontrado"}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-amber-900">
              {motivoDescoberta === "bloqueado"
                ? "O Connector está em execução, mas esta página não foi autorizada a acessá-lo. Atualize o UltraPDV Connector para 1.3.2."
                : "Para utilizar impressão automática neste computador, baixe e instale o Impressão UltraPDV."}
            </p>
            <a
              href={ULTRAPDV_CONNECTOR_DOWNLOAD_URL}
              download={ULTRAPDV_CONNECTOR_SETUP_FILENAME}
              className="updv-btn updv-btn-primary mt-4"
            >
              Baixar Impressão UltraPDV
            </a>
          </div>
        ) : null}
      </section>

      {mensagem ? (
        <p className="text-sm text-zinc-700">{mensagem}</p>
      ) : null}

      {configs.map((config) => {
        const nomes = new Set(impressoras.map((item) => item.nome));
        const configuradaAusente = Boolean(
          config.impressoraNome && !nomes.has(config.impressoraNome)
        );
        return (
          <section
            key={config.tipoDocumento}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <h2 className="text-[15px] font-semibold text-zinc-950">
              {rotuloTipoDocumentoImpressao(config.tipoDocumento)}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-zinc-500">
                  Impressora
                </span>
                <select
                  className="updv-select w-full"
                  value={config.impressoraNome ?? ""}
                  onChange={(event) =>
                    void salvar(config.tipoDocumento, {
                      impressoraNome: event.target.value || null,
                    })
                  }
                >
                  <option value="">Selecionar impressora</option>
                  {configuradaAusente && config.impressoraNome ? (
                    <option value={config.impressoraNome}>
                      {config.impressoraNome} (não encontrada)
                    </option>
                  ) : null}
                  {impressoras.map((impressora) => (
                    <option key={impressora.nome} value={impressora.nome}>
                      {impressora.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-zinc-500">
                  Papel
                </span>
                <select
                  className="updv-select w-full"
                  value={config.papel}
                  onChange={(event) =>
                    void salvar(config.tipoDocumento, {
                      papel: event.target.value as PapelImpressao,
                    })
                  }
                >
                  {PAPEIS_IMPRESSAO.map((papel) => (
                    <option key={papel} value={papel}>
                      {rotuloPapel(papel)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-zinc-500">
                  Cópias
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="updv-input w-full"
                  value={config.copias}
                  onChange={(event) =>
                    void salvar(config.tipoDocumento, {
                      copias: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            {configuradaAusente ? (
              <p className="mt-3 text-[13px] text-amber-800">
                Impressora configurada não encontrada neste computador.
              </p>
            ) : null}
            <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={config.impressaoAutomatica}
                onChange={(event) =>
                  void salvar(config.tipoDocumento, {
                    impressaoAutomatica: event.target.checked,
                  })
                }
              />
              Imprimir automaticamente
            </label>
            <div className="mt-4">
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                disabled={salvandoTipo === config.tipoDocumento || !agenteOk}
                onClick={() => void imprimirTeste(config)}
              >
                Imprimir teste
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
