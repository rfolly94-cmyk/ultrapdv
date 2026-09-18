"use server";

import { revalidatePath } from "next/cache";

import { gerarPixEstatico } from "@/lib/pagamentos/pix/brcode";
import { gerarTxidPixLocal } from "@/lib/pagamentos/pix/brcode/txid";
import { metaArquivoFormData } from "@/lib/pagamentos/pix/arquivo-formdata";
import { coletarNovosSegredosDoFormulario } from "@/lib/pagamentos/pix/coletar-segredos";
import { exigirAdministradorPix } from "@/lib/pagamentos/pix/contexto";
import { createAdminClient } from "@/lib/supabase/admin";
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
  ehProvedorPixSelecionavel,
  obterProvedorPixGeranet,
} from "@/lib/pagamentos/pix/provedores";
import {
  diagnosticoSeguroArquivoC6,
  erroReadBackC6,
  flagsExistenciaCofreC6,
  respostaPublicaSalvarPixC6,
  chavePixC6ParaVault,
  type DiagnosticoSeguroC6,
} from "@/lib/pagamentos/pix/c6/persistencia";
import {
  consultarWebhookPixC6,
  registrarWebhookPixC6,
  removerWebhookPixC6,
} from "@/lib/pagamentos/pix/c6/adapter";

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
  const chavePix =
    texto(formData.get("chave_pix")) || texto(formData.get("chavePix"));
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
  if (
    !meta?.configuracaoDisponivel ||
    (!ehProvedorPixSelecionavel(provedor) && provedor !== "gerencianet")
  ) {
    return {
      ok: false as const,
      erro: "Este provedor ainda não está disponível para configuração.",
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

  const metaCertificado = metaArquivoFormData(
    formData.get("certificadoPemHexadecimal")
  );
  const metaChave = metaArquivoFormData(
    formData.get("chavePrivadaPemHexadecimal")
  );
  const rpcCertificado = { executada: false };
  const rpcChave = { executada: false };
  let incluidoCertificado = false;
  let incluidoChave = false;
  let motivoCertificado: string | null = null;
  let motivoChave: string | null = null;

  if (meta?.configuracaoDisponivel) {
    const coletados = await coletarNovosSegredosDoFormulario(
      formData,
      provedor,
      ambiente
    );
    incluidoCertificado = Boolean(
      coletados.diagnosticoArquivos.find(
        (item) => item.campo === "certificadoPemHexadecimal"
      )?.incluidoEmNovos
    );
    incluidoChave = Boolean(
      coletados.diagnosticoArquivos.find(
        (item) => item.campo === "chavePrivadaPemHexadecimal"
      )?.incluidoEmNovos
    );
    motivoCertificado =
      coletados.diagnosticoArquivos.find(
        (item) => item.campo === "certificadoPemHexadecimal"
      )?.motivoNaoIncluido ?? null;
    motivoChave =
      coletados.diagnosticoArquivos.find(
        (item) => item.campo === "chavePrivadaPemHexadecimal"
      )?.motivoNaoIncluido ?? null;
    if (coletados.erro) {
      if (provedor === "c6bank") {
        return respostaPublicaSalvarPixC6({
          ok: false,
          erro: coletados.erro,
          certificadoConfigurado: false,
          chavePrivadaConfigurada: false,
          diagnostico: {
            certificado: diagnosticoSeguroArquivoC6({
              recebido: metaCertificado.existe,
              size: metaCertificado.size,
              temArrayBuffer: metaCertificado.temArrayBuffer,
              incluidoEmNovos: incluidoCertificado,
              rpcExecutada: false,
              readBackEncontrou: false,
              motivoNaoIncluido: motivoCertificado,
            }),
            chave: diagnosticoSeguroArquivoC6({
              recebido: metaChave.existe,
              size: metaChave.size,
              temArrayBuffer: metaChave.temArrayBuffer,
              incluidoEmNovos: incluidoChave,
              rpcExecutada: false,
              readBackEncontrou: false,
              motivoNaoIncluido: motivoChave,
            }),
          },
        });
      }
      return { ok: false as const, erro: coletados.erro };
    }

    for (const [campo, valor] of Object.entries(coletados.novos)) {
      const { error } = await supabase.rpc("salvar_segredo_bancario_provedor", {
        p_empresa_id: empresaId,
        p_provedor: provedor,
        p_ambiente: ambiente,
        p_campo: campo,
        p_valor: valor,
      });
      if (campo === "certificadoPemHexadecimal") {
        rpcCertificado.executada = true;
      }
      if (campo === "chavePrivadaPemHexadecimal") {
        rpcChave.executada = true;
      }
      if (error) {
        return { ok: false as const, erro: error.message };
      }
      flagsAtuais[campo] = true;
    }
  }

  if (provedor === "c6bank") {
    const chavePixC6 = chavePixC6ParaVault(chavePix);
    if (chavePixC6) {
      const { error: erroChavePix } = await supabase.rpc(
        "salvar_segredo_bancario_provedor",
        {
          p_empresa_id: empresaId,
          p_provedor: provedor,
          p_ambiente: ambiente,
          p_campo: "chavePix",
          p_valor: chavePixC6,
        }
      );
      if (erroChavePix) {
        return { ok: false as const, erro: erroChavePix.message };
      }
    }
  }

  let readBack = flagsExistenciaCofreC6(null);
  if (provedor === "c6bank") {
    const admin = createAdminClient();
    const { data: lidos } = await admin.rpc(
      "obter_segredos_bancarios_provedor",
      {
        p_empresa_id: empresaId,
        p_provedor: provedor,
        p_ambiente: ambiente,
      }
    );
    readBack = flagsExistenciaCofreC6(
      lidos && typeof lidos === "object"
        ? (lidos as Record<string, unknown>)
        : {}
    );
    flagsAtuais.clienteId = readBack.clienteId || Boolean(flagsAtuais.clienteId);
    flagsAtuais.clienteSegredo =
      readBack.clienteSegredo || Boolean(flagsAtuais.clienteSegredo);
    flagsAtuais.certificadoPemHexadecimal =
      readBack.certificadoPemHexadecimal;
    flagsAtuais.chavePrivadaPemHexadecimal =
      readBack.chavePrivadaPemHexadecimal;
    flagsAtuais.chavePix = readBack.chavePix;
  }

  const diagnosticoC6: DiagnosticoSeguroC6 = {
    certificado: diagnosticoSeguroArquivoC6({
      recebido: metaCertificado.existe,
      size: metaCertificado.size,
      temArrayBuffer: metaCertificado.temArrayBuffer,
      incluidoEmNovos: incluidoCertificado,
      rpcExecutada: rpcCertificado.executada,
      readBackEncontrou: readBack.certificadoPemHexadecimal,
      motivoNaoIncluido: motivoCertificado,
    }),
    chave: diagnosticoSeguroArquivoC6({
      recebido: metaChave.existe,
      size: metaChave.size,
      temArrayBuffer: metaChave.temArrayBuffer,
      incluidoEmNovos: incluidoChave,
      rpcExecutada: rpcChave.executada,
      readBackEncontrou: readBack.chavePrivadaPemHexadecimal,
      motivoNaoIncluido: motivoChave,
    }),
  };

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
    provedor === "c6bank"
      ? readBack.certificadoPemHexadecimal &&
        readBack.chavePrivadaPemHexadecimal
      : arquivos.length > 0 &&
        arquivos.every((campo) => flagsFinais[campo.chave]);

  const registro = {
    empresa_id: empresaId,
    modo: "geranet",
    gateway: "geranet",
    provedor,
    ambiente,
    ativo: true,
    chave_pix: chavePix || atual?.chave_pix || null,
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

  if (provedor === "c6bank") {
    const erroCofre = erroReadBackC6(readBack);
    const publico = respostaPublicaSalvarPixC6({
      ok: !erroCofre,
      erro: erroCofre ?? undefined,
      certificadoConfigurado: readBack.certificadoPemHexadecimal,
      chavePrivadaConfigurada: readBack.chavePrivadaPemHexadecimal,
      diagnostico: diagnosticoC6,
    });
    if (!publico.ok) {
      return publico;
    }
    revalidatePath("/configuracoes/financeiro/pix");
    return publico;
  }

  revalidatePath("/configuracoes/financeiro/pix");
  return { ok: true as const };
}

export async function gerenciarWebhookPixC6(
  operacao: "registrar" | "consultar" | "remover"
) {
  const { empresaId } = await exigirAdministradorPix();
  try {
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "gerenciarWebhookPixC6",
    });
    const resultado =
      operacao === "registrar"
        ? await registrarWebhookPixC6(empresaId)
        : operacao === "consultar"
          ? await consultarWebhookPixC6(empresaId)
          : await removerWebhookPixC6(empresaId);
    return {
      ok: true as const,
      mensagem:
        operacao === "registrar"
          ? "Webhook C6 registrado."
          : operacao === "consultar"
            ? resultado.webhookUrl
              ? "Webhook C6 consultado."
              : "Nenhum webhook C6 cadastrado."
            : "Webhook C6 removido.",
      webhookUrl: resultado.webhookUrl,
      ambiente: resultado.ambiente,
    };
  } catch (error) {
    return {
      ok: false as const,
      erro:
        error instanceof Error
          ? error.message
          : "Falha ao operar o webhook C6.",
    };
  }
}
