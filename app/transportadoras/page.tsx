import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  TransportadorasWorkspace,
} from "@/components/transportadoras/transportadoras-workspace";

type PageProps = {
  searchParams: Promise<{
    nova?: string;
  }>;
};

export const dynamic =
  "force-dynamic";

export default async function TransportadorasPage({
  searchParams,
}: PageProps) {
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const {
    data: vinculo,
    error: vinculoError,
  } =
    await supabase
      .from("usuarios_empresas")
      .select(
        "empresa_id, perfil"
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
    redirect(
      "/onboarding"
    );
  }

  const {
    data: transportadoras,
    error: transportadorasError,
  } =
    await supabase
      .from(
        "transportadoras"
      )
      .select(`
        id,
        empresa_id,
        nome_razao_social,
        nome_fantasia,
        cpf_cnpj,
        inscricao_estadual,
        rntrc,
        telefone,
        email,
        logradouro,
        numero,
        complemento,
        bairro,
        municipio,
        codigo_municipio_ibge,
        uf,
        cep,
        ativo,
        created_at,
        updated_at
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .order(
        "ativo",
        {
          ascending:
            false,
        }
      )
      .order(
        "nome_razao_social",
        {
          ascending:
            true,
        }
      );

  if (
    transportadorasError
  ) {
    throw new Error(
      transportadorasError.message
    );
  }

  const ids =
    (
      transportadoras ??
      []
    ).map(
      (item) =>
        item.id
    );

  let veiculos:
    Array<Record<string, unknown>> =
    [];

  if (ids.length > 0) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "transportadoras_veiculos"
        )
        .select(`
          id,
          empresa_id,
          transportadora_id,
          placa,
          uf,
          rntrc,
          descricao,
          ativo,
          created_at,
          updated_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .in(
          "transportadora_id",
          ids
        )
        .order(
          "ativo",
          {
            ascending:
              false,
          }
        )
        .order(
          "placa",
          {
            ascending:
              true,
          }
        );

    if (error) {
      throw new Error(
        error.message
      );
    }

    veiculos =
      data ?? [];
  }

  const params =
    await searchParams;

  return (
    <TransportadorasWorkspace
      transportadoras={
        transportadoras ??
        []
      }
      veiculos={
        veiculos as never[]
      }
      abrirNovo={
        params.nova ===
        "1"
      }
      perfil={
        String(
          vinculo.perfil ??
          ""
        )
      }
    />
  );
}
