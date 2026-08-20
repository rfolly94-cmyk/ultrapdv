export function PdvIndisponivelAssinatura() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">PDV indisponível</h1>
        <p className="mt-3 text-sm text-zinc-600">
          A assinatura desta empresa está suspensa. Regularize para voltar a
          realizar vendas.
        </p>
        <div className="mt-5 flex gap-2">
          <a href="/assinatura" className="updv-btn updv-btn-primary">
            Ver assinatura
          </a>
          <a href="/logout" className="updv-btn updv-btn-ghost">
            Sair
          </a>
        </div>
      </div>
    </div>
  );
}
