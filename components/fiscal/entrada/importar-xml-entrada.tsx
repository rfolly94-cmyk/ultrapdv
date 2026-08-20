"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { importarXmlNfeEntrada } from "@/app/fiscal/entradas/actions";
import { AppModal } from "@/components/ui/app-modal";
import { MENSAGEM_NFE_JA_IMPORTADA } from "@/lib/fiscal/entrada/mensagens";

export function ImportarXmlEntrada({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await importarXmlNfeEntrada(formData);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      onClose();
      formRef.current?.reset();

      if (resultado.documentoId) {
        const aviso = resultado.jaExistia
          ? `?sucesso=${encodeURIComponent(MENSAGEM_NFE_JA_IMPORTADA)}`
          : "";
        router.push(`/fiscal/entradas/${resultado.documentoId}${aviso}`);
        router.refresh();
      }
    });
  }

  return (
    <AppModal
      open={open}
      title="Importar XML da NF-e"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-importar-xml-entrada"
            className="updv-btn updv-btn-primary disabled:opacity-60"
            disabled={pending}
          >
            {pending ? "Importando..." : "Importar XML"}
          </button>
        </>
      }
    >
      <form
        id="form-importar-xml-entrada"
        ref={formRef}
        action={enviar}
        className="space-y-3"
      >
        <p className="text-[13px] text-zinc-600">
          Envie o XML original da NF-e do fornecedor. A importação não
          movimenta estoque.
        </p>
        <input
          type="file"
          name="xml"
          accept=".xml,text/xml,application/xml"
          required
          className="updv-input w-full text-[13px]"
        />
        {erro ? (
          <p className="text-[13px] text-red-700">{erro}</p>
        ) : null}
      </form>
    </AppModal>
  );
}
