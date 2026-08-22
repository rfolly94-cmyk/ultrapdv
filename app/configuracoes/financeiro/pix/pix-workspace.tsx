"use client";

import { useMemo, useState } from "react";

import {
  flagsVisiveisDoProvedor,
} from "@/lib/pagamentos/pix/credenciais";
import {
  acceptArquivo,
  formularioCredenciaisProvedor,
  rotuloArquivoConfigurado,
  rotuloEscolherArquivo,
  rotuloSegredoConfigurado,
} from "@/lib/pagamentos/pix/formulario-provedor";
import {
  PROVEDORES_PIX_GERANET,
  ambientePadraoDoProvedor,
  ambientesSuportadosDoProvedor,
} from "@/lib/pagamentos/pix/provedores";
import type { CobrancaPixPublica, ModoPix } from "@/lib/pagamentos/pix/types";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { salvarConfiguracaoPix } from "./actions";
import { PixLocalPanel } from "./pix-local-panel";

type FlagsCredenciais = Record<
  string,
  Record<string, Record<string, boolean>>
>;

type Props = {
  pixIntegradoLiberado?: boolean;
  integracao: {
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
    flags: FlagsCredenciais;
  } | null;
  cobrancas: CobrancaPixPublica[];
};

type RespostaApi = {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
  cobranca?: CobrancaPixPublica;
  resposta?: unknown;
  payload_enviado?: unknown;
  txid?: string;
};

export function PixGeranetWorkspace({
  pixIntegradoLiberado = true,
  integracao,
  cobrancas,
}: Props) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [operando, setOperando] = useState(false);
  const [valor, setValor] = useState("1.00");
  const [devedorNome, setDevedorNome] = useState("");
  const [diagnostico, setDiagnostico] = useState<unknown>(null);
  const [lista, setLista] = useState(cobrancas);
  const [provedor, setProvedor] = useState(() => {
    const inicial = integracao?.provedor ?? "efibank";
    const meta = PROVEDORES_PIX_GERANET.find((item) => item.codigo === inicial);
    return meta?.configuracaoDisponivel ? inicial : "efibank";
  });
  const [ambiente, setAmbiente] = useState(() => {
    const inicialProvedor = integracao?.provedor ?? "efibank";
    const suportados = ambientesSuportadosDoProvedor(inicialProvedor);
    const atual = integracao?.ambiente ?? ambientePadraoDoProvedor(inicialProvedor);
    return suportados.includes(atual as "1" | "2")
      ? atual
      : ambientePadraoDoProvedor(inicialProvedor);
  });
  const [arquivosLocais, setArquivosLocais] = useState<Record<string, string>>(
    {}
  );
  const [modo, setModo] = useState<ModoPix>(() => {
    if (!pixIntegradoLiberado) {
      return "local_manual";
    }
    return integracao?.modo === "local_manual" ? "local_manual" : "geranet";
  });

  const formulario = useMemo(
    () => formularioCredenciaisProvedor(provedor, ambiente),
    [provedor, ambiente]
  );
  const flags = flagsVisiveisDoProvedor({
    flags: integracao?.flags ?? {},
    provedor,
    ambiente,
    provedorSalvo: integracao?.provedor,
    credenciaisConfiguradas: integracao?.credenciais_configuradas,
    certificadoConfigurado: integracao?.certificado_configurado,
  });

  function trocarProvedor(proximo: string) {
    const meta = PROVEDORES_PIX_GERANET.find((item) => item.codigo === proximo);
    if (!meta?.configuracaoDisponivel) {
      return;
    }
    setProvedor(proximo);
    const suportados = ambientesSuportadosDoProvedor(proximo);
    setAmbiente((atual) =>
      suportados.includes(atual as "1" | "2")
        ? atual
        : ambientePadraoDoProvedor(proximo)
    );
    setArquivosLocais({});
  }

  function trocarAmbiente(proximo: string) {
    setAmbiente(proximo);
    setArquivosLocais({});
  }

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSalvando(true);
    setMensagem(null);

    try {
      const resultado = await salvarConfiguracaoPix(
        new FormData(event.currentTarget)
      );
      setSucesso(Boolean(resultado.ok));
      setMensagem(
        resultado.ok
          ? "Configuração PIX Geranet salva. Credenciais foram para o cofre."
          : resultado.erro
      );
      if (resultado.ok) {
        setArquivosLocais({});
      }
    } catch (error) {
      setSucesso(false);
      setMensagem(
        error instanceof Error ? error.message : "Falha ao salvar o PIX."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function chamar(
    url: string,
    body: Record<string, unknown>
  ) {
    setOperando(true);
    setMensagem(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as RespostaApi;
      setSucesso(Boolean(data.ok));
      setMensagem(data.erro ?? data.mensagem ?? (data.ok ? "Operação concluída." : "Falha PIX."));
      setDiagnostico(data.resposta ?? data);
      if (data.cobranca) {
        setLista((atual) => {
          const resto = atual.filter((item) => item.id !== data.cobranca?.id);
          return [data.cobranca as CobrancaPixPublica, ...resto];
        });
      }
    } catch (error) {
      setSucesso(false);
      setMensagem(
        error instanceof Error ? error.message : "Falha de rede no PIX."
      );
    } finally {
      setOperando(false);
    }
  }

  return (
    <div className="space-y-4">
      {mensagem && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {mensagem}
        </div>
      )}

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">Modo PIX</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex cursor-pointer gap-3 rounded-md border border-zinc-200 p-3">
            <input
              type="radio"
              name="modo_pix_ui"
              checked={modo === "local_manual"}
              onChange={() => setModo("local_manual")}
              className="mt-1"
            />
            <span>
              <span className="block text-[13px] font-semibold text-zinc-950">
                PIX Local / Manual
              </span>
              <span className="mt-1 block text-[12px] text-zinc-500">
                Sem integração bancária. O sistema gera o QR Code e o operador
                confirma o recebimento.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-md border border-zinc-200 p-3">
            <input
              type="radio"
              name="modo_pix_ui"
              checked={modo === "geranet"}
              disabled={!pixIntegradoLiberado}
              onChange={() => {
                if (pixIntegradoLiberado) {
                  setModo("geranet");
                }
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-[13px] font-semibold text-zinc-950">
                PIX Integrado / Geranet
              </span>
              <span className="mt-1 block text-[12px] text-zinc-500">
                Confirmação por integração bancária.
              </span>
            </span>
          </label>
        </div>
        {!pixIntegradoLiberado ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            PIX Integrado não está incluído no plano atual. O PIX Local / Manual
            continua disponível.
          </p>
        ) : null}
      </section>

      {modo === "local_manual" ? (
        <PixLocalPanel
          chavePix={integracao?.chave_pix ?? ""}
          recebedorNome={integracao?.recebedor_nome ?? ""}
          recebedorCidade={integracao?.recebedor_cidade ?? ""}
          onMensagem={(texto, ok) => {
            setMensagem(texto);
            setSucesso(ok);
          }}
        />
      ) : pixIntegradoLiberado ? (
        <>
      <form
        onSubmit={salvar}
        className="rounded-md border border-zinc-200 bg-white p-4"
      >
        <input type="hidden" name="modo" value="geranet" />
        <h2 className="text-[15px] font-semibold text-zinc-950">
          Integração PIX Geranet
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          Etapa isolada: não altera o PDV. A API Key Geranet continua a da
          integração fiscal. Credenciais do banco entram só no cofre.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[13px] font-medium text-zinc-700">
            Integração
            <input
              value="Geranet"
              readOnly
              className="updv-input mt-1 w-full bg-zinc-50"
            />
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            Ambiente
            <select
              name="ambiente"
              value={ambiente}
              onChange={(event) => trocarAmbiente(event.target.value)}
              className="updv-select mt-1 w-full"
            >
              {formulario.ambientes.includes("2") && (
                <option value="2">Homologação</option>
              )}
              {formulario.ambientes.includes("1") && (
                <option value="1">Produção</option>
              )}
            </select>
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            Provedor
            <select
              name="provedor"
              value={provedor}
              onChange={(event) => trocarProvedor(event.target.value)}
              className="updv-select mt-1 w-full"
            >
              {PROVEDORES_PIX_GERANET.map((item) => (
                <option
                  key={item.codigo}
                  value={item.codigo}
                  disabled={!item.configuracaoDisponivel}
                >
                  {item.configuracaoDisponivel
                    ? item.nome
                    : `${item.nome} — Em validação`}
                </option>
              ))}
            </select>
          </label>

          {formulario.usaChavePix && (
            <label className="text-[13px] font-medium text-zinc-700">
              Chave PIX
              <input
                name="chave_pix"
                defaultValue={integracao?.chave_pix ?? ""}
                required={formulario.chavePixObrigatoria}
                className="updv-input mt-1 w-full"
              />
            </label>
          )}

          <label className="text-[13px] font-medium text-zinc-700">
            Nome do recebedor
            <input
              name="recebedor_nome"
              defaultValue={integracao?.recebedor_nome ?? ""}
              required
              className="updv-input mt-1 w-full"
            />
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            CEP
            <input
              name="recebedor_cep"
              defaultValue={integracao?.recebedor_cep ?? ""}
              className="updv-input mt-1 w-full"
            />
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            Cidade
            <input
              name="recebedor_cidade"
              defaultValue={integracao?.recebedor_cidade ?? ""}
              required
              className="updv-input mt-1 w-full"
            />
          </label>

          <label className="text-[13px] font-medium text-zinc-700">
            UF
            <input
              name="recebedor_uf"
              defaultValue={integracao?.recebedor_uf ?? "MT"}
              maxLength={2}
              required
              className="updv-input mt-1 w-full uppercase"
            />
          </label>
        </div>

        <h3 className="mt-6 text-[13px] font-semibold text-zinc-950">
          {formulario.titulo}
        </h3>
        <p className="mt-1 text-[12px] text-zinc-500">{formulario.ajuda}</p>

        {formulario.configuracaoDisponivel ? (
          <div
            key={`${provedor}-${ambiente}`}
            className="mt-3 grid gap-3 md:grid-cols-2"
          >
            {formulario.campos.map((campo) => (
              <label
                key={campo.chave}
                className="text-[13px] font-medium text-zinc-700"
              >
                {campo.label}
                {campo.tipo === "select" ? (
                  <select
                    name={campo.chave}
                    className="updv-select mt-1 w-full"
                    defaultValue=""
                  >
                    <option value="">Selecione</option>
                    {(campo.opcoes ?? []).map((opcao) => (
                      <option key={opcao.valor} value={opcao.valor}>
                        {opcao.rotulo}
                      </option>
                    ))}
                  </select>
                ) : campo.tipo === "file" ? (
                  <>
                    <input
                      name={campo.chave}
                      type="file"
                      accept={acceptArquivo(campo)}
                      className="mt-1 block w-full text-[13px]"
                      onChange={(event) => {
                        const arquivo = event.target.files?.[0];
                        setArquivosLocais((atual) => ({
                          ...atual,
                          [campo.chave]: arquivo?.name ?? "",
                        }));
                      }}
                    />
                    <span className="mt-1 block text-[12px] text-zinc-500">
                      {arquivosLocais[campo.chave]
                        ? arquivosLocais[campo.chave]
                        : rotuloEscolherArquivo(campo)}
                    </span>
                    {flags[campo.chave] && (
                      <span className="mt-1 block text-[12px] text-emerald-700">
                        {rotuloArquivoConfigurado(campo)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      name={campo.chave}
                      type={campo.tipo}
                      autoComplete={
                        campo.tipo === "password" ? "new-password" : "off"
                      }
                      className="updv-input mt-1 w-full"
                    />
                    {flags[campo.chave] && (
                      <span className="mt-1 block text-[12px] text-emerald-700">
                        {rotuloSegredoConfigurado(campo)}
                      </span>
                    )}
                  </>
                )}
                {campo.ajuda && (
                  <span className="mt-1 block text-[12px] text-zinc-500">
                    {campo.ajuda}
                  </span>
                )}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {formulario.mensagemIndisponivel}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={salvando}
            className="updv-btn updv-btn-primary"
          >
            {salvando ? "Salvando..." : "Salvar configuração"}
          </button>
          <button
            type="button"
            disabled={operando}
            onClick={() => chamar("/api/pagamentos/pix/geranet/testar", {})}
            className="updv-btn updv-btn-ghost"
          >
            Testar conexão
          </button>
        </div>
      </form>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <h2 className="text-[15px] font-semibold text-zinc-950">
          Cobrança PIX de teste
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          Não vincula venda. Homologação não gera cobrança Geranet.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-[13px] font-medium text-zinc-700">
            Valor
            <input
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              className="updv-input mt-1 w-full"
            />
          </label>
          <label className="text-[13px] font-medium text-zinc-700 md:col-span-2">
            Devedor (opcional)
            <input
              value={devedorNome}
              onChange={(event) => setDevedorNome(event.target.value)}
              className="updv-input mt-1 w-full"
              placeholder="Nome do pagador de teste"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={operando}
          onClick={() =>
            chamar("/api/pagamentos/pix/geranet/emitir", {
              valor: Number(valor.replace(",", ".")),
              devedor_nome: devedorNome || undefined,
            })
          }
          className="updv-btn updv-btn-primary mt-4"
        >
          Criar cobrança PIX de teste
        </button>

        <div className="mt-4 overflow-x-auto">
          <table className="updv-table min-w-[760px]">
            <thead>
              <tr>
                <th>TXID</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Ambiente</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((cobranca) => {
                const dados = cobranca.dados_publicos as {
                  normalizado?: {
                    copiaECola?: string | null;
                    qrCode?: string | null;
                  };
                };
                const copia = dados.normalizado?.copiaECola;
                const qr = dados.normalizado?.qrCode;

                return (
                  <tr key={cobranca.id}>
                    <td className="max-w-[220px] truncate font-mono text-[12px]">
                      {cobranca.txid ?? "—"}
                    </td>
                    <td>
                      {cobranca.valor.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                    <td>{cobranca.status}</td>
                    <td>
                      {cobranca.ambiente === "1" ? "Produção" : "Homologação"}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={operando || !cobranca.txid}
                          onClick={() =>
                            chamar("/api/pagamentos/pix/geranet/consultar", {
                              cobranca_id: cobranca.id,
                            })
                          }
                          className="updv-btn-row"
                        >
                          Consultar
                        </button>
                        <button
                          type="button"
                          disabled={
                            operando ||
                            !cobranca.txid ||
                            cobranca.status === "paga" ||
                            cobranca.status === "cancelada"
                          }
                          onClick={() =>
                            chamar("/api/pagamentos/pix/geranet/cancelar", {
                              cobranca_id: cobranca.id,
                            })
                          }
                          className="updv-btn-row text-red-700"
                        >
                          Cancelar
                        </button>
                      </div>
                      {copia && (
                        <p className="mt-2 max-w-sm break-all text-[11px] text-zinc-600">
                          Copia e cola: {copia}
                        </p>
                      )}
                      {qr && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            qr.startsWith("data:") || qr.startsWith("http")
                              ? qr
                              : `data:image/png;base64,${qr}`
                          }
                          alt="QR Code PIX"
                          className="mt-2 h-32 w-32 bg-white"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="updv-table-empty">
                    Nenhuma cobrança de teste ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {diagnostico != null && (
        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="text-[15px] font-semibold text-zinc-950">
            Resposta Geranet sanitizada
          </h2>
          <pre className="mt-2 overflow-auto text-[12px] text-zinc-700">
            {JSON.stringify(diagnostico, null, 2)}
          </pre>
        </section>
      )}
        </>
      ) : (
        <RecursoNaoContratado
          titulo="PIX integrado"
          descricao="Este recurso não está disponível no plano atual da sua empresa. O PIX Local / Manual continua disponível."
          voltarHref="/configuracoes/financeiro/pix"
          voltarLabel="Usar PIX Local"
        />
      )}
    </div>
  );
}
