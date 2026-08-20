export default function CatalogoNaoEncontrado() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-zinc-500">Catálogo</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
          Loja não encontrada
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Este link de catálogo não existe ou foi alterado.
        </p>
      </div>
    </main>
  );
}
