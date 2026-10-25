import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import {
  confirmarServidorComercial,
  invalidarAutorizacaoProducao,
  registrarPinpadProducao,
} from "@/lib/pdv/tef/autorizacao-producao-servidor";
import { montarPedidoProducao } from "@/lib/pdv/tef/encaminhamento-configuracao";
import { interpretarRespostaMotor } from "@/lib/pdv/tef/motor-csharp";
import { decidirConfiguracaoProducao, decidirInstalacaoProducao, decidirTestePinPadProducao } from "@/lib/pdv/tef/politica-empresa";
import { carregarConfiguracaoMotor } from "@/lib/pdv/tef/politica-empresa-servidor";
import { classificarServidorComercial } from "@/lib/pdv/tef/servidor-comercial";

export const dynamic = "force-dynamic";

function recusa(erro: string, status = 200) {
  return Response.json({ ok: false, pagamentoRecebido: false, codigo: "PRODUCAO_NAO_AUTORIZADA", erro }, { status });
}

export async function POST(request: Request) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return recusa("A empresa ativa não foi resolvida.", 401);
  }
  const corpo = (await request.json().catch(() => null)) as {
    origem?: unknown;
    comando?: unknown;
    chave?: unknown;
    sessao?: unknown;
    valor?: unknown;
    autorizarPinPad?: unknown;
    operacao?: unknown;
  } | null;
  const pedido = montarPedidoProducao({ comando: corpo?.comando, chave: corpo?.chave, operacao: corpo?.operacao });
  if (!pedido.ok) {
    return recusa(pedido.erro);
  }
  const comando = pedido.comando;
  const administrador = sessao.perfil.trim().toLowerCase() === "administrador";
  const config = await carregarConfiguracaoMotor(sessao.empresaId);
  if (comando === "configurar") {
    const credencial = decidirConfiguracaoProducao({
      administrador,
      credenciamentoProducao: config.credenciamentoComprovado,
      pendenciaFinanceira: false,
      servidorDeclarado: classificarServidorComercial(config.servidorComercial).ok,
    });
    if (!credencial.pode) return recusa(credencial.mensagem);
  }
  if (comando === "instalar") {
    const credencial = decidirInstalacaoProducao({
      administrador,
      credenciamentoProducao: config.credenciamentoComprovado,
      pendenciaFinanceira: false,
      servidorComercialValidado: config.servidorComercialValidado,
    });
    if (!credencial.pode) return recusa(credencial.mensagem);
  }
  if (comando === "pinpad") {
    const autorizado = decidirTestePinPadProducao({
      administrador,
      autorizacaoExplicita: corpo?.autorizarPinPad === true,
      pontoProducaoInstalado: true,
      pendenciaFinanceira: false,
    });
    if (!autorizado.pode) return recusa(autorizado.mensagem);
  }
  if (comando === "responder" && !administrador) {
    return recusa("Somente o administrador da empresa pode continuar a instalação de produção.");
  }

  const origem = typeof corpo?.origem === "string" ? corpo.origem : "";
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    return recusa("O Connector local não foi informado. Nenhuma instalação foi iniciada.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return recusa("O motor TEF só é chamado no computador local.");
  }

  let referenciaInstalacao = "";
  let terminalPrevia = "";
  let dispositivoPrevia = "";
  if (comando === "instalar" || comando === "configurar" || comando === "pinpad") {
    const previa = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando: "situacao",
        empresaId: sessao.empresaId,
        ambiente: 0,
        finalidade: "consulta_producao",
      }),
      signal: AbortSignal.timeout(15000),
    }).then(async (item) => item.json().catch(() => null)).catch(() => null) as {
      codigo?: unknown;
      referenciaInstalacao?: unknown;
      terminalId?: unknown;
      dispositivoId?: unknown;
    } | null;
    const codigo = typeof previa?.codigo === "string" ? previa.codigo : "";
    referenciaInstalacao = typeof previa?.referenciaInstalacao === "string" ? previa.referenciaInstalacao : "";
    terminalPrevia = typeof previa?.terminalId === "string" ? previa.terminalId : "";
    dispositivoPrevia = typeof previa?.dispositivoId === "string" ? previa.dispositivoId : "";
    if (comando === "configurar") {
      const pendente = decidirConfiguracaoProducao({
        administrador,
        credenciamentoProducao: config.credenciamentoComprovado,
        pendenciaFinanceira: codigo === "venda_pendente",
        servidorDeclarado: classificarServidorComercial(config.servidorComercial).ok,
      });
      if (!pendente.pode) return recusa(pendente.mensagem);
    }
    if (comando === "instalar") {
      const pendente = decidirInstalacaoProducao({
        administrador,
        credenciamentoProducao: config.credenciamentoComprovado,
        pendenciaFinanceira: codigo === "venda_pendente",
        servidorComercialValidado: config.servidorComercialValidado,
      });
      if (!pendente.pode) return recusa(pendente.mensagem);
    }
    if (comando === "pinpad") {
      const ponto = decidirTestePinPadProducao({
        administrador,
        autorizacaoExplicita: corpo?.autorizarPinPad === true,
        pontoProducaoInstalado: codigo === "ponto_instalado",
        pendenciaFinanceira: codigo === "venda_pendente",
      });
      if (!ponto.pode) return recusa(ponto.mensagem);
    }
  }
  const endereco = comando === "configurar" ? classificarServidorComercial(config.servidorComercial) : null;
  if (comando === "configurar" && !endereco?.ok) {
    return recusa("Informe o servidor comercial de produção fornecido pela PayGo. A configuração não foi iniciada.");
  }
  try {
    const resposta = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando: pedido.comando,
        empresaId: sessao.empresaId,
        ambiente: 0,
        finalidade: pedido.finalidade,
        operacaoNativa: pedido.operacaoNativa,
        chave: pedido.chave,
        sessao: corpo?.sessao,
        valor: corpo?.valor,
        autorizaPinPadProducao: pedido.comando === "pinpad",
        servidorComercialValidado: comando === "instalar" && config.servidorComercialValidado,
        enderecoComercial: endereco && endereco.ok ? endereco.servidor : undefined,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const bruto = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
    const interpretado = interpretarRespostaMotor(bruto);
    const configuracaoConcluida =
      interpretado.codigo === "configurada" &&
      interpretado.servidorValidado &&
      interpretado.nativo &&
      (comando === "configurar" || (comando === "responder" && pedido.operacaoNativa === "PWOPER_CONFIG"));
    if (configuracaoConcluida) {
      const gravado = await confirmarServidorComercial({
        empresaId: sessao.empresaId,
        usuarioId: sessao.usuarioId,
        terminalId: typeof bruto?.terminalId === "string" ? bruto.terminalId : "",
        dispositivoId: typeof bruto?.dispositivoId === "string" ? bruto.dispositivoId : "",
        codigo: interpretado.codigo,
        nativo: interpretado.nativo,
        servidorValidado: true,
      });
      if (!gravado.ok) {
        return Response.json({ ...interpretado, servidorValidado: false, erro: gravado.erro });
      }
    }
    const instalacaoConcluida =
      interpretado.codigo === "instalada" &&
      (comando === "instalar" || (comando === "responder" && pedido.operacaoNativa === "PWOPER_INSTALL"));
    if (instalacaoConcluida) {
      await invalidarAutorizacaoProducao(sessao.empresaId);
    }
    if (comando === "pinpad") {
      const gravado = await registrarPinpadProducao({
        empresaId: sessao.empresaId,
        usuarioId: sessao.usuarioId,
        terminalId: typeof bruto?.terminalId === "string" ? bruto.terminalId : terminalPrevia,
        dispositivoId: typeof bruto?.dispositivoId === "string" ? bruto.dispositivoId : dispositivoPrevia,
        journalInstalacao: referenciaInstalacao,
        codigoNativo: typeof bruto?.codigoNativo === "number" ? bruto.codigoNativo : interpretado.codigoNativo,
      });
      if (!gravado.ok && interpretado.codigoNativo === 0) {
        return Response.json({ ...interpretado, erro: gravado.erro });
      }
    }
    return Response.json(interpretado);
  } catch {
    return recusa("O Connector não respondeu. Nenhuma instalação foi iniciada.");
  }
}
