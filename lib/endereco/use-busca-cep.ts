"use client";

import { useRef, useState } from "react";

import {
  buscarEnderecoPorCep,
  digitosCep,
  MENSAGEM_CEP_CONSULTA_FALHOU,
  MENSAGEM_CEP_NAO_ENCONTRADO,
  type EnderecoViaCep,
} from "@/lib/endereco/viacep";

export function useBuscaCep(onEndereco: (endereco: EnderecoViaCep) => void) {
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultimoCep = useRef("");
  const emAndamento = useRef("");
  const onEnderecoRef = useRef(onEndereco);
  onEnderecoRef.current = onEndereco;

  async function consultar(cepBruto: string) {
    const cep = digitosCep(cepBruto);
    if (cep.length !== 8) {
      return;
    }
    if (ultimoCep.current === cep || emAndamento.current === cep) {
      return;
    }
    emAndamento.current = cep;
    setCarregando(true);
    setAviso(null);
    const resultado = await buscarEnderecoPorCep(cep);
    emAndamento.current = "";
    setCarregando(false);
    if (resultado.ok) {
      ultimoCep.current = cep;
      onEnderecoRef.current(resultado.endereco);
      return;
    }
    if (resultado.motivo === "nao_encontrado") {
      ultimoCep.current = cep;
      setAviso(MENSAGEM_CEP_NAO_ENCONTRADO);
      return;
    }
    if (resultado.motivo === "falha") {
      setAviso(MENSAGEM_CEP_CONSULTA_FALHOU);
    }
  }

  function aoAlterarCep(valor: string) {
    const cep = digitosCep(valor);
    if (cep.length < 8 && ultimoCep.current) {
      ultimoCep.current = "";
      setAviso(null);
    }
    if (cep.length === 8) {
      void consultar(valor);
    }
  }

  function aoSairCep(valor: string) {
    void consultar(valor);
  }

  return { carregando, aviso, consultar, aoAlterarCep, aoSairCep };
}
