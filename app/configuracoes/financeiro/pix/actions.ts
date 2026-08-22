"use server";

import { revalidatePath } from "next/cache";

import { gerarPixEstatico } from "@/lib/pagamentos/pix/brcode";
import { gerarTxidPixLocal } from "@/lib/pagamentos/pix/brcode/txid";
import { coletarNovosSegredosDoFormulario } from "@/lib/pagamentos/pix/coletar-segredos";
import { exigirAdministradorPix } from "@/lib/pagamentos/pix/contexto";
import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import {
  exigirPixLocalAtivo,
  garantirTrocaModoPixPermitida,
} from "@/lib/pagamentos/pix/modo-ativo-servidor";
import {
  gravarFlagsPublicas,
  lerFlagsPublicas,
} from "@/lib/pagamentos/pix/credenciais";
import { ehModoPix } from "@/lib/pagamentos/pix/local-config";
import { carregarConfiguracaoPixLocal } from "@/lib/pagamentos/pix/local";
import {
  camposCredencialDoProvedor,
  ehProvedorPixGeranet,
  obterProvedorPixGeranet,
} from "@/lib/pagamentos/pix/provedores";

function texto(valor: FormDataEntryValue | null) {
  return String(valor ?? "").trim();
}

export async function salvarConfiguracaoPixLocal(formData: FormData) {
  const { supabase, empresaId } = await exigirAdministradorPix();

  const chavePix = texto(formData.get("chave_pix"));
  const recebedorNome = texto(formData.get("recebedor_nome"));
  const recebedorCidade = texto(formData.get("recebedor_cidade"));

  if (!chavePix || !recebedorNome || !recebedorCidade) {
    return {
      ok: false as const,
      erro: "Preencha Chave PIX, nome e cidade do recebedor.",
    };
  }

  const { data: atual } = await supabase
    .from("integracoes_pix")
    .select("id, modo, provedor, ambiente, credenciais_configuradas, certificado_configurado, configuracao_publica, recebedor_cep, recebedor_uf")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  try {
    await garantirTrocaModoPixPermitida({
      empresaId,
      modoAtual: atual?.modo ? String(atual.modo) : null,
      modoNovo: "local_manual",
    });
  } catch (error) {
    return {
      ok: false as const,
      erro: error instanceof Error ? error.message : "Não foi possível alterar o modo PIX.",
    };
  }

  const registro = {
    empresa_id: empresaId,
    modo: "local_manual",
    gateway: "local",
    ativo: true,
    chave_pix: chavePix,
    recebedor_nome: recebedorNome,
    recebedor_cidade: recebedorCidade,
    provedor: atual?.provedor ?? null,
    ambiente: atual?.ambiente ?? "2",
    recebedor_cep: atual?.recebedor_cep ?? null,
    recebedor_uf: atual?.recebedor_uf ?? null,
    credenciais_configuradas: Boolean(atual?.credenciais_configuradas),
    certificado_configurado: Boolean(atual?.certificado_configurado),
    configuracao_publica: atual?.configuracao_publica ?? {},
    updated_at: new Date().toISOString(),
  };

  const { error } = atual?.id
    ? await supabase.from("integracoes_pix").update(registro).eq("id", atual.id)
    : await supabase.from("integracoes_pix").insert(registro);

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  revalidatePath("/configuracoes/financeiro/pix");
  return { ok: true as const };
}

export async function gerarQrPixLocalTeste(valorInformado?: number) {
  const { empresaId } = await exigirAdministradorPix();
  try {
    await exigirPixLocalAtivo(empresaId);
  } catch (error) {
    return {
      ok: false as const,
      erro:
        error instanceof Error
          ? error.message
          : "Salve o PIX Local antes de gerar o QR de teste.",
    };
  }
  const integracao = await carregarConfiguracaoPixLocal(empresaId);

  if (!integracao || integracao.modo !== "local_manual") {
    return {
      ok: false as const,
      erro: "Salve o PIX Local antes de gerar o QR de teste.",
    };
  }

  if (
    !integracao.chave_pix ||
    !integracao.recebedor_nome ||
    !integracao.recebedor_cidade
  ) {
    return {
      ok: false as const,
      erro: "Preencha Chave PIX, nome e cidade do recebedor.",
    };
  }

  const valor = Number(valorInformado ?? 1);

  try {
    const gerado = await gerarPixEstatico({
      chave: integracao.chave_pix,
      nomeRecebedor: integracao.recebedor_nome,
      cidadeRecebedor: integracao.recebedor_cidade,
      valor,
      txid: gerarTxidPixLocal(),
    });

    return {
      ok: true as const,
      pago: false as const,
      valor: gerado.valor,
      txid: gerado.txid,
      payload: gerado.payload,
      qrCode: gerado.qrCode,
      mensagem: "QR Code PIX Local gerado. Isso não confirma pagamento.",
    };
  } catch (error) {
    return {
      ok: false as const,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o QR Code PIX Local.",
    };
  }
}

export async function salvarConfiguracaoPix(formData: FormData) {
  const modo = texto(formData.get("modo"));
  if (modo === "local_manual") {
    return salvarConfiguracaoPixLocal(formData);
  }

  if (modo && !ehModoPix(modo)) {
    return { ok: false as const, erro: "Selecione o modo PIX." };
  }

  const { supabase, empresaId } = await exigirAdministradorPix();

  try {
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "salvarConfiguracaoPix",
    });
  } catch (error) {
    if (error instanceof ErroEntitlement) {
      return { ok: false as const, erro: error.message };
    }
    throw error;
  }

  const provedor = texto(formData.get("provedor"));
  const ambiente = texto(formData.get("ambiente"));
  const chavePix = texto(formData.get("chave_pix"));
  const recebedorNome = texto(formData.get("recebedor_nome"));
  const recebedorCep = texto(formData.get("recebedor_cep")).replace(/\D/g, "");
  const recebedorCidade = texto(formData.get("recebedor_cidade"));
  const recebedorUf = texto(formData.get("recebedor_uf")).toUpperCase();

  if (!ehProvedorPixGeranet(provedor)) {
    return { ok: false as const, erro: "Selecione um provedor PIX da Geranet." };
  }

  if (ambiente !== "1" && ambiente !== "2") {
    return { ok: false as const, erro: "Selecione homologação ou produção." };
  }

  if (!recebedorNome || !recebedorCidade || recebedorUf.length !== 2) {
    return {
      ok: false as const,
      erro: "Preencha nome, cidade e UF do recebedor.",
    };
  }

  const meta = obterProvedorPixGeranet(provedor);
  if (!meta?.configuracaoDisponivel) {
    return {
      ok: false as const,
      erro: "Este provedor ainda está em validação e não pode ser configurado.",
    };
  }
  const { data: atual } = await supabase
    .from("integracoes_pix")
    .select(
      "id, modo, chave_pix, credenciais_configuradas, certificado_configurado, configuracao_publica"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  try {
    await garantirTrocaModoPixPermitida({
      empresaId,
      modoAtual: atual?.modo ? String(atual.modo) : null,
      modoNovo: "geranet",
    });
  } catch (error) {
    return {
      ok: false as const,
      erro: error instanceof Error ? error.message : "Não foi possível alterar o modo PIX.",
    };
  }

  const configuracaoAtual =
    atual?.configuracao_publica &&
    typeof atual.configuracao_publica === "object"
      ? (atual.configuracao_publica as Record<string, unknown>)
      : {};
  const flagsAtuais = lerFlagsPublicas(configuracaoAtual, provedor, ambiente);

  if (meta?.configuracaoDisponivel) {
    const coletados = await coletarNovosSegredosDoFormulario(
      formData,
      provedor,
      ambiente
    );
    if (coletados.erro) {
      return { ok: false as const, erro: coletados.erro };
    }

    for (const [campo, valor] of Object.entries(coletados.novos)) {
      const { error } = await supabase.rpc(
        "salvar_segredo_bancario_provedor",
        {
          p_empresa_id: empresaId,
          p_provedor: provedor,
          p_ambiente: ambiente,
          p_campo: campo,
          p_valor: valor,
        }
      );
      if (error) {
        return { ok: false as const, erro: error.message };
      }
      flagsAtuais[campo] = true;
    }
  }

  const flagsFinais = { ...flagsAtuais };
  const configuracaoPublica = gravarFlagsPublicas(
    configuracaoAtual,
    provedor,
    ambiente,
    flagsFinais
  );

  const campos = camposCredencialDoProvedor(provedor, ambiente);
  const arquivos = campos.filter((campo) => campo.tipo === "file");
  const credenciaisConfiguradas =
    Boolean(meta?.configuracaoDisponivel) &&
    campos
      .filter((campo) => campo.obrigatorio && campo.tipo !== "file")
      .every((campo) => flagsFinais[campo.chave]);
  const certificadoConfigurado =
    arquivos.length > 0 &&
    arquivos.every((campo) => flagsFinais[campo.chave]);

  const registro = {
    empresa_id: empresaId,
    modo: "geranet",
    gateway: "geranet",
    provedor,
    ambiente,
    ativo: true,
    chave_pix: formData.has("chave_pix")
      ? chavePix || null
      : atual?.chave_pix ?? null,
    recebedor_nome: recebedorNome,
    recebedor_cep: recebedorCep || null,
    recebedor_cidade: recebedorCidade,
    recebedor_uf: recebedorUf,
    credenciais_configuradas: credenciaisConfiguradas,
    certificado_configurado: certificadoConfigurado,
    configuracao_publica: configuracaoPublica,
    updated_at: new Date().toISOString(),
  };

  const { error } = atual?.id
    ? await supabase.from("integracoes_pix").update(registro).eq("id", atual.id)
    : await supabase.from("integracoes_pix").insert(registro);

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  revalidatePath("/configuracoes/financeiro/pix");
  return { ok: true as const };
}
