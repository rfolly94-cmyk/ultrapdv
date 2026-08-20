"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  confirmarImportacaoAction,
  errosImportacaoAction,
  previaImportacaoAction,
} from "@/app/configuracoes/importar-dados/actions";
import { ConfiguracaoDuplicadosClientes, ConfiguracaoDuplicadosProdutos } from "@/components/importacao/configuracao-duplicados";
import { MapeamentoColunas } from "@/components/importacao/mapeamento-colunas";
import { PreviewImportacao } from "@/components/importacao/preview-importacao";
import { SeletorCampos } from "@/components/importacao/seletor-campos";
import { UploadArquivo } from "@/components/importacao/upload-arquivo";
import {
  colunasDoCabecalho,
  extrairPlanilha,
  lerWorkbook,
  linhasAposCabecalho,
  LIMITES_IMPORTACAO,
} from "@/lib/importacao/parser";
import {
  CAMPOS_CLIENTE,
  CAMPOS_PRODUTO,
  ROTULOS_CAMPO_CLIENTE,
  ROTULOS_CAMPO_PRODUTO,
  type CampoCliente,
  type CampoProduto,
  type ConfiguracaoImportacao,
  type ErroHistoricoImportacao,
  type HistoricoImportacao,
  type IdentificadorCliente,
  type IdentificadorProduto,
  type ResultadoPreviaImportacao,
  type TipoImportacao,
} from "@/lib/importacao/tipos";

const ETAPAS = [
  "Arquivo",
  "Campos",
  "Vincular",
  "Regras",
  "Revisar",
  "Concluído",
];

type ResultadoFinal = {
  empresaNome: string;
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: number;
  arquivo: string;
};

function HistoricoRecente({
  historico,
  histAberto,
  errosHist,
  pending,
  onAbrir,
}: {
  historico: HistoricoImportacao[];
  histAberto: string | null;
  errosHist: ErroHistoricoImportacao[] | null;
  pending: boolean;
  onAbrir: (id: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-3 py-2 text-[13px] font-semibold">
        Importações recentes
      </div>
      {historico.length === 0 ? (
        <p className="px-3 py-4 text-[13px] text-zinc-500">Nenhuma importação nesta empresa.</p>
      ) : (
        <table className="updv-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Arquivo</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.created_at).toLocaleString("pt-BR")}</td>
                <td>{item.tipo === "clientes" ? "Clientes" : "Produtos"}</td>
                <td>{item.nome_arquivo}</td>
                <td>
                  <button
                    type="button"
                    className="text-left font-medium underline"
                    disabled={pending}
                    onClick={() => onAbrir(item.id)}
                  >
                    {item.total_criados.toLocaleString("pt-BR")} criados ·{" "}
                    {item.total_atualizados.toLocaleString("pt-BR")} atualizados ·{" "}
                    {item.total_erros} erros
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {histAberto && errosHist ? (
        <div className="border-t border-zinc-200 px-3 py-3 text-[13px]">
          <p className="font-semibold">Linhas com erro</p>
          {errosHist.length === 0 ? (
            <p className="mt-1 text-zinc-500">Nenhum erro gravado.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {errosHist.map((item) => (
                <li key={item.id}>
                  Linha {item.numero_linha}: {item.erro}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ImportacaoWorkspace({
  tipoInicial = null,
  historico,
  empresaNome,
}: {
  tipoInicial?: TipoImportacao | null;
  historico: HistoricoImportacao[];
  empresaNome: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tipo, setTipo] = useState<TipoImportacao | null>(tipoInicial);
  const [etapa, setEtapa] = useState(0);
  const [arquivoNome, setArquivoNome] = useState("");
  const [arquivoTam, setArquivoTam] = useState(0);
  const [abas, setAbas] = useState<string[]>([]);
  const [aba, setAba] = useState("");
  const [matriz, setMatriz] = useState<string[][]>([]);
  const [workbookAbas, setWorkbookAbas] = useState<Record<string, string[][]>>({});
  const [linhaCabecalho, setLinhaCabecalho] = useState(1);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [camposProduto, setCamposProduto] = useState<CampoProduto[]>([]);
  const [camposCliente, setCamposCliente] = useState<CampoCliente[]>([]);
  const [mapeamento, setMapeamento] = useState<Record<string, string | null>>({});
  const [identProduto, setIdentProduto] = useState<IdentificadorProduto>("codigo");
  const [identCliente, setIdentCliente] = useState<IdentificadorCliente>("cpf_cnpj");
  const [existenteProd, setExistenteProd] = useState<"atualizar" | "ignorar" | "erro">("atualizar");
  const [existenteCli, setExistenteCli] = useState<"atualizar" | "ignorar" | "erro">("atualizar");
  const [catAusente, setCatAusente] = useState<"criar" | "sem" | "erro">("criar");
  const [marcaAusente, setMarcaAusente] = useState<"criar" | "sem" | "erro">("criar");
  const [gerarCodigo, setGerarCodigo] = useState(true);
  const [qtdInvalida, setQtdInvalida] = useState<"zero" | "ignorar_estoque" | "erro">("erro");
  const [previa, setPrevia] = useState<ResultadoPreviaImportacao | null>(null);
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState<ResultadoFinal | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [errosHist, setErrosHist] = useState<ErroHistoricoImportacao[] | null>(null);
  const [histAberto, setHistAberto] = useState<string | null>(null);

  const colunas = useMemo(
    () => colunasDoCabecalho(matriz, linhaCabecalho),
    [matriz, linhaCabecalho]
  );
  const destinos = tipo === "clientes" ? camposCliente : camposProduto;
  const rotulos =
    tipo === "clientes" ? ROTULOS_CAMPO_CLIENTE : ROTULOS_CAMPO_PRODUTO;

  const idsProduto: IdentificadorProduto[] = [];
  if (camposProduto.includes("codigo") && mapeamento.codigo) idsProduto.push("codigo");
  if (camposProduto.includes("ean") && mapeamento.ean) idsProduto.push("ean");
  const idsCliente: IdentificadorCliente[] = [];
  if (camposCliente.includes("cpf_cnpj") && mapeamento.cpf_cnpj) idsCliente.push("cpf_cnpj");
  if (camposCliente.includes("email") && mapeamento.email) idsCliente.push("email");
  if (camposCliente.includes("telefone") && mapeamento.telefone) idsCliente.push("telefone");

  const codigoMapeado = Boolean(camposProduto.includes("codigo") && mapeamento.codigo);
  const estoqueMapeado = Boolean(
    camposProduto.includes("estoque_atual") && mapeamento.estoque_atual
  );

  function montarConfig(): ConfiguracaoImportacao {
    return {
      tipo: tipo ?? "produtos",
      nomeArquivo: arquivoNome,
      aba,
      linhaCabecalho,
      colunas,
      camposProduto,
      camposCliente,
      mapeamento,
      regrasProdutos: {
        identificador: idsProduto.includes(identProduto) ? identProduto : idsProduto[0] ?? "codigo",
        existente: existenteProd,
        categoriaAusente: catAusente,
        marcaAusente,
        gerarCodigoAutomatico: gerarCodigo && !codigoMapeado,
        importarEstoque: estoqueMapeado,
        colunaQuantidade: estoqueMapeado ? mapeamento.estoque_atual : null,
        quantidadeInvalida: qtdInvalida,
      },
      regrasClientes: {
        identificador: idsCliente.includes(identCliente) ? identCliente : idsCliente[0] ?? "cpf_cnpj",
        existente: existenteCli,
      },
    };
  }

  async function lerArquivo(arquivo: File) {
    setErroArquivo(null);
    if (arquivo.size > LIMITES_IMPORTACAO.maxBytes) {
      setErroArquivo("Arquivo maior que 8 MB.");
      return;
    }
    const buffer = await arquivo.arrayBuffer();
    const wb = lerWorkbook(buffer);
    const lida = extrairPlanilha(wb);
    const porAba: Record<string, string[][]> = {};
    for (const nomeAba of lida.abas) {
      porAba[nomeAba] = extrairPlanilha(wb, nomeAba).matriz;
    }
    setWorkbookAbas(porAba);
    setArquivoNome(arquivo.name);
    setArquivoTam(arquivo.size);
    setAbas(lida.abas);
    setAba(lida.aba);
    setMatriz(lida.matriz);
    setLinhaCabecalho(1);
    setMapeamento({});
  }

  function continuar() {
    setErroAcao(null);
    if (etapa === 0 && (!arquivoNome || matriz.length === 0)) {
      setErroAcao("Selecione um arquivo.");
      return;
    }
    if (etapa === 1 && destinos.length === 0) {
      setErroAcao("Marque pelo menos um campo para importar.");
      return;
    }
    if (etapa === 2 && destinos.every((campo) => !mapeamento[campo])) {
      setErroAcao("Vincule pelo menos uma coluna.");
      return;
    }
    if (etapa === 3) {
      const linhas = linhasAposCabecalho(matriz, linhaCabecalho, colunas);
      startTransition(async () => {
        const resposta = await previaImportacaoAction(montarConfig(), linhas);
        if (!resposta.ok) {
          setErroAcao(resposta.erro);
          return;
        }
        setPrevia(resposta.previa);
        setPagina(1);
        setEtapa(4);
      });
      return;
    }
    setEtapa(etapa + 1);
  }

  function confirmar() {
    const linhas = linhasAposCabecalho(matriz, linhaCabecalho, colunas);
    startTransition(async () => {
      const resposta = await confirmarImportacaoAction(montarConfig(), linhas);
      if (!resposta.ok) {
        setErroAcao(resposta.erro);
        return;
      }
      setResultado({
        empresaNome: resposta.empresaNome || empresaNome,
        criados: resposta.criados,
        atualizados: resposta.atualizados,
        ignorados: resposta.ignorados,
        erros: resposta.erros,
        arquivo: arquivoNome,
      });
      setEtapa(5);
      router.refresh();
    });
  }

  function cancelar() {
    setTipo(tipoInicial);
    setEtapa(0);
    setArquivoNome("");
    setMatriz([]);
    setPrevia(null);
    setResultado(null);
    setErroAcao(null);
  }

  if (!tipo) {
    return (
      <div className="space-y-6 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            className="rounded-xl border border-zinc-200 bg-white p-5 text-left hover:border-zinc-400"
            onClick={() => {
              setTipo("produtos");
              setEtapa(0);
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Produtos
            </p>
            <p className="mt-1 text-[17px] font-semibold">Importar produtos</p>
            <p className="mt-2 text-[13px] text-zinc-500">
              Código, EAN, preços, NCM, categoria, marca e estoque da empresa ativa.
            </p>
          </button>
          <button
            type="button"
            className="rounded-xl border border-zinc-200 bg-white p-5 text-left hover:border-zinc-400"
            onClick={() => {
              setTipo("clientes");
              setEtapa(0);
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Clientes
            </p>
            <p className="mt-1 text-[17px] font-semibold">Importar clientes</p>
            <p className="mt-2 text-[13px] text-zinc-500">
              Os mesmos campos editáveis do cadastro atual, isolados por empresa.
            </p>
          </button>
        </div>

        <HistoricoRecente
          historico={historico}
          histAberto={histAberto}
          errosHist={errosHist}
          pending={pending}
          onAbrir={(id) => {
            setHistAberto(id);
            startTransition(async () => {
              const resp = await errosImportacaoAction(id);
              setErrosHist(resp.ok ? resp.erros : []);
            });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <ol className="flex flex-wrap gap-2 text-[12px] text-zinc-500">
        {ETAPAS.map((nome, indice) => (
          <li
            key={nome}
            className={indice === etapa ? "font-semibold text-zinc-950" : undefined}
          >
            {indice + 1} {nome}
            {indice < ETAPAS.length - 1 ? " →" : ""}
          </li>
        ))}
      </ol>

      <p className="text-[13px] text-zinc-500">
        {tipo === "clientes" ? "Importação de clientes" : "Importação de produtos"} · {empresaNome}
      </p>

      {etapa === 0 ? (
        <UploadArquivo
          nome={arquivoNome}
          tamanho={arquivoTam}
          abas={abas}
          aba={aba}
          matriz={matriz}
          linhaCabecalho={linhaCabecalho}
          erro={erroArquivo}
          onArquivo={(arquivo) => void lerArquivo(arquivo)}
          onAba={(escolhida) => {
            setAba(escolhida);
            setMatriz(workbookAbas[escolhida] ?? []);
          }}
          onCabecalho={setLinhaCabecalho}
        />
      ) : null}

      {etapa === 1 && tipo === "produtos" ? (
        <SeletorCampos
          campos={CAMPOS_PRODUTO}
          rotulos={ROTULOS_CAMPO_PRODUTO}
          selecionados={camposProduto}
          onChange={setCamposProduto}
        />
      ) : null}

      {etapa === 1 && tipo === "clientes" ? (
        <SeletorCampos
          campos={CAMPOS_CLIENTE}
          rotulos={ROTULOS_CAMPO_CLIENTE}
          selecionados={camposCliente}
          onChange={setCamposCliente}
        />
      ) : null}

      {etapa === 2 ? (
        <MapeamentoColunas
          destinos={destinos}
          rotulos={rotulos}
          colunas={colunas}
          mapeamento={mapeamento}
          onChange={(campo, coluna) =>
            setMapeamento((atual) => ({ ...atual, [campo]: coluna }))
          }
        />
      ) : null}

      {etapa === 3 && tipo === "produtos" ? (
        <ConfiguracaoDuplicadosProdutos
          identificadores={idsProduto}
          identificador={identProduto}
          existente={existenteProd}
          categoriaAusente={catAusente}
          marcaAusente={marcaAusente}
          gerarCodigo={gerarCodigo}
          mostrarCodigoAuto={!codigoMapeado}
          mostrarCategoria={camposProduto.includes("categoria")}
          mostrarMarca={camposProduto.includes("marca")}
          mostrarEstoque={estoqueMapeado}
          quantidadeInvalida={qtdInvalida}
          onIdentificador={setIdentProduto}
          onExistente={setExistenteProd}
          onCategoria={setCatAusente}
          onMarca={setMarcaAusente}
          onGerarCodigo={setGerarCodigo}
          onQuantidadeInvalida={setQtdInvalida}
        />
      ) : null}

      {etapa === 3 && tipo === "clientes" ? (
        <ConfiguracaoDuplicadosClientes
          identificadores={idsCliente}
          identificador={identCliente}
          existente={existenteCli}
          onIdentificador={setIdentCliente}
          onExistente={setExistenteCli}
        />
      ) : null}

      {etapa === 4 && previa ? (
        <div className="space-y-3">
          <PreviewImportacao
            resumo={previa.resumo}
            linhas={previa.linhas}
            pagina={pagina}
            porPagina={50}
            onPagina={setPagina}
          />
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13px]">
            <p>
              Empresa: <strong>{empresaNome}</strong>
            </p>
            <p>Arquivo: {arquivoNome}</p>
            <p>
              Novos {previa.resumo.criar} · Atualizações {previa.resumo.atualizar} ·
              Ignorados {previa.resumo.ignorados} · Erros {previa.resumo.erros}
            </p>
          </div>
        </div>
      ) : null}

      {etapa === 5 && resultado ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-[13px] text-emerald-950">
          <p className="text-[15px] font-semibold">Importação concluída</p>
          <p className="mt-2">Empresa: {resultado.empresaNome}</p>
          <p>Arquivo: {resultado.arquivo}</p>
          <p>
            {resultado.criados} criados · {resultado.atualizados} atualizados ·{" "}
            {resultado.ignorados} ignorados · {resultado.erros} erros
          </p>
        </div>
      ) : null}

      {erroAcao ? <p className="text-[13px] text-red-700">{erroAcao}</p> : null}

      <div className="flex flex-wrap gap-2">
        {etapa > 0 && etapa < 5 ? (
          <button type="button" className="updv-btn updv-btn-ghost" onClick={() => setEtapa(etapa - 1)}>
            Voltar
          </button>
        ) : null}
        {etapa < 4 ? (
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={continuar}
          >
            {pending ? "Preparando..." : "Continuar"}
          </button>
        ) : null}
        {etapa === 4 ? (
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={confirmar}
          >
            {pending ? "Importando..." : "Confirmar importação"}
          </button>
        ) : null}
        <button type="button" className="updv-btn updv-btn-ghost" onClick={cancelar}>
          {etapa === 5 ? "Nova importação" : "Cancelar"}
        </button>
      </div>

      {etapa === 0 || etapa === 5 ? (
        <HistoricoRecente
          historico={historico}
          histAberto={histAberto}
          errosHist={errosHist}
          pending={pending}
          onAbrir={(id) => {
            setHistAberto(id);
            startTransition(async () => {
              const resp = await errosImportacaoAction(id);
              setErrosHist(resp.ok ? resp.erros : []);
            });
          }}
        />
      ) : null}
    </div>
  );
}
