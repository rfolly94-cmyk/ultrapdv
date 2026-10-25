"use client";

import { useState } from "react";

import { prepararBibliotecaProducao } from "@/app/configuracoes/financeiro/tef/actions";
import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { formatarCnpj } from "@/lib/pdv/tef/assistente-instalacao";

type StatusAgente = {
  compativel?: boolean;
  nome?: string;
  versao?: string;
  caminho?: string;
  diretorioSelecionado?: string;
  diretorioSandbox?: string;
  diretorioProducao?: string;
};

type PerfilAutonomo = {
  efetivo?: string;
  estado?: string;
};

type StatusVinculo = {
  vinculado?: boolean;
  ambiente?: string;
  servidor?: string;
  pontoCaptura?: string;
  cnpjInformado?: boolean;
};

export function TefProducaoIsolada(props: {
  administrador: boolean;
  cnpj: string;
  ponto: string;
  servidor: string;
  estabelecimento: string;
  ambiente: string;
}) {
  const [confirmacao, setConfirmacao] = useState(false);
  const [credencial, setCredencial] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [agente, setAgente] = useState<StatusAgente | null>(null);
  const [perfil, setPerfil] = useState<PerfilAutonomo | null>(null);
  const [vinculo, setVinculo] = useState<StatusVinculo | null>(null);

  async function consultar() {
    const descoberta = await descobrirUltraPdvConector();
    if (!descoberta.ok) {
      throw new Error("UltraPDV Connector não encontrado neste computador.");
    }
    const resposta = await fetch(`${descoberta.origem}/tef/status`, { cache: "no-store" });
    const corpo = (await resposta.json()) as {
      ok?: boolean;
      erro?: string;
      tef?: {
        agente?: StatusAgente;
        biblioteca?: { cobrancaPermitida?: boolean; motivo?: string };
        perfilAutonomo?: PerfilAutonomo;
      };
      vinculo?: StatusVinculo;
    };
    if (!resposta.ok || corpo.ok === false) {
      throw new Error(corpo.erro || "O Connector não respondeu o status do agente.");
    }
    setAgente(corpo.tef?.agente ?? null);
    setPerfil(corpo.tef?.perfilAutonomo ?? null);
    setVinculo(corpo.vinculo ?? null);
    return { origem: descoberta.origem, corpo };
  }

  function ocultarCredencial(texto: string, senha: string) {
    if (senha.length < 4) {
      return texto;
    }
    return texto.split(senha).join("[redigido]");
  }

  async function instalar() {
    if (!props.administrador || !confirmacao || credencial.length < 4) {
      setMensagens([
        "A instalação da pasta de produção exige administrador, confirmação explícita e a credencial técnica neste momento.",
      ]);
      return;
    }
    const senha = credencial;
    setCredencial("");
    setOcupado(true);
    setMensagens([]);
    try {
      const atual = await consultar();
      if (atual.corpo.tef?.agente?.compativel !== true) {
        setMensagens([
          "O Connector não carregou o agente desta versão. A instalação não foi iniciada.",
        ]);
        return;
      }
      if (!atual.corpo.tef?.agente?.diretorioSandbox) {
        setMensagens([
          "O Connector ainda não informa a pasta de homologação. Atualize o agente antes de instalar.",
        ]);
        return;
      }
      if (
        atual.corpo.vinculo?.vinculado !== true ||
        atual.corpo.vinculo.ambiente !== "producao" ||
        !atual.corpo.vinculo.servidor ||
        !atual.corpo.vinculo.cnpjInformado
      ) {
        setMensagens([
          "O vínculo deste computador ainda não tem ambiente, servidor e CNPJ de produção. Use Sincronizar Connector antes de instalar. A chave atual é mantida.",
        ]);
        return;
      }
      if (atual.corpo.tef?.biblioteca?.cobrancaPermitida === true) {
        setMensagens(["A pasta de produção já está comprovada. A instalação não será repetida."]);
        return;
      }
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok || !descoberta.saude.dispositivoId) {
        setMensagens(["O UltraPDV Connector não respondeu neste computador. A instalação não foi iniciada."]);
        return;
      }
      const autorizado = await prepararBibliotecaProducao({
        confirmacaoExplicita: true,
        credencialInformada: true,
        dispositivoId: descoberta.saude.dispositivoId,
      });
      if (autorizado.efeito !== "instalar") {
        setMensagens([autorizado.motivo]);
        return;
      }
      const resposta = await fetch(`${descoberta.origem}/tef/instalar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "instalar",
          confirmacao: true,
          credencial: senha,
          ...(perfil?.estado === "ocupado" ? { provisionarNovo: true } : {}),
        }),
      });
      const corpo = (await resposta.json()) as { erro?: string; resultado?: { mensagem?: string } };
      setMensagens([
        ocultarCredencial(
          corpo.erro || corpo.resultado?.mensagem || "O Connector devolveu o resultado da instalação.",
          senha
        ),
      ]);
      await consultar().catch(() => undefined);
    } catch {
      setMensagens(["Não foi possível falar com o Connector. Nenhuma pasta foi apagada."]);
    } finally {
      setCredencial("");
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">PGWebLib de produção</h2>
        <p className="mt-1 text-sm text-zinc-600">
        A instalação usa um perfil vazio escolhido neste computador. O ponto, o servidor e o CNPJ
        saem do cadastro desta empresa. A chave, o vínculo, o journal e as pastas anteriores permanecem.
        </p>
      </div>
      <dl className="grid gap-2 text-sm text-zinc-800 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-zinc-500">Ponto oficial</dt>
          <dd>{props.ponto || "não informado"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Servidor oficial</dt>
          <dd>{props.servidor || "não informado"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">CNPJ autenticado</dt>
          <dd>{props.cnpj ? formatarCnpj(props.cnpj) : "não cadastrado"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Ambiente oficial</dt>
          <dd>{props.ambiente === "producao" ? "Produção" : "Homologação"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-zinc-500">Pasta de homologação preservada</dt>
          <dd>{agente?.diretorioSandbox || "bin/tef/TEF/PGWeb"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-zinc-500">Perfil novo de produção</dt>
          <dd>
            {perfil?.efetivo ||
              "Será criado em ProgramData\\UltraPDV\\TEF\\Producao\\perfis. As pastas anteriores não serão abertas."}
            {perfil?.estado === "ocupado"
              ? " Este perfil já tem dados e permanece preservado. A confirmação cria outro perfil vazio."
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Agente selecionado</dt>
          <dd>
            {agente?.nome || "não consultado"}
            {agente?.versao ? ` ${agente.versao}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Pasta realmente selecionada</dt>
          <dd>{agente?.diretorioSelecionado || "ainda não confirmada pelo agente"}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-900"
        disabled={ocupado}
        onClick={() => void consultar().catch((error: unknown) => {
          setMensagens([error instanceof Error ? error.message : "Não foi possível consultar o Connector."]);
        })}
      >
        Consultar pastas neste computador
      </button>
      {vinculo?.vinculado && (vinculo.ambiente !== "producao" || !vinculo.servidor || !vinculo.cnpjInformado) ? (
        <PageAlert type="aviso" className="mx-0 mt-0">
          O vínculo deste computador ainda não tem ambiente, servidor e CNPJ de produção. Use
          Sincronizar Connector antes de instalar. A chave atual é mantida.
        </PageAlert>
      ) : null}
      {props.administrador ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={confirmacao}
              onChange={(evento) => setConfirmacao(evento.target.checked)}
            />
            Confirmo a instalação do ponto de produção em uma pasta nova. A pasta de homologação
            permanece intacta.
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            Credencial técnica
            <input
              type="password"
              value={credencial}
              onChange={(evento) => setCredencial(evento.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <p className="text-sm text-zinc-600">
            A credencial segue somente até o Connector deste computador e é descartada em seguida.
            O estabelecimento oficial é {props.estabelecimento || "não informado"}.
          </p>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={ocupado}
            onClick={() => void instalar()}
          >
            {ocupado ? "Instalando..." : "Instalar PayGoWeb"}
          </button>
        </div>
      ) : (
        <PageAlert type="aviso" className="mx-0 mt-0">
          Somente um administrador pode confirmar a instalação da pasta de produção.
        </PageAlert>
      )}
      {mensagens.map((mensagem) => (
        <PageAlert key={mensagem} type="aviso" className="mx-0 mt-0">
          {mensagem}
        </PageAlert>
      ))}
    </section>
  );
}
