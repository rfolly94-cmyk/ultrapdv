"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import { CampoValor } from "@/components/ui/campo-valor";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageAlert } from "@/components/ui/page-alert";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  MODELO_OUTRO_ID,
  MENSAGEM_AVANCADO_ETIQUETA,
  MENSAGEM_TROCA_MODELO_AVANCADO,
  ajudaFormatoModelo,
  aplicarSelecaoModelo,
  buscarModelo,
  estadoInicialFormularioBalanca,
  modelosDoFabricante,
  opcoesFormatoModelo,
  rotuloFormatoSalvo,
  tiposIntegracaoDoModelo,
} from "@/lib/balancas/modelos";
import {
  AJUDA_DEPARTAMENTO_PADRAO,
  departamentoEfetivoBalanca,
  departamentoPadraoDaConfiguracao,
  rotuloDepartamentoTabela,
  sugerirDepartamentoPadrao,
} from "@/lib/balancas/departamento";
import {
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  FABRICANTES_BALANCA,
  MODOS_ETIQUETA_BALANCA,
  ROTULO_STATUS_PRODUTO_BALANCA,
  TIPOS_INTEGRACAO_BALANCA,
  type ConfiguracaoBalanca,
  type ConfiguracaoEtiquetaBalanca,
  type FabricanteBalanca,
  type ProdutoVinculadoBalanca,
  type ResumoValidacaoCargaBalanca,
  type StatusProdutoBalanca,
  type TipoIntegracaoBalanca,
} from "@/lib/balancas/tipos";
import type { FiltroVinculoBalanca } from "@/lib/balancas/validar-produto-balanca";
import { filtrarProdutosVinculados } from "@/lib/balancas/validar-produto-balanca";
import { layoutExportacaoImplementado } from "@/lib/balancas/adapters";

import {
  definirVinculoProdutoBalanca,
  excluirConfiguracaoBalanca,
  exportarCargaBalanca,
  listarProdutosVinculadosBalanca,
  salvarConfiguracaoBalanca,
} from "./actions";

function rotuloFabricante(valor: string) {
  return (
    FABRICANTES_BALANCA.find((item) => item.value === valor)?.label ?? valor
  );
}

function rotuloTipo(valor: string) {
  return (
    TIPOS_INTEGRACAO_BALANCA.find((item) => item.value === valor)?.label ??
    valor
  );
}

function dinheiro(valor: number) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function badgeStatus(status: StatusProdutoBalanca) {
  if (status === "pronto") {
    return "ativo";
  }
  if (status === "nao_vinculado") {
    return "inativo";
  }
  return "pendente";
}

function baixarArquivo(nome: string, conteudo: string, mime: string) {
  const bytes = new Uint8Array(conteudo.length);
  for (let indice = 0; indice < conteudo.length; indice += 1) {
    bytes[indice] = conteudo.charCodeAt(indice) & 0xff;
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BalancasWorkspace({
  configs,
  podeEditar,
}: {
  configs: ConfiguracaoBalanca[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selecionadaId, setSelecionadaId] = useState<string | null>(
    configs[0]?.id ?? null
  );
  const [editando, setEditando] = useState<ConfiguracaoBalanca | "nova" | null>(
    null
  );
  const [vinculados, setVinculados] = useState<ProdutoVinculadoBalanca[]>([]);
  const [resumo, setResumo] = useState<ResumoValidacaoCargaBalanca | null>(
    null
  );
  const [filtro, setFiltro] = useState<FiltroVinculoBalanca>("todos");
  const [busca, setBusca] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [exportacao, setExportacao] = useState<ResumoValidacaoCargaBalanca | null>(
    null
  );

  const selecionada =
    configs.find((item) => item.id === selecionadaId) ?? null;
  const vinculadosExibidos = useMemo(
    () => (selecionadaId ? vinculados : []),
    [selecionadaId, vinculados]
  );
  const resumoExibido = selecionadaId ? resumo : null;

  useEffect(() => {
    if (!selecionadaId) {
      return;
    }

    const configId = selecionadaId;
    let cancelado = false;

    start(async () => {
      const saida = await listarProdutosVinculadosBalanca(configId);
      if (cancelado) {
        return;
      }
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setVinculados(saida.vinculados);
      setResumo(saida.resumo);
    });

    return () => {
      cancelado = true;
    };
  }, [selecionadaId]);

  const departamentoPadrao = departamentoPadraoDaConfiguracao(selecionada);
  const departamentos = useMemo(() => {
    const valores = new Set<string>();
    for (const item of vinculadosExibidos) {
      const efetivo = departamentoEfetivoBalanca(
        item.departamento,
        departamentoPadrao
      );
      if (efetivo.valor) {
        valores.add(efetivo.valor);
      }
    }
    return [...valores].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [vinculadosExibidos, departamentoPadrao]);

  const filtrados = useMemo(
    () =>
      filtrarProdutosVinculados(
        vinculadosExibidos,
        filtro,
        busca,
        departamento || null,
        departamentoPadrao
      ),
    [vinculadosExibidos, filtro, busca, departamento, departamentoPadrao]
  );

  function mostrarSucesso(mensagem: string) {
    setErro(null);
    setSucesso(mensagem);
    window.setTimeout(() => setSucesso(null), 4000);
  }

  function salvarConfig(formData: FormData) {
    start(async () => {
      const saida = await salvarConfiguracaoBalanca(formData);
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setEditando(null);
      if (saida.id) {
        setSelecionadaId(saida.id);
      }
      mostrarSucesso(saida.mensagem ?? "Balança salva.");
      router.refresh();
    });
  }

  function excluir(id: string) {
    start(async () => {
      const saida = await excluirConfiguracaoBalanca(id);
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      if (selecionadaId === id) {
        setSelecionadaId(null);
      }
      mostrarSucesso(saida.mensagem ?? "Balança excluída.");
      router.refresh();
    });
  }

  function prepararExportacao() {
    if (!selecionadaId) {
      return;
    }
    start(async () => {
      const saida = await listarProdutosVinculadosBalanca(selecionadaId);
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setVinculados(saida.vinculados);
      setResumo(saida.resumo);
      setExportacao(saida.resumoExportacao);
    });
  }

  function alternarVinculo(produtoId: string, vinculado: boolean) {
    if (!selecionadaId) {
      return;
    }
    start(async () => {
      const saida = await definirVinculoProdutoBalanca({
        configId: selecionadaId,
        produtoId,
        vinculado,
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      const lista = await listarProdutosVinculadosBalanca(selecionadaId);
      if (!lista.ok) {
        setErro(lista.erro);
        return;
      }
      setVinculados(lista.vinculados);
      setResumo(lista.resumo);
      mostrarSucesso(saida.mensagem ?? "Vínculo atualizado.");
    });
  }

  function confirmarExportacao(somenteValidos: boolean) {
    if (!selecionadaId) {
      return;
    }
    start(async () => {
      const saida = await exportarCargaBalanca({
        configId: selecionadaId,
        somenteValidos,
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setExportacao(null);
      baixarArquivo(saida.nomeArquivo, saida.conteudo, saida.mime);
      mostrarSucesso("Carga exportada.");
    });
  }

  return (
    <div className="space-y-4">
      {erro ? (
        <PageAlert type="erro" className="mx-0">
          {erro}
        </PageAlert>
      ) : null}
      {sucesso ? (
        <PageAlert type="sucesso" className="mx-0">
          {sucesso}
        </PageAlert>
      ) : null}

      <div className="rounded-md border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-[var(--page-pad)] py-3">
          <h2 className="text-[15px] font-semibold text-zinc-950">
            Balanças da empresa
          </h2>
          {podeEditar ? (
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              onClick={() => setEditando("nova")}
            >
              Nova balança
            </button>
          ) : null}
        </div>
        <DataTable minWidth={720}>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Fabricante</th>
              <th>Modelo</th>
              <th>Integração</th>
              <th>Formato</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr
                key={config.id}
                className={
                  config.id === selecionadaId ? "bg-zinc-50" : undefined
                }
                onClick={() => setSelecionadaId(config.id)}
              >
                <td className="font-medium">{config.nome}</td>
                <td>{rotuloFabricante(config.fabricante)}</td>
                <td>{config.modelo ?? "—"}</td>
                <td>{rotuloTipo(config.tipoIntegracao)}</td>
                <td>
                  {rotuloFormatoSalvo({
                    fabricante: config.fabricante,
                    modeloNome: config.modelo,
                    modeloId: config.configuracao.modeloId,
                    formato: config.configuracao.formato,
                    layout: config.layout,
                  })}
                </td>
                <td>
                  <StatusBadge status={config.ativo ? "ativo" : "inativo"} />
                </td>
                <td>
                  <RowActions
                    onEdit={
                      podeEditar ? () => setEditando(config) : undefined
                    }
                    items={
                      podeEditar
                        ? [
                            {
                              label: "Excluir",
                              danger: true,
                              onClick: () => excluir(config.id),
                            },
                          ]
                        : []
                    }
                  />
                </td>
              </tr>
            ))}
            {configs.length === 0 && (
              <DataTableEmpty colSpan={7}>
                Nenhuma balança cadastrada nesta empresa.
              </DataTableEmpty>
            )}
          </tbody>
        </DataTable>
      </div>

      {selecionada ? (
        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-950">
                Produtos vinculados · {selecionada.nome}
              </h2>
              <p className="mt-1 text-[13px] text-zinc-500">
                Produtos em KG da empresa ativa. O vínculo é desta configuração.
                O preço vem de preço de venda.
              </p>
            </div>
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              disabled={pending || !selecionada}
              onClick={prepararExportacao}
            >
              Exportar para balança
            </button>
          </div>

          {resumoExibido ? (
            <p className="mt-3 text-[13px] text-zinc-600">
              {resumoExibido.encontrados} encontrados · {resumoExibido.validos} válidos ·{" "}
              {resumoExibido.comErro} com erro
            </p>
          ) : null}

          {layoutExportacaoImplementado(
            selecionada.fabricante,
            selecionada.layout
          ) ? (
            <p className="mt-2 text-[12px] text-zinc-500">
              A exportação gera o arquivo Itensmgv.txt para importação no MGV7.
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-amber-800">
              {MENSAGEM_LAYOUT_NAO_IMPLEMENTADO}
            </p>
          )}

          <ListToolbar
            searchPlaceholder="Buscar descrição, código ou PLU"
            searchValue={busca}
            onSearchChange={setBusca}
            filters={
              <>
                <select
                  value={filtro}
                  onChange={(event) =>
                    setFiltro(event.target.value as FiltroVinculoBalanca)
                  }
                  className="updv-input"
                >
                  <option value="todos">Todos</option>
                  <option value="vinculados">Vinculados</option>
                  <option value="nao_vinculados">Não vinculados</option>
                  <option value="com_erro">Com erro</option>
                </select>
                <select
                  value={departamento}
                  onChange={(event) => setDepartamento(event.target.value)}
                  className="updv-input"
                >
                  <option value="">Departamento</option>
                  {departamentos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </>
            }
          />

          <DataTable minWidth={980}>
            <thead>
              <tr>
                <th>Vínculo</th>
                <th>PLU</th>
                <th>Código</th>
                <th>Produto</th>
                <th>UN</th>
                <th>Preço</th>
                <th>Departamento</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((item) => (
                <tr key={item.produtoId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Vincular ${item.nome}`}
                      checked={item.enviarBalanca}
                      disabled={!podeEditar || pending}
                      onChange={(event) =>
                        alternarVinculo(item.produtoId, event.target.checked)
                      }
                    />
                  </td>
                  <td>{item.plu ?? "—"}</td>
                  <td>{item.codigo}</td>
                  <td>{item.nome}</td>
                  <td>{item.unidade}</td>
                  <td className="num">R$ {dinheiro(item.precoVenda)}</td>
                  <td>
                    {rotuloDepartamentoTabela(
                      item.departamento,
                      departamentoPadrao
                    )}
                  </td>
                  <td>
                    <StatusBadge status={badgeStatus(item.status)}>
                      {ROTULO_STATUS_PRODUTO_BALANCA[item.status]}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <DataTableEmpty colSpan={8}>
                  Nenhum produto elegível encontrado.
                </DataTableEmpty>
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      <AppModal
        open={Boolean(editando)}
        title={editando === "nova" ? "Nova balança" : "Editar balança"}
        onClose={() => setEditando(null)}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setEditando(null)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="balanca-config-form"
              className="updv-btn updv-btn-primary"
              disabled={pending || !podeEditar}
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </>
        }
      >
        {editando ? (
          <FormularioBalanca
            key={editando === "nova" ? "nova" : editando.id}
            config={editando === "nova" ? null : editando}
            onSubmit={salvarConfig}
          />
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(exportacao)}
        title="Validar carga da balança"
        onClose={() => setExportacao(null)}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setExportacao(null)}
            >
              Cancelar para corrigir
            </button>
            {exportacao && exportacao.comErro > 0 ? (
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                disabled={pending || exportacao.validos === 0}
                onClick={() => confirmarExportacao(true)}
              >
                Exportar somente válidos
              </button>
            ) : (
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                disabled={pending || (exportacao?.validos ?? 0) === 0}
                onClick={() => confirmarExportacao(true)}
              >
                Exportar
              </button>
            )}
          </>
        }
      >
        {exportacao ? (
          <div className="space-y-3 text-[13px]">
            <p>
              {exportacao.encontrados} encontrados · {exportacao.validos}{" "}
              válidos · {exportacao.comErro} com erro
            </p>
            {selecionada &&
            !layoutExportacaoImplementado(
              selecionada.fabricante,
              selecionada.layout
            ) ? (
              <PageAlert type="aviso" className="mx-0">
                {MENSAGEM_LAYOUT_NAO_IMPLEMENTADO}
              </PageAlert>
            ) : null}
            {exportacao.problemas.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-red-700">
                {exportacao.problemas.map((problema) => (
                  <li key={problema.produtoId}>
                    {problema.codigo} · {problema.nome}: {problema.detalhe}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600">
                Nenhum problema de cadastro. A carga será gerada para os
                produtos válidos desta configuração.
              </p>
            )}
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}

function FormularioBalanca({
  config,
  onSubmit,
}: {
  config: ConfiguracaoBalanca | null;
  onSubmit: (formData: FormData) => void;
}) {
  const inicial = estadoInicialFormularioBalanca(config);
  const [nome, setNome] = useState(config?.nome ?? "");
  const [fabricante, setFabricante] = useState<FabricanteBalanca>(
    inicial.fabricante
  );
  const [modeloId, setModeloId] = useState(inicial.modeloId);
  const [modeloNome, setModeloNome] = useState(inicial.modeloNome);
  const [buscaModelo, setBuscaModelo] = useState("");
  const [formato, setFormato] = useState(inicial.formato);
  const [tipoIntegracao, setTipoIntegracao] = useState<TipoIntegracaoBalanca>(
    inicial.tipoIntegracao
  );
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [etiqueta, setEtiqueta] = useState<ConfiguracaoEtiquetaBalanca>(
    inicial.etiqueta
  );
  const [etiquetaManual, setEtiquetaManual] = useState(inicial.etiquetaManual);
  const [departamentoPadrao, setDepartamentoPadrao] = useState(
    inicial.departamentoPadrao
  );
  const [confirmacao, setConfirmacao] = useState<{
    fabricante: FabricanteBalanca;
    modeloId: string;
    modeloNome: string;
  } | null>(null);

  const modelo = buscarModelo({ fabricante, modeloId });
  const conhecidos = modelosDoFabricante(fabricante);
  const opcoesFormato = opcoesFormatoModelo(modelo);
  const tiposIntegracao = tiposIntegracaoDoModelo(modelo);
  const tiposVisiveis = TIPOS_INTEGRACAO_BALANCA.filter((item) =>
    tiposIntegracao.includes(item.value)
  );

  function aplicarTroca(
    proximo: {
      fabricante: FabricanteBalanca;
      modeloId: string;
      modeloNome: string;
    },
    substituirAvancado = false
  ) {
    const modeloNovo = buscarModelo({
      fabricante: proximo.fabricante,
      modeloId: proximo.modeloId,
    });
    const resultado = aplicarSelecaoModelo({
      modelo: modeloNovo,
      etiquetaAtual: etiqueta,
      etiquetaManual,
      substituirAvancado,
    });
    const tipos = tiposIntegracaoDoModelo(modeloNovo);

    setFabricante(proximo.fabricante);
    setModeloId(proximo.modeloId);
    setModeloNome(modeloNovo?.nome ?? proximo.modeloNome);
    setFormato(resultado.formato);
    setTipoIntegracao((atual) =>
      tipos.includes(atual) ? atual : tipos[0]
    );
    setEtiqueta(resultado.etiqueta);
    setEtiquetaManual(resultado.etiquetaManual);
    setDepartamentoPadrao((atual) =>
      sugerirDepartamentoPadrao({
        layout: resultado.layout,
        atual,
      })
    );
    setBuscaModelo("");
    setConfirmacao(
      resultado.exigeConfirmacao && !substituirAvancado ? proximo : null
    );
  }

  function alterarEtiqueta(
    parcial: Partial<ConfiguracaoEtiquetaBalanca>
  ) {
    setEtiqueta((atual) => ({ ...atual, ...parcial }));
    setEtiquetaManual(true);
  }

  return (
    <form
      id="balanca-config-form"
      className="grid gap-4 md:grid-cols-2"
      action={onSubmit}
    >
      {config?.id ? <input type="hidden" name="id" value={config.id} /> : null}
      <input type="hidden" name="modelo_id" value={modeloId} />
      <input type="hidden" name="formato" value={formato} />
      <input
        type="hidden"
        name="etiqueta_manual"
        value={etiquetaManual ? "1" : "0"}
      />
      {modeloId !== MODELO_OUTRO_ID ? (
        <input type="hidden" name="modelo" value={modelo?.nome ?? ""} />
      ) : null}

      {confirmacao ? (
        <div className="md:col-span-2">
          <PageAlert type="aviso" className="mx-0">
            <p>{MENSAGEM_TROCA_MODELO_AVANCADO}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                onClick={() => aplicarTroca(confirmacao, true)}
              >
                Substituir
              </button>
              <button
                type="button"
                className="updv-btn updv-btn-ghost"
                onClick={() => setConfirmacao(null)}
              >
                Manter minhas configurações
              </button>
            </div>
          </PageAlert>
        </div>
      ) : null}

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-zinc-700">Nome</label>
        <input
          name="nome"
          required
          value={nome}
          maxLength={80}
          onChange={(event) => setNome(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Fabricante
        </label>
        <select
          name="fabricante"
          required
          value={fabricante}
          onChange={(event) => {
            const proximo = event.target.value as FabricanteBalanca;
            const permanece =
              modelo?.fabricante === proximo ? modeloId : MODELO_OUTRO_ID;
            aplicarTroca({
              fabricante: proximo,
              modeloId: permanece,
              modeloNome: permanece === MODELO_OUTRO_ID ? "" : modeloNome,
            });
          }}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        >
          {FABRICANTES_BALANCA.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <SelectModeloBalanca
        modeloId={modeloId}
        modeloNome={modeloNome}
        busca={buscaModelo}
        conhecidos={conhecidos}
        onBusca={setBuscaModelo}
        onModeloNome={setModeloNome}
        onModeloId={(proximoId) =>
          aplicarTroca({
            fabricante,
            modeloId: proximoId,
            modeloNome: proximoId === MODELO_OUTRO_ID ? modeloNome : "",
          })
        }
      />

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Formato
        </label>
        <select
          value={formato}
          onChange={(event) => setFormato(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        >
          {opcoesFormato.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          {ajudaFormatoModelo(modelo)}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Tipo de integração
        </label>
        <select
          name="tipo_integracao"
          required
          value={tipoIntegracao}
          onChange={(event) =>
            setTipoIntegracao(event.target.value as TipoIntegracaoBalanca)
          }
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        >
          {tiposVisiveis.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Departamento padrão
        </label>
        <input
          name="departamento_padrao"
          value={departamentoPadrao}
          inputMode="numeric"
          maxLength={2}
          placeholder="01"
          onChange={(event) => setDepartamentoPadrao(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500">
          {AJUDA_DEPARTAMENTO_PADRAO}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 md:col-span-2">
        <input
          type="checkbox"
          name="ativo"
          value="1"
          checked={ativo}
          onChange={(event) => setAtivo(event.target.checked)}
          className="size-4 rounded border-zinc-300"
        />
        Ativa
      </label>

      <details className="md:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h3 className="text-sm font-semibold text-zinc-950">
            Configurações avançadas
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            {MENSAGEM_AVANCADO_ETIQUETA}
          </p>
        </summary>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Prefixo
            </label>
            <input
              name="etiqueta_prefixo"
              value={etiqueta.prefixo}
              maxLength={8}
              onChange={(event) =>
                alterarEtiqueta({ prefixo: event.target.value })
              }
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Peso ou preço
            </label>
            <select
              name="etiqueta_modo"
              value={etiqueta.modo}
              onChange={(event) =>
                alterarEtiqueta({
                  modo: event.target.value as ConfiguracaoEtiquetaBalanca["modo"],
                })
              }
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            >
              {MODOS_ETIQUETA_BALANCA.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Quantidade de dígitos
            </label>
            <CampoValor
              name="etiqueta_quantidade_digitos"
              value={String(etiqueta.quantidadeDigitos)}
              inputMode="numeric"
              onChange={(event) =>
                alterarEtiqueta({
                  quantidadeDigitos: Number(event.target.value) || 0,
                })
              }
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Casas decimais
            </label>
            <CampoValor
              name="etiqueta_casas_decimais"
              value={String(etiqueta.casasDecimais)}
              inputMode="numeric"
              onChange={(event) =>
                alterarEtiqueta({
                  casasDecimais: Number(event.target.value) || 0,
                })
              }
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
            <input
              type="checkbox"
              name="etiqueta_plu"
              value="1"
              checked={etiqueta.plu}
              onChange={(event) => alterarEtiqueta({ plu: event.target.checked })}
              className="size-4 rounded border-zinc-300"
            />
            Incluir PLU
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
            <input
              type="checkbox"
              name="etiqueta_digito_verificador"
              value="1"
              checked={etiqueta.digitoVerificador}
              onChange={(event) =>
                alterarEtiqueta({ digitoVerificador: event.target.checked })
              }
              className="size-4 rounded border-zinc-300"
            />
            Dígito verificador
          </label>
        </div>
      </details>
    </form>
  );
}

function SelectModeloBalanca({
  modeloId,
  modeloNome,
  busca,
  conhecidos,
  onBusca,
  onModeloNome,
  onModeloId,
}: {
  modeloId: string;
  modeloNome: string;
  busca: string;
  conhecidos: ReturnType<typeof modelosDoFabricante>;
  onBusca: (valor: string) => void;
  onModeloNome: (valor: string) => void;
  onModeloId: (valor: string) => void;
}) {
  const normalizar = (valor: string) =>
    valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const filtrados = conhecidos.filter((item) =>
    normalizar(item.nome).includes(normalizar(busca))
  );
  const selecionado = conhecidos.find((item) => item.id === modeloId);
  const opcoes =
    selecionado && !filtrados.some((item) => item.id === selecionado.id)
      ? [selecionado, ...filtrados]
      : filtrados;

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">Modelo</label>
      {conhecidos.length > 0 ? (
        <>
          <input
            type="search"
            placeholder="Buscar modelo"
            value={busca}
            onChange={(event) => onBusca(event.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
          />
          <select
            value={modeloId}
            onChange={(event) => onModeloId(event.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
          >
            {opcoes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
            <option value={MODELO_OUTRO_ID}>Outro modelo</option>
          </select>
        </>
      ) : (
        <select
          defaultValue={MODELO_OUTRO_ID}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        >
          <option value={MODELO_OUTRO_ID}>Outro modelo</option>
        </select>
      )}
      {modeloId === MODELO_OUTRO_ID ? (
        <input
          name="modelo"
          value={modeloNome}
          placeholder="Nome do modelo"
          onChange={(event) => onModeloNome(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
        />
      ) : null}
    </div>
  );
}

