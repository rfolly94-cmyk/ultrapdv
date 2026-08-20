"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AppModal } from "@/components/ui/app-modal";
import {
  masterAlterarPlano,
  masterAtivarEmpresa,
  masterCancelarAssinatura,
  masterCarenciaEmpresa,
  masterLiberarTemporariamente,
  masterSuspenderEmpresa,
} from "@/lib/master/acoes";
import { diasLiberacaoTemporaria } from "@/lib/assinatura/aplicar-acao";

type Painel = "suspender" | "carencia" | "liberar" | null;

export function MasterAcoesAssinatura({
  empresaId,
  planoId,
  vencimento,
  status,
  planos,
}: {
  empresaId: string;
  planoId: string | null;
  vencimento: string | null;
  status?: string | null;
  planos: Array<{ id: string; nome: string }>;
}) {
  const [erro, setErro] = useState("");
  const [painel, setPainel] = useState<Painel>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const jaAtiva = status === "ativa" || status === "trial";
  const jaCancelada = status === "cancelada";

  function executar(
    acao: (formData: FormData) => Promise<{ ok: boolean; erro?: string }>,
    data: FormData
  ) {
    data.set("empresa_id", empresaId);
    start(async () => {
      const resultado = await acao(data);
      if (resultado.ok) {
        setErro("");
        setPainel(null);
        router.refresh();
        return;
      }
      setErro(resultado.erro || "Não foi possível salvar.");
    });
  }

  function enviarFormulario(
    acao: (formData: FormData) => Promise<{ ok: boolean; erro?: string }>,
    form: HTMLFormElement
  ) {
    executar(acao, new FormData(form));
  }

  return (
    <div className="space-y-5">
      {erro ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>
      ) : null}

      <form
        className="grid gap-3 border-b border-zinc-100 pb-5 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          enviarFormulario(masterAlterarPlano, event.currentTarget);
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500">Plano</span>
          <select name="plano_id" defaultValue={planoId ?? ""} className="updv-input w-full">
            <option value="">Sem plano</option>
            {planos.map((plano) => (
              <option key={plano.id} value={plano.id}>
                {plano.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500">Vencimento</span>
          <input
            type="date"
            name="vencimento_em"
            defaultValue={vencimento?.slice(0, 10) ?? ""}
            className="updv-input w-full"
          />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className="updv-btn updv-btn-primary">
            Salvar plano
          </button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || jaAtiva}
          className="updv-btn updv-btn-primary"
          onClick={() => {
            if (!confirm("Reativar esta empresa?")) return;
            const data = new FormData();
            data.set("motivo", "Reativação Master");
            executar(masterAtivarEmpresa, data);
          }}
        >
          Reativar
        </button>
        <button
          type="button"
          disabled={pending || jaCancelada}
          className="updv-btn updv-btn-ghost"
          onClick={() => setPainel("suspender")}
        >
          Suspender
        </button>
        <button
          type="button"
          disabled={pending || jaCancelada}
          className="updv-btn updv-btn-ghost"
          onClick={() => setPainel("carencia")}
        >
          Carência
        </button>
        <button
          type="button"
          disabled={pending || jaCancelada}
          className="updv-btn updv-btn-ghost"
          onClick={() => setPainel("liberar")}
        >
          Liberar
        </button>
        <button
          type="button"
          disabled={pending || jaCancelada}
          className="updv-btn updv-btn-ghost text-red-700"
          onClick={() => {
            if (
              !confirm(
                "Cancelar a assinatura? Os dados da empresa serão preservados."
              )
            ) {
              return;
            }
            const data = new FormData();
            data.set("motivo", "Cancelamento Master");
            executar(masterCancelarAssinatura, data);
          }}
        >
          Cancelar assinatura
        </button>
      </div>

      <AppModal
        open={painel === "suspender"}
        title="Suspender empresa"
        onClose={() => setPainel(null)}
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setPainel(null)}
              disabled={pending}
            >
              Voltar
            </button>
            <button
              type="submit"
              form="master-suspender"
              disabled={pending}
              className="updv-btn updv-btn-primary"
            >
              Suspender
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-600">
          A empresa deixa de operar imediatamente. Os dados serão preservados.
        </p>
        <form
          id="master-suspender"
          onSubmit={(event) => {
            event.preventDefault();
            enviarFormulario(masterSuspenderEmpresa, event.currentTarget);
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Motivo da suspensão</span>
            <textarea name="motivo" required className="updv-input min-h-24 w-full" />
          </label>
        </form>
      </AppModal>

      <AppModal
        open={painel === "carencia"}
        title="Colocar em carência"
        onClose={() => setPainel(null)}
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setPainel(null)}
              disabled={pending}
            >
              Voltar
            </button>
            <button
              type="submit"
              form="master-carencia"
              disabled={pending}
              className="updv-btn updv-btn-primary"
            >
              Confirmar carência
            </button>
          </>
        }
      >
        <form
          id="master-carencia"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            enviarFormulario(masterCarenciaEmpresa, event.currentTarget);
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Carência até</span>
            <input type="date" name="carencia_ate" required className="updv-input w-full" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Motivo</span>
            <input name="motivo" className="updv-input w-full" />
          </label>
        </form>
      </AppModal>

      <AppModal
        open={painel === "liberar"}
        title="Liberar temporariamente"
        onClose={() => setPainel(null)}
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setPainel(null)}
              disabled={pending}
            >
              Voltar
            </button>
            <button
              type="submit"
              form="master-liberar"
              disabled={pending}
              className="updv-btn updv-btn-primary"
            >
              Liberar
            </button>
          </>
        }
      >
        <form
          id="master-liberar"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            enviarFormulario(masterLiberarTemporariamente, event.currentTarget);
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Prazo</span>
            <select name="dias" defaultValue="7" className="updv-input w-full">
              {diasLiberacaoTemporaria().map((dias) => (
                <option key={dias} value={dias}>
                  {dias} dia(s)
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Ou data personalizada</span>
            <input type="date" name="liberado_ate" className="updv-input w-full" />
          </label>
        </form>
      </AppModal>
    </div>
  );
}
