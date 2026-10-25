const ROTAS = new Set([
  "/tef/pgweb/sessao",
  "/tef/pgweb/inicializar",
  "/tef/pgweb/instalar",
  "/tef/pgweb/vender",
  "/tef/pgweb/confirmar",
  "/tef/pgweb/desfazer",
  "/tef/pgweb/pinpad",
]);

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

export function esperarMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function esperarCaptura(sessao, resultado, limiteMs = 110000, dormir = esperarMs) {
  let atual = resultado;
  const limite = Date.now() + limiteMs;
  while (atual?.estado === "aguardando_captura" && Date.now() < limite) {
    await dormir(50);
    if (sessao.estado !== "aguardando_captura") return sessao.ultimo ?? atual;
  }
  if (sessao.estado === "aguardando_captura" && sessao.captura) {
    return sessao.responderCaptura({
      dispositivoId: sessao.dispositivoId,
      solicitacaoId: sessao.captura.solicitacaoId,
      cancelar: true,
    });
  }
  return atual;
}

export function rotaPgWeb(caminho) {
  return ROTAS.has(caminho);
}

export async function executarRotaPgWeb(sessao, metodo, caminho, corpo, dispositivoPedido) {
  if (!rotaPgWeb(caminho)) return null;
  const dispositivoId = texto(dispositivoPedido) || sessao.dispositivoId;
  if (metodo === "GET" && caminho === "/tef/pgweb/sessao") {
    return { status: 200, corpo: { ok: true, pago: false, warsaw: false, ...sessao.foto() } };
  }
  if (metodo !== "POST") return { status: 405, corpo: { ok: false, erro: "Método não aceito nesta rota TEF 2.0." } };
  const pedido = objeto(corpo);
  if (!pedido) return { status: 400, corpo: { ok: false, erro: "Payload inválido." } };

  if (caminho === "/tef/pgweb/inicializar") {
    const resultado = await sessao.inicializar({
      ambiente: pedido.ambiente,
      diretorio: pedido.diretorio,
      dispositivoId,
    });
    return { status: resultado.ok ? 200 : 409, corpo: resultado };
  }
  if (caminho === "/tef/pgweb/instalar") {
    const resultado = await sessao.instalar({
      dispositivoId,
      ponto: pedido.ponto,
      cnpj: pedido.cnpj,
      capacidades: pedido.capacidades,
    });
    return { status: resultado.codigo === -2497 || resultado.ok ? 200 : 409, corpo: resultado };
  }
  if (caminho === "/tef/pgweb/vender") {
    const modalidade = pedido.modalidade || pedido.preferencia;
    const resultado = await sessao.vender({
      dispositivoId,
      identificador: pedido.identificador,
      valorCentavos: Number(pedido.valorCentavos),
      modalidade,
      parcelas: Number(pedido.parcelas) || 1,
      capacidades: pedido.capacidades,
    });
    const seguido = await esperarCaptura(sessao, resultado);
    return { status: seguido.ok ? 200 : 409, corpo: seguido };
  }
  if (caminho === "/tef/pgweb/confirmar") {
    const resultado = await sessao.confirmar({
      dispositivoId,
      motivo: pedido.motivo || "manual",
    });
    return { status: resultado.ok ? 200 : 409, corpo: resultado };
  }
  if (caminho === "/tef/pgweb/desfazer") {
    const resultado = await sessao.desfazer({
      dispositivoId,
      motivo: pedido.motivo || "manual",
    });
    return { status: resultado.ok ? 200 : 409, corpo: resultado };
  }
  const resultado = await sessao.pinpad({
    dispositivoId,
    porta: Number(pedido.porta) || 0,
  });
  return { status: resultado.codigo === 0 ? 200 : 409, corpo: resultado };
}
