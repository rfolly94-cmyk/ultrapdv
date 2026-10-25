import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { avaliarInicioCobranca, classificarEstadoTef, producaoLiberada, ROTULOS_ESTADO_TEF, requisitosProducao } from "@/lib/pdv/tef/politica-empresa";
import { classificarPendenciaSituacao } from "@/lib/pdv/tef/motor-csharp";
import { carregarSinaisCobranca } from "@/lib/pdv/tef/sinais-cobranca";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return Response.json({ ok: false, podeCobrar: false, mensagem: "A empresa ativa não foi resolvida." }, { status: 401 });
  }
  const corpo = (await request.json().catch(() => null)) as { origem?: unknown } | null;
  const origem = typeof corpo?.origem === "string" ? corpo.origem : "";
  const carregado = await carregarSinaisCobranca(origem, sessao.empresaId);
  const { config, sinais, consulta } = carregado;
  const inicio = avaliarInicioCobranca(config, sinais);
  const estado = classificarEstadoTef(config, sinais);
  const fonte = config.ambiente === "producao" ? carregado.producao : consulta;
  const pendencia = classificarPendenciaSituacao(fonte?.erro ?? "", fonte?.chave ?? "");
  return Response.json({
    ok: true,
    podeCobrar: inicio.pode,
    mensagem: inicio.mensagem,
    estado,
    rotulo: ROTULOS_ESTADO_TEF[estado],
    habilitado: config.habilitado,
    ambiente: config.ambiente,
    configurado: config.existe,
    producaoLiberada: producaoLiberada(sinais, config.producaoAutorizada),
    pontoInstalado: sinais.pontoInstalado,
    pontoProducaoInstalado: sinais.pontoProducaoInstalado,
    credenciamentoProducao: config.credenciamentoComprovado,
    referenciaCredenciamento: config.referenciaCredenciamento,
    situacaoCredenciamento: config.situacaoCredenciamento,
    comprovadoEm: config.comprovadoEm,
    servidorComercial: config.servidorComercial,
    servidorComercialValidado: config.servidorComercialValidado,
    conciliacao: consulta?.erro.includes("sem venda no PDV") ? consulta.erro : "",
    requisitosProducao: requisitosProducao(sinais, config.producaoAutorizada),
    pendencia: pendencia.pendencia,
    chavePendente: pendencia.chave,
  });
}
