"use client";

import {
  type FormEvent,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type Props = {
  nomeInicial: string;
  email: string;
};

function somenteDigitos(
  valor: string
) {
  return valor.replace(
    /\D/g,
    ""
  );
}

function formatarCnpj(
  valor: string
) {
  const digitos =
    somenteDigitos(
      valor
    ).slice(
      0,
      14
    );

  return digitos
    .replace(
      /^(\d{2})(\d)/,
      "$1.$2"
    )
    .replace(
      /^(\d{2})\.(\d{3})(\d)/,
      "$1.$2.$3"
    )
    .replace(
      /\.(\d{3})(\d)/,
      ".$1/$2"
    )
    .replace(
      /(\d{4})(\d)/,
      "$1-$2"
    );
}

export function
OnboardingEmpresaForm({
  nomeInicial,
  email,
}: Props) {
  const router = useRouter();
  const [
    processando,
    setProcessando,
  ] =
    useState(false);

  const [
    erro,
    setErro,
  ] =
    useState("");

  const [
    cnpj,
    setCnpj,
  ] =
    useState("");

  async function
  enviar(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErro("");
    setProcessando(true);

    try {
      const form =
        new FormData(
          event.currentTarget
        );

      const response =
        await fetch(
          "/api/onboarding/empresa",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                nome:
                  form.get(
                    "nome"
                  ),
                razao_social:
                  form.get(
                    "razao_social"
                  ),
                nome_fantasia:
                  form.get(
                    "nome_fantasia"
                  ),
                cnpj:
                  somenteDigitos(
                    cnpj
                  ),
              }),
          }
        );

      const payload =
        await response
          .json()
          .catch(
            () => ({})
          ) as {
            ok?: boolean;
            erro?: string;
            destino?: string;
          };

      if (
        payload.destino ===
        "/confirmar-email"
      ) {
        router.push("/confirmar-email");
        router.refresh();
        return;
      }

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.erro ??
          "Não foi possível cadastrar a empresa."
        );
      }

      router.push(payload.destino ?? "/painel");
      router.refresh();
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar a empresa."
      );
    } finally {
      setProcessando(
        false
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
        <div>
          <p className="text-sm font-semibold text-zinc-500">
            UltraPDV
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">
            Cadastre sua empresa
          </h1>

          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Você será o administrador principal desta empresa no UltraPDV.
          </p>
        </div>

        {erro && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {erro}
          </div>
        )}

        <form
          onSubmit={
            enviar
          }
          className="mt-6 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Campo
              label="Responsável"
              name="nome"
              defaultValue={
                nomeInicial
              }
              required
            />

            <div>
              <span className="text-sm font-medium text-zinc-700">
                E-mail do login
              </span>

              <input
                value={
                  email
                }
                disabled
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-500"
              />
            </div>
          </div>

          <Campo
            label="CNPJ"
            name="cnpj_visual"
            value={cnpj}
            onChange={(
              valor
            ) =>
              setCnpj(
                formatarCnpj(
                  valor
                )
              )
            }
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            required
          />

          <Campo
            label="Razão social"
            name="razao_social"
            required
          />

          <Campo
            label="Nome fantasia"
            name="nome_fantasia"
            required
          />

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800">
            O cadastro fiscal, certificado A1, CSC e numeração serão configurados depois em Configurações fiscais.
          </div>

          <button
            type="submit"
            disabled={
              processando
            }
            className="flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {processando
              ? "Criando empresa..."
              : "Criar empresa e entrar"}
          </button>
        </form>

        <div className="mt-6 border-t border-zinc-200 pt-5 text-center">
          <a
            href="/logout"
            className="text-sm font-semibold text-zinc-600 underline"
          >
            Sair e usar outro login
          </a>
        </div>
      </div>
    </main>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  value,
  onChange,
  required,
  inputMode,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (
    valor: string
  ) => void;
  required?: boolean;
  inputMode?:
    "numeric"
    | "text"
    | "email"
    | "tel"
    | "url"
    | "search"
    | "decimal"
    | "none";
  placeholder?: string;
}) {
  const controlado =
    typeof value ===
    "string";

  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">
        {label}
      </span>

      <input
        name={name}
        defaultValue={
          controlado
            ? undefined
            : defaultValue
        }
        value={
          controlado
            ? value
            : undefined
        }
        onChange={
          onChange
            ? (
                event
              ) =>
                onChange(
                  event.target
                    .value
                )
            : undefined
        }
        required={
          required
        }
        inputMode={
          inputMode
        }
        placeholder={
          placeholder
        }
        className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none transition focus:border-zinc-700 focus:ring-2 focus:ring-zinc-100"
      />
    </label>
  );
}
