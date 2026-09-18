"use client";

import { Search } from "lucide-react";

import {
  MENSAGEM_CONSULTANDO_CNPJ,
  mascararCnpjDigitando,
  type DadosCnpjNormalizados,
} from "@/lib/cadastro/cnpj";
import { useConsultaCnpj } from "@/lib/cadastro/use-consulta-cnpj";
import { somenteDigitosDocumento } from "@/lib/fiscal/destinatario/documento";

type ModoConsultaCnpj = "novo" | "edicao";

export function ConsultaCnpjCampo({
  name = "cpf_cnpj",
  value,
  onChange,
  onAplicar,
  modo,
  disabled,
  required,
  label = "CNPJ",
  inputClassName = "updv-input mt-1 w-full",
  placeholder = "00.000.000/0000-00",
  formatar = mascararCnpjDigitando,
}: {
  name?: string;
  value: string;
  onChange: (valor: string) => void;
  onAplicar: (dados: DadosCnpjNormalizados) => void;
  modo: ModoConsultaCnpj;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  inputClassName?: string;
  placeholder?: string;
  formatar?: (valor: string) => string;
}) {
  const consulta = useConsultaCnpj(onAplicar);
  const podeConsultar = !disabled && somenteDigitosDocumento(value).length === 14;

  function aplicarMascara(valor: string) {
    onChange(formatar(valor));
    consulta.aoAlterarCnpj(valor);
  }

  return (
    <div>
      {label ? (
        <label className="text-sm font-medium text-zinc-700" htmlFor={name}>
          {label}
          {required ? " *" : ""}
        </label>
      ) : null}

      <div className="relative">
        <input
          id={name}
          name={name}
          value={value}
          inputMode="numeric"
          autoComplete="off"
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => aplicarMascara(event.target.value)}
          onBlur={(event) => consulta.aoSairCnpj(event.target.value, modo === "novo")}
          className={`${inputClassName} pr-8`}
        />
        <button
          type="button"
          title="Consultar CNPJ"
          aria-label="Consultar CNPJ"
          disabled={!podeConsultar || consulta.carregando}
          onClick={() => consulta.consultar(value, { aplicar: true, forcar: true })}
          className="absolute bottom-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-40"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>

      {consulta.carregando ? (
        <p className="mt-1 text-xs text-zinc-500">{MENSAGEM_CONSULTANDO_CNPJ}</p>
      ) : consulta.aviso ? (
        <p className="mt-1 text-xs text-amber-700">{consulta.aviso}</p>
      ) : null}
    </div>
  );
}
