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
  PROVEDORES_PIX_SELECIONAVEIS,
  ambientePadraoDoProvedor,
  ambientesSuportadosDoProvedor,
  codigoProvedorPixParaTela,
  ehProvedorPixSelecionavel,
} from "@/lib/pagamentos/pix/provedores";
import type { CobrancaPixPublica, ModoPix } from "@/lib/pagamentos/pix/types";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { gerenciarWebhookPixC6, salvarConfiguracaoPix } from "./actions";
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

type TomAlertaPix = "sucesso" | "inconclusivo" | "erro";

type RespostaApi = {
  ok?: boolean;
  resultado?: TomAlertaPix;
  erro?: string;
  mensagem?: string;
  limitacao?: string;
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
  const [tomAlerta, setTomAlerta] = useState<TomAlertaPix>("sucesso");
  const [salvando, setSalvando] = useState(false);
  const [operando, setOperando] = useState(false);
  const [valor, setValor] = useState("1.00");
  const [devedorNome, setDevedorNome] = useState("");
  const [diagnostico, setDiagnostico] = useState<unknown>(null);
  const [flagsArquivoSalvas, setFlagsArquivoSalvas] = useState<{
    certificadoConfigurado: boolean;
    chavePrivadaConfigurada: boolean;
  } | null>(null);
  const [lista, setLista] = useState(cobrancas);
  const [provedor, setProvedor] = useState(() =>
    codigoProvedorPixParaTela(integracao?.provedor)
  );
  const provedorSalvoForaDoCatalogo = Boolean(
    integracao?.provedor &&
      integracao.provedor !== "gerencianet" &&
      !ehProvedorPixSelecionavel(integracao.provedor)
  );
  const [ambiente, setAmbiente] = useState(() => {
    const inicialProvedor = codigoProvedorPixParaTela(integracao?.provedor);
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

  const ehC6 = provedor === "c6bank";
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
  const certificadoConfiguradoVisivel =
    flagsArquivoSalvas?.certificadoConfigurado ??
    Boolean(flags.certificadoPemHexadecimal);
  const chavePrivadaConfiguradaVisivel =
    flagsArquivoSalvas?.chavePrivadaConfigurada ??
    Boolean(flags.chavePrivadaPemHexadecimal);

  function arquivoConfiguradoVisivel(chave: string) {
    if (chave === "certificadoPemHexadecimal") {
      return certificadoConfiguradoVisivel;
    }
    if (chave === "chavePrivadaPemHexadecimal") {
      return chavePrivadaConfiguradaVisivel;
    }
    return Boolean(flags[chave]);
  }

  function trocarProvedor(proximo: string) {
    if (!ehProvedorPixSelecionavel(proximo)) {
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
    setFlagsArquivoSalvas(null);
  }

  function trocarAmbiente(proximo: string) {
    setAmbiente(proximo);
    setArquivosLocais({});
    setFlagsArquivoSalvas(null);
  }

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSalvando(true);
    setMensagem(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const resultado = await salvarConfiguracaoPix(formData);
      setTomAlerta(resultado.ok ? "sucesso" : "erro");
      setMensagem(
        resultado.ok
          ? "mensagem" in resultado && resultado.mensagem
            ? resultado.mensagem
            : "Credenciais salvas com segurança."
          : resultado.erro
      );
      if (
        "certificadoConfigurado" in resultado &&
        "chavePrivadaConfigurada" in resultado
      ) {
        setFlagsArquivoSalvas({
          certificadoConfigurado: Boolean(resultado.certificadoConfigurado),
          chavePrivadaConfigurada: Boolean(resultado.chavePrivadaConfigurada),
        });
      }
      if (resultado.ok) {
        setArquivosLocais({});
      }
    } catch (error) {
      setTomAlerta("erro");
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
      const tom: TomAlertaPix =
        data.resultado === "sucesso" ||
        data.resultado === "inconclusivo" ||
        data.resultado === "erro"
          ? data.resultado
          : data.ok
            ? "sucesso"
            : "erro";
      setTomAlerta(tom);
      setMensagem(
        [data.erro ?? data.mensagem ?? (data.ok ? "Operação concluída." : "Falha PIX."), data.limitacao]
          .filter(Boolean)
          .join(" ")
      );
      setDiagnostico(data.resposta ?? data);
      if (data.cobranca) {
        setLista((atual) => {
          const resto = atual.filter((item) => item.id !== data.cobranca?.id);
          return [data.cobranca as CobrancaPixPublica, ...resto];
        });
      }
    } catch (error) {
      setTomAlerta("erro");
      setMensagem(
        error instanceof Error ? error.message : "Falha de rede no PIX."
      );
    } finally {
      setOperando(false);
    }
  }

  async function webhookC6(operacao: "registrar" | "consultar" | "remover") {
    setOperando(true);
    setMensagem(null);
    try {
      const resultado = await gerenciarWebhookPixC6(operacao);
      setTomAlerta(resultado.ok ? "sucesso" : "erro");
      setMensagem(
        resultado.ok
          ? [resultado.mensagem, resultado.webhookUrl]
              .filter(Boolean)
              .join(" ")
          : resultado.erro
      );
    } catch (error) {
      setTomAlerta("erro");
      setMensagem(
        error instanceof Error ? error.message : "Falha ao operar o webhook C6."
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
            tomAlerta === "sucesso"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : tomAlerta === "inconclusivo"
                ? "border-amber-200 bg-amber-50 text-amber-800"
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
            setTomAlerta(ok ? "sucesso" : "erro");
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
          {ehC6 ? "Integração PIX C6 Bank" : "Integração PIX Geranet"}
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500">
          {ehC6
            ? "Autenticação e cobrança imediatas no C6. Sandbox e produção usam credenciais, certificado, chave privada e chave PIX separados no cofre da empresa ativa."
            : "Etapa isolada: não altera o PDV. A API Key Geranet continua a da integração fiscal. Credenciais do banco entram só no cofre."}
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[13px] font-medium text-zinc-700">
            Integração
            <input
              value={ehC6 ? "C6 Bank (direto)" : "Geranet"}
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
                <option value="2">{ehC6 ? "Sandbox" : "Homologação"}</option>
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
              {PROVEDORES_PIX_SELECIONAVEIS.map((item) => (
                <option key={item.codigo} value={item.codigo}>
                  {item.nome}
                </option>
              ))}
            </select>
          </label>

          {provedorSalvoForaDoCatalogo && (
            <p className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              O provedor salvo anteriormente não está disponível nesta versão.
              Selecione um dos bancos suportados para continuar.
            </p>
          )}

          {formulario.usaChavePix &&
            !formulario.campos.some((campo) => campo.chave === "chavePix") && (
            <label className="text-[13px] font-medium text-zinc-700">
              Chave PIX
              <input
                key={`${provedor}-${ambiente}-chave-pix`}
                name="chave_pix"
                defaultValue={ehC6 ? "" : (integracao?.chave_pix ?? "")}
                required={
                  ehC6 ? !flags.chavePix : formulario.chavePixObrigatoria
                }
                autoComplete="off"
                placeholder={
                  ehC6 && flags.chavePix
                    ? "Informe somente para substituir neste ambiente"
                    : undefined
                }
                className="updv-input mt-1 w-full"
              />
              {ehC6 && flags.chavePix ? (
                <span className="mt-1 block text-[12px] text-emerald-700">
                  Chave PIX configurada ✓
                </span>
              ) : null}
              {ehC6 ? (
                <span className="mt-1 block text-[12px] text-zinc-500">
                  Sandbox e produção usam chaves distintas no cofre. Trocar o
                  ambiente não copia a chave anterior.
                </span>
              ) : null}
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
                    {arquivoConfiguradoVisivel(campo.chave) && (
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
            {ehC6 && ambiente === "1"
              ? "Testar conexão de produção"
              : ehC6
                ? "Testar conexão de sandbox"
                : "Testar conexão"}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-zinc-500">
          {ehC6
            ? ambiente === "1"
              ? "O teste autentica no C6 Produção com mTLS. O access_token não é enviado ao navegador e nenhuma cobrança é emitida."
              : "O teste autentica no C6 Sandbox com mTLS. O access_token não é enviado ao navegador e nenhuma cobrança é emitida."
            : "O teste consulta um TXID sintético, sem emitir cobrança. Só marca sucesso quando a resposta comprova autenticação aceita e erro de cobrança inexistente. Resposta genérica fica inconclusiva; recusa de certificado, token ou credencial é erro."}
        </p>
        {ehC6 && (
          <ul className="mt-3 grid gap-1 text-[12px] text-zinc-700 md:grid-cols-2">
            <li>
              Client ID configurado {flags.clienteId ? "✓" : "—"}
            </li>
            <li>
              Client Secret configurado {flags.clienteSegredo ? "✓" : "—"}
            </li>
            <li>
              Certificado configurado {certificadoConfiguradoVisivel ? "✓" : "—"}
            </li>
            <li>
              Chave privada configurada {chavePrivadaConfiguradaVisivel ? "✓" : "—"}
            </li>
            <li>
              Chave PIX configurada{" "}
              {flags.chavePix || integracao?.chave_pix ? "✓" : "—"}
            </li>
          </ul>
        )}
        </form>

      {ehC6 ? (
        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <h2 className="text-[15px] font-semibold text-zinc-950">
            Webhook C6
          </h2>
          <p className="mt-1 text-[13px] text-zinc-500">
            O cadastro no C6 é feito pelo servidor. A URL pública aponta para o
            domínio HTTPS do UltraPDV. O webhook só dispara a consulta da
            cobrança; o pagamento não é confirmado pelo POST recebido.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={operando}
              onClick={() => void webhookC6("registrar")}
              className="updv-btn updv-btn-primary"
            >
              Registrar webhook
            </button>
            <button
              type="button"
              disabled={operando}
              onClick={() => void webhookC6("consultar")}
              className="updv-btn updv-btn-ghost"
            >
              Consultar webhook
            </button>
            <button
              type="button"
              disabled={operando}
              onClick={() => void webhookC6("remover")}
              className="updv-btn updv-btn-ghost"
            >
              Remover webhook
            </button>
          </div>
        </section>
      ) : null}

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
                  pixCopiaECola?: string | null;
                  contrato?: { pixCopiaECola?: string | null; qrCode?: string | null };
                  normalizado?: {
                    copiaECola?: string | null;
                    qrCode?: string | null;
                  };
                };
                const copia =
                  dados.contrato?.pixCopiaECola ??
                  dados.pixCopiaECola ??
                  dados.normalizado?.copiaECola;
                const qr =
                  dados.contrato?.qrCode ?? dados.normalizado?.qrCode;

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
                      {cobranca.ambiente === "1"
                        ? "Produção"
                        : cobranca.provedor === "c6bank"
                          ? "Sandbox"
                          : "Homologação"}
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
                            cobranca.provedor === "c6bank" ||
                            cobranca.status === "paga" ||
                            cobranca.status === "cancelada"
                          }
                          title={
                            cobranca.provedor === "c6bank"
                              ? "Cancelamento remoto C6 ainda não está documentado nesta fase."
                              : undefined
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
            Resposta sanitizada
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
