"use client";

import { useRef, useState } from "react";

import {
  MENSAGEM_CNPJ_INDISPONIVEL,
  MENSAGEM_CNPJ_INVALIDO,
  type DadosCnpjNormalizados,
  type MotivoConsultaCnpj,
} from "@/lib/cadastro/cnpj";
import { cnpjValido, somenteDigitosDocumento } from "@/lib/fiscal/destinatario/documento";

type ResultadoApi =
  | { ok: true; dados: DadosCnpjNormalizados; aviso?: string }
  | { ok: false; motivo?: MotivoConsultaCnpj; erro?: string };

export function useConsultaCnpj(onAplicar: (dados: DadosCnpjNormalizados) => void) {
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultimoCnpj = useRef("");
  const emAndamento = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAplicarRef = useRef(onAplicar);
  onAplicarRef.current = onAplicar;

  function limparDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  async function executar(cnpjBruto: string, aplicar: boolean, forcar: boolean) {
    const cnpj = somenteDigitosDocumento(cnpjBruto);
    if (cnpj.length !== 14) {
      return;
    }
    if (!cnpjValido(cnpj)) {
      ultimoCnpj.current = "";
      setAviso(MENSAGEM_CNPJ_INVALIDO);
      return;
    }
    if (!forcar && (ultimoCnpj.current === cnpj || emAndamento.current === cnpj)) {
      return;
    }
    emAndamento.current = cnpj;
    setCarregando(true);
    setAviso(null);
    try {
      const resposta = await fetch(
        `/api/cadastro/cnpj?cnpj=${encodeURIComponent(cnpj)}`,
        { method: "GET", cache: "no-store" }
      );
      const payload = (await resposta.json().catch(() => ({}))) as ResultadoApi;
      if (!payload.ok) {
        setAviso(payload.erro || MENSAGEM_CNPJ_INDISPONIVEL);
        return;
      }
      ultimoCnpj.current = cnpj;
      if (payload.aviso) {
        setAviso(payload.aviso);
      }
      if (aplicar) {
        onAplicarRef.current(payload.dados);
      }
    } catch {
      setAviso(MENSAGEM_CNPJ_INDISPONIVEL);
    } finally {
      emAndamento.current = "";
      setCarregando(false);
    }
  }

  function consultar(
    cnpjBruto: string,
    opcoes?: { aplicar?: boolean; forcar?: boolean }
  ) {
    limparDebounce();
    debounceRef.current = setTimeout(() => {
      void executar(
        cnpjBruto,
        opcoes?.aplicar !== false,
        opcoes?.forcar === true
      );
    }, 280);
  }

  function aoSairCnpj(cnpjBruto: string, aplicar: boolean) {
    if (!aplicar) return;
    consultar(cnpjBruto, { aplicar: true });
  }

  function aoAlterarCnpj(valor: string) {
    const cnpj = somenteDigitosDocumento(valor);
    if (cnpj.length < 14 && ultimoCnpj.current) {
      ultimoCnpj.current = "";
      setAviso(null);
    }
  }

  return {
    carregando,
    aviso,
    consultar,
    aoSairCnpj,
    aoAlterarCnpj,
  };
}
