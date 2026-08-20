import { validarParcelaPixContraSaldo } from "@/lib/pdv/pagamentos-teto";
import { gerarPixEstatico } from "./brcode";
import { gerarTxidPixLocalPdv } from "./brcode/txid";
import { ErroPixGeranet, resolverEmpresaPix } from "./contexto";
import { carregarConfiguracaoPixLocal } from "./local";
import { exigirPixLocalAtivo } from "./modo-ativo-servidor";
import {
  STATUS_PIX_LOCAL,
  rejeitarCamposDeConfirmacaoDoCliente,
  validarConfirmacaoPixLocal,
  validarGeracaoPixLocal,
} from "./local-regras";

function decimalPix(valor: number) {
  return Math.round(valor * 100) / 100;
}

function erroValidacao(error: unknown): never {
  throw new ErroPixGeranet(
    error instanceof Error ? error.message : "Operação PIX Local inválida.",
    422
  );
}

async function nomeUsuario(
  admin: Awaited<ReturnType<typeof resolverEmpresaPix>>["admin"],
  usuarioId: string
) {
  const { data } = await admin
    .from("usuarios")
    .select("nome")
    .eq("id", usuarioId)
    .maybeSingle();

  return data?.nome ? String(data.nome) : null;
}

export async function gerarRecebimentoPixLocal(
  valorInformado: number,
  opcoes?: {
    saldoRestanteCentavos?: number;
  }
) {
  const { admin, empresaId } = await resolverEmpresaPix();
  await exigirPixLocalAtivo(empresaId);
  const integracao = await carregarConfiguracaoPixLocal(empresaId);
  const valor = decimalPix(Number(valorInformado));

  try {
    validarGeracaoPixLocal({
      valor,
      modo: integracao?.modo,
      ativo: integracao?.ativo,
      chavePix: integracao?.chave_pix,
      recebedorNome: integracao?.recebedor_nome,
      recebedorCidade: integracao?.recebedor_cidade,
    });
    validarParcelaPixContraSaldo({
      valorPixCentavos: Math.round(valor * 100),
      saldoRestanteCentavos: Number(opcoes?.saldoRestanteCentavos),
    });
  } catch (error) {
    erroValidacao(error);
  }

  if (!integracao?.chave_pix || !integracao.recebedor_nome || !integracao.recebedor_cidade) {
    throw new ErroPixGeranet("Configure o PIX Local / Manual.");
  }

  const txid = gerarTxidPixLocalPdv();
  const gerado = await gerarPixEstatico({
    chave: integracao.chave_pix,
    nomeRecebedor: integracao.recebedor_nome,
    cidadeRecebedor: integracao.recebedor_cidade,
    valor,
    txid,
  });

  const { data, error } = await admin
    .from("cobrancas_pix")
    .insert({
      empresa_id: empresaId,
      integracao_pix_id: integracao.id,
      venda_id: null,
      txid: gerado.txid,
      valor,
      status: STATUS_PIX_LOCAL.aguardando,
      modo_pix: "local_manual",
      provedor: null,
      ambiente: null,
      confirmado_manualmente: false,
      confirmado_por: null,
      confirmado_em: null,
      dados_publicos: {
        modo: "local_manual",
        payload: gerado.payload,
        qrCode: gerado.qrCode,
        recebedor_nome: integracao.recebedor_nome,
        pago: false,
      },
    })
    .select("id, txid, valor, status")
    .single();

  if (error || !data) {
    throw new ErroPixGeranet(
      error?.message ?? "Não foi possível registrar o PIX Local.",
      500
    );
  }

  return {
    recebimento_id: String(data.id),
    txid: String(data.txid),
    valor: Number(data.valor),
    payload: gerado.payload,
    qrCode: gerado.qrCode,
    recebedor: integracao.recebedor_nome,
    status: STATUS_PIX_LOCAL.aguardando,
    pago: false as const,
  };
}

export async function confirmarRecebimentoPixLocal(
  recebimentoId: string,
  body: Record<string, unknown> = {}
) {
  try {
    rejeitarCamposDeConfirmacaoDoCliente(body);
  } catch (error) {
    erroValidacao(error);
  }

  const { admin, empresaId, usuarioId } = await resolverEmpresaPix();
  await exigirPixLocalAtivo(empresaId);
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select(
      "id, empresa_id, status, modo_pix, venda_id, valor, txid, confirmado_manualmente"
    )
    .eq("id", recebimentoId)
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  if (!data) {
    throw new ErroPixGeranet("Recebimento PIX não encontrado.", 404);
  }

  try {
    validarConfirmacaoPixLocal({
      empresaId,
      recebimento: {
        empresa_id: String(data.empresa_id),
        status: String(data.status),
        modo_pix: data.modo_pix ? String(data.modo_pix) : null,
        venda_id: data.venda_id ? String(data.venda_id) : null,
      },
    });
  } catch (error) {
    erroValidacao(error);
  }

  const confirmadoEm = new Date().toISOString();
  const { data: atualizado, error: erroUpdate } = await admin
    .from("cobrancas_pix")
    .update({
      status: STATUS_PIX_LOCAL.confirmado,
      confirmado_manualmente: true,
      confirmado_por: usuarioId,
      confirmado_em: confirmadoEm,
      updated_at: confirmadoEm,
    })
    .eq("id", recebimentoId)
    .eq("empresa_id", empresaId)
    .eq("status", STATUS_PIX_LOCAL.aguardando)
    .is("venda_id", null)
    .select("id, status, confirmado_em, confirmado_por")
    .maybeSingle();

  if (erroUpdate || !atualizado) {
    throw new ErroPixGeranet(
      erroUpdate?.message ?? "Não foi possível confirmar este PIX Local.",
      409
    );
  }

  return {
    status: STATUS_PIX_LOCAL.confirmado,
    confirmado_em: String(atualizado.confirmado_em ?? confirmadoEm),
    confirmado_por_nome: await nomeUsuario(admin, usuarioId),
    pago: false as const,
  };
}

export async function descartarRecebimentoPixLocal(
  recebimentoId: string,
  consciente = false
) {
  const { admin, empresaId } = await resolverEmpresaPix();
  await exigirPixLocalAtivo(empresaId);
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("id, empresa_id, status, modo_pix, venda_id")
    .eq("id", recebimentoId)
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  if (!data) {
    throw new ErroPixGeranet("Recebimento PIX não encontrado.", 404);
  }

  if (String(data.empresa_id) !== empresaId) {
    throw new ErroPixGeranet("Recurso PIX pertence a outra empresa.", 403);
  }

  if (data.venda_id) {
    throw new ErroPixGeranet("Este PIX já está vinculado a uma venda.");
  }

  if (data.modo_pix !== "local_manual") {
    throw new ErroPixGeranet("Este recebimento não é um PIX Local.");
  }

  if (data.status === STATUS_PIX_LOCAL.vinculado) {
    throw new ErroPixGeranet("Este PIX já foi utilizado em uma venda.");
  }

  if (data.status === STATUS_PIX_LOCAL.confirmado && !consciente) {
    throw new ErroPixGeranet(
      "Este PIX já foi confirmado manualmente. Para alterar o pagamento, é necessário remover/reverter conscientemente esta confirmação."
    );
  }

  if (
    data.status !== STATUS_PIX_LOCAL.aguardando &&
    !(data.status === STATUS_PIX_LOCAL.confirmado && consciente)
  ) {
    throw new ErroPixGeranet("Este QR não pode ser descartado.");
  }

  const agora = new Date().toISOString();
  const { error: erroUpdate } = await admin
    .from("cobrancas_pix")
    .update({
      status: STATUS_PIX_LOCAL.descartado,
      cancelado_em: agora,
      updated_at: agora,
    })
    .eq("id", recebimentoId)
    .eq("empresa_id", empresaId)
    .is("venda_id", null);

  if (erroUpdate) {
    throw new ErroPixGeranet(erroUpdate.message, 500);
  }

  return {
    status: STATUS_PIX_LOCAL.descartado,
    mensagem: "QR descartado no UltraPDV.",
  };
}
