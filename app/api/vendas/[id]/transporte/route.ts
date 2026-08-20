import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type Volume = {
  quantidade?:
    | number
    | string
    | null;
  especie?: string;
  marca?: string;
  numeracao?: string;
  peso_bruto_kg?:
    | number
    | string
    | null;
  peso_liquido_kg?:
    | number
    | string
    | null;
};

type Body = {
  mod_frete?: string;
  transportadora_id?:
    | string
    | null;
  veiculo_id?:
    | string
    | null;
  transportador?: {
    nome_razao_social?: string;
    cpf_cnpj?: string;
    inscricao_estadual?: string;
    endereco?: string;
    municipio?: string;
    uf?: string;
  } | null;
  veiculo?: {
    rntc?: string;
    placa?: string;
    uf?: string;
  } | null;
  volumes?: Volume[];
};

const MODALIDADES =
  new Set([
    "0",
    "1",
    "2",
    "3",
    "4",
    "9",
  ]);

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function digitos(
  valor: unknown
) {
  return texto(valor)
    .replace(/\D/g, "");
}

function uf(
  valor: unknown
) {
  const retorno =
    texto(valor)
      .toUpperCase();

  if (!retorno) {
    return "";
  }

  if (
    !/^[A-Z]{2}$/.test(
      retorno
    )
  ) {
    throw new Error(
      "UF deve possuir 2 letras."
    );
  }

  return retorno;
}

function decimalOpcional(
  valor: unknown,
  campo: string
):
  | number
  | null {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return null;
  }

  const normalizado =
    texto(valor)
      .replace(",", ".");

  const numero =
    Number(normalizado);

  if (
    !Number.isFinite(
      numero
    ) ||
    numero < 0
  ) {
    throw new Error(
      `${campo} inválido.`
    );
  }

  return numero;
}

function inteiroOpcional(
  valor: unknown,
  campo: string
):
  | number
  | null {
  const numero =
    decimalOpcional(
      valor,
      campo
    );

  if (
    numero === null
  ) {
    return null;
  }

  if (
    !Number.isInteger(
      numero
    )
  ) {
    throw new Error(
      `${campo} deve ser um número inteiro.`
    );
  }

  return numero;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id: vendaId,
  } =
    await context.params;

  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  try {
    const {
      data: claimsData,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claimsData
        ?.claims
        ?.sub
    ) {
      return json(
        {
          ok: false,
          erro:
            "Não autenticado.",
        },
        401
      );
    }

    const {
      data: vinculo,
      error:
        vinculoError,
    } =
      await supabase
        .from(
          "usuarios_empresas"
        )
        .select(
          "empresa_id"
        )
        .eq(
          "usuario_id",
          String(claimsData.claims.sub)
        )
        .eq(
          "principal",
          true
        )
        .eq(
          "ativo",
          true
        )
        .maybeSingle();

    if (
      vinculoError ||
      !vinculo
    ) {
      return json(
        {
          ok: false,
          erro:
            "Empresa ativa não encontrada.",
        },
        403
      );
    }

    const empresaId =
      vinculo.empresa_id;

    let body: Body;

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          ok: false,
          erro:
            "JSON inválido.",
        },
        400
      );
    }

    const modFrete =
      texto(
        body.mod_frete ??
          "9"
      );

    if (
      !MODALIDADES.has(
        modFrete
      )
    ) {
      return json(
        {
          ok: false,
          erro:
            "Modalidade de frete inválida. Use 0, 1, 2, 3, 4 ou 9.",
        },
        400
      );
    }

    const {
      data: venda,
      error: vendaError,
    } =
      await admin
        .from("vendas")
        .select(
          "id, status"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          vendaId
        )
        .maybeSingle();

    if (
      vendaError ||
      !venda
    ) {
      return json(
        {
          ok: false,
          erro:
            vendaError
              ?.message ??
            "Venda não encontrada.",
        },
        404
      );
    }

    if (
      venda.status !==
      "finalizada"
    ) {
      return json(
        {
          ok: false,
          erro:
            "Somente venda finalizada pode receber dados de transporte para emissão fiscal.",
        },
        409
      );
    }

    const {
      data:
        emissoesBloqueantes,
      error:
        fiscalError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(
          "id, modelo, status, serie, numero, resposta_resumo, cstat, motivo, protocolo, chave_acesso, geranet_http_status, geranet_situacao, erro_comunicacao"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "origem_tipo",
          "venda"
        )
        .eq(
          "origem_id",
          vendaId
        );

    if (
      fiscalError
    ) {
      return json(
        {
          ok: false,
          erro:
            fiscalError.message,
        },
        500
      );
    }

    const emissaoBloqueante = (emissoesBloqueantes ?? []).find(
      (emissao) =>
        !resolverEstadoOperacionalDeEmissaoPersistida(emissao).podeEditarFiscal
    );

    if (emissaoBloqueante) {
      return json(
        {
          ok: false,
          erro:
            `Os dados de transporte não podem ser alterados porque existe documento fiscal em estado ${emissaoBloqueante.status ?? "sensível"}.`,
        },
        409
      );
    }

    const transportadoraId =
      texto(
        body.transportadora_id
      ) ||
      null;

    const veiculoId =
      texto(
        body.veiculo_id
      ) ||
      null;

    if (
      transportadoraId
    ) {
      const {
        data:
          transportadoraCadastro,
        error:
          transportadoraCadastroError,
      } =
        await admin
          .from(
            "transportadoras"
          )
          .select(
            "id, ativo"
          )
          .eq(
            "id",
            transportadoraId
          )
          .eq(
            "empresa_id",
            empresaId
          )
          .maybeSingle();

      if (
        transportadoraCadastroError ||
        !transportadoraCadastro ||
        !transportadoraCadastro.ativo
      ) {
        return json(
          {
            ok: false,
            erro:
              "A transportadora selecionada não existe ou está inativa.",
          },
          400
        );
      }
    }

    if (
      veiculoId
    ) {
      if (
        !transportadoraId
      ) {
        return json(
          {
            ok: false,
            erro:
              "Selecione a transportadora antes do veículo.",
          },
          400
        );
      }

      const {
        data:
          veiculoCadastro,
        error:
          veiculoCadastroError,
      } =
        await admin
          .from(
            "transportadoras_veiculos"
          )
          .select(
            "id, transportadora_id, ativo"
          )
          .eq(
            "id",
            veiculoId
          )
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "transportadora_id",
            transportadoraId
          )
          .maybeSingle();

      if (
        veiculoCadastroError ||
        !veiculoCadastro ||
        !veiculoCadastro.ativo
      ) {
        return json(
          {
            ok: false,
            erro:
              "O veículo selecionado não existe, está inativo ou pertence a outra transportadora.",
          },
          400
        );
      }
    }

    const documento =
      digitos(
        body.transportador
          ?.cpf_cnpj
      );

    if (
      documento &&
      documento.length !==
        11 &&
      documento.length !==
        14
    ) {
      return json(
        {
          ok: false,
          erro:
            "CNPJ/CPF do transportador deve possuir 11 ou 14 dígitos.",
        },
        400
      );
    }

    const placa =
      texto(
        body.veiculo
          ?.placa
      )
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );

    if (
      placa &&
      placa.length !== 7
    ) {
      return json(
        {
          ok: false,
          erro:
            "Placa do veículo deve possuir 7 caracteres.",
        },
        400
      );
    }

    const volumes =
      Array.isArray(
        body.volumes
      )
        ? body.volumes
        : [];

    const volumesNormalizados =
      volumes.map(
        (
          volume,
          indice
        ) => ({
          quantidade:
            inteiroOpcional(
              volume
                .quantidade,
              `Quantidade do volume ${indice + 1}`
            ),
          especie:
            texto(
              volume.especie
            ) ||
            texto(
              (
                volume as {
                  descricao?: string;
                }
              ).descricao
            ),
          marca:
            texto(
              volume.marca
            ),
          numeracao:
            texto(
              volume.numeracao
            ),
          peso_bruto_kg:
            decimalOpcional(
              volume
                .peso_bruto_kg,
              `Peso bruto do volume ${indice + 1}`
            ),
          peso_liquido_kg:
            decimalOpcional(
              volume
                .peso_liquido_kg,
              `Peso líquido do volume ${indice + 1}`
            ),
        })
      );

    const dados = {
      versao: 1,
      mod_frete:
        modFrete,
      transportadora_id:
        transportadoraId,
      veiculo_id:
        veiculoId,
      transportador: {
        nome_razao_social:
          texto(
            body.transportador
              ?.nome_razao_social
          ),
        cpf_cnpj:
          documento,
        inscricao_estadual:
          texto(
            body.transportador
              ?.inscricao_estadual
          ),
        endereco:
          texto(
            body.transportador
              ?.endereco
          ),
        municipio:
          texto(
            body.transportador
              ?.municipio
          ),
        uf:
          uf(
            body.transportador
              ?.uf
          ),
      },
      veiculo: {
        rntc:
          texto(
            body.veiculo
              ?.rntc
          ),
        placa,
        uf:
          uf(
            body.veiculo
              ?.uf
          ),
      },
      volumes:
        volumesNormalizados,
    };

    if (transporteConflitaComFrete9(dados)) {
      return json(
        {
          ok: false,
          erro: MENSAGEM_FRETE_9_COM_DADOS,
        },
        400
      );
    }

    const {
      error: updateError,
    } =
      await admin
        .from("vendas")
        .update({
          dados_transporte:
            dados,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          vendaId
        );

    if (
      updateError
    ) {
      return json(
        {
          ok: false,
          erro:
            updateError.message,
        },
        422
      );
    }

    return json({
      ok: true,
      venda_id:
        vendaId,
      dados_transporte:
        dados,
      mensagem:
        "Dados de transporte salvos com sucesso.",
    });
  } catch (
    error
  ) {
    console.error(
      "[VENDA TRANSPORTE]",
      error
    );

    return json(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao salvar dados de transporte.",
      },
      500
    );
  }
}
