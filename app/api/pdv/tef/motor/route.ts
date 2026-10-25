import { createClient } from "@/lib/supabase/server";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { decidirAmbienteCobranca } from "@/lib/pdv/tef/habilitacao-producao";
import { haPendenciaFinanceiraNativa } from "@/lib/pdv/tef/motor-csharp";
import { modalidadeNativaPinpad } from "@/lib/pdv/tef/modalidade-pinpad";
import { interpretarRespostaMotor } from "@/lib/pdv/tef/motor-csharp";
import { avaliarInicioCobranca } from "@/lib/pdv/tef/politica-empresa";
import { carregarConfiguracaoMotor } from "@/lib/pdv/tef/politica-empresa-servidor";
import { carregarSinaisCobranca } from "@/lib/pdv/tef/sinais-cobranca";

export const dynamic = "force-dynamic";

const COMANDOS = new Set(["vender", "instalar", "configurar", "cancelar", "confirmar", "recuperar", "responder", "situacao", "pinpad", "vincular"]);

export async function POST(request: Request) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return Response.json(
      { ok: false, pagamentoRecebido: false, codigo: "SESSAO_AUSENTE", erro: "A empresa ativa não foi resolvida." },
      { status: 401 }
    );
  }

  const corpo = (await request.json().catch(() => null)) as {
    origem?: unknown;
    comando?: unknown;
    modalidade?: unknown;
    valorCentavos?: unknown;
    parcelas?: unknown;
    chave?: unknown;
    sessao?: unknown;
    valor?: unknown;
    cancelar?: unknown;
  } | null;
  const origem = typeof corpo?.origem === "string" ? corpo.origem : "";
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    return Response.json(interpretarRespostaMotor({ codigo: "CONECTOR_AUSENTE", erro: "O Connector local não foi informado. Nenhuma cobrança foi iniciada." }));
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return Response.json(interpretarRespostaMotor({ codigo: "CONECTOR_INVALIDO", erro: "O motor TEF só é chamado no computador local." }));
  }

  const comando = typeof corpo?.comando === "string" && COMANDOS.has(corpo.comando) ? corpo.comando : "vender";
  let cnpj = "";
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("empresas").select("id, cnpj").eq("id", sessao.empresaId).maybeSingle();
    if (data && String(data.id) === sessao.empresaId && typeof data.cnpj === "string") {
      cnpj = data.cnpj;
    }
  } catch {
    cnpj = "";
  }

  const config = await carregarConfiguracaoMotor(sessao.empresaId);
  let ambiente: 0 | 1 = 1;
  let finalidade: "venda_producao" | "vinculo_producao" | undefined;
  if (comando === "vincular") {
    ambiente = config.ambiente === "producao" ? 0 : 1;
    finalidade = config.ambiente === "producao" ? "vinculo_producao" : undefined;
  } else if (config.ambiente === "producao" && (comando === "vender" || comando === "confirmar" || comando === "cancelar")) {
    const carregado = await carregarSinaisCobranca(origem, sessao.empresaId);
    const sinaisDaCobranca = comando === "confirmar"
      ? { ...carregado.sinais, pendenciaFinanceira: false }
      : carregado.sinais;
    const inicioCobranca = avaliarInicioCobranca(carregado.config, sinaisDaCobranca);
    const liberada = inicioCobranca.pode;
    if (comando === "vender" && haPendenciaFinanceiraNativa(`${carregado.producao?.erro ?? ""} ${carregado.consulta?.erro ?? ""}`)) {
      return Response.json(interpretarRespostaMotor({
        codigo: "venda_pendente",
        erro: "Há confirmação financeira pendente ou resultado desconhecido. Nenhuma nova cobrança foi iniciada.",
      }));
    }
    const destino = decidirAmbienteCobranca({ ambienteEmpresa: "producao", liberada, comando });
    if (!destino.ok) {
      return Response.json(interpretarRespostaMotor({
        codigo: "PRODUCAO_NAO_AUTORIZADA",
        erro: inicioCobranca.mensagem || destino.erro,
      }));
    }
    ambiente = destino.ambiente;
    finalidade = destino.finalidade;
  }
  let modalidade = corpo?.modalidade;
  if (comando === "vender") {
    const nativa = modalidadeNativaPinpad(corpo?.modalidade);
    if (!nativa.ok) {
      return Response.json(interpretarRespostaMotor({ codigo: "MODALIDADE_INDISPONIVEL", erro: nativa.erro }));
    }
    modalidade = nativa.modalidade;
  }

  try {
    const resposta = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando,
        empresaId: sessao.empresaId,
        cnpj,
        ambiente,
        finalidade,
        modalidade,
        valorCentavos: corpo?.valorCentavos,
        parcelas: corpo?.parcelas,
        chave: corpo?.chave,
        sessao: corpo?.sessao,
        valor: corpo?.valor,
        cancelar: corpo?.cancelar === true,
      }),
      signal: AbortSignal.timeout(180000),
    });
    return Response.json(interpretarRespostaMotor(await resposta.json().catch(() => null)));
  } catch {
    return Response.json(
      interpretarRespostaMotor({
        codigo: "CONECTOR_INDISPONIVEL",
        erro: "O Connector não respondeu. Nenhuma cobrança foi iniciada.",
      })
    );
  }
}
